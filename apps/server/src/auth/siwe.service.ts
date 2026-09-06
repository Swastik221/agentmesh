import { SiweMessage, generateNonce } from 'siwe';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { UnauthorizedError, BadRequestError } from '../errors/app-error.js';

export class SiweService {
  async generateAndStoreNonce(): Promise<string> {
    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiration

    await prisma.siweNonce.create({
      data: {
        nonce,
        expiresAt,
      },
    });

    return nonce;
  }

  async verifySiweMessage(message: string, signature: string): Promise<string> {
    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch {
      throw new BadRequestError('Malformed SIWE message');
    }

    // 1. Validate domain
    if (siweMessage.domain !== config.siweDomain) {
      throw new UnauthorizedError(
        `Domain mismatch. Expected '${config.siweDomain}', got '${siweMessage.domain}'`,
      );
    }

    // 2. Validate URI
    if (siweMessage.uri !== config.siweUri) {
      throw new UnauthorizedError(
        `URI mismatch. Expected '${config.siweUri}', got '${siweMessage.uri}'`,
      );
    }

    // 3. Validate Chain ID
    if (siweMessage.chainId !== config.siweChainId) {
      throw new UnauthorizedError(
        `Chain ID mismatch. Expected ${config.siweChainId}, got ${siweMessage.chainId}`,
      );
    }

    // 4. Check SIWE nonce exists and is not expired (do NOT delete yet)
    const dbNonce = await prisma.siweNonce.findUnique({
      where: { nonce: siweMessage.nonce },
    });

    if (!dbNonce || dbNonce.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired SIWE nonce');
    }

    // 5. Verify SIWE signature BEFORE consuming nonce
    try {
      const verifyResult = await siweMessage.verify({
        signature,
        domain: config.siweDomain,
        nonce: siweMessage.nonce,
        time: new Date().toISOString(),
      });

      if (!verifyResult.success) {
        throw new UnauthorizedError('Invalid SIWE signature');
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('SIWE verification failed');
    }

    // 6. Signature verification SUCCEEDED - atomically consume the nonce
    try {
      await prisma.siweNonce.delete({
        where: { nonce: siweMessage.nonce },
      });
    } catch {
      // Nonce already consumed concurrently or deleted
      throw new UnauthorizedError('Invalid or expired SIWE nonce');
    }

    // 7. Return lowercase normalized wallet address
    return siweMessage.address.toLowerCase();
  }
}

export const siweService = new SiweService();
