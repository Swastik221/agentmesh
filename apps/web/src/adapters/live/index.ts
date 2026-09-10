import { liveAuthAdapter } from './auth.adapter';
import { liveWalletAdapter } from './wallet.adapter';
import { liveAgentConnectionAdapter } from './agent-connection.adapter';
import { liveWorkspaceRealtimeAdapter } from './workspace-realtime.adapter';
import { liveTaskProtocolAdapter } from './task-protocol.adapter';
import { liveFileAdapter } from './file.adapter';
import { liveTerminalAdapter } from './terminal.adapter';
import { liveBrowserPreviewAdapter } from './browser-preview.adapter';

export * from './auth.adapter';
export * from './wallet.adapter';
export * from './agent-connection.adapter';
export * from './workspace-realtime.adapter';
export * from './task-protocol.adapter';
export * from './file.adapter';
export * from './terminal.adapter';
export * from './browser-preview.adapter';

export const liveAdapters = {
  auth: liveAuthAdapter,
  wallet: liveWalletAdapter,
  agentConnection: liveAgentConnectionAdapter,
  workspaceRealtime: liveWorkspaceRealtimeAdapter,
  taskProtocol: liveTaskProtocolAdapter,
  file: liveFileAdapter,
  terminal: liveTerminalAdapter,
  browserPreview: liveBrowserPreviewAdapter,
};
