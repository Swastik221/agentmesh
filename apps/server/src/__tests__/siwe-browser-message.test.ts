import { describe, it, expect } from 'vitest';
import { SiweMessage } from 'siwe';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../app.js';
import { config } from '../config/index.js';

describe('SIWE Browser Canonical Message & Verification Regression Tests', () => {
  const app = createApp();
  const testAccount = privateKeyToAccount(generatePrivateKey());
  const walletAddress = testAccount.address;

  it('1. should construct canonical SIWE message using SiweMessage class and parse with new SiweMessage(message)', () => {
    const domain = 'localhost';
    const address = walletAddress;
    const statement = 'Sign in with Ethereum to AgentMesh.';
    const uri = 'http://localhost:5173';
    const version = '1';
    const chainId = 1;
    const nonce = '12345678';
    const issuedAt = new Date().toISOString();

    const siweMessage = new SiweMessage({
      domain,
      address,
      statement,
      uri,
      version,
      chainId,
      nonce,
      issuedAt,
    });

    const preparedMessage = siweMessage.prepareMessage();
    expect(typeof preparedMessage).toBe('string');
    expect(preparedMessage).toContain('localhost wants you to sign in with your Ethereum account:');

    // Verify parser extracts exact canonical fields
    const parsed = new SiweMessage(preparedMessage);
    expect(parsed.domain).toBe(domain);
    expect(parsed.address.toLowerCase()).toBe(address.toLowerCase());
    expect(parsed.statement).toBe(statement);
    expect(parsed.uri).toBe(uri);
    expect(parsed.version).toBe(version);
    expect(parsed.chainId).toBe(chainId);
    expect(parsed.nonce).toBe(nonce);
  });

  it('2. should accept canonical SIWE message signed by wallet on backend verification path', async () => {
    const nonceRes = await request(app).get('/auth/nonce');
    expect(nonceRes.status).toBe(200);
    const nonce = nonceRes.body.nonce;

    const siweMessage = new SiweMessage({
      domain: config.siweDomain,
      address: walletAddress,
      statement: 'Sign in with Ethereum to AgentMesh.',
      uri: config.siweUri,
      version: '1',
      chainId: config.siweChainId,
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const message = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message });

    const res = await request(app).post('/auth/verify').send({
      message,
      signature,
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.walletAddress).toBe(walletAddress.toLowerCase());
  });

  it('3. should reject malformed SIWE messages on backend verification path with 400 Bad Request', async () => {
    const res = await request(app).post('/auth/verify').send({
      message: 'Malformed SIWE message string without EIP-4361 structure',
      signature: '0x1234',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Malformed SIWE message');
  });
});
