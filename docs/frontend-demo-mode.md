# Historical Architecture: AgentMesh Frontend Demo Mode

> [!NOTE]
> Demo Mode was removed in **PRD-57A**. AgentMesh now operates exclusively as a real product using real wallet connection, SIWE authentication, REST APIs, WebSockets, real connected agents, x402 payment settlement, and real artifacts.

## Historical Reference

In early prototypes prior to PRD-57A, AgentMesh included an offline simulated demo mode. That legacy fallback path, simulated adapters (`demoAdapters`), fake gateways, and simulated cursors have been completely removed.

## Current Product Architecture

The web application now uses:
- **Authentication**: Real EIP-1193 wallet (`window.ethereum`) + SIWE (`/auth/nonce`, `/auth/verify`).
- **Projects & Tasks**: Real REST API (`/projects`, `/tasks`, `/agents`, `/artifacts`).
- **Realtime Collaboration**: Real WebSocket client (`/ws?projectId=...&clientType=user`).
- **Execution**: Real BYOA connected agents via WebSocket (`TASK_REQUEST`, `TASK_COMPLETED`).
