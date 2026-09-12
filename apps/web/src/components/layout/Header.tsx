import { useState } from 'react';
import {
  Check,
  Hexagon,
  Home,
  Maximize2,
  PanelsTopLeft,
  RefreshCw,
  Settings,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { navigate } from '../../routes/AppRouter';
import { WalletAuthButton } from '../auth/WalletAuthButton';

export function Header() {
  const [copied, setCopied] = useState<'invite' | 'share' | null>(null);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [ideMode, setIdeMode] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');

  const copy = async (value: string, kind: 'invite' | 'share') => {
    await navigator.clipboard?.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteCodeInput.trim()) {
      setJoinModalOpen(false);
      window.dispatchEvent(
        new CustomEvent('agentmesh:toast', {
          detail: `Joined project with code: ${inviteCodeInput.trim().toUpperCase()}`,
        })
      );
    }
  };

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="All projects"
          onClick={() => navigate('/workspaces')}
        >
          <Home size={16} strokeWidth={1.75} />
          <span className="sr-only">All projects</span>
        </button>
        <button
          type="button"
          className="chrome-hbtn"
          title="Return to AgentMesh landing"
          onClick={() => navigate('/')}
        >
          <Hexagon size={17} strokeWidth={2} color="var(--chrome-accent)" aria-hidden="true" />
          <span className="app-header__name">AgentMesh</span>
        </button>
        <span className="app-header__divider" aria-hidden="true" />
        <span className="app-header__project">Agent Workspace</span>
      </div>

      <div className="app-header__identity">
        <div className="app-header__actions">
          <button type="button" title="Join project with invite code" onClick={() => setJoinModalOpen(true)}>
            <UserPlus size={15} strokeWidth={1.75} />
            Join
          </button>
          <button type="button" title="Realtime protocol state is synced">
            <RefreshCw size={15} strokeWidth={1.75} />
            Sync
          </button>
          <button type="button" title="Copy project link" onClick={() => void copy(location.href, 'share')}>
            {copied === 'share' ? <Check size={15} strokeWidth={1.75} /> : <Share2 size={15} strokeWidth={1.75} />}
            {copied === 'share' ? 'Copied' : 'Share'}
          </button>
          <WalletAuthButton />
        </div>

        <span className="app-header__divider" aria-hidden="true" />

        <button
          type="button"
          className={`chrome-hbtn${ideMode ? ' chrome-hbtn--on' : ''}`}
          title="Toggle IDE mode"
          aria-pressed={ideMode}
          onClick={() => setIdeMode((on) => !on)}
        >
          <PanelsTopLeft size={15} strokeWidth={1.75} />
          IDE Mode
        </button>
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="Toggle presence panel"
          onClick={() => window.dispatchEvent(new Event('agentmesh:toggle-presence'))}
        >
          <Users size={16} strokeWidth={1.75} />
          <span className="sr-only">Presence</span>
        </button>
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="Full screen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen?.();
          }}
        >
          <Maximize2 size={15} strokeWidth={1.75} />
          <span className="sr-only">Full screen</span>
        </button>
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="Project settings"
          onClick={() => navigate('/workspaces')}
        >
          <Settings size={16} strokeWidth={1.75} />
          <span className="sr-only">Settings</span>
        </button>
      </div>

      {joinModalOpen && (
        <div
          className="workspace-modal-backdrop"
          role="presentation"
          onMouseDown={() => setJoinModalOpen(false)}
        >
          <div
            className="workspace-modal"
            style={{ maxWidth: 360 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span>MULTIPLAYER INVITATION</span>
                <h2>Join Project</h2>
              </div>
            </header>
            <form onSubmit={handleJoin} style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--mesh-text-muted)', marginBottom: 12 }}>
                Enter a project invite code to join a peer session.
              </p>
              <input
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--mesh-border-strong)',
                  fontFamily: 'var(--mesh-font-mono)',
                  fontSize: 13,
                  marginBottom: 14,
                }}
                placeholder="MESH-2026"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setJoinModalOpen(false)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--mesh-border-subtle)',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: 'var(--mesh-primary-green)',
                    color: '#FFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
