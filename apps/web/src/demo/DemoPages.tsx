import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Copy, Eye, EyeOff, Hexagon, LockKeyhole, LogOut, Mail, Plus, RotateCcw, ShieldCheck, UserRound, Users, WalletCards, X } from 'lucide-react';
import { demoGateways } from './demo.gateways';
import { DEMO_PROFILES, PRIMARY_WORKSPACE } from './demo.fixtures';
import { navigate } from './navigation';
import { useDemo } from './DemoProvider';
import type { DemoProfileId } from './demo.types';
import { getAppMode } from '../config/env';
import { useProjects } from '../hooks/useProjects';
import './demo.css';
import './auth.css';

function DemoHeader({ compact = false }: { compact?: boolean }) {
  const { state, setSession } = useDemo();
  return <header className="demo-header"><button className="demo-brand" onClick={() => navigate('/')}><Hexagon /> <b>AgentMesh</b></button><span className="demo-header__line"/><span>{compact ? 'Demo workspace' : 'Multiplayer agent workspace'}</span><span className="demo-badge">DEMO MODE</span><div className="demo-header__actions">{state.session && <><span>{state.session.displayName}</span><button onClick={() => { void demoGateways.auth.logout(); setSession(null); navigate('/login'); }}><LogOut size={15}/> Log out</button></>}</div></header>;
}
function Shell({ children, title, copy }: { children: ReactNode; title: string; copy: string }) {
  return <div className="demo-page demo-auth-page"><DemoHeader/><main className="demo-page__main"><section className="demo-page__intro"><div className="auth-mesh" aria-hidden="true"><i/><i/><i/><svg viewBox="0 0 400 200"><path d="M24 138 C116 138 102 48 198 48 S282 138 376 138"/><path d="M24 138 C132 138 116 168 198 168 S284 138 376 138"/></svg></div><span>AGENTMESH / LOCAL FIRST</span><h1>{title}</h1><p>{copy}</p><dl><div><dt>01</dt><dd>Identity stays scoped</dd></div><div><dt>02</dt><dd>Agents coordinate in public</dd></div><div><dt>03</dt><dd>Humans keep final authority</dd></div></dl></section>{children}</main></div>;
}

