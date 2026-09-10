import { DEMO_PROFILES, PRIMARY_WORKSPACE } from './demo.fixtures';
import type { AuthGateway, BrowserGateway, DemoIdentity, DemoSession, DemoState, IdentityGateway, LoginInput, SignupInput, TerminalGateway, WorkspaceGateway } from './demo.types';

const SESSION_KEY = 'agentmesh.demo.session';
const wait = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));
const sessionFor = (email: string, displayName: string): DemoSession => {
  const profile = DEMO_PROFILES.find((item) => item.email === email) ?? DEMO_PROFILES[0];
  return { id: `session-${profile.id}`, email, displayName: displayName || profile.name, profileId: profile.id, createdAt: new Date().toISOString() };
};
export class DemoAuthGateway implements AuthGateway {
  async login(input: LoginInput) { await wait(); if (!input.email.includes('@') || input.password.length < 6) throw new Error('Enter a valid email and a password with at least 6 characters.'); const result = sessionFor(input.email, ''); localStorage.setItem(SESSION_KEY, JSON.stringify(result)); return result; }
  async signup(input: SignupInput) { await wait(); const result = sessionFor(input.email, input.displayName); localStorage.setItem(SESSION_KEY, JSON.stringify(result)); return result; }
  async logout() { localStorage.removeItem(SESSION_KEY); }
  getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as DemoSession | null; } catch { return null; } }
}
export class DemoIdentityGateway implements IdentityGateway {
  async connectWallet(profileId: DemoIdentity['profileId']) { await wait(550); return { profileId, walletConnected: true, ensResolved: false, agentConnected: false }; }
  async resolveEns(identity: DemoIdentity) { await wait(500); return { ...identity, ensResolved: true }; }
  async registerAgent(identity: DemoIdentity) { await wait(650); return { ...identity, agentConnected: true }; }
}
export class DemoWorkspaceGateway implements WorkspaceGateway {
  async create(name: string) { await wait(); return { ...PRIMARY_WORKSPACE, id: `workspace-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new'}`, name, inviteCode: `MESH-${String(name.length * 417).padStart(4, '0').slice(0, 4)}`, memberCount: 1, agentCount: 1 }; }
  async join(inviteCode: string) { await wait(); if (inviteCode.trim().toUpperCase() !== PRIMARY_WORKSPACE.inviteCode) throw new Error('Invite code not found. Try MESH-2026.'); return PRIMARY_WORKSPACE; }
}
export class DemoTerminalGateway implements TerminalGateway {
  execute(command: string, state: DemoState) {
    const normalized = command.trim();
    if (normalized === 'agentmesh connect') return { output: ['HELLO · scoped demo agent connected', 'CAPABILITY_ANNOUNCEMENT · frontend, backend, identity'], action: 'connect' };
    if (normalized === 'clear') return { output: [], action: 'clear' };
    const help = 'agentmesh help | status | identity | agents | tasks | events | claim AM-114 | publish payment-api.json | request-approval deploy';
    if (normalized === 'agentmesh help') return { output: [help] };
    if (normalized === 'agentmesh status') return { output: [`workspace checkout-demo | ${state.workspace.tasks.length} tasks | ${state.workspace.events.length} events | demo mode`] };
    if (normalized === 'agentmesh identity') return { output: [`${state.session?.displayName ?? 'Anand'} | ${state.identity?.walletConnected ? 'wallet connected' : 'wallet simulation ready'}`] };
    if (normalized === 'agentmesh agents') return { output: ['Orion / Codex connected', 'Vega / Claude connected'] };
    if (normalized === 'agentmesh tasks') return { output: state.workspace.tasks.map((task) => `${task.id} ${task.status} ${task.title}`) };
    if (normalized === 'agentmesh events') return { output: state.workspace.events.slice(-8).map((event) => `${event.time} ${event.type} ${event.payload}`) };
    if (/^agentmesh claim AM-11[4-7]$/.test(normalized)) return { output: [`Claim requested for ${normalized.slice(-6)}`], action: 'claim', value: normalized.slice(-6) };
    if (normalized === 'agentmesh publish payment-api.json') return { output: ['payment-api.json published to the shared workspace'], action: 'publish' };
    if (normalized === 'agentmesh request-approval deploy') return { output: ['Approval request opened for deploy. Human signature is simulated.'], action: 'approval' };
    return { output: [`Command not found: ${normalized}`, 'Type agentmesh help for available commands.'] };
  }
}
export class DemoBrowserGateway implements BrowserGateway {
  resolve(route: string, state: DemoState) {
    if (route === 'agentmesh://preview/checkout') return { title: 'Checkout preview', body: 'A prepared checkout UI backed by the shared payment contract.' };
    if (route === 'agentmesh://artifact/payment-api') return { title: 'payment-api.json', body: 'Published by Vega and consumed by Orion.', code: JSON.stringify({ version: 1, publisher: 'claude.dev2.eth', hash: 'sha256:7fb2...91cd', endpoints: ['/payment', '/refund'], consumer: 'codex.dev1.eth' }, null, 2) };
    if (route === 'agentmesh://activity') return { title: 'Protocol activity', body: state.workspace.events.slice(-6).map((event) => `${event.type}: ${event.payload}`).join('\n') };
    const taskId = route.match(/agentmesh:\/\/task\/(AM-\d+)/)?.[1]; const task = state.workspace.tasks.find((item) => item.id === taskId);
    if (task) return { title: `${task.id} ${task.title}`, body: `Capability: ${task.capability}\nStatus: ${task.status}\nSuggested agent: ${task.suggestedAgent}` };
    return { title: 'Page unavailable', body: 'Use an AgentMesh preview route.' };
  }
}
export const demoGateways = { auth: new DemoAuthGateway(), identity: new DemoIdentityGateway(), workspace: new DemoWorkspaceGateway(), terminal: new DemoTerminalGateway(), browser: new DemoBrowserGateway() };
