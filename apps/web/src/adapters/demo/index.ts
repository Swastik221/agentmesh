import { DemoAuthAdapter } from './auth.adapter';
import { DemoWalletAdapter } from './wallet.adapter';
import { DemoAgentConnectionAdapter } from './agent-connection.adapter';
import { DemoWorkspaceRealtimeAdapter } from './workspace-realtime.adapter';
import { DemoTaskProtocolAdapter } from './task-protocol.adapter';
import { DemoFileAdapter } from './file.adapter';
import { DemoTerminalAdapter } from './terminal.adapter';
import { DemoBrowserPreviewAdapter } from './browser-preview.adapter';

export const demoAdapters = {
  auth: new DemoAuthAdapter(),
  wallet: new DemoWalletAdapter(),
  agentConnection: new DemoAgentConnectionAdapter(),
  workspaceRealtime: new DemoWorkspaceRealtimeAdapter(),
  taskProtocol: new DemoTaskProtocolAdapter(),
  file: new DemoFileAdapter(),
  terminal: new DemoTerminalAdapter(),
  browserPreview: new DemoBrowserPreviewAdapter(),
};

export * from './auth.adapter';
export * from './wallet.adapter';
export * from './agent-connection.adapter';
export * from './workspace-realtime.adapter';
export * from './task-protocol.adapter';
export * from './file.adapter';
export * from './terminal.adapter';
export * from './browser-preview.adapter';
