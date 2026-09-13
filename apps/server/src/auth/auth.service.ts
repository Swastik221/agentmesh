import { prisma } from '../lib/prisma.js';
import { siweService } from './siwe.service.js';
import { sessionService } from './session.service.js';
import { ensService } from '../services/ens.service.js';
import { VerifySiweInput } from './auth.schemas.js';

/**
 * How long a cached primary ENS name is trusted before it is looked up again.
 * A primary name changes rarely, and a mainnet round trip on every sign-in
 * would put an external dependency on the critical path of logging in.
 */
const ENS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a request is willing to wait for that lookup. ENS is decoration on an
 * identity the wallet signature has already established, so it gets a budget
 * far shorter than the RPC client's own timeout: if mainnet is slow or
 * unreachable the request completes immediately and the name is picked up on
 * a later one instead. Without this, an unreachable RPC would add the full ENS
 * timeout to every sign-in.
 */
const ENS_LOOKUP_BUDGET_MS = 2000;

export class AuthService {
  async getNonce(): Promise<{ nonce: string }> {
    const nonce = await siweService.generateAndStoreNonce();
    return { nonce };
  }

  async verifyAndLogin(input: VerifySiweInput) {
    const normalizedWalletAddress = await siweService.verifySiweMessage(
      input.message,
      input.signature,
    );

    let user = await prisma.user.findUnique({
      where: { walletAddress: normalizedWalletAddress },
    });

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            walletAddress: normalizedWalletAddress,
            displayName: null,
          },
        });
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === 'P2002'
        ) {
          user = await prisma.user.findUnique({
            where: { walletAddress: normalizedWalletAddress },
          });
        }
        if (!user) {
          throw err;
        }
      }
    }

    user = await this.refreshEnsName(user);

    const session = await sessionService.createSession(user.id);

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
        ensName: user.ensName,
      },
      sessionId: session.id,
    };
  }

  /**
   * Refresh the user's cached primary ENS name, at most once per interval.
   *
   * Identity here is already established by the SIWE signature; ENS only puts
   * a human-readable name on it. So every failure path returns the user
   * unchanged rather than propagating: an unreachable RPC must not be able to
   * stop anyone from signing in. A name that stops verifying is cleared, so a
   * stale name is never shown after it has been transferred away.
   */
  async refreshEnsName<T extends { id: string; walletAddress: string | null; ensName: string | null; ensCheckedAt: Date | null }>(
    user: T,
  ): Promise<T> {
    if (!user.walletAddress) return user;

    const age = user.ensCheckedAt ? Date.now() - user.ensCheckedAt.getTime() : Infinity;
    if (age < ENS_REFRESH_INTERVAL_MS) return user;

    try {
      // The losing side of the race below stays pending, so make sure it can
      // never surface as an unhandled rejection.
      const lookup = ensService
        .resolveVerifiedPrimaryName(user.walletAddress)
        .catch(() => null);
      const timedOut = Symbol('ens-timeout');
      let budget: NodeJS.Timeout | undefined;
      const deadline = new Promise<typeof timedOut>((resolve) => {
        budget = setTimeout(() => resolve(timedOut), ENS_LOOKUP_BUDGET_MS);
      });

      let ensName: string | null;
      try {
        const result = await Promise.race([lookup, deadline]);
        if (result === timedOut) {
          // Leave ensCheckedAt untouched so the next request retries rather
          // than caching "no name" for a day because the network was slow.
          console.warn(`[ens] primary name lookup for ${user.walletAddress} exceeded the ${ENS_LOOKUP_BUDGET_MS}ms budget`);
          return user;
        }
        ensName = result;
      } finally {
        if (budget) clearTimeout(budget);
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { ensName, ensCheckedAt: new Date() },
      });
      return { ...user, ensName: updated.ensName, ensCheckedAt: updated.ensCheckedAt };
    } catch (err) {
      console.error(`[ens] could not refresh the primary name for ${user.walletAddress}:`, err);
      return user;
    }
  }

  async logout(sessionId: string): Promise<void> {
    await sessionService.invalidateSession(sessionId);
  }
}

export const authService = new AuthService();
