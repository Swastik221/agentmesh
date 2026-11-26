import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Hexagon,
  KeyRound,
  Mail,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { usePendingInvitations } from '../../hooks/useInvitations';
import {
  getProjectJoinCode,
  joinProjectByCode,
  rotateProjectJoinCode,
} from '../../adapters/live/project.adapter';
import { navigate } from '../../routes/AppRouter';
import './workspaces-page.css';

function WorkspacesHeader() {
  return (
    <header className="demo-header">
      <button className="demo-brand" type="button" onClick={() => navigate('/')}>
        <Hexagon /> <b>AgentMesh</b>
      </button>
      <span className="demo-header__line" />
      <span>Multiplayer agent workspace</span>
    </header>
  );
}

/**
 * The owner's shareable code for one workspace. Fetched only when asked for,
 * because the server mints it on first read: a workspace nobody has shared
 * never gets a code at all.
 */
function JoinCodePanel({ projectId }: { projectId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await getProjectJoinCode(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the join code.');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await rotateProjectJoinCode(projectId));
      setCopied(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rotate the join code.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard unavailable. Select the code and copy it manually.');
    }
  };

  if (!code) {
    return (
      <>
        <button type="button" className="demo-secondary" onClick={() => void show()} disabled={busy}>
          <KeyRound /> {busy ? 'Loading…' : 'Invite code'}
        </button>
        {error && <p role="alert">{error}</p>}
      </>
    );
  }

  return (
    <div className="join-code">
      <code>{code}</code>
      <button type="button" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" onClick={() => void rotate()} disabled={busy} title="Replace this code">
        <RotateCcw /> New
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function WorkspacesPage() {
  const accessRemoved = new URLSearchParams(location.search).get('notice') === 'access-removed';
  const { projects, loading, error, refetch, createProject } = useProjects();
  const { invitations, acceptInvitation, declineInvitation } = usePendingInvitations();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleAccept = async (invitationId: string) => {
    setActionBusyId(invitationId);
    setInviteError(null);
    try {
      await acceptInvitation(invitationId);
      await refetch();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDecline = async (invitationId: string) => {
    setActionBusyId(invitationId);
    setInviteError(null);
    try {
      await declineInvitation(invitationId);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to decline invitation');
    } finally {
      setActionBusyId(null);
    }
  };

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
      const project = await createProject({ name });
      setCreateOpen(false);
      navigate(`/workspace/${project.id}`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to create project.');
    } finally {
      setBusy(false);
    }
  };

  const join = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setJoinBusy(true);
    setJoinError('');
    try {
      const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
      const project = await joinProjectByCode(code);
      setJoinOpen(false);
      navigate(`/workspace/${project.id}`);
    } catch (reason) {
      // The real server message, including "that join code does not match any
      // workspace", rather than a friendlier invention.
      setJoinError(reason instanceof Error ? reason.message : 'Unable to join that workspace.');
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="demo-page">
      <WorkspacesHeader />
      <main className="workspaces">
        <header>
          <div>
            <span>YOUR PROJECTS</span>
            <h1>Choose where your agents coordinate.</h1>
            {accessRemoved && (
              <p role="alert" className="workspaces-notice">
                Your access to that workspace was removed, so you were signed out of it.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="demo-secondary"
              onClick={() => {
                setJoinOpen(!joinOpen);
                setCreateOpen(false);
                setJoinError('');
              }}
            >
              <KeyRound /> Join with code
            </button>
            <button
              type="button"
              className="demo-primary"
              onClick={() => {
                setCreateOpen(!createOpen);
                setJoinOpen(false);
                setFormError('');
              }}
            >
              <Plus /> Create workspace
            </button>
          </div>
        </header>

        {invitations.length > 0 && (
          <section className="pending-invitations-banner">
            <h2 className="invite-banner__title">
              <Mail size={15} /> Pending workspace invitations ({invitations.length})
            </h2>
            {invitations.map((inv) => (
              <article key={inv.id} className="invite-card">
                <div>
                  <span className="invite-card__role">INVITATION · {inv.role}</span>
                  <h3>{inv.project?.name || 'Workspace'}</h3>
                  <p>
                    Invited by{' '}
                    {inv.inviterUser?.displayName ||
                      inv.inviterUser?.walletAddress?.slice(0, 10) ||
                      'a teammate'}
                  </p>
                </div>
                <div className="invite-card__actions">
                  <button
                    type="button"
                    className="demo-primary"
                    disabled={actionBusyId === inv.id}
                    onClick={() => void handleAccept(inv.id)}
                  >
                    <Check /> {actionBusyId === inv.id ? 'Accepting…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    className="demo-secondary"
                    disabled={actionBusyId === inv.id}
                    onClick={() => void handleDecline(inv.id)}
                  >
                    <X /> Decline
                  </button>
                </div>
              </article>
            ))}
            {inviteError && <p role="alert">{inviteError}</p>}
          </section>
        )}

        {joinOpen && (
          <div className="workspace-inline-form">
            <form onSubmit={join}>
              <label>
                Workspace invite code
                <input name="code" required autoFocus placeholder="MESH-XXXXXXXX" />
              </label>
              <button type="submit" className="demo-primary" disabled={joinBusy}>
                {joinBusy ? 'Joining…' : 'Join workspace'}
              </button>
            </form>
            {joinError && <p role="alert">{joinError}</p>}
          </div>
        )}

        {createOpen && (
          <div className="workspace-inline-form">
            <form onSubmit={create}>
              <label>
                Workspace name
                <input name="name" required autoFocus defaultValue="" placeholder="My Startup" />
              </label>
              <button type="submit" className="demo-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create and open'}
              </button>
            </form>
            {formError && <p role="alert">{formError}</p>}
          </div>
        )}

        <section className="workspace-list">
          <div className="workspace-list__label">YOUR WORKSPACES</div>
          {loading ? (
            <p role="status">Loading your projects…</p>
          ) : error ? (
            <div className="workspace-error" role="alert">
              <p>{error}</p>
              <button type="button" className="demo-secondary" onClick={() => void refetch()}>
                <RotateCcw /> Retry
              </button>
            </div>
          ) : projects.length === 0 ? (
            <p className="workspace-empty">
              No workspaces yet. Create one, join with a code a teammate gave you, or accept an
              invitation.
            </p>
          ) : (
            projects.map((project) => {
              const role = (project.role ?? 'member').toUpperCase();
              return (
                <article key={project.id}>
                  <div className="workspace-symbol">
                    <Hexagon />
                  </div>
                  <div>
                    <span>{role}</span>
                    <h2>{project.name}</h2>
                    <p>{project.description || project.id}</p>
                    {/* Only the owner can mint or read the code, so only the
                        owner is offered the control. */}
                    {role === 'OWNER' && <JoinCodePanel projectId={project.id} />}
                  </div>
                  <button
                    type="button"
                    className="workspace-open"
                    onClick={() => navigate(`/workspace/${project.id}`)}
                  >
                    Open project <ArrowRight />
                  </button>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
