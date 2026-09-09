/**
 * Live end-to-end smoke test against a running AgentMesh server.
 * Uses REAL SIWE signatures (viem) - no faked auth or mocked responses.
 *
 * Flow (matches the agent-first product path):
 *   SIWE sign-in -> create project -> register agent -> agent connects over
 *   WS (becomes ONLINE) -> create task -> coordinator assigns (agent must be
 *   online) -> agent claims TASK_REQUEST -> executes -> publishes reviewable
 *   artifact -> task PENDING_APPROVAL (live) -> user approves via REST ->
 *   COMPLETED -> activity + persistence checks.
 *
 * Run: node e2e-smoke.mjs   (from apps/server where viem/ws resolve)
 */
import { privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';

const BASE = 'http://localhost:3001';
const DOMAIN = 'localhost';
const URI = 'http://localhost:5173';
const CHAIN_ID = 11155111;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

const account = privateKeyToAccount(`0x${'12'.repeat(32)}`);
console.log(`Wallet: ${account.address}`);

// 1. SIWE sign-in
const nonceRes = await request('/auth/nonce');
const { nonce } = nonceRes.json;
const issuedAt = new Date().toISOString();
const message = [
  `${DOMAIN} wants you to sign in with your Ethereum account:`,
  account.address,
  '',
  'Sign in to AgentMesh demo.',
  '',
  `URI: ${URI}`,
  'Version: 1',
  `Chain ID: ${CHAIN_ID}`,
  `Nonce: ${nonce}`,
  `Issued At: ${issuedAt}`,
].join('\n');
const signature = await account.signMessage({ message });
const verifyRes = await request('/auth/verify', {
  method: 'POST',
  body: { message, signature },
});
check(
  'SIWE sign-in returns user',
  verifyRes.status === 200 &&
    verifyRes.json?.user?.walletAddress === account.address.toLowerCase(),
);
const sessionCookie = verifyRes.setCookie?.split(';')[0] ?? '';
check('session cookie set', Boolean(sessionCookie));

// 2. me
const meRes = await request('/auth/me', { cookie: sessionCookie });
check('/auth/me authenticated', meRes.status === 200 && meRes.json?.user?.id);
const userId = meRes.json.user.id;

// 3. create project
const projectRes = await request('/projects', {
  method: 'POST',
  cookie: sessionCookie,
  body: { name: `E2E Workspace ${Date.now()}`, ownerId: userId },
});
check(
  'create project',
  (projectRes.status === 200 || projectRes.status === 201) && projectRes.json?.id,
);
const projectId = projectRes.json.id;

// 4. register agent
const agentRes = await request(`/projects/${projectId}/agents`, {
  method: 'POST',
  cookie: sessionCookie,
  body: { ownerId: userId, name: 'e2e-agent', provider: 'cli' },
});
check('register agent', agentRes.status === 201 && agentRes.json?.id);
const agentId = agentRes.json.id;

// 5. agent connects over WS + handshake -> ONLINE
const makeBuffer = (socket) => {
  const buffer = [];
  socket.on('message', (data) => {
    try { buffer.push(JSON.parse(data.toString())); } catch {}
  });
  return buffer;
};

const waitFor = (socket, buffer, predicate, timeoutMs = 8000, debugTag = 'WS') =>
  new Promise((resolve, reject) => {
    const scan = () => {
      const idx = buffer.findIndex((m) => predicate(m));
      if (idx !== -1) {
        clearTimeout(timer);
        const [found] = buffer.splice(idx, 1);
        resolve(found);
        return true;
      }
      return false;
    };
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ws message on ${debugTag}`)), timeoutMs);
    let cancelled = false;
    if (scan()) { cancelled = true; return; }
    const onMsg = (data) => {
      if (cancelled) return;
      if (process.env.DEBUG_WS) {
        try { const m = JSON.parse(data.toString()); console.log(`${debugTag}<`, m.type, m.payload?.code ?? ''); } catch {}
      }
      if (scan()) {
        cancelled = true;
        // listener already re-added? we use buffer-based; remove nothing extra
      }
    };
    socket.on('message', onMsg);
  });
const ws = await new Promise((resolve, reject) => {
  const w = new WebSocket(`ws://localhost:3001/ws?projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${sessionCookie.split('=')[1]}` },
  });
  w.on('open', () => resolve(w));
  w.on('error', reject);
});
const agentBuf = makeBuffer(ws);

ws.send(
  JSON.stringify({
    id: `hs-${Date.now()}`,
    protocolVersion: '1.0',
    projectId,
    timestamp: new Date().toISOString(),
    type: 'agent.handshake',
    senderId: agentId,
    payload: { agentId },
  }),
);
const hsMsg = await waitFor(ws, agentBuf, (m) => m.type === 'agent.handshake.accepted', 8000, 'AGENT');
check('agent handshake accepted', hsMsg.payload?.agentId === agentId);

// agent ONLINE now
const agentsAfter = await request(`/projects/${projectId}/agents`, { cookie: sessionCookie });
check('agent ONLINE in registry', agentsAfter.json?.[0]?.status === 'ONLINE');

// 6. create task
const taskRes = await request(`/api/projects/${projectId}/tasks`, {
  method: 'POST',
  cookie: sessionCookie,
  body: { title: 'E2E review task', description: 'Exercise the full loop', priority: 'HIGH' },
});
check('create task', taskRes.status === 201 && taskRes.json?.id);
const taskId = taskRes.json.id;

// 7. user client connects for live checks
const userWs = await new Promise((resolve, reject) => {
  const w = new WebSocket(`ws://localhost:3001/ws?projectId=${projectId}&clientType=user`, {
    headers: { Cookie: sessionCookie },
  });
  w.on('open', () => resolve(w));
  w.on('error', reject);
});
const userBuf = makeBuffer(userWs);
const userWaitFor = (predicate, timeoutMs = 8000) =>
  waitFor(userWs, userBuf, predicate, timeoutMs, 'USER');
