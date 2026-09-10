import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ShieldAlert, Check, X } from 'lucide-react';
import type { ApprovalRequest } from '../../../adapters/types';

export interface ApprovalNodeData {
  request: ApprovalRequest;
  onDecision?: (decision: 'approved' | 'rejected') => void;
  onOpenModal?: () => void;
}

export function ApprovalNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ApprovalNodeData;
  const request = nodeData.request;
  const isPending = request.status === 'pending';

  return (
    <article className={`product-node product-approval ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <header className="product-approval__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldAlert size={16} />
          <span>Human Approval Gate</span>
        </div>
        <span style={{ fontFamily: 'var(--mesh-font-mono)', fontSize: 10 }}>{request.id}</span>
      </header>

      {/* Body */}
      <div className="product-approval__body">
        <div className="product-approval__risk-badge">HIGH-RISK WEB3 ACTION</div>
        <div className="product-approval__action">{request.action}</div>
        <div className="product-approval__detail">
          Spend threshold: <strong style={{ color: 'var(--mesh-approval-amber)' }}>{request.spendThreshold || '$0.001 USDC (Hedera Testnet)'}</strong>
        </div>
        <div className="product-approval__authority">
          Agent can propose. Wallet owner holds final authority.
        </div>

        {isPending ? (
          <div className="product-approval__buttons">
            <button
              type="button"
              className="product-approval__btn product-approval__btn--reject nodrag nopan"
              onClick={() => nodeData.onDecision?.('rejected')}
            >
              <X size={13} style={{ display: 'inline', marginRight: 3, verticalAlign: -2 }} />
              Reject
            </button>
            <button
              type="button"
              className="product-approval__btn product-approval__btn--approve nodrag nopan"
              onClick={() => nodeData.onDecision?.('approved')}
            >
              <Check size={13} style={{ display: 'inline', marginRight: 3, verticalAlign: -2 }} />
              Approve
            </button>
          </div>
        ) : (
          <div
            className={`product-approval__decision-badge product-approval__decision-badge--${request.status}`}
          >
            {request.status === 'approved' ? '✓ Approved by dev1.eth (Signed)' : '× Rejected by dev1.eth'}
          </div>
        )}
      </div>
    </article>
  );
}
