/**
 * ENS Service — PRD-34
 *
 * Provides ENS name resolution and ownership verification using viem.
 * All address comparisons use viem's getAddress() for checksum normalization.
 * ENS name normalization uses viem's normalize() (UTS-46 compliant) before
 * any namehash/resolution operation, per the ENS specification.
 *
 * This service is READ-ONLY — no blockchain writes.
 */

import { createPublicClient, http, getAddress, type Chain, type PublicClient } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';
import { config } from '../config/index.js';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  AppError,
} from '../errors/app-error.js';

export interface EnsIdentity {
  name: string;
  address: string;
}

/**
 * Chains with an ENS deployment that this service can read from. Mainnet is
 * the real registry; Sepolia carries the test deployment, which is what makes
 * the feature exercisable on the testnet the rest of the product runs on.
 */
const ENS_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
};

const resolveEnsChain = (chainId: number): Chain => {
  const chain = ENS_CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `ENS_CHAIN_ID ${chainId} has no ENS deployment this service can read. Supported: ${Object.keys(ENS_CHAINS).join(', ')}.`,
    );
  }
  return chain;
};

/**
 * Extract something actionable from a viem/RPC failure.
 *
 * Every provider error used to collapse into the same "provider unavailable"
 * string, which is how a completely dead default RPC endpoint (it answered
 * every request with an HTTP 525) went unnoticed: the product reported an
 * outage and never said by whom or why. Keep the 503 contract, but carry the
 * underlying reason in the message and log the full error server-side.
 */
const MAX_RPC_REASON_LENGTH = 200;

const describeRpcFailure = (err: unknown): string => {
  let reason: string;
  if (err instanceof Error) {
    // viem nests the useful part in `details`/`shortMessage` on its error types.
    const viemError = err as Error & { shortMessage?: string; details?: string };
    reason = viemError.details || viemError.shortMessage || err.message;
  } else {
    reason = String(err);
  }

  // A misconfigured endpoint often answers with an HTML error page rather than
  // JSON-RPC, and the whole page is not something to put in an API response.
  // The <title> of such a page is the part that names the failure (for example
  // "525: SSL handshake failed"), so prefer it, then bound the length.
  const htmlTitle = /<title>([^<]+)<\/title>/i.exec(reason);
  if (htmlTitle?.[1]) {
    reason = htmlTitle[1];
  }

  reason = reason.replace(/\s+/g, ' ').trim();
  return reason.length > MAX_RPC_REASON_LENGTH
    ? `${reason.slice(0, MAX_RPC_REASON_LENGTH)}…`
    : reason;
};

export class EnsService {
  private client: PublicClient;
  private chain: Chain;

  constructor(client?: PublicClient) {
    this.chain = resolveEnsChain(config.ensChainId);
    this.client =
      client ??
      createPublicClient({
        chain: this.chain,
        transport: http(config.ensRpcUrl, {
          timeout: config.ensTimeoutMs,
        }),
      });
  }

  /**
   * Normalize an ENS name (UTS-46 compliant via viem).
   * Throws BadRequestError if the name is malformed.
   */
  normalizeName(name: string): string {
    try {
      return normalize(name);
    } catch {
      throw new BadRequestError(`Malformed ENS name: "${name}"`);
    }
  }

  /**
   * Normalize an Ethereum address to EIP-55 checksum form.
   * Used for deterministic address comparison.
   */
  normalizeAddress(address: string): string {
    try {
      return getAddress(address);
    } catch {
      throw new BadRequestError(`Malformed Ethereum address: "${address}"`);
    }
  }

  /**
   * Forward resolution: ENS name → Ethereum address.
   * Returns null if the name is not registered or has no address record.
   */
  async resolveName(name: string): Promise<string | null> {
    const normalized = this.normalizeName(name);
    try {
      const address = await (this.client as PublicClient & {
        getEnsAddress: (args: { name: string }) => Promise<`0x${string}` | null>;
      }).getEnsAddress({ name: normalized });

      if (!address) return null;
      return getAddress(address);
    } catch (err: unknown) {
      // Re-throw normalization errors (already wrapped)
      if (err instanceof BadRequestError) throw err;
      // Surface timeouts and RPC failures as a dependency error, naming the
      // endpoint and the real reason so a misconfigured or dead RPC is
      // diagnosable from the response instead of only from a debugger.
      const reason = describeRpcFailure(err);
      console.error(`[ens] forward resolution failed for "${normalized}" via ${config.ensRpcUrl}:`, err);
      throw new AppError(
        `ENS resolution failed via ${config.ensRpcUrl}: ${reason}`,
        503,
        'ENS_UNAVAILABLE',
      );
    }
  }

