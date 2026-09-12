import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Hexagon, Mail, Plus, RotateCcw, X } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { usePendingInvitations } from '../../hooks/useInvitations';
import { navigate } from '../../routes/AppRouter';

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

export function WorkspacesPage() {
  const { projects, loading, error, refetch, createProject } = useProjects();
  const {
    invitations,
    acceptInvitation,
    declineInvitation,
  } = usePendingInvitations();

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const handleAccept = async (invitationId: string) => {
    setActionBusyId(invitationId);
    try {
      await acceptInvitation(invitationId);
      await refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDecline = async (invitationId: string) => {
    setActionBusyId(invitationId);
    try {
      await declineInvitation(invitationId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to decline invitation');
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

  return (
    <div className="demo-page">
      <WorkspacesHeader />
      <main className="workspaces">
        <header>
          <div>
            <span>YOUR PROJECTS</span>
            <h1>Choose where your agents coordinate.</h1>
          </div>
          <div>
            <button
              type="button"
              className="demo-primary"
              onClick={() => {
                setCreateOpen(!createOpen);
                setFormError('');
              }}
            >
              <Plus /> Create workspace
            </button>
          </div>
        </header>

        {invitations.length > 0 && (
          <section className="pending-invitations-banner" style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--canvas-copy)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={16} /> Pending Workspace Invitations ({invitations.length})
            </h2>
            <div style={{ display: 'grid', gap: '12px' }}>
              {invitations.map((inv) => (
                <article
                  key={inv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--canvas-line-strong)',
                    background: 'rgba(255, 255, 255, 0.9)',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--canvas-dim)', textTransform: 'uppercase' }}>
                      INVITATION · {inv.role}
                    </span>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '2px 0' }}>
                      {inv.project?.name || 'Workspace'}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--canvas-copy)', margin: 0 }}>
                      Invited by {inv.inviterUser?.displayName || inv.inviterUser?.walletAddress?.slice(0, 10) || 'a teammate'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={actionBusyId === inv.id}
                      onClick={() => void handleAccept(inv.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'var(--canvas-green)',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Check size={14} /> {actionBusyId === inv.id ? 'Accepting…' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusyId === inv.id}
                      onClick={() => void handleDecline(inv.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--canvas-line-strong)',
                        background: 'transparent',
                        color: 'var(--canvas-copy)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      <X size={14} /> Decline
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
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
                <RotateCcw size={14} /> Retry
              </button>
            </div>
          ) : projects.length === 0 ? (
            <p className="workspace-empty">
              No workspaces yet. Create your first workspace or accept an invitation to collaborate.
            </p>
          ) : (
            projects.map((project) => (
              <article key={project.id}>
                <div className="workspace-symbol">
                  <Hexagon />
                </div>
                <div>
                  <span>{(project.role ?? 'member').toUpperCase()}</span>
                  <h2>{project.name}</h2>
                  <p>{project.description || project.id}</p>
                </div>
                <button
                  type="button"
                  className="workspace-open"
                  onClick={() => navigate(`/workspace/${project.id}`)}
                >
                  Open project <ArrowRight />
                </button>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
