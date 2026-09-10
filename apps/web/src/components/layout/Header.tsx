import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Hexagon,
  Home,
  Maximize2,
  MoreHorizontal,
  PanelsTopLeft,
  RefreshCw,
  Settings,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useDemo } from '../../demo/DemoProvider';
import { PRIMARY_WORKSPACE } from '../../demo/demo.fixtures';
import { navigate } from '../../demo/navigation';

/**
 * The workspace's top bar: 46px, near-black, and quiet — no filled or
 * coloured buttons, so the canvas below it is the only thing with weight.
 *
 * Left to right it reads home, brand, workspace name; then on the right,
 * collaboration (Join / Sync / Share / more), view controls (IDE mode,
 * presence, full screen, settings), and finally identity.
 */
export function Header() {
  const { profile } = useDemo();
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
          detail: `Joined workspace with code: ${inviteCodeInput.trim().toUpperCase()}`,
        })
      );
    }
  };

  return (
    <header className="app-header">
      {/* Left: home, brand, then the workspace this canvas belongs to — the
          same order and proportions as the reference bar. */}
      <div className="app-header__brand">
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="All workspaces"
          onClick={() => navigate('/workspaces')}
        >
          <Home size={16} strokeWidth={1.75} />
          <span className="sr-only">All workspaces</span>
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
        <span className="app-header__project">Checkout protocol workspace</span>
      </div>

      {/* Right: collaboration, then the view controls, then identity. */}
      <div className="app-header__identity">
        <div className="app-header__actions">
          <button type="button" title="Join workspace with invite code" onClick={() => setJoinModalOpen(true)}>
            <UserPlus size={15} strokeWidth={1.75} />
            Join
          </button>
          <button type="button" title="Local-first protocol state is synced">
            <RefreshCw size={15} strokeWidth={1.75} />
            Sync
          </button>
          <button type="button" title="Copy workspace link" onClick={() => void copy(location.href, 'share')}>
            {copied === 'share' ? <Check size={15} strokeWidth={1.75} /> : <Share2 size={15} strokeWidth={1.75} />}
            {copied === 'share' ? 'Copied' : 'Share'}
          </button>
          <button
            type="button"
            className="chrome-hbtn chrome-hbtn--icon"
            title="More workspace actions"
            onClick={() => window.dispatchEvent(new Event('agentmesh:replay'))}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
            <span className="sr-only">More</span>
          </button>
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
          title="Workspace settings"
          onClick={() => navigate('/workspaces')}
        >
          <Settings size={16} strokeWidth={1.75} />
          <span className="sr-only">Settings</span>
        </button>

        {/* Identity closes the bar: avatar, then the wallet it belongs to. */}
        <button type="button" className="chrome-avatar" title={`${profile.name} · ${profile.ens}`}>
          <i
            style={{
              backgroundColor:
                profile.color === 'purple' ? 'var(--mesh-owner-anand)' : 'var(--mesh-owner-swastik)',
            }}
          >
            {profile.name.charAt(0)}
          </i>
          <ChevronDown size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Join Workspace Modal */}
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
                <h2>Join Workspace</h2>
              </div>
            </header>
            <form onSubmit={handleJoin} style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--mesh-text-muted)', marginBottom: 12 }}>
                Current workspace invite code is{' '}
                <strong style={{ color: 'var(--mesh-primary-green)', fontFamily: 'var(--mesh-font-mono)' }}>
                  {PRIMARY_WORKSPACE.inviteCode}
                </strong>
                . Enter an invite code to join a peer session.
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