function WalletDialog({ status, onClose, onConnect }: { status: string; onClose(): void; onConnect(name: string): void }) {
  const wallets = [{ name: 'MetaMask', mark: 'M', color: 'orange' }, { name: 'Coinbase Wallet', mark: 'C', color: 'blue' }, { name: 'Rabby', mark: 'R', color: 'violet' }];
  return <div className="wallet-dialog-backdrop" role="presentation" onMouseDown={status ? undefined : onClose}><section className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>DEMO WALLET</span><h2 id="wallet-dialog-title">Connect a browser wallet</h2></div><button aria-label="Close wallet dialog" onClick={onClose} disabled={Boolean(status)}><X/></button></header><p className="wallet-dialog__notice"><ShieldCheck/> This is a safe simulation. AgentMesh will not request a signature, transaction, private key, or seed phrase.</p>{status ? <div className="wallet-dialog__progress" role="status"><i/><div><b>{status}</b><span>Preparing your scoped demo identity</span></div></div> : <div className="wallet-options">{wallets.map((wallet, index) => <button key={wallet.name} autoFocus={index === 0} onClick={() => onConnect(wallet.name)}><i className={`wallet-mark wallet-mark--${wallet.color}`}>{wallet.mark}</i><span><b>{wallet.name}</b><small>Browser extension</small></span><ChevronRight/></button>)}</div>}<footer><i/> Only the selected demo address is shared with the workspace.</footer></section></div>;
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { setSession } = useDemo();
  const [show, setShow] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(false); const [walletOpen, setWalletOpen] = useState(false); const [walletStatus, setWalletStatus] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(''); const data = new FormData(e.currentTarget); const password = String(data.get('password') ?? '');
    if (mode === 'signup' && password !== String(data.get('confirm') ?? '')) { setError('Passwords do not match.'); return; }
    if (mode === 'signup' && !data.get('terms')) { setError('Accept the demo terms to continue.'); return; }
    setLoading(true);
    try { const session = mode === 'login' ? await demoGateways.auth.login({ email: String(data.get('email')), password, remember: Boolean(data.get('remember')) }) : await demoGateways.auth.signup({ displayName: String(data.get('displayName')), email: String(data.get('email')), password }); setSession(session); setSuccess(true); setTimeout(() => navigate('/onboarding'), 500); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not continue.'); }
    finally { setLoading(false); }
  };
  const demo = () => { const profile = DEMO_PROFILES[0]; const session = { id: 'session-anand', email: profile.email, displayName: profile.name, profileId: profile.id, createdAt: new Date().toISOString() }; localStorage.setItem('agentmesh.demo.session', JSON.stringify(session)); sessionStorage.setItem('agentmesh.demo.tab.session', JSON.stringify(session)); setSession(session); navigate('/onboarding'); };
  const connectWallet = (name: string) => { setWalletStatus(`Opening ${name}…`); window.setTimeout(() => setWalletStatus('Demo wallet connected'), 650); window.setTimeout(demo, 1250); };
  useEffect(() => { if (!walletOpen || walletStatus) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setWalletOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [walletOpen, walletStatus]);
  return <Shell title={mode === 'login' ? 'Welcome back to the mesh.' : 'Bring your agent into the team.'} copy="Connect your identity, bring your coding agent, and coordinate work in one shared workspace."><form className={`demo-form demo-form--${mode}`} onSubmit={submit}><div className="demo-form__head"><span>{mode === 'login' ? 'RETURN TO YOUR WORKSPACE' : 'CREATE YOUR IDENTITY'}</span><h2>{mode === 'login' ? 'Sign in to AgentMesh' : 'Create your AgentMesh account'}</h2><p>Choose a wallet or use email. Everything stays in this browser during demo mode.</p></div><button className="wallet-connect-button" type="button" onClick={() => setWalletOpen(true)}><WalletCards/><span><b>Continue with a wallet</b><small>MetaMask, Coinbase Wallet, or Rabby</small></span><ArrowRight/></button><div className="auth-divider"><span>or continue with email</span></div><div className="demo-form__fields">{mode === 'signup' && <label><span>Display name</span><span className="auth-input"><UserRound/><input name="displayName" required minLength={2} autoComplete="name" placeholder="How your team sees you"/></span></label>}<label><span>Email address</span><span className="auth-input"><Mail/><input name="email" type="email" required autoComplete="email" defaultValue={mode === 'login' ? DEMO_PROFILES[0].email : ''} placeholder="you@example.com"/></span></label><label><span>Password</span><span className="auth-input demo-password"><LockKeyhole/><input name="password" type={show ? 'text' : 'password'} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} defaultValue={mode === 'login' ? 'demo2026' : ''} placeholder="At least 6 characters"/><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff/> : <Eye/>}</button></span></label>{mode === 'signup' && <label><span>Confirm password</span><span className="auth-input"><LockKeyhole/><input name="confirm" type={show ? 'text' : 'password'} required minLength={6} placeholder="Repeat your password"/></span></label>}</div><div className="demo-form__check"><label><input name={mode === 'login' ? 'remember' : 'terms'} type="checkbox" defaultChecked={mode === 'login'}/><span>{mode === 'login' ? 'Keep me signed in on this device' : 'I accept the local demo terms'}</span></label>{mode === 'login' && <button type="button" onClick={() => setError('Password reset is simulated. You can continue with the prepared demo account.')}>Forgot password?</button>}</div>{error && <p className="demo-form__error" role="alert">{error}</p>}{success && <p className="demo-form__success"><Check/> Demo session ready. Opening setup…</p>}<button className="demo-primary" disabled={loading}>{loading ? 'Preparing your workspace…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight/></button><button className="demo-account-link" type="button" onClick={demo}>Use the prepared demo account <ChevronRight/></button><p className="demo-form__switch">{mode === 'login' ? 'New to AgentMesh?' : 'Already have an account?'} <button type="button" onClick={() => navigate(mode === 'login' ? '/signup' : '/login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p></form>{walletOpen && <WalletDialog status={walletStatus} onClose={() => setWalletOpen(false)} onConnect={connectWallet}/>}</Shell>;
}

