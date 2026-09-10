import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEMO_PROFILES, PRIMARY_WORKSPACE, REPLAY_STEPS, initialDemoState } from './demo.fixtures';
import { demoGateways } from './demo.gateways';
import type { DemoIdentity, DemoProfileId, DemoSession, DemoState, DemoSyncMessage, DemoWorkspace, TerminalLine } from './demo.types';
import type { ProtocolEvent, ProtocolEventType } from '../features/workspace/workspace.types';

const STATE_KEY = 'agentmesh.demo.state.v1';
const SYNC_KEY = 'agentmesh.demo.sync';
const SOURCE_KEY = 'agentmesh-demo-source';
const TAB_SESSION_KEY = 'agentmesh.demo.tab.session';
const timestamp = () => new Date().toLocaleTimeString([], { hour12: false });
const sourceId = () => {
  let id = sessionStorage.getItem(SOURCE_KEY);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SOURCE_KEY, id); }
  return id;
};
const readState = (): DemoState => {
  try {
    const stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as DemoState | null;
    const session = JSON.parse(sessionStorage.getItem(TAB_SESSION_KEY) ?? 'null') as DemoSession | null ?? demoGateways.auth.getSession();
    return stored ? { ...stored, session: session ?? stored.session } : { ...initialDemoState(), session };
  } catch { return { ...initialDemoState(), session: demoGateways.auth.getSession() }; }
};
const event = (type: ProtocolEventType, payload: string, actor = 'coordinator', receiver = 'all agents', correlationId?: string): ProtocolEvent => ({
  id: `${type.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 999)}`, workspaceId: PRIMARY_WORKSPACE.id,
  actor, agentIdentity: actor, timestamp: new Date().toISOString(), correlationId, time: timestamp(), sender: actor, receiver, type, payload,
});

interface DemoContextValue {
  state: DemoState; profiles: typeof DEMO_PROFILES; profile: (typeof DEMO_PROFILES)[number];
  setSession(session: DemoSession | null): void; setIdentity(identity: DemoIdentity | null): void;
  addWorkspace(workspace: DemoWorkspace): void; switchProfile(id: DemoProfileId): void; reset(): void;
  claimTask(taskId: string): void; decideApproval(decision: 'approved' | 'rejected'): void;
  appendEvent(type: ProtocolEventType, payload: string, actor?: string, receiver?: string, correlationId?: string): void;
  submitPrd(): void; runCommand(agent: 'orion' | 'vega', command: string): void;
  openBrowser(route: string): void; browserBack(): void; browserForward(): void;
  replay: { play(): void; pause(): void; next(): void; restart(): void; exit(): void };
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(readState);
  const source = useMemo(sourceId, []);
  const channel = useRef<BroadcastChannel | null>(null);
  const skipBroadcast = useRef(false);

