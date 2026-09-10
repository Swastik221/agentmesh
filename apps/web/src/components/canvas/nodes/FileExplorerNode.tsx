import { useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Folder, FileCode, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { DEMO_FILES } from '../../../adapters/demo/file.adapter';

export function FileExplorerNode({ selected }: NodeProps) {
  const [selectedPath, setSelectedPath] = useState('README.md');
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    contracts: true,
    apps: true,
  });

  const toggleFolder = (path: string) => {
    setOpenFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const currentFileContent = (() => {
    if (selectedPath === 'README.md') return DEMO_FILES[0]?.content;
    if (selectedPath === 'payment-api.json') return DEMO_FILES[1]?.content;
    if (selectedPath === 'CheckoutEscrow.sol') {
      const contracts = DEMO_FILES.find((f) => f.name === 'contracts');
      return contracts?.children?.[0]?.content;
    }
    return `// Code preview for ${selectedPath}`;
  })();

  return (
    <article
      className={`product-node product-file-node ${selected ? 'is-selected' : ''}`}
      style={{ minWidth: 380, minHeight: 280 }}
    >
      <NodeResizer isVisible={selected} minWidth={340} minHeight={240} />
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <div className="product-file-node__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Folder size={14} color="var(--mesh-flow-cyan)" />
          <span>Project Explorer</span>
        </div>
        <span style={{ fontSize: 10, fontFamily: 'var(--mesh-font-mono)', color: 'var(--mesh-text-muted)' }}>
          workspace/
        </span>
      </div>

      {/* Body: Split Explorer & Preview */}
      <div className="product-file-node__body">
        {/* Tree */}
        <div className="product-file-node__tree nowheel nodrag">
          <div
            className={`product-file-node__tree-item ${selectedPath === 'README.md' ? 'is-active' : ''}`}
            onClick={() => setSelectedPath('README.md')}
          >
            <FileText size={12} color="var(--mesh-text-muted)" />
            <span>README.md</span>
          </div>

          <div
            className={`product-file-node__tree-item ${selectedPath === 'payment-api.json' ? 'is-active' : ''}`}
            onClick={() => setSelectedPath('payment-api.json')}
          >
            <FileCode size={12} color="var(--mesh-owner-anand)" />
            <span>payment-api.json</span>
          </div>

          <div>
            <div
              className="product-file-node__tree-item"
              onClick={() => toggleFolder('contracts')}
            >
              {openFolders['contracts'] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <Folder size={12} color="var(--mesh-primary-green)" />
              <span>contracts</span>
            </div>
            {openFolders['contracts'] && (
              <div style={{ paddingLeft: 16 }}>
                <div
                  className={`product-file-node__tree-item ${selectedPath === 'CheckoutEscrow.sol' ? 'is-active' : ''}`}
                  onClick={() => setSelectedPath('CheckoutEscrow.sol')}
                >
                  <FileCode size={12} color="var(--mesh-approval-amber)" />
                  <span>CheckoutEscrow.sol</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="product-file-node__tree-item" onClick={() => toggleFolder('apps')}>
              {openFolders['apps'] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <Folder size={12} color="var(--mesh-flow-cyan)" />
              <span>apps</span>
            </div>
            {openFolders['apps'] && (
              <div style={{ paddingLeft: 16 }}>
                <div
                  className="product-file-node__tree-item"
                  onClick={() => setSelectedPath('apps/web')}
                >
                  <Folder size={11} />
                  <span>web</span>
                </div>
                <div
                  className="product-file-node__tree-item"
                  onClick={() => setSelectedPath('apps/server')}
                >
                  <Folder size={11} />
                  <span>server</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="product-file-node__preview nowheel nodrag">
          {currentFileContent}
        </div>
      </div>
    </article>
  );
}
