import { randomUUID } from 'crypto';
import {
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  HTTPFacilitatorClient,
} from '@x402/core/http';
import { x402ResourceServer } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import {
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_USDC,
} from '@x402/hedera';
import { PAYMENT_CONFIG } from './payment.config.js';
import {
  X402PaymentRequirement,
  X402PaymentPayload,
  X402VerificationResult,
} from './payment.types.js';

export class X402Service {
  private resourceServer: x402ResourceServer;
  private facilitatorClient: HTTPFacilitatorClient;

  constructor() {
    this.facilitatorClient = new HTTPFacilitatorClient({
      url: PAYMENT_CONFIG.FACILITATOR_URL,
    });
    this.resourceServer = new x402ResourceServer(this.facilitatorClient);
    this.resourceServer.register(
      (PAYMENT_CONFIG.NETWORK || HEDERA_TESTNET_CAIP2) as `${string}:${string}`,
      new ExactHederaScheme(),
    );
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
    };
  }

  /**
   * Encodes standard x402 HTTP 402 header requirement.
   */
  encodeRequirementHeader(requirement: X402PaymentRequirement): string {
    return encodePaymentRequiredHeader({
      x402Version: 2,
      accepts: [
        {
          scheme: requirement.scheme,
          network: requirement.network as `${string}:${string}`,
          asset: requirement.asset,
          amount: requirement.amount,
          receiverAddress: requirement.receiver,
          extra: {
            paymentReference: requirement.paymentReference,
          },
        },
      ],
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
    const payloadReceiver = accepted.receiverAddress || accepted.payee;
    if (payloadReceiver && payloadReceiver !== requirement.receiver) {
      return {
        valid: false,
        error: `Invalid payment receiver '${payloadReceiver}'. Required server receiver: '${requirement.receiver}'`,
      };
    }

    // 4. Amount Validation
    if (accepted.amount && BigInt(accepted.amount) < BigInt(requirement.amount)) {
      return {
        valid: false,
        error: `Insufficient payment amount '${accepted.amount}'. Required minimum: '${requirement.amount}'`,
      };
    }

    // 5. Official Facilitator Verification & Settlement
    try {
      const verifyRes = await this.facilitatorClient.verify(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload as any,
        {
          scheme: requirement.scheme,
          network: requirement.network,
          asset: requirement.asset,
          amount: requirement.amount,
          payee: requirement.receiver,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );

      if (!verifyRes || (verifyRes as unknown as { valid?: boolean }).valid === false) {
        return {
          valid: false,
          error: (verifyRes as unknown as { error?: string }).error || 'Payment cryptographic verification failed',
        };
      }

      const settleRes = await this.facilitatorClient.settle(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload as any,
        {
          scheme: requirement.scheme,
          network: requirement.network,
          asset: requirement.asset,
          amount: requirement.amount,
          payee: requirement.receiver,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );

      const txRef =
        (settleRes as unknown as { transactionReference?: string }).transactionReference ||
        (settleRes as unknown as { txId?: string }).txId;

      if (!txRef) {
        return {
          valid: false,
          error: 'Settlement succeeded but network returned no valid transaction reference',
        };
      }

      return {
        valid: true,
        paymentReference: requirement.paymentReference,
        transactionReference: txRef,
        payerAddress: (verifyRes as unknown as { payerAddress?: string }).payerAddress || undefined,
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
