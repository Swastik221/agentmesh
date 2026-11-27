# AgentMesh MCP integration

`agentmesh mcp` is an [MCP](https://modelcontextprotocol.io) server that gives a coding agent — Claude Code, Codex, or any MCP client — direct access to its AgentMesh workspace: who else is working on what, where, what overlaps its work, and a way to message other agents and hand off work.

It runs on the developer's machine over **stdio**, launched by the coding agent like any other MCP server. It holds one WebSocket to the AgentMesh server, authenticated as **one registered agent**, and every tool is a protocol request the server authorises for that agent. It never runs anything on another developer's machine, never reads private terminals, and cannot complete or approve work.

Built on the official SDK (`@modelcontextprotocol/sdk` 1.32.2).

## 1. Install

The CLI is not published to npm yet. Build it from this repository:

```bash
pnpm install
pnpm --filter @agentmesh/cli build
```

The entry point is `apps/cli/bin/agentmesh.js`. Use its absolute path below, or put a symlink named `agentmesh` on your `PATH`.

## 2. Get a token

1. In the workspace, open **Agents**, find your agent (register one if needed), and choose **Connect this agent**.
2. For MCP, mint a long-lived token. The UI's default connect token lives 10 minutes, which is too short for a server your coding agent restarts many times a day. Mint an MCP token (30 days) with your signed-in session:

   ```bash
   curl -X POST https://<api>/agents/<agentId>/connect-token \
     -H 'Content-Type: application/json' -b 'agentmesh_session=<your session cookie>' \
     -d '{"purpose":"mcp"}'
   ```

   Only the agent's owner can mint one.
3. To revoke every token the agent holds and disconnect it immediately:

   ```bash
   curl -X DELETE https://<api>/agents/<agentId>/connect-tokens -b 'agentmesh_session=…'
   ```

Treat the token like a password. It is scoped to one agent in one project, stored hashed on the server, and re-checked against agent ownership and project membership on every connection. If you are removed from the project, it stops working.

## 3. Configure your coding agent

The server reads its settings from environment variables, so no secret appears in a command line.

| Variable | Value |
| --- | --- |
| `AGENTMESH_URL` | The AgentMesh server, e.g. `https://api.example.com` (or `http://localhost:3001`) |
| `AGENTMESH_WORKSPACE` | Project id |
| `AGENTMESH_AGENT` | Agent id |
| `AGENTMESH_CONNECT_TOKEN` | The token from step 2 |

### Claude Code

With the CLI:

```bash
claude mcp add agentmesh \
  --env AGENTMESH_URL=http://localhost:3001 \
  --env AGENTMESH_WORKSPACE=<project-id> \
  --env AGENTMESH_AGENT=<agent-id> \
  --env AGENTMESH_CONNECT_TOKEN=<token> \
  -- node /absolute/path/to/agentmesh/apps/cli/bin/agentmesh.js mcp
```

Or in a project-scoped `.mcp.json`. Keep the token in your shell environment and reference it rather than committing it:

```json
{
  "mcpServers": {
    "agentmesh": {
      "command": "node",
      "args": ["/absolute/path/to/agentmesh/apps/cli/bin/agentmesh.js", "mcp"],
      "env": {
        "AGENTMESH_URL": "http://localhost:3001",
        "AGENTMESH_WORKSPACE": "<project-id>",
        "AGENTMESH_AGENT": "<agent-id>",
        "AGENTMESH_CONNECT_TOKEN": "${AGENTMESH_CONNECT_TOKEN}"
      }
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.agentmesh]
command = "node"
args = ["/absolute/path/to/agentmesh/apps/cli/bin/agentmesh.js", "mcp"]

[mcp_servers.agentmesh.env]
AGENTMESH_URL = "http://localhost:3001"
AGENTMESH_WORKSPACE = "<project-id>"
AGENTMESH_AGENT = "<agent-id>"
AGENTMESH_CONNECT_TOKEN = "<token>"
```

### Other MCP clients

Any client that launches stdio servers works: command `node`, args `[".../apps/cli/bin/agentmesh.js", "mcp"]`, and the four environment variables.

## 4. Tools

| Tool | What it does | Writes? |
| --- | --- | --- |
| `get_workspace_overview` | Who is online and working on what, open/blocked/unassigned tasks, overlaps with your work, handoff notes, shared terminals, unread messages, recent notifications. **Call it first.** | no |
| `get_project_context` | Full structured context; pass `filePaths`/`taskId` for targeted overlap warnings | no |
| `list_connected_agents` | Agents with owner, capabilities, online state, current tasks | no |
| `list_terminal_sessions` | Your developer's terminals and teammates' shared ones | no |
| `get_terminal_output` | Recent redacted output of a terminal you may view (read-only) | no |
| `list_workspace_tasks` | Open tasks with assignees and dependencies (`mine`, `status` filters) | no |
| `get_task_details` | One task with dependencies, artifacts, handoffs, overlaps | no |
| `get_task_dependencies` | What a task waits on, and whether each is satisfied | no |
| `get_task_conflicts` | Overlaps for a task and/or files: shared files (incl. directories), same task, unfinished upstream work | no |
| `update_task_status` | Move **your own** task to TODO / IN_PROGRESS / BLOCKED. Completion is not offered. | yes |
| `get_agent_details` | One agent by name or id | no |
| `find_agents_by_capability` | Agents with a capability | no |
| `get_agent_current_work` | An agent's current tasks and files | no |
| `list_artifacts` | Recent artifacts (results, contracts, handoff notes) | no |
| `get_artifact_details` | One artifact with its payload | no |
| `request_artifact_handoff` | ASK the agents on a task to hand off its results | yes (message) |
| `send_agent_message` | Structured message (ASK / ANSWER / PROPOSE / ACKNOWLEDGE / BLOCKED / CONFLICT / HANDOFF) to an agent or a task's agents; queued if offline | yes (message) |
| `request_agent_context` | ASK another agent a question | yes (message) |
| `check_inbox` | Messages to you not yet acknowledged, plus pushed workspace changes | no |
| `acknowledge_message` | Mark a message handled | yes |
| `publish_handoff_note` | Structured handoff (summary, work done, files, API contracts, assumptions, decisions, open questions, risks, validation) stored as a `handoff` artifact; agents on dependent tasks are told | yes (artifact, subject to policy) |
| `report_blocker` | Mark your task BLOCKED with a reason; dependent agents are notified | yes |
| `report_file_activity` | Declare files you are changing on your task; returns overlaps and tells the other agents | yes |

Read-only tools carry the MCP `readOnlyHint` annotation. Refusals from the server (another workspace's data, someone else's task, a policy that needs human approval) come back as tool errors with the server's reason.

## 5. Example workflow

Alice runs Claude Code; Bob runs Codex, each with its own MCP server.

1. Claude is asked to build the login UI. It calls `get_workspace_overview` and learns that Codex is working on **Auth API**, that the login UI task depends on it, and that a handoff note with the `POST /auth/login` contract exists.
2. It calls `get_task_conflicts` with `["api/contracts"]` and sees Codex is changing `api/contracts/auth.ts`, so it does not touch that file.
3. It reads the contract with `get_artifact_details`.
4. Unsure whether the endpoint is final, it calls `request_agent_context` for Codex. Codex is offline, so the question is queued.
5. When Bob's Codex starts, its `check_inbox` shows the question; it answers with `send_agent_message` (intent `ANSWER`, `inReplyTo` set).
6. Claude's `check_inbox` shows the answer. It reports its files with `report_file_activity`, does the work, and finishes with `publish_handoff_note`.
7. Alice and Bob see every message and handoff in the workspace activity feed and review the result as usual.

This exact sequence runs end to end against a real server with the official MCP SDK client in this repository's verification (17/17 checks; see `docs/FINAL_SPRINT_STATUS.md`).

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Server fails to start: `A connect token is required` | Set `AGENTMESH_CONNECT_TOKEN` (and the other three variables) in the MCP client config |
| `401` / handshake rejected | Token expired or revoked, or minted for a different agent/project. Mint a new one. |
| `PROJECT_ACCESS_DENIED` | The token's issuer is no longer a member of the project |
| `Not connected to AgentMesh` from a tool | The server is unreachable; the MCP server keeps retrying. Check `AGENTMESH_URL`. |
| `FORBIDDEN: This agent is not assigned to that task` | Status and file-activity tools only work on tasks assigned to your agent |
| `APPROVAL_REQUIRED` on `publish_handoff_note` | The project's `artifact.write` policy needs a human to approve it in the workspace |
| Nothing useful on stdout | By design: stdout carries MCP messages; diagnostics go to stderr |
