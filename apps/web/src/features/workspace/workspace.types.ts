export type OwnerColor = 'purple' | 'green';
export interface HumanOwner {
  id: string;
  name: string;
  ens: string;
  address: string;
  color: OwnerColor;
}
export interface ProductAgent {
  id: string;
  name: string;
  provider: string;
  ownerId: string;
  ens: string;
  address: string;
  capabilities: string[];
  status: 'connected' | 'working';
  logs: string[];
}
export interface WorkspacePresence {
  id: string;
  humanOwnerId: string;
  agentId: string;
}
export type ProductTaskStatus = 'proposed' | 'claimed' | 'auto-assigned';
export interface ProductTask {
  id: string;
  title: string;
  capability: string;
  status: ProductTaskStatus;
  suggestedAgent: string;
  claimedBy?: string;
  countdown?: number;
  reason: string;
}
export type ProtocolEventType =
  | 'HELLO'
  | 'CAPABILITY_ANNOUNCEMENT'
  | 'TASK_PROPOSAL'
  | 'TASK_PREFERENCE'
  | 'TASK_CLAIMED'
  | 'DEPENDENCY_REQUEST'
  | 'ARTIFACT_PUBLISHED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_APPROVED'
  | 'APPROVAL_REJECTED';
export interface ProtocolEvent {
  id: string;
  time: string;
  sender: string;
  receiver: string;
  type: ProtocolEventType;
  payload: string;
}
export interface WorkspaceArtifact {
  id: string;
  name: string;
  hash: string;
  schema: string;
  publishedBy: string;
  usedBy: string;
}
export interface ApprovalRequest {
  id: string;
  action: string;
  detail: string;
  status: 'pending' | 'approved' | 'rejected';
}
export interface ProductWorkspaceState {
  tasks: ProductTask[];
  events: ProtocolEvent[];
  approval: ApprovalRequest;
}