  useEffect(() => {
    const receive = (message: DemoSyncMessage) => {
      if (message.kind !== 'STATE' || message.source === source) return;
      skipBroadcast.current = true;
      setState((current) => ({ ...message.state, session: current.session, identity: current.identity }));
    };
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('agentmesh-demo-state');
      channel.current.onmessage = ({ data }: MessageEvent<DemoSyncMessage>) => receive(data);
    }
    const storage = (e: StorageEvent) => { if (e.key === SYNC_KEY && e.newValue) receive(JSON.parse(e.newValue) as DemoSyncMessage); };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('storage', storage); channel.current?.close(); channel.current = null; };
  }, [source]);

  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    if (skipBroadcast.current) { skipBroadcast.current = false; return; }
    const message: DemoSyncMessage = { kind: 'STATE', source, state };
    channel.current?.postMessage(message);
    localStorage.setItem(SYNC_KEY, JSON.stringify(message));
  }, [source, state]);

  const update = useCallback((recipe: (current: DemoState) => DemoState) => setState((current) => ({ ...recipe(current), revision: current.revision + 1 })), []);
  const appendEvent = useCallback<DemoContextValue['appendEvent']>((type, payload, actor, receiver, correlationId) => update((current) => ({ ...current, workspace: { ...current.workspace, events: [...current.workspace.events, event(type, payload, actor, receiver, correlationId)] } })), [update]);
  const setSession = useCallback((session: DemoSession | null) => { if (session) sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(session)); else sessionStorage.removeItem(TAB_SESSION_KEY); update((current) => ({ ...current, session })); }, [update]);
  const setIdentity = useCallback((identity: DemoIdentity | null) => update((current) => ({ ...current, identity })), [update]);
  const addWorkspace = useCallback((workspace: DemoWorkspace) => update((current) => ({ ...current, workspaces: [...current.workspaces.filter((item) => item.id !== workspace.id), workspace] })), [update]);
  const switchProfile = useCallback((id: DemoProfileId) => { const next = { id: `session-${id}`, profileId: id, email: DEMO_PROFILES.find((p) => p.id === id)!.email, displayName: DEMO_PROFILES.find((p) => p.id === id)!.name, createdAt: new Date().toISOString() }; sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(next)); update((current) => ({ ...current, session: next, identity: { profileId: id, walletConnected: true, ensResolved: true, agentConnected: true } })); }, [update]);
  const claimTask = useCallback((taskId: string) => update((current) => {
    const task = current.workspace.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== 'proposed') return current;
    const profile = DEMO_PROFILES.find((item) => item.id === (current.session?.profileId ?? 'anand'))!;
    return { ...current, workspace: { ...current.workspace, tasks: current.workspace.tasks.map((item) => item.id === taskId ? { ...item, status: 'claimed', claimedBy: profile.agent.id, countdown: undefined } : item), events: [...current.workspace.events, event('TASK_CLAIMED', `${taskId} claimed by ${profile.agent.name}`, profile.name, profile.agent.name, taskId)] } };
  }), [update]);
  const decideApproval = useCallback((decision: 'approved' | 'rejected') => update((current) => {
    if (current.workspace.approval.status !== 'pending') return current;
    const type = decision === 'approved' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED';
    const line: TerminalLine = { id: `approval-line-${Date.now()}`, kind: decision === 'approved' ? 'success' : 'error', text: decision === 'approved' ? 'Human approval granted. Simulated wallet signature accepted.' : 'Human rejected deploy. Safe local preview continues.' };
    return { ...current, workspace: { ...current.workspace, approval: { ...current.workspace.approval, status: decision }, events: [...current.workspace.events, event(type, `Deploy checkout contract ${decision}`, 'dev1.eth', 'Orion', current.workspace.approval.id)] }, terminal: { ...current.terminal, orion: [...current.terminal.orion, line] }, replay: { ...current.replay, completed: true, playing: false } };
  }), [update]);
  const submitPrd = useCallback(() => update((current) => ({ ...current, prdSubmitted: true, workspace: { ...current.workspace, tasks: current.workspace.tasks.map((task) => ({ ...task, status: 'proposed' as const, claimedBy: undefined, countdown: task.id === 'AM-117' ? 12 : task.countdown ?? 24 })), events: [...current.workspace.events, event('TASK_PROPOSAL', 'Coordinator generated AM-114 through AM-117', 'coordinator')] } })), [update]);
  const runCommand = useCallback((agent: 'orion' | 'vega', command: string) => {
    const result = demoGateways.terminal.execute(command, state);
    if (result.action === 'connect') { appendEvent('HELLO', 'Demo agent connected', agent); appendEvent('CAPABILITY_ANNOUNCEMENT', 'Scoped capabilities announced', agent); }
    if (result.action === 'claim' && result.value) claimTask(result.value);
    if (result.action === 'approval') { appendEvent('APPROVAL_REQUESTED', 'Deploy checkout contract requires human approval', agent, 'dev1.eth'); window.dispatchEvent(new Event('agentmesh:open-approval')); }
    if (result.action === 'publish') appendEvent('ARTIFACT_PUBLISHED', 'payment-api.json · v1', 'Vega', 'Orion');
    update((current) => ({ ...current, terminal: { ...current.terminal, [agent]: result.action === 'clear' ? [] : [...current.terminal[agent], { id: `cmd-${Date.now()}`, kind: 'command', text: `$ ${command}` }, ...result.output.map((text, index) => ({ id: `out-${Date.now()}-${index}`, kind: text.startsWith('Command not') ? 'error' as const : 'output' as const, text }))] } }));
  }, [appendEvent, claimTask, state, update]);
  const openBrowser = useCallback((route: string) => update((current) => ({ ...current, browser: { history: [...current.browser.history.slice(0, current.browser.index + 1), route], index: current.browser.index + 1, loading: false } })), [update]);
  const browserBack = useCallback(() => update((current) => ({ ...current, browser: { ...current.browser, index: Math.max(0, current.browser.index - 1) } })), [update]);
  const browserForward = useCallback(() => update((current) => ({ ...current, browser: { ...current.browser, index: Math.min(current.browser.history.length - 1, current.browser.index + 1) } })), [update]);
  const replayNext = useCallback(() => update((current) => {
    const item = REPLAY_STEPS[current.replay.step];
    if (!item) return { ...current, replay: { ...current.replay, playing: false, completed: true } };
    const [type, payload] = item;
    const tasks = type === 'TASK_AUTO_ASSIGNED' ? current.workspace.tasks.map((task) => task.id === 'AM-116' && task.status === 'proposed' ? { ...task, status: 'auto-assigned' as const, claimedBy: 'orion', countdown: undefined } : task) : current.workspace.tasks;
    return { ...current, workspace: { ...current.workspace, tasks, events: [...current.workspace.events, event(type, payload)] }, replay: { ...current.replay, active: true, step: current.replay.step + 1, completed: current.replay.step + 1 >= REPLAY_STEPS.length } };
  }), [update]);
  useEffect(() => { if (!state.replay.playing) return; const timer = window.setTimeout(replayNext, 1300); return () => clearTimeout(timer); }, [replayNext, state.replay.playing, state.replay.step]);
  useEffect(() => {
    if (state.replay.active) return;
    const timer = window.setInterval(() => update((current) => {
      const expired = current.workspace.tasks.filter((task) => task.status === 'proposed' && task.countdown === 1);
      if (!current.workspace.tasks.some((task) => task.status === 'proposed' && task.countdown)) return current;
      return { ...current, workspace: { ...current.workspace,
        tasks: current.workspace.tasks.map((task) => task.status !== 'proposed' || !task.countdown ? task : task.countdown === 1 ? { ...task, status: 'auto-assigned' as const, claimedBy: task.suggestedAgent, countdown: undefined } : { ...task, countdown: task.countdown - 1 }),
        events: expired.length ? [...current.workspace.events, ...expired.map((task) => event('TASK_AUTO_ASSIGNED', `${task.id} assigned by capability`, 'coordinator', task.suggestedAgent, task.id))] : current.workspace.events,
      } };
    }), 1000);
    return () => clearInterval(timer);
  }, [state.replay.active, update]);
  const replay = useMemo(() => ({ play: () => update((current) => ({ ...current, replay: { ...current.replay, active: true, playing: true } })), pause: () => update((current) => ({ ...current, replay: { ...current.replay, playing: false } })), next: replayNext, restart: () => update((current) => ({ ...initialDemoState(), session: current.session, identity: current.identity, replay: { active: true, playing: true, step: 0, completed: false } })), exit: () => update((current) => ({ ...current, replay: { ...current.replay, active: false, playing: false } })) }), [replayNext, update]);
  const reset = useCallback(() => { localStorage.removeItem(STATE_KEY); update((current) => ({ ...initialDemoState(), session: current.session, identity: current.identity })); }, [update]);
  const profile = DEMO_PROFILES.find((item) => item.id === (state.session?.profileId ?? 'anand')) ?? DEMO_PROFILES[0];
  const value = useMemo<DemoContextValue>(() => ({ state, profiles: DEMO_PROFILES, profile, setSession, setIdentity, addWorkspace, switchProfile, reset, claimTask, decideApproval, appendEvent, submitPrd, runCommand, openBrowser, browserBack, browserForward, replay }), [addWorkspace, appendEvent, browserBack, browserForward, claimTask, decideApproval, openBrowser, profile, replay, reset, runCommand, setIdentity, setSession, state, submitPrd, switchProfile]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
export function useDemo() { const context = useContext(DemoContext); if (!context) throw new Error('useDemo must be used within DemoProvider'); return context; }