  /**
   * Reverse resolution: Ethereum address → primary ENS name.
   * Returns null if the address has no primary name set.
   */
  async resolvePrimaryName(address: string): Promise<string | null> {
    const normalizedAddr = this.normalizeAddress(address);
    try {
      const name = await (this.client as PublicClient & {
        getEnsName: (args: { address: `0x${string}` }) => Promise<string | null>;
      }).getEnsName({ address: normalizedAddr as `0x${string}` });

      return name ?? null;
    } catch (err: unknown) {
      if (err instanceof BadRequestError) throw err;
      const reason = describeRpcFailure(err);
      console.error(`[ens] reverse resolution failed for ${normalizedAddr} via ${config.ensRpcUrl}:`, err);
      throw new AppError(
        `ENS reverse resolution failed via ${config.ensRpcUrl}: ${reason}`,
        503,
        'ENS_UNAVAILABLE',
      );
    }
  }

  /**
   * Reverse-resolve an address to its primary ENS name, and only return the
   * name if it forward-resolves back to the same address.
   *
   * A reverse record is set by whoever controls the address and is not, on its
   * own, proof of anything: without the forward check an address can claim any
   * name it likes. Displaying an unverified reverse record as a person's
   * identity would be exactly the kind of claim the product must not make, so
   * the forward resolution is mandatory here.
   *
   * Returns null when there is no primary name, when the round trip disagrees,
   * or when the provider is unreachable. Callers use this to decorate an
   * identity that is already established by the wallet signature, so an ENS
   * outage must degrade to "no ENS name", never to a failed sign-in.
   */
  async resolveVerifiedPrimaryName(address: string): Promise<string | null> {
    const normalizedAddr = this.normalizeAddress(address);

    let primary: string | null;
    try {
      primary = await this.resolvePrimaryName(normalizedAddr);
    } catch {
      return null;
    }
    if (!primary) return null;

    let forward: string | null;
    try {
      forward = await this.resolveName(primary);
    } catch {
      return null;
    }

    if (!forward || forward !== normalizedAddr) {
      console.warn(
        `[ens] discarding unverified reverse record for ${normalizedAddr}: "${primary}" forward-resolves to ${forward ?? 'nothing'}`,
      );
      return null;
    }

    return primary;
  }

  /**
   * Verify that `name` resolves to `expectedAddress`.
   *
   * Flow:
   *   1. Normalize name (UTS-46)
   *   2. Forward-resolve name → resolved address
   *   3. Normalize both addresses (EIP-55 checksum)
   *   4. Compare — throw ForbiddenError on mismatch
   *   5. Return EnsIdentity on success
   *
   * This is the primary method used before attaching ENS identity to an agent.
   */
  async verifyNameOwnership(name: string, expectedAddress: string): Promise<EnsIdentity> {
    // Step 1: Normalize name
    const normalized = this.normalizeName(name);

    // Step 2: Forward resolve
    const resolved = await this.resolveName(normalized);
    if (!resolved) {
      // Name the chain: the same name can be registered on one ENS deployment
      // and not another, and without this the message reads as if the name is
      // broken rather than absent from the registry being read.
      throw new NotFoundError(
        `ENS name "${normalized}" does not resolve to an address on ${this.chain.name}`,
      );
    }

    // Step 3 & 4: Normalize and compare addresses
    const normalizedResolved = this.normalizeAddress(resolved);
    const normalizedExpected = this.normalizeAddress(expectedAddress);

    if (normalizedResolved !== normalizedExpected) {
      throw new ForbiddenError(
        `ENS name "${normalized}" resolves to ${normalizedResolved}, not the authenticated wallet ${normalizedExpected}`,
      );
    }

    return { name: normalized, address: normalizedResolved };
  }
}

export const ensService = new EnsService();
