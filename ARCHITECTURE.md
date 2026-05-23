# DAP - Distributed Agent Protocol

**A protocol for heterogeneous AI agents to coordinate across machines and networks.**

---

## 1. Overview

DAP enables **peer-to-peer task delegation** AND **asynchronous job queue** between AI agents running on different machines (Windows, Linux, macOS) and different frameworks (Mavis, Codex, Claude Code, etc.).

### Goals
- **Cross-network**: Works over the public internet through NAT/firewalls
- **Heterogeneous**: Supports any agent framework via lightweight shim adapters
- **Dual-mode**: Real-time request/response + asynchronous job queue
- **Minimal dependencies**: Relay server is ~200 lines of Node.js, shims are ~100 lines

### Architecture
```
┌─────────────┐    WebSocket    ┌─────────────┐    WebSocket    ┌─────────────┐
│   Mavis     │───────────────►│   Relay     │◄───────────────│  Claude     │
│   (macOS)   │◄───────────────│   Server    │───────────────►│  Code (Win) │
│             │                │  (any host) │                │             │
└─────────────┘                └──────┬──────┘                └─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │      Shared Task Board          │
                    │   (in-memory + optional Redis)  │
                    └─────────────────────────────────┘
```

---

## 2. Protocol Specification

### 2.1 Message Format

Every message is JSON with this envelope:

```json
{
  "version": "1.0.0",
  "msg_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "from": {
    "agent_id": "mavis-prod-01",
    "machine": "macos-arm64",
    "capabilities": ["code-review", "task-planning", "web-search"]
  },
  "to": {
    "agent_id": "claude-code-dev-01" | "broadcast" | "task-queue:code-review"
  },
  "action": "request" | "response" | "event" | "stream" | "job-claim" | "job-complete",
  "payload": {
    "type": "task-delegation" | "job-submission" | "result" | "heartbeat" | "capability-query",
    "data": {}
  },
  "reply_to": "msg_id"  // for threading
}
```

### 2.2 Actions

| Action | Description | Mode |
|--------|-------------|------|
| `request` | Real-time request/response (like RPC) | P2P |
| `response` | Reply to a request | P2P |
| `stream` | Chunked response (for long tasks) | P2P |
| `event` | Fire-and-forget notification | P2P |
| `job-submission` | Submit task to queue | Async |
| `job-claim` | Agent claims a job from queue | Async |
| `job-complete` | Agent reports job done | Async |
| `job-progress` | Agent reports progress | Async |
| `capability-query` | Query what agents can do | Discovery |

### 2.3 Addressing

- **P2P**: `to.agent_id` — direct message to specific agent
- **Broadcast**: `to = "broadcast"` — all connected agents
- **Topic**: `to = "task-queue:<topic>"` — job queue (e.g., `task-queue:code-review`)
- **Capability-based**: `to = "capability:code-review"` — route to any agent with that capability

### 2.4 Capabilities Registry

Agents advertise what they can do:

```json
{
  "capabilities": {
    "code-review": { "version": "1.0", "max_concurrent": 3 },
    "data-analysis": { "version": "1.0", "max_concurrent": 1 },
    "web-search": { "version": "1.0", "max_concurrent": 5 }
  }
}
```

---

## 3. Relay Server

### 3.1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/connect` | Register new agent |
| `POST` | `/disconnect` | Unregister agent |
| `WS` | `/ws` | WebSocket for real-time messaging |
| `GET` | `/agents` | List connected agents |
| `GET` | `/agents/:id` | Get agent details |
| `GET` | `/capabilities` | List all capabilities |
| `POST` | `/jobs` | Submit job to queue |
| `GET` | `/jobs` | List pending jobs |
| `GET` | `/jobs/:id` | Get job status |
| `GET` | `/jobs/:id/result` | Get job result |
| `DELETE` | `/jobs/:id` | Cancel job |

### 3.2 Authentication

- **API Key**: Header `X-API-Key: <key>` for all REST calls
- **Token**: `token` field in WebSocket handshake query param
- Keys managed via env vars: `DAP_API_KEYS=key1,key2,key3`

### 3.3 Persistence

- Connected agents: in-memory Map (lost on restart)
- Job queue: in-memory + optional Redis for durability
- For production: add Redis adapter for crash recovery

---

## 4. Shim Adapters

Each agent framework gets a thin shim that:
1. Connects to relay via WebSocket
2. Translates DAP messages ↔ native communication
3. Advertises capabilities on connect
4. Handles message routing

### 4.1 Generic Shim Interface

```typescript
interface AgentShim {
  // Called when shim starts
  onConnect(relay: DAPClient): void;

  // Called when shim receives a message
  onMessage(msg: DAPMessage): Promise<DAPMessage | void>;

  // Called when shim needs to send to local agent
  sendToAgent(task: Task): Promise<Result>;

  // Return capabilities this shim provides
  getCapabilities(): Capability[];
}
```

### 4.2 Mavis Shim

Uses `mavis communication send` to route messages to/from Mavis agents.

```typescript
// mavis-shim.ts
class MavisShim implements AgentShim {
  async sendToAgent(task: Task): Promise<Result> {
    // Use mavis communication to send to specific agent
    const response = await mavis.communication.send({
      to: task.targetAgentId,
      command: 'prompt',
      content: task.description
    });
    return parseResult(response);
  }
}
```

### 4.3 Codex Shim

Uses Codex's file-based task manifest system.

```typescript
// codex-shim.ts
class CodexShim implements AgentShim {
  async sendToAgent(task: Task): Promise<Result> {
    // Write task to Codex's task manifest
    await writeFile('~/.codex/tasks/incoming.json', JSON.stringify(task));
    // Poll for completion via status file
    await pollForResult(task.id, '~/.codex/tasks/results/');
    return readResult(task.id);
  }
}
```

