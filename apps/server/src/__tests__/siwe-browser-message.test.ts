import { describe, it, expect } from 'vitest';
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';
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

  it('4. should normalize a lowercase wallet address to EIP-55 checksum format before SiweMessage creation and parse successfully', () => {
    const rawLowercaseAddress = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';

    // Unchecksummed raw lowercase address causes SiweMessage constructor to throw EIP-55 error:
    expect(() => {
      new SiweMessage({
        domain: 'localhost',
        address: rawLowercaseAddress,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: 'http://localhost:5173',
        version: '1',
        chainId: 1,
        nonce: '12345678',
        issuedAt: new Date().toISOString(),
      });
    }).toThrow(/invalid EIP-55 address/i);

    // EIP-55 normalization via viem getAddress:
    const normalizedAddress = getAddress(rawLowercaseAddress);
    expect(normalizedAddress).toBe('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');

    const siweMessage = new SiweMessage({
      domain: 'localhost',
      address: normalizedAddress,
      statement: 'Sign in with Ethereum to AgentMesh.',
      uri: 'http://localhost:5173',
      version: '1',
      chainId: 1,
      nonce: '12345678',
      issuedAt: new Date().toISOString(),
    });

    const preparedMessage = siweMessage.prepareMessage();
    expect(preparedMessage).toContain('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');

    const parsed = new SiweMessage(preparedMessage);
    expect(parsed.address).toBe('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  });
});

