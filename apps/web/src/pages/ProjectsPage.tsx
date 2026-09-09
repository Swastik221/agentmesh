import { useState } from 'react';
import { ArrowRight, FolderPlus, Hexagon, Loader2 } from 'lucide-react';
import { useWorkspace } from '../state/WorkspaceContext';

/**
 * Project selection / creation. Backed by the real project API; entering a
 * project stores the choice locally so a refresh returns to the same space.
 */
export function ProjectsPage() {
  const {
    user,
    projects,
    projectsLoading,
    projectsError,
    refreshProjects,
    createProject,
    selectProject,
    logout,
  } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createProject(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <Hexagon size={24} strokeWidth={1.5} className="app-header__mark" aria-hidden="true" />
          <span className="app-header__name">AgentMesh</span>
        </div>
        <div className="app-header__identity">
          {user?.walletAddress && (
            <span className="app-header__wallet mono">
              {user.walletAddress.slice(0, 6)}…{user.walletAddress.slice(-4)}
            </span>
          )}
          <button className="btn btn--ghost" onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </header>

      <main className="projects-page">
        <section className="projects-panel">
          <h1 className="projects-panel__title">Workspaces</h1>
          <p className="projects-panel__subtitle">
            Create or enter a workspace. Tasks, agents and activity are scoped to the selected
            workspace and stored server-side.
          </p>

          {projectsError && <div className="form-error">{projectsError}</div>}

          <div className="projects-create">
            <input
              className="field"
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onCreate();
              }}
            />
            <input
              className="field"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onCreate();
              }}
            />
            <button
              className="btn btn--primary"
              onClick={() => void onCreate()}
              disabled={creating || !name.trim()}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
              Create Workspace
            </button>
          </div>

          {createError && <div className="form-error">{createError}</div>}

          {projectsLoading && projects.length === 0 ? (
            <p className="states-note">Loading workspaces…</p>
          ) : projects.length === 0 ? (
            <p className="states-note">
              No workspaces yet. Create one above — it will belong to your authenticated identity.
            </p>
          ) : (
            <ul className="projects-list">
              {projects.map((project) => (
                <li key={project.id} className="projects-item">
                  <div className="projects-item__body">
                    <span className="projects-item__name">{project.name}</span>
                    <span className="projects-item__meta mono">
                      {project.description ?? 'No description'}
                    </span>
                  </div>
                  <button
                    className="btn btn--primary"
                    onClick={() => selectProject(project.id)}
                  >
                    Enter <ArrowRight size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button className="link-btn" onClick={() => void refreshProjects()}>
            Refresh workspaces
          </button>
        </section>
      </main>
    </div>
  );
}