import { describe, it, expect, vi } from 'vitest';
import { liveWalletAdapter, LiveWalletError } from '../wallet.adapter';
import { liveAuthAdapter, LiveAuthError } from '../auth.adapter';
import { liveAgentConnectionAdapter, LiveAgentConnectionError } from '../agent-connection.adapter';
import { liveTaskProtocolAdapter, LiveTaskProtocolError } from '../task-protocol.adapter';
import { liveFileAdapter, LiveFileAdapterError } from '../file.adapter';
import { liveTerminalAdapter, LiveTerminalError } from '../terminal.adapter';
import { liveBrowserPreviewAdapter, LiveBrowserPreviewError } from '../browser-preview.adapter';
import { liveWorkspaceRealtimeAdapter } from '../workspace-realtime.adapter';
import { demoAdapters } from '../../demo/index';
import { getAdapters, adapters } from '../../index';
import { setAppMode, getAppMode } from '../../../config/env';

describe('INT-1-C2 Live Adapters Contract Alignment & Mode Isolation Tests', () => {
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

    it('throws LiveWalletError when eth_chainId fails or returns invalid value without defaulting to chain 1', async () => {
      const originalWindow = global.window;
      Object.defineProperty(global, 'window', {
        value: {
          ethereum: {
            request: vi.fn().mockImplementation(async (args: { method: string }) => {
              if (args.method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
              if (args.method === 'eth_chainId') throw new Error('RPC error querying chainId');
              return null;
            }),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(LiveWalletError);
      await expect(liveWalletAdapter.connectWallet('metamask')).rejects.toThrow(/eth_chainId/);

      global.window = originalWindow;
    });

    it('returns real wallet identity when provider succeeds', async () => {
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
      await expect(liveWalletAdapter.signApproval('app_1', 'action_1')).rejects.toThrow(/Wallet approval signing is not implemented in INT-1/);
    });

    it('propagates ENS resolution error without converting to fake resolved: false or developer.eth', async () => {
      await expect(liveWalletAdapter.resolveEns('0x9999999999999999999999999999999999999999')).rejects.toThrow();
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

  describe('3. Unsupported Capabilities Correctness', () => {
    it('throws LiveAgentConnectionError on getAvailableAgents without projectId or on connect/disconnect/announce', async () => {
      await expect(liveAgentConnectionAdapter.getAvailableAgents()).rejects.toThrow(LiveAgentConnectionError);
      await expect(liveAgentConnectionAdapter.connectAgent('ag_1')).rejects.toThrow(LiveAgentConnectionError);
      await expect(liveAgentConnectionAdapter.disconnectAgent('ag_1')).rejects.toThrow(LiveAgentConnectionError);
      await expect(liveAgentConnectionAdapter.announceCapabilities('ag_1', ['cap'])).rejects.toThrow(LiveAgentConnectionError);
    });

    it('throws LiveTaskProtocolError on submitPrd, claimTask, and autoAssignTask', async () => {
      await expect(liveTaskProtocolAdapter.submitPrd('ws_1', 'prd text')).rejects.toThrow(LiveTaskProtocolError);
      await expect(liveTaskProtocolAdapter.claimTask('ws_1', 'task_1', 'ag_1')).rejects.toThrow(LiveTaskProtocolError);
      await expect(liveTaskProtocolAdapter.autoAssignTask('ws_1', 'task_1', 'ag_1')).rejects.toThrow(LiveTaskProtocolError);
    });

    it('throws LiveFileAdapterError on file operations (getFiles, readFile, getArtifacts without taskId, publishArtifact without taskId)', async () => {
      await expect(liveFileAdapter.getFiles('ws_1')).rejects.toThrow(LiveFileAdapterError);
      await expect(liveFileAdapter.readFile('ws_1', 'file.txt')).rejects.toThrow(LiveFileAdapterError);
      await expect(liveFileAdapter.getArtifacts('ws_1')).rejects.toThrow(LiveFileAdapterError);
      await expect(liveFileAdapter.publishArtifact('ws_1', { id: 'art_1', name: 'n', schema: 's', hash: 'h', publishedBy: 'p', usedBy: 'u' })).rejects.toThrow(LiveFileAdapterError);
    });

    it('throws LiveTerminalError on createSession and executeCommand', async () => {
      await expect(liveTerminalAdapter.createSession('agent_1')).rejects.toThrow(LiveTerminalError);
      await expect(liveTerminalAdapter.executeCommand('sess_1', 'ls')).rejects.toThrow(LiveTerminalError);
    });

    it('throws LiveBrowserPreviewError on getPreview', async () => {
      await expect(liveBrowserPreviewAdapter.getPreview('http://example.com')).rejects.toThrow(LiveBrowserPreviewError);
    });

    it('propagates API error when querying tasks or joining workspace for non-existent workspace in Live Mode', async () => {
      await expect(liveTaskProtocolAdapter.getTasks('invalid_ws')).rejects.toThrow();
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
