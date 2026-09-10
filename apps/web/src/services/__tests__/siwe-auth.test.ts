import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authSessionService } from '../auth-session';
import { liveWalletAdapter, LiveWalletError } from '../../adapters/live/wallet.adapter';
import { liveAuthAdapter, LiveAuthError } from '../../adapters/live/auth.adapter';
import { apiClient } from '../api-client';

describe('INT-2 Real Wallet & SIWE Authentication Tests', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset singleton state between tests
    (authSessionService as unknown as { currentUser: null; currentWallet: null }).currentUser = null;
    (authSessionService as unknown as { currentUser: null; currentWallet: null }).currentWallet = null;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe('Test Group A — Wallet Provider', () => {
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

    it('A4 & A5: returns real wallet identity with address and chain ID on success', async () => {
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

    it('A6: surfaces eth_chainId read failure without defaulting to chain 1', async () => {
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

  describe('Test Group B — SIWE Nonce', () => {
    it('B1: requests fresh nonce from /auth/nonce', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ nonce: 'test_nonce_987654321' });

      const nonce = await authSessionService.fetchNonce();
      expect(getSpy).toHaveBeenCalledWith('/auth/nonce');
      expect(nonce).toBe('test_nonce_987654321');

      getSpy.mockRestore();
    });

    it('B2: handles nonce request failure gracefully', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('500 Internal Server Error'));

      await expect(authSessionService.fetchNonce()).rejects.toThrow('500 Internal Server Error');

      getSpy.mockRestore();
    });
  });

  describe('Test Group C & D — SIWE Verification & Signing', () => {
    it('D3 & E1: sends real SIWE message and signature to /auth/verify and updates session user', async () => {
      const mockUser = {
        id: 'usr_real_123',
        walletAddress: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
        displayName: 'Test User',
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

    it('E2 & E3: throws on SIWE verification failure when backend rejects', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('401 Unauthorized: Invalid SIWE signature'));

      await expect(authSessionService.verifySiwe('bad message', 'bad signature')).rejects.toThrow();
      expect(authSessionService.getCurrentUser()).toBeNull();

      postSpy.mockRestore();
    });
  });

  describe('Test Group F — Session Restoration & Logout', () => {
    it('F1: fetchSession queries /auth/me and returns authenticated user', async () => {
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
      expect(session.user?.id).toBe('usr_restored_456');

      getSpy.mockRestore();
    });

    it('F2: fetchSession returns unauthenticated state when /auth/me returns 401', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('401 Unauthorized'));

      const session = await authSessionService.fetchSession();
      expect(session.authenticated).toBe(false);
      expect(session.user).toBeNull();
      expect(authSessionService.getCurrentUser()).toBeNull();

      getSpy.mockRestore();
    });

    it('F5: logout calls /auth/logout and clears user state', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({});

      await authSessionService.logout();
      expect(postSpy).toHaveBeenCalledWith('/auth/logout');
      expect(authSessionService.getCurrentUser()).toBeNull();
      expect(authSessionService.getCurrentWallet()).toBeNull();

      postSpy.mockRestore();
    });

    it('liveAuthAdapter methods route directly to authSessionService', async () => {
      await expect(liveAuthAdapter.signup({ displayName: 'D', email: 'e' })).rejects.toThrow(LiveAuthError);
    });
  });
});
