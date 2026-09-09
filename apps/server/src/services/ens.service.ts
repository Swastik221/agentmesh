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

import { createPublicClient, http, getAddress, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
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

export class EnsService {
  private client: PublicClient;

  constructor(client?: PublicClient) {
    this.client =
      client ??
      createPublicClient({
        chain: mainnet,
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
      // Surface timeouts and RPC failures as a dependency error
      throw new AppError('ENS resolution failed: provider unavailable', 503, 'ENS_UNAVAILABLE');
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
      throw new AppError('ENS reverse resolution failed: provider unavailable', 503, 'ENS_UNAVAILABLE');
    }
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
      throw new NotFoundError(`ENS name "${normalized}" does not resolve to an address`);
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
