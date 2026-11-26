import { randomUUID } from 'crypto';
import {
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  HTTPFacilitatorClient,
} from '@x402/core/http';
import {
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_USDC,
} from '@x402/hedera';
import { AppError } from '../errors/app-error.js';
import { PAYMENT_CONFIG } from './payment.config.js';
import {
  X402PaymentRequirement,
  X402PaymentPayload,
  X402VerificationResult,
} from './payment.types.js';

/** How long the facilitator's advertised fee payer is cached. */
const FEE_PAYER_CACHE_MS = 10 * 60 * 1000;

export class X402Service {
  private feePayerCache: { network: string; feePayer: string; at: number } | null = null;

  /**
   * The fee payer the facilitator manages for this network, from its
   * /supported endpoint. A requirement naming any other account (the payment
   * receiver, as this service used to) is rejected by the official Hedera
   * facilitator with `fee_payer_not_managed_by_facilitator`, so settlement
   * could never succeed.
   */
  async getFacilitatorFeePayer(network: string): Promise<string> {
    const cached = this.feePayerCache;
    if (cached && cached.network === network && Date.now() - cached.at < FEE_PAYER_CACHE_MS) {
      return cached.feePayer;
    }
    let supported: { kinds?: Array<{ scheme?: string; network?: string; extra?: Record<string, unknown> }> };
    try {
      supported = await this.getFacilitatorClient().getSupported();
    } catch (err) {
      throw new AppError(
        `The payment facilitator is unavailable (${err instanceof Error ? err.message : 'unknown error'}). No payment was requested.`,
        503,
        'FACILITATOR_UNAVAILABLE',
      );
    }
    const kind = supported.kinds?.find(
      (k) => k.scheme === PAYMENT_CONFIG.SCHEME && k.network === network && typeof k.extra?.feePayer === 'string',
    );
    if (!kind) {
      throw new AppError(
        `The payment facilitator does not support '${PAYMENT_CONFIG.SCHEME}' payments on '${network}'. No payment was requested.`,
        503,
        'FACILITATOR_UNSUPPORTED',
      );
    }
    const feePayer = kind.extra!.feePayer as string;
    this.feePayerCache = { network, feePayer, at: Date.now() };
    return feePayer;
  }

  /**
   * Generates a standard x402 v2 payment requirement.
   */
  generateRequirement(options?: {
    amount?: string;
    asset?: string;
    network?: string;
    receiver?: string;
    paymentReference?: string;
    feePayer?: string;
    maxTimeoutSeconds?: number;
  }): X402PaymentRequirement {
    const paymentReference = options?.paymentReference || `x402_${randomUUID().replace(/-/g, '')}`;
    const amount = options?.amount || PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT;
    const asset = options?.asset || PAYMENT_CONFIG.USDC_TOKEN_ID || HEDERA_TESTNET_USDC;
    const network = options?.network || PAYMENT_CONFIG.NETWORK || HEDERA_TESTNET_CAIP2;
    const receiver = options?.receiver || PAYMENT_CONFIG.RECEIVER_ADDRESS;

    return {
      scheme: PAYMENT_CONFIG.SCHEME,
      network,
      asset,
      amount,
      receiver,
      paymentReference,
      maxTimeoutSeconds: options?.maxTimeoutSeconds ?? PAYMENT_CONFIG.MAX_TIMEOUT_SECONDS,
      ...(options?.feePayer && { feePayer: options.feePayer }),
    };
  }

  /**
   * The requirement in the x402 v2 wire shape the facilitator checks:
   * `payTo`, `maxTimeoutSeconds` and `extra.feePayer` must equal what the
   * client signed against, field for field.
   */
  toWireRequirement(requirement: X402PaymentRequirement) {
    return {
      scheme: requirement.scheme,
      network: requirement.network as `${string}:${string}`,
      asset: requirement.asset,
      amount: requirement.amount,
      payTo: requirement.receiver,
      maxTimeoutSeconds: requirement.maxTimeoutSeconds,
      extra: {
        ...(requirement.feePayer && { feePayer: requirement.feePayer }),
        paymentReference: requirement.paymentReference,
      },
    };
  }

  /**
   * Encodes standard x402 HTTP 402 header requirement.
   */
  encodeRequirementHeader(requirement: X402PaymentRequirement, resourceUrl = '', description = ''): string {
    return encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: resourceUrl, description, mimeType: 'application/json' },
      accepts: [this.toWireRequirement(requirement)],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  /**
   * Parses official x402 payment signature header.
   */
  parsePaymentHeader(headerValue?: string): X402PaymentPayload | null {
    if (!headerValue || typeof headerValue !== 'string') {
      return null;
    }

    try {
      // Decode using official x402 header decoder
      const decoded = decodePaymentSignatureHeader(headerValue);
      if (decoded && typeof decoded === 'object') {
        return decoded as unknown as X402PaymentPayload;
      }
      return null;
    } catch {
      // Direct JSON fallback parse if unencoded payload is passed
      try {
        let raw = headerValue.trim();
        if (raw.toLowerCase().startsWith('x402 ')) {
          raw = raw.slice(5).trim();
        }
        if (!raw.startsWith('{')) {
          raw = Buffer.from(raw, 'base64').toString('utf-8');
        }
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? (parsed as X402PaymentPayload) : null;
      } catch {
        return null;
      }
    }
  }

  private getFacilitatorClient(): HTTPFacilitatorClient {
    return new HTTPFacilitatorClient({
      url: PAYMENT_CONFIG.FACILITATOR_URL,
    });
  }

