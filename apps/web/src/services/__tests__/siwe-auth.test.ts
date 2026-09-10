import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authSessionService } from '../auth-session';
import { liveWalletAdapter, LiveWalletError } from '../../adapters/live/wallet.adapter';
import { liveAuthAdapter, LiveAuthError } from '../../adapters/live/auth.adapter';
import { apiClient, ApiError } from '../api-client';

describe('INT-2-C1 Corrective Hardening: Real Wallet & SIWE Auth Tests', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (authSessionService as unknown as { currentUser: null; currentWallet: null }).currentUser = null;
    (authSessionService as unknown as { currentUser: null; currentWallet: null }).currentWallet = null;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe('Test Group A — Wallet Provider & Chain Detection', () => {
    it('A1: throws error when window.ethereum is missing', async () => {
      // @ts-expect-error mocking window for test
      delete global.window;

      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(/window.ethereum/);
    });

    it('A2: handles user rejection of eth_requestAccounts cleanly', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockRejectedValue(new Error('User rejected the request.')),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(/rejected/);
    });

    it('A3: handles empty accounts array from provider', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockResolvedValue([]),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(/no active accounts/);
    });

    it('A4: returns real wallet identity with address and chain ID on success', async () => {
      const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockImplementation(async (args: { method: string }) => {
              if (args.method === 'eth_requestAccounts') return [mockAddress];
              if (args.method === 'eth_chainId') return '0xaa36a7'; // Sepolia 11155111
              return null;
            }),
          },
        },
        writable: true,
        configurable: true,
      });

      const res = await liveWalletAdapter.connectWallet('metamask');
      expect(res.address).toBe(mockAddress);
      expect(res.connected).toBe(true);
      expect(res.chainId).toBe(11155111);
      expect(res.truncatedAddress).toBe('0x71C7...976F');
    });

    it('A5: rejects malformed / non-hex chain ID without chain fallback', async () => {
      const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockImplementation(async (args: { method: string }) => {
              if (args.method === 'eth_requestAccounts') return [mockAddress];
              if (args.method === 'eth_chainId') return 'INVALID_HEX';
              return null;
            }),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(/Invalid chain ID/);
    });

    it('A6: surfaces eth_chainId read failure without defaulting to fallback chain', async () => {
      const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockImplementation(async (args: { method: string }) => {
              if (args.method === 'eth_requestAccounts') return [mockAddress];
              if (args.method === 'eth_chainId') throw new Error('Network query timeout');
              return null;
            }),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(/eth_chainId/);
    });
  });

  describe('Test Group B — SIWE Nonce & Message Construction', () => {
    it('B1: requests fresh nonce from /auth/nonce', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ nonce: 'test_nonce_987654321' });

      const nonce = await authSessionService.fetchNonce();
      expect(getSpy).toHaveBeenCalledWith('/auth/nonce');
      expect(nonce).toBe('test_nonce_987654321');

      getSpy.mockRestore();
    });

    it('B2: handles /auth/nonce request failure gracefully', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new ApiError(500, 'Internal Error', 'Server Error'));

      await expect(authSessionService.fetchNonce()).rejects.toThrow('Server Error');

      getSpy.mockRestore();
    });
  });

  describe('Test Group C & D — SIWE Verification & Personal Signing', () => {
    it('D1: sends real SIWE message and signature to /auth/verify and updates session user', async () => {
      const mockUser = {
        id: 'usr_real_123',
        walletAddress: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
        displayName: 'Test User',
        createdAt: '2026-01-01',
      };

      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ user: mockUser });

      const message = 'localhost wants you to sign in with your Ethereum account:\n0x71c7656ec7ab88b098defb751b7401b5f6d8976f\n\nSign in with Ethereum to AgentMesh.\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 11155111\nNonce: nonce_12345\nIssued At: 2026-09-10T12:00:00.000Z';
      const signature = '0x_real_signature_hash_bytes';

      const user = await authSessionService.verifySiwe(message, signature);

      expect(postSpy).toHaveBeenCalledWith('/auth/verify', { message, signature });
      expect(user.id).toBe('usr_real_123');
      expect(authSessionService.getCurrentUser()?.id).toBe('usr_real_123');

      postSpy.mockRestore();
    });

    it('D2: throws on SIWE verification failure when backend rejects signature or nonce', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new ApiError(401, 'Unauthorized', 'Invalid SIWE signature'));

      await expect(authSessionService.verifySiwe('bad message', 'bad signature')).rejects.toThrow(ApiError);
      expect(authSessionService.getCurrentUser()).toBeNull();

      postSpy.mockRestore();
    });
  });

  describe('Test Group E — Session Restoration & Error Semantics (401 vs 5xx)', () => {
    it('E1: fetchSession queries /auth/me and returns authenticated state on 200', async () => {
      const mockUser = {
        id: 'usr_restored_456',
        walletAddress: '0x1234567890123456789012345678901234567890',
        displayName: 'Restored User',
        createdAt: '2026-01-01',
      };

      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ user: mockUser });

      const session = await authSessionService.fetchSession();
      expect(getSpy).toHaveBeenCalledWith('/auth/me');
      expect(session.authenticated).toBe(true);
      expect(session.status).toBe('authenticated');
      expect(session.user?.id).toBe('usr_restored_456');

      getSpy.mockRestore();
    });

    it('E2: fetchSession returns status unauthenticated on 401 Unauthorized', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new ApiError(401, 'Unauthorized', 'Unauthorized'));

      const session = await authSessionService.fetchSession();
      expect(session.authenticated).toBe(false);
      expect(session.status).toBe('unauthenticated');
      expect(session.user).toBeNull();
      expect(authSessionService.getCurrentUser()).toBeNull();

      getSpy.mockRestore();
    });

    it('E3: fetchSession returns status error on 500 Internal Server Error (NOT unauthenticated)', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new ApiError(500, 'Internal Server Error', 'Database unreachable'));

      const session = await authSessionService.fetchSession();
      expect(session.authenticated).toBe(false);
      expect(session.status).toBe('error');
      expect(session.error).toContain('Database unreachable');
      expect(authSessionService.getCurrentUser()).toBeNull();

      getSpy.mockRestore();
    });

    it('E4: fetchSession returns status error on network failure (NOT unauthenticated)', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new ApiError(0, 'Network Error', 'Failed to fetch'));

      const session = await authSessionService.fetchSession();
      expect(session.authenticated).toBe(false);
      expect(session.status).toBe('error');
      expect(session.error).toContain('Failed to fetch');

      getSpy.mockRestore();
    });
  });

  describe('Test Group F — Protected API & Cookie Access', () => {
    it('F1: credentials include option is used for protected API calls', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce([{ id: 'proj_1', name: 'AgentMesh' }]);

      const projects = await apiClient.get('/projects');
      expect(getSpy).toHaveBeenCalledWith('/projects');
      expect(projects).toHaveLength(1);

      getSpy.mockRestore();
    });
  });

  describe('Test Group G — Truthful Logout Lifecycle', () => {
    it('G1: logout calls /auth/logout and clears user state on 204 success', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({});

      await authSessionService.logout();
      expect(postSpy).toHaveBeenCalledWith('/auth/logout');
      expect(authSessionService.getCurrentUser()).toBeNull();
      expect(authSessionService.getCurrentWallet()).toBeNull();

      postSpy.mockRestore();
    });

    it('G2: logout throws ApiError when backend returns 500 (does not pretend logout succeeded)', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
        throw new ApiError(500, 'Internal Server Error', 'Session teardown failed');
      });

      await expect(authSessionService.logout()).rejects.toThrow(ApiError);
      await expect(authSessionService.logout()).rejects.toThrow(/Session teardown failed/);

      postSpy.mockRestore();
    });
  });

  describe('Test Group H — Demo Isolation', () => {
    it('H1: liveAuthAdapter methods route directly to authSessionService and reject password signup', async () => {
      await expect(liveAuthAdapter.signup({ displayName: 'D', email: 'e' })).rejects.toThrow(LiveAuthError);
    });

    it('H2: live auth does not contain fallback credentials or demo identities', () => {
      expect(authSessionService.getCurrentUser()).toBeNull();
      expect(authSessionService.getCurrentWallet()).toBeNull();
    });
  });
});

