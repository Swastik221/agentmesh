import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Hexagon,
  Home,
  KeyRound,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { navigate } from '../../routes/AppRouter';
import { WalletAuthButton } from '../auth/WalletAuthButton';
import { currentProjectId } from '../../utils/currentProjectId';
import { authSessionService } from '../../services/auth-session';
import { useWorkspaceRealtime } from '../../hooks/useWorkspaceRealtime';
import { liveProjectAdapter, type Project } from '../../adapters/live/project.adapter';
import {
  getProjectJoinCode,
  joinProjectByCode,
  rotateProjectJoinCode,
} from '../../adapters/live/project.adapter';

export function Header() {
  const projectId = currentProjectId();
  const realtime = useWorkspaceRealtime(projectId);
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProject(null);
    if (!projectId) return;
    liveProjectAdapter
      .getProject(projectId)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  // The invite (join) code is owner-only on the server; only the owner is offered it.
  const isOwner = Boolean(project && project.ownerId === authSessionService.getCurrentUser()?.id);
  const [copied, setCopied] = useState<'invite' | 'share' | null>(null);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const copy = async (value: string, kind: 'invite' | 'share') => {
    await navigator.clipboard?.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  };

  /**
   * Really joins the workspace the code belongs to. This used to close the
   * modal and fire a "Joined project with code: X" toast without calling
   * anything, so it reported success for a join that never happened.
   */
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCodeInput.trim();
    if (!code) return;
    setJoinBusy(true);
    setJoinError('');
    try {
      const project = await joinProjectByCode(code);
      setJoinModalOpen(false);
      setInviteCodeInput('');
      navigate(`/workspace/${project.id}`);
    } catch (reason) {
      // The server's real message, e.g. "That join code does not match any
      // workspace", instead of a success that did not happen.
      setJoinError(reason instanceof Error ? reason.message : 'Could not join that workspace.');
    } finally {
      setJoinBusy(false);
    }
  };

  /** Shows this workspace's invite code. Owner only, enforced server-side. */
  const openInvite = async () => {
    const projectId = currentProjectId();
    if (!projectId) return;
    setInviteModalOpen(true);
    setInviteBusy(true);
    setInviteError('');
    try {
      setInviteCode(await getProjectJoinCode(projectId));
    } catch (reason) {
      setInviteCode(null);
      setInviteError(
        reason instanceof Error ? reason.message : 'Could not load the invite code.',
      );
    } finally {
      setInviteBusy(false);
    }
  };

  const rotateInvite = async () => {
    const projectId = currentProjectId();
    if (!projectId) return;
    setInviteBusy(true);
    setInviteError('');
    try {
      setInviteCode(await rotateProjectJoinCode(projectId));
    } catch (reason) {
      setInviteError(
        reason instanceof Error ? reason.message : 'Could not rotate the invite code.',
      );
    } finally {
      setInviteBusy(false);
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
        <span className="app-header__project">{project?.name ?? 'Workspace'}</span>
      </div>

      <div className="app-header__identity">
        <div className="app-header__actions">
          {isOwner && (
            <button type="button" title="Show this workspace's invite code" onClick={() => void openInvite()}>
              <KeyRound size={15} strokeWidth={1.75} />
              Invite
            </button>
          )}
          <button type="button" title="Join another workspace with an invite code" onClick={() => setJoinModalOpen(true)}>
            <UserPlus size={15} strokeWidth={1.75} />
            Join
          </button>
          {projectId && (
            <span
              className={`app-header__live app-header__live--${realtime.status}`}
              title={`Realtime connection: ${realtime.status}`}
              role="status"
            >
              <RefreshCw size={13} strokeWidth={1.75} />
              {realtime.status === 'connected' ? 'Live' : realtime.status === 'revoked' ? 'No access' : realtime.status === 'disconnected' ? 'Offline' : 'Reconnecting…'}
            </span>
          )}
          <button type="button" title="Copy project link" onClick={() => void copy(location.href, 'share')}>
            {copied === 'share' ? <Check size={15} strokeWidth={1.75} /> : <Share2 size={15} strokeWidth={1.75} />}
            {copied === 'share' ? 'Copied' : 'Share'}
          </button>
          <WalletAuthButton />
        </div>

        <span className="app-header__divider" aria-hidden="true" />

        {/* The IDE Mode toggle was removed: it flipped a piece of state that
            nothing else in the app ever read, so pressing it changed only the
            button's own appearance. */}
        <button
          type="button"
          className="chrome-hbtn chrome-hbtn--icon"
          title="Who's here: members and their presence"
          onClick={() => window.dispatchEvent(new CustomEvent('agentmesh:open-section', { detail: 'team' }))}
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
            <form onSubmit={handleJoin}>
              <p>Enter a project invite code to join a peer session.</p>
              <input
                className="join-code-field"
                placeholder="MESH-XXXXXXXX"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                autoFocus
              />
              {joinError && (
                <p role="alert" className="invite-modal__error" style={{ margin: '0 0 12px' }}>
                  {joinError}
                </p>
              )}
              <div className="invite-modal__actions">
                <button type="button" onClick={() => setJoinModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="is-primary" disabled={joinBusy}>
                  {joinBusy ? 'Joining…' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inviteModalOpen && (
        <div
          className="workspace-modal-backdrop"
          role="presentation"
          onMouseDown={() => setInviteModalOpen(false)}
        >
          <div
            className="workspace-modal"
            style={{ maxWidth: 400 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span>WORKSPACE INVITE</span>
                <h2>Invite code</h2>
              </div>
            </header>
            <p>Share this code. Anyone signed in who enters it joins this workspace as a member.</p>

            {inviteBusy && !inviteCode ? (
              <p className="invite-modal__status">Loading…</p>
            ) : inviteError ? (
              <p role="alert" className="invite-modal__error">
                {inviteError}
              </p>
            ) : inviteCode ? (
              <div className="invite-code-row">
                <code className="invite-code-row__value">{inviteCode}</code>
                <button
                  type="button"
                  title="Copy invite code"
                  onClick={() => void copy(inviteCode, 'invite')}
                >
                  {copied === 'invite' ? <Check size={13} /> : <Copy size={13} />}
                  {copied === 'invite' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  title="Replace this code, invalidating the old one"
                  disabled={inviteBusy}
                  onClick={() => void rotateInvite()}
                >
                  <RotateCcw size={13} /> New
                </button>
              </div>
            ) : null}

            <div className="invite-modal__footer">
              <button type="button" onClick={() => setInviteModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