await userWaitFor((m) => m.type === 'workspace.snapshot');

// 8. coordinator assigns to the online agent -> TASK_REQUEST
const assignRes = await request(`/api/projects/${projectId}/tasks/${taskId}/assign`, {
  method: 'POST',
  cookie: sessionCookie,
  body: { preferredAgentId: agentId },
});
check(
  'coordinator assignment',
  assignRes.status === 200 && assignRes.json?.assigned === true && assignRes.json?.agentId === agentId,
);

// 9. create the execution -> pipeline dispatches TASK_REQUEST to the agent
const execRes = await request(`/api/projects/${projectId}/tasks/${taskId}/executions`, {
  method: 'POST',
  cookie: sessionCookie,
  body: { agentId, input: { request: 'implement demo' } },
});
check('create execution (QUEUED)', execRes.status === 201 && execRes.json?.id);
const executionId = execRes.json.id;

const taskRequestMsg = await waitFor(ws, agentBuf, (m) => m.type === 'task.request', 8000, 'AGENT');
check('agent receives TASK_REQUEST', taskRequestMsg.payload?.taskId === taskId);

// 10. agent accepts + reports progress (RUNNING)
ws.send(
  JSON.stringify({
    id: `acc-${Date.now()}`,
    protocolVersion: '1.0',
    projectId,
    type: 'task.accepted',
    senderId: agentId,
    payload: { taskId, executionId },
  }),
);
ws.send(
  JSON.stringify({
    id: `progress-${Date.now()}`,
    protocolVersion: '1.0',
    projectId,
    timestamp: new Date().toISOString(),
    type: 'task.progress',
    senderId: agentId,
    payload: { taskId, executionId, progress: 50, message: 'working' },
  }),
);

const liveRunning = userWaitFor((m) => m.type === 'task.status' && m.payload?.taskId === taskId);
const runningMsg = await liveRunning;
check('live task.status after claim', Boolean(runningMsg));

// 11. agent publishes reviewable artifact
ws.send(
  JSON.stringify({
    id: `art-${Date.now()}`,
    protocolVersion: '1.0',
    projectId,
    type: 'artifact.created',
    senderId: agentId,
    payload: {
      taskId,
      type: 'CODE',
      name: 'e2e-patch',
      executionId,
      payload: { files: ['src/demo.ts'], summary: 'implemented demo endpoint' },
    },
  }),
);

const pendingMsg = await waitFor(
  ws,
  agentBuf,
  (m) => m.type === 'task.status' && m.payload?.taskId === taskId && m.payload?.status === 'PENDING_APPROVAL',
  8000,
  'AGENT',
);
check('task enters PENDING_APPROVAL (agent sees live)', pendingMsg.payload?.status === 'PENDING_APPROVAL');

// user client also sees pending + activity
const userPendingPromise = userWaitFor(
  (m) => m.type === 'task.status' && m.payload?.taskId === taskId && m.payload?.status === 'PENDING_APPROVAL',
);
const activityPendingPromise = userWaitFor(
  (m) => m.type === 'activity.created' && m.payload?.type === 'task.pending_approval',
);
await userPendingPromise;
check('user client sees PENDING_APPROVAL live', true);

// artifact persisted
const artifactsRes = await request(`/api/projects/${projectId}/tasks/${taskId}/artifacts`, {
  cookie: sessionCookie,
});
const artifact = artifactsRes.json.items?.[0];
check(
  'artifact persisted + reviewable',
  Boolean(artifact) && artifact.requiresReview === true && artifact.status === 'PENDING',
);

// 12. user approves via REST
const reviewRes = await request(`/api/projects/${projectId}/artifacts/${artifact.id}/review`, {
  method: 'POST',
  cookie: sessionCookie,
  body: { approved: true, note: `E2E approved ${Date.now()}` },
});
check('approve artifact -> APPROVED', reviewRes.status === 200 && reviewRes.json?.artifact?.status === 'APPROVED');
check('approve artifact -> task COMPLETED', reviewRes.status === 200 && reviewRes.json?.task?.status === 'COMPLETED');

await activityPendingPromise;
check('live ACTIVITY_CREATED (pending approval)', true);

const completedLivePromise = userWaitFor(
  (m) => m.type === 'task.status' && m.payload?.taskId === taskId && m.payload?.status === 'COMPLETED',
);
await completedLivePromise;
check('user client sees COMPLETED live', true);

// 13. persisted + API state
const taskAfter = await request(`/api/projects/${projectId}/tasks/${taskId}`, { cookie: sessionCookie });
check('task COMPLETED via API', taskAfter.json?.status === 'COMPLETED');

const activityRes = await request(`/api/projects/${projectId}/activity`, { cookie: sessionCookie });
const types = activityRes.json.events.map((e) => e.type);
check('activity: task.created', types.includes('task.created'));
check('activity: task.assigned', types.includes('task.assigned'));
check('activity: artifact.created', types.includes('artifact.created'));
check('activity: task.pending_approval', types.includes('task.pending_approval'));
check('activity: artifact.approved', types.includes('artifact.approved'));

// 14. projects list includes this workspace
const projectsRes = await request('/projects', { cookie: sessionCookie });
check('GET /projects includes workspace', projectsRes.json.projects.some((p) => p.id === projectId));

// 15. refresh persistence: a fresh request with the same cookie still works
const meAgain = await request('/auth/me', { cookie: sessionCookie });
check('session survives refresh (cookie)', meAgain.status === 200);

ws.close();
userWs.close();
console.log(failures === 0 ? '\nE2E SMOKE: ALL PASS' : `\nE2E SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);