  /**
   * Cryptographically verifies payment payload and settles transaction on Hedera Testnet via x402 facilitator.
   * STRICT GOLDEN RULE: Settles only if network verification/settlement succeeds with a real Hedera transaction reference.
   */
  async verifyAndSettle(
    payload: X402PaymentPayload,
    requirement: X402PaymentRequirement,
  ): Promise<X402VerificationResult> {
    const accepted = payload.accepted || payload;

    // 1. Network Validation
    if (accepted.network && accepted.network !== requirement.network) {
      return {
        valid: false,
        error: `Invalid network '${accepted.network}'. Required network: '${requirement.network}'`,
      };
    }

    // 2. Asset Validation
    if (accepted.asset && accepted.asset !== requirement.asset) {
      return {
        valid: false,
        error: `Invalid payment asset '${accepted.asset}'. Required USDC token: '${requirement.asset}'`,
      };
    }

    // 3. Receiver Address Validation (Server-controlled receiver protection)
    const payloadReceiver = accepted.payTo || accepted.receiverAddress || accepted.payee;
    if (payloadReceiver && payloadReceiver !== requirement.receiver) {
      return {
        valid: false,
        error: `Invalid payment receiver '${payloadReceiver}'. Required server receiver: '${requirement.receiver}'`,
      };
    }

    // 4. Amount Validation: the facilitator requires an exact match.
    if (accepted.amount !== undefined) {
      let ok = false;
      try {
        ok = BigInt(String(accepted.amount)) === BigInt(requirement.amount);
      } catch {
        ok = false;
      }
      if (!ok) {
        return {
          valid: false,
          error: `Invalid payment amount '${String(accepted.amount)}'. Required: '${requirement.amount}'`,
        };
      }
    }

    // 5a. The facilitator settles only with a fee payer it manages, and only
    // when the client signed against exactly that one.
    if (!requirement.feePayer) {
      return { valid: false, error: 'Payment requirement has no facilitator fee payer; request a new payment' };
    }
    const acceptedFeePayer = (accepted.extra as Record<string, unknown> | undefined)?.feePayer;
    if (acceptedFeePayer !== undefined && acceptedFeePayer !== requirement.feePayer) {
      return { valid: false, error: 'Payment was signed for a different fee payer than this server requested' };
    }

    // 5. Real network safety guard: refuse to ever execute a real facilitator
    // settlement unless the resolved network is exactly the enforced safe
    // testnet identifier. This is a hard code-level guard, not reliant on
    // HEDERA_NETWORK's default: PAYMENT_CONFIG.NETWORK would otherwise let
    // an operator point this at hedera:mainnet with a real key and this
    // function would proceed regardless. Checked before entering the try
    // block below so a refusal here is never confused with a real
    // "Facilitator settlement failed" error; no facilitator call happens.
    if (requirement.network !== HEDERA_TESTNET_CAIP2) {
      return {
        valid: false,
        error: `Refusing to execute real settlement: network '${requirement.network}' is not the enforced safe network '${HEDERA_TESTNET_CAIP2}'`,
      };
    }

    // 6. Official Facilitator Verification & Settlement
    try {
      const client = this.getFacilitatorClient();

      const reqForFacilitator = this.toWireRequirement(requirement);

      const verifyRes = await client.verify(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reqForFacilitator as any,
      );

      const isVerifyValid =
        Boolean(verifyRes) &&
        ((verifyRes as unknown as { valid?: boolean }).valid !== false) &&
        ((verifyRes as unknown as { isValid?: boolean }).isValid !== false);

      if (!isVerifyValid) {
        const verifyErr =
          (verifyRes as unknown as { error?: string }).error ||
          (verifyRes as unknown as { invalidReason?: string }).invalidReason ||
          'Payment cryptographic verification failed';
        return {
          valid: false,
          error: verifyErr,
        };
      }

      const settleRes = await client.settle(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reqForFacilitator as any,
      );

      const txRef =
        (settleRes as unknown as { transactionReference?: string }).transactionReference ||
        (settleRes as unknown as { transaction?: string }).transaction ||
        (settleRes as unknown as { txId?: string }).txId;

      const isSettleSuccess =
        Boolean(settleRes) &&
        ((settleRes as unknown as { success?: boolean }).success !== false) &&
        Boolean(txRef);

      if (!isSettleSuccess || !txRef) {
        const settleErr =
          (settleRes as unknown as { error?: string }).error ||
          (settleRes as unknown as { errorReason?: string }).errorReason ||
          'Settlement succeeded but network returned no valid transaction reference';
        return {
          valid: false,
          error: settleErr,
        };
      }

      const payerAddr =
        (verifyRes as unknown as { payerAddress?: string }).payerAddress ||
        (verifyRes as unknown as { payer?: string }).payer ||
        (settleRes as unknown as { payer?: string }).payer ||
        undefined;

      return {
        valid: true,
        paymentReference: requirement.paymentReference,
        transactionReference: txRef,
        payerAddress: payerAddr,
        receiverAddress: requirement.receiver,
        amount: requirement.amount,
        asset: requirement.asset,
        network: requirement.network,
      };
    } catch (err: unknown) {
      // Failed settlement or facilitator unavailable -> Return controlled failure. NO FAKE SUCCESS!
      const errorMsg = err instanceof Error ? err.message : 'Facilitator verification/settlement failed';
      return {
        valid: false,
        error: `Facilitator settlement failed: ${errorMsg}`,
      };
    }
  }
}

export const x402Service = new X402Service();
