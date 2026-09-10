import { describe, it, expect, vi } from 'vitest';
import { liveWalletAdapter, LiveWalletError } from '../wallet.adapter';
import { liveAuthAdapter, LiveAuthError } from '../auth.adapter';
import { liveAgentConnectionAdapter, LiveAgentConnectionError } from '../agent-connection.adapter';
import { liveTaskProtocolAdapter } from '../task-protocol.adapter';
import { liveFileAdapter } from '../file.adapter';
import { liveTerminalAdapter, LiveTerminalError } from '../terminal.adapter';
import { liveBrowserPreviewAdapter, LiveBrowserPreviewError } from '../browser-preview.adapter';
import { liveWorkspaceRealtimeAdapter } from '../workspace-realtime.adapter';
import { demoAdapters } from '../../demo/index';
import { getAdapters, adapters } from '../../index';
import { setAppMode, getAppMode } from '../../../config/env';

describe('INT-1-C1 Live Adapters Correctness & Mode Isolation Tests', () => {
  describe('1. Wallet Adapter Correctness', () => {
    it('throws LiveWalletError when window.ethereum is missing', async () => {
      const originalWindow = global.window;
      // @ts-expect-error mocking window for test
      delete global.window;

      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet()).rejects.toThrow(/window.ethereum/);

      global.window = originalWindow;
    });

    it('throws LiveWalletError when wallet connection is rejected', async () => {
      const originalWindow = global.window;
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

      global.window = originalWindow;
    });

    it('throws LiveWalletError when wallet returns empty accounts array', async () => {
      const originalWindow = global.window;
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

      global.window = originalWindow;
    });

    it('returns real wallet identity when provider succeeds without inventing fallback address', async () => {
      const originalWindow = global.window;
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockImplementation(async (args: { method: string }) => {
              if (args.method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
              if (args.method === 'eth_chainId') return '0x128'; // 296 in hex
              return null;
            }),
          },
        },
        writable: true,
        configurable: true,
      });

      const res = await liveWalletAdapter.connectWallet('metamask');
      expect(res.address).toBe('0x1111111111111111111111111111111111111111');
      expect(res.connected).toBe(true);
      expect(res.chainId).toBe(296);

      global.window = originalWindow;
    });

    it('throws LiveWalletError on signApproval without inventing fake signatures or txHashes', async () => {
      await expect(liveWalletAdapter.signApproval('app_1', 'action_1')).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.signApproval('app_1', 'action_1')).rejects.toThrow(/not implemented yet/);
    });

    it('does not return developer.eth fallback on ENS resolution error', async () => {
      const res = await liveWalletAdapter.resolveEns('0x9999999999999999999999999999999999999999');
      expect(res.ens).toBe('0x9999999999999999999999999999999999999999');
      expect(res.resolved).toBe(false);
      expect(res.ens).not.toContain('developer.eth');
    });
  });

  describe('2. Auth Adapter Correctness', () => {
    it('throws LiveAuthError when no active session exists', async () => {
      await expect(liveAuthAdapter.login({ email: 'test@example.com' })).rejects.toThrow(LiveAuthError);
    });

    it('throws LiveAuthError on signup attempt instead of fabricating usr_live users', async () => {
      await expect(liveAuthAdapter.signup({ displayName: 'Dev', email: 'test@example.com' })).rejects.toThrow(LiveAuthError);
    });
  });

  describe('3. Agent & Task & File & Realtime Adapter Error Propagation', () => {
    it('throws LiveAgentConnectionError on unsupported capability announcement', async () => {
      await expect(liveAgentConnectionAdapter.announceCapabilities('ag_1', ['cap'])).rejects.toThrow(LiveAgentConnectionError);
    });

    it('propagates API error when fetching tasks for non-existent workspace in Live Mode', async () => {
      await expect(liveTaskProtocolAdapter.getTasks('invalid_ws')).rejects.toThrow();
    });

    it('propagates API error when reading files in Live Mode without fake comments', async () => {
      await expect(liveFileAdapter.readFile('ws_1', 'nonexistent.txt')).rejects.toThrow();
    });

    it('throws LiveTerminalError on createSession when execution endpoint is unvailable', async () => {
      await expect(liveTerminalAdapter.createSession('agent_1')).rejects.toThrow(LiveTerminalError);
    });

    it('throws LiveBrowserPreviewError on fetch failure', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(liveBrowserPreviewAdapter.getPreview('http://localhost:59999')).rejects.toThrow(LiveBrowserPreviewError);

      global.fetch = originalFetch;
    });

    it('propagates API error on joining workspace when server is offline or workspace not found', async () => {
      await expect(liveWorkspaceRealtimeAdapter.joinWorkspace('ws_nonexistent', { id: 'u1', email: 'e', displayName: 'd', createdAt: '' })).rejects.toThrow();
    });
  });

  describe('4. Mode Isolation & Demo Non-Regression', () => {
    it('Demo Mode returns deterministic demo adapters and never calls live adapters', () => {
      setAppMode('demo');
      expect(getAppMode()).toBe('demo');

      const active = getAdapters();
      expect(active).toBe(demoAdapters);

      // Verify proxy routes to demoAdapters
      expect(adapters.auth.getCurrentUser()).toBe(demoAdapters.auth.getCurrentUser());
    });

    it('Live Mode never falls back to Demo Mode when set to live', () => {
      setAppMode('live');
      expect(getAppMode()).toBe('live');

      const active = getAdapters();
      expect(active).not.toBe(demoAdapters);

      // Reset back to demo for clean state
      setAppMode('demo');
    });
  });
});