### 4.4 Claude Code Shim

Uses Claude Code's stdin/stdout interface.

```typescript
// claude-shim.ts
class ClaudeCodeShim implements AgentShim {
  async sendToAgent(task: Task): Promise<Result> {
    const proc = spawn('claude', ['--agent', task.agentId]);
    proc.stdin.write(JSON.stringify(task));
    return new Promise(resolve => {
      proc.stdout.on('data', data => resolve(parseResult(data)));
    });
  }
}
```

---

## 5. Task Board

### 5.1 Job Lifecycle

```
SUBMIT → PENDING → CLAIMED → IN_PROGRESS → COMPLETED/FAILED
         ↑                              ↓
         └────────────── CANCELLED ←───┘
```

### 5.2 Job Schema

```json
{
  "job_id": "uuid",
  "type": "code-review",
  "priority": 1,
  "submitter": "mavis-prod-01",
  "capability_required": "code-review",
  "payload": {
    "repo_url": "...",
    "pr_number": 123,
    "criteria": ["security", "performance"]
  },
  "constraints": {
    "max_duration_seconds": 300,
    "memory_limit_mb": 512
  },
  "status": "pending",
  "claimed_by": null,
  "result": null,
  "created_at": "ISO-8601",
  "started_at": null,
  "completed_at": null
}
```

### 5.3 Routing

- Jobs submitted with `type` field
- Agents with matching capability can claim
- Round-robin within same capability pool
- Submitter can specify `preferred_agent` for P2P delegation

---

## 6. File Structure

```
distributed-agent-protocol/
├── README.md
├── package.json
├── tsconfig.json
├── Dockerfile               # Multi-stage production build
├── docker-compose.yml        # Full monitoring stack
├── scripts/
│   └── deploy.sh             # Docker deployment automation
├── docker/
│   ├── prometheus/
│   │   ├── prometheus.yml    # Scrape targets
│   │   └── alerting-rules.yml # 5 alert rules
│   ├── grafana/
│   │   └── provisioning/     # Dashboards + datasource
│   └── alertmanager/
│       ├── alertmanager.yml  # Email + Slack routing
│       └── entrypoint.sh     # Env var expansion
├── src/
│   ├── protocol/
│   │   ├── types.ts          # Type definitions
│   │   ├── messages.ts       # Message builders
│   │   └── validation.ts     # Schema validation
│   ├── relay/
│   │   ├── server.ts        # Main server entry
│   │   ├── ws-handler.ts    # WebSocket handling
│   │   ├── rest-handler.ts  # REST endpoints
│   │   ├── agent-registry.ts # Connected agents
│   │   └── job-queue.ts      # Task board implementation
│   ├── utils/
│   │   └── metrics.ts        # Prometheus metrics (20+ metrics)
│   └── shims/
│       ├── base.ts          # Shim interface
│       ├── mavis.ts         # Mavis adapter
│       ├── codex.ts         # Codex adapter
│       └── claude-code.ts   # Claude Code adapter
├── test/
│   ├── protocol.test.ts
│   ├── relay.test.ts
│   └── shims.test.ts
└── docs/
    └── api.md               # API documentation
```

---

## 7. Getting Started

### 7.1 Start Relay Server

```bash
cd distributed-agent-protocol
npm install
cp .env.example .env
# Edit .env with your API keys
npm run relay
# Server starts on http://localhost:3000
```

### 7.2 Connect Mavis

```bash
npm run shim:mavis -- --relay ws://your-server:3000/ws --api-key your-key
```

### 7.3 Connect Claude Code

```bash
npm run shim:claude -- --relay ws://your-server:3000/ws --api-key your-key
```

### 7.4 Test

```bash
# From Mavis session
> delegate code review to claude-code-dev-01: review PR #42

# From Claude Code (if it receives messages)
> respond to mavis-prod-01 with review of PR #42
```

---

## 8. Security Considerations

- [ ] API key authentication (basic)
- [ ] Message signing (HMAC)
- [ ] Rate limiting per agent
- [ ] Audit logging
- [ ] TLS for WebSocket (WSS)
- [ ] Agent capability scoping (don't let agents do more than advertised)

---

## 9. Future Enhancements

- [ ] Redis adapter for job queue persistence
- [ ] STUN/TURN for NAT traversal
- [ ] Multi-relay federation
- [ ] Capability versioning and negotiation
- [ ] Streaming responses (SSE)
- [ ] File transfer protocol
- [ ] GraphQL interface

## 11. Monitoring

The relay server exposes a `/metrics` endpoint (Prometheus format) with 20+ metrics covering jobs, agents, messages, and HTTP requests.

### Docker Compose Stack

```
dap-relay ──────────► prometheus ──────────► grafana (dashboards)
                     ▲                      ▲
                     └──────── alertmanager ┘
                           └───► email + Slack
node-exporter ──────────────────────────────► prometheus
```

**Services:** DAP relay, Prometheus, Grafana, Alertmanager, Node Exporter.

**Dashboards:** Job Pipeline, Agent Activity, System metrics.

**Alerting:** 5 Prometheus rules (error rate, queue depth, agent offline, relay down, job latency). Alertmanager routes to email and Slack via env vars (`SMTP_*`, `SLACK_WEBHOOK_URL`).

---

## 10. Implementation Order

1. **Core protocol** — types, validation, message builders
2. **Relay server** — WebSocket + REST, agent registry
3. **Basic client** — connect, send, receive
4. **Mavis shim** — first-class integration
5. **Claude Code shim** — example adapter
6. **Job queue** — async task board
7. **Examples** — simple-chat, code-review
8. **Documentation** — API docs, usage guides