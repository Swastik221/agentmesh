import { prisma } from '../lib/prisma.js';
import { siweService } from './siwe.service.js';
import { sessionService } from './session.service.js';
import { VerifySiweInput } from './auth.schemas.js';

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
      user = await prisma.user.create({
        data: {
          walletAddress: normalizedWalletAddress,
          displayName: null,
        },
      });
    }

    const session = await sessionService.createSession(user.id);

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
      },
      sessionId: session.id,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await sessionService.invalidateSession(sessionId);
  }
}

export const authService = new AuthService();
