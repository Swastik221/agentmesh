import { useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Globe, RotateCw, ExternalLink } from 'lucide-react';

export interface BrowserNodeData {
  initialUrl?: string;
}

export function BrowserNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as BrowserNodeData;
  const [tab, setTab] = useState<'preview' | 'api'>('preview');
  const [isReloading, setIsReloading] = useState(false);

  const reload = () => {
    setIsReloading(true);
    setTimeout(() => setIsReloading(false), 300);
  };

  return (
    <article
      className={`product-node product-browser-node ${selected ? 'is-selected' : ''}`}
      style={{ minWidth: 380, minHeight: 280 }}
    >
      <NodeResizer isVisible={selected} minWidth={360} minHeight={260} />
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Top Chrome */}
      <div className="product-browser-node__topbar">
        <span className="product-window-dots">
          <i />
          <i />
          <i />
        </span>
        <div className="product-browser-node__url-bar">
          <Globe size={11} style={{ display: 'inline', marginRight: 5, verticalAlign: -1 }} />
          <span>
            {tab === 'preview'
              ? nodeData.initialUrl || 'agentmesh://preview/checkout'
              : 'agentmesh://api/docs/payment'}
          </span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="mesh-composer-btn nodrag nopan"
          title="Reload preview"
          style={{ padding: 4 }}
        >
          <RotateCw size={13} className={isReloading ? 'spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="product-browser-node__tabs">
        <div
          className={`product-browser-node__tab ${tab === 'preview' ? 'is-active' : ''}`}
          onClick={() => setTab('preview')}
        >
          Checkout App Preview
        </div>
        <div
          className={`product-browser-node__tab ${tab === 'api' ? 'is-active' : ''}`}
          onClick={() => setTab('api')}
        >
          Payment API Schema
        </div>
      </div>

      {/* Content */}
      <div className="product-browser-node__content nowheel nodrag">
        {tab === 'preview' ? (
          <div style={{ padding: 18, color: 'var(--mesh-text-main)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                borderBottom: '1px solid var(--mesh-border-subtle)',
                paddingBottom: 8,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mesh-primary-green)' }}>
                ● LOCAL SANDBOX PREVIEW
              </span>
              <span
                style={{
                  fontSize: 10,
                  backgroundColor: 'var(--mesh-soft-mint)',
                  color: 'var(--mesh-primary-green)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                HTTP 200 OK
              </span>
            </div>

            <div
              style={{
                backgroundColor: 'var(--mesh-bg-secondary)',
                border: '1px solid var(--mesh-border-subtle)',
                borderRadius: 8,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--mesh-text-muted)', marginBottom: 4 }}>
                Escrow Settlement
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: 'var(--mesh-font-mono)',
                  color: 'var(--mesh-text-main)',
                }}
              >
                0.35 ETH
              </div>
              <div style={{ fontSize: 11, color: 'var(--mesh-text-muted)', marginTop: 4 }}>
                Owner: <code>dev1.eth (Anand)</code>
              </div>
            </div>

            <div
              style={{
                fontSize: 11,
                backgroundColor: 'var(--mesh-approval-bg)',
                border: '1px solid rgba(217, 154, 50, 0.3)',
                color: '#8A5800',
                padding: '8px 10px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ExternalLink size={12} />
              <span>Contract deployment blocked until human owner signs approval.</span>
            </div>
          </div>
        ) : (
          <pre
            style={{
              padding: 14,
              margin: 0,
              fontSize: 10,
              fontFamily: 'var(--mesh-font-mono)',
              lineHeight: 1.5,
              color: 'var(--mesh-flow-cyan)',
              whiteSpace: 'pre-wrap',
            }}
          >
{`{
  "openapi": "3.0.0",
  "info": {
    "title": "Payment API",
    "version": "1.0.0"
  },
  "paths": {
    "/payment/intent": {
      "post": {
        "summary": "Create checkout intent",
        "spendThreshold": "0.35 ETH",
        "schemaHash": "sha256:7fb2…91cd"
      }
    }
  }
}`}
          </pre>
        )}
      </div>
    </article>
  );
}