export function OnboardingPage() {
  const { state, setIdentity, switchProfile } = useDemo(); const [profileId, setProfileId] = useState<DemoProfileId>(state.session?.profileId ?? 'anand'); const [step, setStep] = useState(state.identity?.agentConnected ? 4 : 0); const [busy, setBusy] = useState(false); const profile = DEMO_PROFILES.find((p) => p.id === profileId)!;
  const advance = async () => { setBusy(true); try { if (step === 0) { switchProfile(profileId); const identity = await demoGateways.identity.connectWallet(profileId); setIdentity(identity); setStep(1); } else if (step === 1 && state.identity) { setIdentity(await demoGateways.identity.resolveEns(state.identity)); setStep(2); } else if (step === 2) setStep(3); else if (step === 3 && state.identity) { setIdentity(await demoGateways.identity.registerAgent(state.identity)); setStep(4); } else navigate('/workspace/checkout-demo'); } finally { setBusy(false); } };
  const labels = ['Connect demo wallet', 'Resolve ENS identity', 'Configure scoped agent', 'Deploy local coding agent', 'Setup complete · Open workspace'];
  return <div className="demo-page"><DemoHeader/><main className="onboarding"><header><span>IDENTITY SETUP / 04 STEPS</span><h1>Set up a scoped demo agent.</h1><p>Every step is local and simulated. No wallet signature or blockchain transaction is requested.</p></header><div className="onboarding__grid"><section className="profile-picker"><h2>Choose a demo profile</h2>{DEMO_PROFILES.map((item) => <button key={item.id} className={profileId === item.id ? 'is-active' : ''} disabled={step > 0} onClick={() => setProfileId(item.id)}><i className={`profile-dot profile-dot--${item.color}`}/><span><b>{item.name}</b><small>{item.ens} · {item.wallet}</small></span><Check/></button>)}</section><section className="setup-card"><div className="agent-preview"><span>{profile.name}</span><h2>{profile.agent.name} / {profile.agent.provider}</h2><p>{profile.agent.ens}</p><div>{profile.agent.capabilities.map((cap) => <code key={cap}>{cap}</code>)}</div></div><ol>{labels.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''}><i>{index < step ? <Check/> : index + 1}</i><span>{label}</span>{index < step && <small>Complete</small>}</li>)}</ol><button className="demo-primary" disabled={busy} onClick={advance}>{busy ? 'Completing simulated step…' : step === 4 ? 'Open Checkout Workspace ↗' : labels[step]} <ChevronRight/></button></section></div></main></div>;
}

export function WorkspacesPage() {
  // Live Mode shows the signed-in user's real projects; Demo Mode is unchanged.
  return getAppMode() === 'live' ? <LiveProjectsPage /> : <DemoWorkspacesPage />;
}

