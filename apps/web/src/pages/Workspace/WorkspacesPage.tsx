import { useState, type FormEvent } from 'react';
import { ArrowRight, Hexagon, Plus, RotateCcw } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
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
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

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
              <Plus /> Create project
            </button>
          </div>
        </header>
        {createOpen && (
          <div className="workspace-inline-form">
            <form onSubmit={create}>
              <label>
                Project name
                <input name="name" required autoFocus defaultValue="" />
              </label>
              <button type="submit" className="demo-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create and open'}
              </button>
            </form>
            {formError && <p role="alert">{formError}</p>}
          </div>
        )}
        <section className="workspace-list">
          <div className="workspace-list__label">YOUR PROJECTS</div>
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
              No projects yet. Create your first project to bring your agents together.
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
