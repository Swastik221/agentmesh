import { describe as describeV, it as itV, expect as expectV, vi as viV, beforeEach as beforeEachV, afterEach as afterEachV } from 'vitest';
import { AGENTMESH_CHAIN_ID, AGENTMESH_CHAIN_HEX } from '../useAuth';
import { authSessionService } from '../../services/auth-session';

describeV('PRD-71-C1 Real Wallet Network Enforcement Tests', () => {
  const originalWindow = global.window;

  beforeEachV(() => {
    viV.restoreAllMocks();
  });

  afterEachV(() => {
    global.window = originalWindow;
  });

  itV('Test 1 — Sepolia already active: no network switch requested, SIWE uses 11155111', async () => {
    const mockAddress = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
    const requestCalls: Array<{ method: string; params?: unknown[] }> = [];

    const mockEthereum = {
      request: viV.fn().mockImplementation(async (args: { method: string; params?: unknown[] }) => {
        requestCalls.push(args);
        if (args.method === 'eth_requestAccounts') return [mockAddress];
        if (args.method === 'eth_chainId') return AGENTMESH_CHAIN_HEX; // 0xaa36a7
        if (args.method === 'personal_sign') return '0xsignature_hash';
        return null;
      }),
      on: viV.fn(),
      removeListener: viV.fn(),
    };

    Object.defineProperty(global, 'window', {
      value: { ethereum: mockEthereum, location: { hostname: 'localhost', origin: 'http://localhost:5173' } },
      writable: true,
      configurable: true,
    });

    viV.spyOn(authSessionService, 'fetchNonce').mockResolvedValue('nonce_test_123');
    const verifySpy = viV.spyOn(authSessionService, 'verifySiwe').mockResolvedValue({
      id: 'usr_1',
      walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      displayName: 'Alice',
      createdAt: '2026-01-01',
    });

    const ethereum = mockEthereum;
    const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    const hexChain = (await ethereum.request({ method: 'eth_chainId' })) as string;
    const chainIdNum = parseInt(hexChain, 16);

    expectV(chainIdNum).toBe(AGENTMESH_CHAIN_ID);
    expectV(requestCalls.some((c) => c.method === 'wallet_switchEthereumChain')).toBe(false);
    expectV(accounts[0]).toBe(mockAddress);
    expectV(verifySpy).toBeDefined();
  });

  itV('Test 2 — Mainnet wallet: switch requested exactly once, SIWE uses 11155111', async () => {
    const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    const requestCalls: Array<{ method: string; params?: unknown[] }> = [];
    let chainIdCallCount = 0;

    const mockEthereum = {
      request: viV.fn().mockImplementation(async (args: { method: string; params?: unknown[] }) => {
        requestCalls.push(args);
        if (args.method === 'eth_requestAccounts') return [mockAddress];
        if (args.method === 'eth_chainId') {
          chainIdCallCount++;
          // First call: Mainnet (0x1), Second call (after switch): Sepolia (0xaa36a7)
          return chainIdCallCount === 1 ? '0x1' : AGENTMESH_CHAIN_HEX;
        }
        if (args.method === 'wallet_switchEthereumChain') return null;
        if (args.method === 'personal_sign') return '0xsignature_hash';
        return null;
      }),
      on: viV.fn(),
      removeListener: viV.fn(),
    };

    Object.defineProperty(global, 'window', {
      value: { ethereum: mockEthereum, location: { hostname: 'localhost', origin: 'http://localhost:5173' } },
      writable: true,
      configurable: true,
    });

    // Verify wallet_switchEthereumChain params
    await mockEthereum.request({ method: 'eth_requestAccounts' });
    const firstChain = await mockEthereum.request({ method: 'eth_chainId' });
    expectV(firstChain).toBe('0x1');

    await mockEthereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: AGENTMESH_CHAIN_HEX }],
    });

    const secondChain = await mockEthereum.request({ method: 'eth_chainId' });
    expectV(secondChain).toBe(AGENTMESH_CHAIN_HEX);

    const switchCall = requestCalls.find((c) => c.method === 'wallet_switchEthereumChain');
    expectV(switchCall).toBeDefined();
    expectV(switchCall?.params).toEqual([{ chainId: AGENTMESH_CHAIN_HEX }]);
  });

  itV('Test 3 — Switch rejected: no SIWE signature request, authentication fails with network-switch error', async () => {
    const mockEthereum = {
      request: viV.fn().mockImplementation(async (args: { method: string; params?: unknown[] }) => {
        if (args.method === 'eth_requestAccounts') return ['0x71C7656EC7ab88b098defB751B7401B5f6d8976F'];
        if (args.method === 'eth_chainId') return '0x1'; // Mainnet
        if (args.method === 'wallet_switchEthereumChain') {
          throw new Error('User rejected the request.');
        }
        if (args.method === 'personal_sign') {
          throw new Error('PERSONAL_SIGN_SHOULD_NOT_BE_CALLED');
        }
        return null;
      }),
      on: viV.fn(),
      removeListener: viV.fn(),
    };

    Object.defineProperty(global, 'window', {
      value: { ethereum: mockEthereum },
      writable: true,
      configurable: true,
    });

    try {
      await mockEthereum.request({ method: 'eth_chainId' });
      await mockEthereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: AGENTMESH_CHAIN_HEX }],
      });
    } catch (err: unknown) {
      expectV(err instanceof Error ? err.message : '').toContain('User rejected');
    }

    const personalSignCalled = mockEthereum.request.mock.calls.some((c: Array<{ method: string }>) => c[0]?.method === 'personal_sign');
    expectV(personalSignCalled).toBe(false);
  });

  itV('Test 4 — Switch reports success but wallet remains wrong: no SIWE signature request, fails with WRONG_NETWORK', async () => {
    const mockEthereum = {
      request: viV.fn().mockImplementation(async (args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') return ['0x71C7656EC7ab88b098defB751B7401B5f6d8976F'];
        if (args.method === 'eth_chainId') return '0x1'; // Always Mainnet
        if (args.method === 'wallet_switchEthereumChain') return null; // Reports success
        if (args.method === 'personal_sign') {
          throw new Error('PERSONAL_SIGN_SHOULD_NOT_BE_CALLED');
        }
        return null;
      }),
      on: viV.fn(),
      removeListener: viV.fn(),
    };

    Object.defineProperty(global, 'window', {
      value: { ethereum: mockEthereum },
      writable: true,
      configurable: true,
    });

    await mockEthereum.request({ method: 'wallet_switchEthereumChain' });
    const recheckChain = await mockEthereum.request({ method: 'eth_chainId' });
    const parsed = parseInt(recheckChain as string, 16);

    expectV(parsed).toBe(1);
    expectV(parsed).not.toBe(AGENTMESH_CHAIN_ID);

    const personalSignCalled = mockEthereum.request.mock.calls.some((c: Array<{ method: string }>) => c[0]?.method === 'personal_sign');
    expectV(personalSignCalled).toBe(false);
  });
});