function LiveProjectsPage() {
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
      // Surface the real server validation message, not an invented one.
      setFormError(reason instanceof Error ? reason.message : 'Unable to create project.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="demo-page"><DemoHeader/><main className="workspaces"><header><div><span>YOUR PROJECTS</span><h1>Choose where your agents coordinate.</h1></div><div><button className="demo-primary" onClick={() => { setCreateOpen(!createOpen); setFormError(''); }}><Plus/> Create project</button></div></header>{createOpen && <div className="workspace-inline-form"><form onSubmit={create}><label>Project name<input name="name" required autoFocus defaultValue=""/></label><button className="demo-primary" disabled={busy}>{busy ? 'Creating…' : 'Create and open'}</button></form>{formError && <p role="alert">{formError}</p>}</div>}<section className="workspace-list"><div className="workspace-list__label">YOUR PROJECTS</div>{loading ? <p role="status">Loading your projects…</p> : error ? <div className="workspace-error" role="alert"><p>{error}</p><button className="demo-secondary" onClick={() => void refetch()}><RotateCcw size={14}/> Retry</button></div> : projects.length === 0 ? <p className="workspace-empty">No projects yet. Create your first one to bring your agents together.</p> : projects.map((project) => <article key={project.id}><div className="workspace-symbol"><Hexagon/></div><div><span>{(project.role ?? 'member').toUpperCase()}</span><h2>{project.name}</h2><p>{project.description || project.id}</p></div><button className="workspace-open" onClick={() => navigate(`/workspace/${project.id}`)}>Open project <ArrowRight/></button></article>)}</section></main></div>;
}

function DemoWorkspacesPage() {
  const { state, addWorkspace, reset } = useDemo(); const [createOpen, setCreateOpen] = useState(false); const [joinOpen, setJoinOpen] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setBusy(true); const workspace = await demoGateways.workspace.create(String(new FormData(e.currentTarget).get('name'))); addWorkspace(workspace); setBusy(false); navigate(`/workspace/${workspace.id}`); };
  const join = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setBusy(true); try { const workspace = await demoGateways.workspace.join(String(new FormData(e.currentTarget).get('code'))); addWorkspace(workspace); navigate(`/workspace/${workspace.id}`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to join.'); } finally { setBusy(false); } };
  return <div className="demo-page"><DemoHeader/><main className="workspaces"><header><div><span>YOUR WORKSPACES</span><h1>Choose where your agents coordinate.</h1></div><div><button className="demo-secondary" onClick={() => setJoinOpen(!joinOpen)}>Join with code</button><button className="demo-primary" onClick={() => setCreateOpen(!createOpen)}><Plus/> Create workspace</button></div></header>{(createOpen || joinOpen) && <div className="workspace-inline-form">{createOpen ? <form onSubmit={create}><label>Workspace name<input name="name" required defaultValue="Checkout Protocol Workspace"/></label><button className="demo-primary" disabled={busy}>Create and open</button></form> : <form onSubmit={join}><label>Invite code<input name="code" required defaultValue="MESH-2026"/></label><button className="demo-primary" disabled={busy}>Join workspace</button></form>}{error && <p role="alert">{error}</p>}</div>}<section className="workspace-list"><div className="workspace-list__label">RECENT</div>{state.workspaces.map((workspace) => <article key={workspace.id}><div className="workspace-symbol"><Hexagon/></div><div><span>{workspace.online ? 'ONLINE NOW' : 'OFFLINE'}</span><h2>{workspace.name}</h2><p>{workspace.id}</p></div><dl><div><dt>Developers</dt><dd><Users/> {workspace.memberCount}</dd></div><div><dt>Agents</dt><dd>{workspace.agentCount}</dd></div><div><dt>Invite</dt><dd><button onClick={() => void navigator.clipboard?.writeText(workspace.inviteCode)}>{workspace.inviteCode} <Copy/></button></dd></div></dl><button className="workspace-open" onClick={() => navigate(`/workspace/${workspace.id}`)}>Open workspace <ArrowRight/></button></article>)}</section><footer><button onClick={reset}><RotateCcw/> Reset demo data</button><span>Prepared workspace: {PRIMARY_WORKSPACE.inviteCode}</span></footer></main></div>;
}

export function RouteGuard({ children }: { children: ReactNode }) { const { state } = useDemo(); useEffect(() => { if (!state.session) navigate('/login'); }, [state.session]); return state.session ? children : <div className="demo-route-loading" role="status">Restoring demo session…</div>; }
