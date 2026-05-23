# DAP — Distributed Agent Protocol
## Professional User Manual

**Version:** 1.0.0
**Last Updated:** 2026-05-22

---

## Table of Contents

1. [What is DAP?](#1-what-is-dap)
2. [Quick Start](#2-quick-start)
3. [Architecture](#3-architecture)
4. [Agent Registration & Cards](#4-agent-registration--cards)
5. [Job Queue (Async Tasks)](#5-job-queue-async-tasks)
6. [Provenance Tracking](#6-provenance-tracking)
7. [REST API Reference](#7-rest-api-reference)
8. [WebSocket Communication](#8-websocket-communication)
9. [Security](#9-security)
10. [Configuration](#10-configuration)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What is DAP?

DAP is a protocol for heterogeneous AI agents to coordinate across machines and networks. It handles:

- **Real-time messaging** — request/response between agents via WebSocket
- **Async job queue** — submit tasks, agents claim them, track completion
- **Semantic discovery** — find agents by capability using JSON-LD Agent Cards
- **Provenance tracking** — audit every job's lifecycle (submit → claim → complete/fail)

```
┌──────────────┐    WebSocket    ┌──────────────┐    WebSocket    ┌──────────────┐
│   Mavis      │─────────────────│   Relay      │◄───────────────│  Claude      │
│   (macOS)    │◄────────────────│   Server     │────────────────│  Code (Win)  │
│              │                 │  (any host)  │                 │              │
└──────────────┘                 └──────┬───────┘                 └──────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    │       Shared Task Board + Provenance    │
                    └─────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| Cross-network | Works over public internet through NAT/firewalls |
| Heterogeneous | Any agent framework via lightweight shim adapters |
| Dual-mode | Real-time request/response + async job queue |
| Semantic discovery | JSON-LD Agent Cards for capability filtering |
| Provenance | Full audit trail for every job operation |
| SHACL validation | TTL-based schema validation for agents, messages, jobs |
| TLS support | Encrypted traffic for production deployments |
| Rate limiting | Per-key rate limiting to prevent abuse |

---

## 2. Quick Start

### 2.1 Install

```bash
cd distributed-agent-protocol
npm install
```

### 2.2 Start the Relay Server

```bash
# Copy and edit env file (optional)
cp .env.example .env

# Start the relay
npm run relay
```

Server starts at `http://localhost:3000` with WebSocket at `ws://localhost:3000/ws`.

### 2.3 Connect an Agent

**Mavis Shim:**
```bash
npm run shim:mavis -- --relay ws://localhost:3000/ws --agent-id my-mavis-agent
```

**Claude Code Shim:**
```bash
npm run shim:claude -- --relay ws://localhost:3000/ws --agent-id my-claude-agent
```

**Codex Shim:**
```bash
npm run shim:codex -- --relay ws://localhost:3000/ws --agent-id my-codex-agent
```

### 2.4 Run Tests

```bash
# All tests (184 tests)
npm test

# E2E integration tests only
npm test -- --run test/e2e-integration.test.ts

# Specific test file
npm test -- --run test/agent-registry.test.ts
```

---

## 3. Architecture

### 3.1 Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Relay Server | `src/relay/server.ts` | Dual WebSocket + REST server |
| Agent Registry | `src/relay/agent-registry.ts` | Tracks connected agents |
| Agent Cards | `src/relay/agent-cards.ts` | JSON-LD capability discovery |
| Job Queue | `src/relay/job-queue.ts` | Async task board with persistence |
| SHACL Validator | `src/validation/shacl-validator.ts` | TTL-based schema validation |
| Provenance | `src/provenance/index.ts` | Audit trail for jobs and agents |
| DAP Client | `src/utils/dap-client.ts` | Easy-to-use WebSocket client |

### 3.2 Data Flow

```
Agent → WebSocket → ws-handler.ts → AgentRegistry (SHACL validated)
                          ↓
                    REST API ← rest-handler.ts
                          ↓
                  JobQueue (file-backed: data/jobs.json)
                          ↓
                  ProvenanceGenerator (auto-tracked)
```

### 3.3 Persistence

Job data is persisted to `data/jobs.json` with:
- Debounced saves (500ms after last change)
- Corruption recovery (auto-backup before write)
- Auto-recovery on server restart

---

## 4. Agent Registration & Cards

### 4.1 How Registration Works

When an agent connects via WebSocket, it sends a `register` message:

```json
{
  "action": "register",
  "agentId": "my-agent-001",
  "capabilities": [
    { "name": "code-generation", "version": "1.0.0", "maxConcurrent": 3 },
    { "name": "code-review", "version": "1.0.0", "maxConcurrent": 1 }
  ],
  "shimType": "mavis",
  "metadata": { "os": "macos", "region": "us-west" }
}
```

The server validates this against `shapes/agent-shape.ttl` (SHACL constraints). If validation passes, the agent is registered and an Agent Card is auto-created.

### 4.2 Agent Cards (JSON-LD)

Every registered agent gets a JSON-LD Agent Card at `/agents/:agentId/card`.

**Example:**
```bash
curl http://localhost:3000/agents/my-agent-001/card
```

```json
{
  "@context": [
    "https://www.w3.org/ns/json-ld/contexts/person.jsonld",
    "https://dap-protocol.org/ns/agent-card-context.json"
  ],
  "@type": "AgentCard",
  "@id": "my-agent-001",
  "id": "my-agent-001",
  "name": "My AI Agent",
  "description": "Agent with code generation and review capabilities",
  "capabilities": [
    {
      "@type": "Capability",
      "name": "code-generation",
      "version": "1.0.0",
      "maxConcurrent": 3
    }
  ],
  "status": "active",
  "shimType": "mavis",
  "metadata": { "os": "macos" },
  "registeredAt": "2026-05-22T10:30:00.000Z"
}
```

### 4.3 Discovering Agents by Capability

```bash
# Find agents with code-generation capability
curl http://localhost:3000/agents?capability=code-generation

# Find active agents of a specific shim type
curl http://localhost:3000/agents?status=active&shimType=mavis

# Filter by capability + status
curl http://localhost:3000/agents?capability=testing&status=active
```

### 4.4 Updating Agent Cards

Agents can update their metadata and status dynamically:

```bash
curl -X PATCH http://localhost:3000/agents/my-agent-001/card \
  -H "Content-Type: application/json" \
  -d '{"status": "busy", "metadata": {"currentTask": "PR #123"}}'
```

Status values: `active`, `busy`, `idle`, `offline`

### 4.5 Server's Own Agent Card

The relay server publishes its own card for service discovery:

```bash
curl http://localhost:3000/.well-known/dap-agent-card
```

### 4.6 Capability Filtering in Code

```typescript
import { AgentCards } from './src/relay/agent-cards.js';

// Find agents with specific capability
const agents = agentCards.findByCapability('code-generation');

// Get all unique capabilities across all agents
const allCapabilities = agentCards.getAllCapabilities();

// List all cards with optional filters
const activeCards = agentCards.listCards({ status: 'active', shimType: 'mavis' });
```

---

## 5. Job Queue (Async Tasks)

### 5.1 Job Lifecycle

```
PENDING → CLAIMED → IN_PROGRESS → COMPLETED
                         ↓
                       FAILED
                         ↓
                     CANCELLED
```

### 5.2 Submitting a Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-key:write" \
  -d '{
    "type": "code-generation",
    "priority": 5,
    "capability_required": "code-generation",
    "payload": {
      "task": "Write a hello world function in TypeScript",
      "language": "typescript"
    },
    "submitter": "user-001"
  }'
```

Response:
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "code-generation",
  "status": "pending",
  "priority": 5,
  "capability_required": "code-generation",
  "submitter": "user-001",
  "created_at": "2026-05-22T10:35:00.000Z"
}
```

### 5.3 Claiming a Job

```bash
# Via REST
curl -X POST http://localhost:3000/jobs/550e8400.../claim \
  -H "X-API-Key: my-key:write" \
  -d '{"agent_id": "AgentA"}'

# Via WebSocket
{
  "action": "job-claim",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "agentId": "AgentA"
}
```

### 5.4 Starting a Job

After claiming, the agent must start the job (required transition from CLAIMED → IN_PROGRESS):

```bash
curl -X POST http://localhost:3000/jobs/550e8400.../start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-key:write" \
  -d '{"message": "Starting code generation"}'
```

### 5.5 Progress Updates

```bash
curl -X POST http://localhost:3000/jobs/550e8400.../progress \
  -H "Content-Type: application/json" \
  -d '{"message": "Generated 50% of the function"}'
```

### 5.6 Completing a Job

```bash
curl -X POST http://localhost:3000/jobs/550e8400.../complete \
  -H "Content-Type: application/json" \
  -d '{
    "result": {
      "success": true,
      "output": "export function helloWorld(): string { return \"Hello, World!\"; }",
      "language": "typescript"
    }
  }'
```

### 5.7 Failing a Job

```bash
curl -X POST http://localhost:3000/jobs/550e8400.../fail \
  -H "Content-Type: application/json" \
  -d '{
    "error": "Compilation failed: missing semicolon at line 5",
    "message": "TypeScript syntax error"
  }'
```

### 5.8 Querying Jobs

```bash
# List all pending jobs
curl http://localhost:3000/jobs

# Filter by status
curl "http://localhost:3000/jobs?status=pending"

# Filter by type
curl "http://localhost:3000/jobs?type=code-generation"

# Sort by priority (highest first)
curl "http://localhost:3000/jobs?sort=priority&order=desc"

# Pagination
curl "http://localhost:3000/jobs?limit=10&offset=0"

# Get single job
curl http://localhost:3000/jobs/550e8400...

# Get job result
curl http://localhost:3000/jobs/550e8400.../result
```

### 5.9 Job Constraints (Optional)

When submitting, you can add constraints:

```json
{
  "type": "code-generation",
  "priority": 8,
  "constraints": {
    "maxDurationSeconds": 300,
    "memoryLimitMB": 512,
    "preferredAgent": "AgentA",
    "tags": ["frontend", "typescript"]
  }
}
```

---

## 6. Provenance Tracking

Every job operation generates a provenance record (PROV-O compliant). You can query the audit trail at any time.

### 6.1 Get Provenance for a Job

```bash
curl http://localhost:3000/jobs/550e8400.../provenance
```

Response:
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "records": [
    {
      "activity": "job-submitted",
      "agent": "user-001",
      "timestamp": "2026-05-22T10:35:00.000Z",
      "description": "Job submitted to queue"
    },
    {
      "activity": "job-claimed",
      "agent": "AgentA",
      "timestamp": "2026-05-22T10:36:00.000Z",
      "description": "AgentA claimed the job"
    },
    {
      "activity": "job-completed",
      "agent": "AgentA",
      "timestamp": "2026-05-22T10:38:00.000Z",
      "description": "Job completed successfully"
    }
  ]
}
```

### 6.2 Trace a Job's Timeline

```bash
curl http://localhost:3000/jobs/550e8400.../trace
```

Returns a human-readable timeline of all job activities.

### 6.3 Find Root Cause of a Failed Job

```bash
curl http://localhost:3000/jobs/550e8400.../trace
```

Response includes a `rootCause` field if the job failed.

### 6.4 Query by Agent

Find all job activities for a specific agent:

```bash
# All activities by AgentA
curl "http://localhost:3000/agents/AgentA/provenance"

# Activities in a time range
curl "http://localhost:3000/agents/AgentA/provenance?start=2026-05-22T00:00:00Z&end=2026-05-22T23:59:59Z"
```

### 6.5 Provenance Statistics

```bash
curl http://localhost:3000/provenance/stats
```

Returns:
- Total records
- Records by activity type
- Records by agent
- Date range of records

### 6.6 Provenance Query in Code

```typescript
import { ProvenanceQuery } from './src/provenance/index.js';

const pq = new ProvenanceQuery(jobQueue, agentRegistry);

// Trace a job
const trace = pq.trace('550e8400-e29b-41d4-a716-446655440000');

// Find root cause
const rootCause = pq.findRootCause('550e8400-e29b-41d4-a716-446655440000');

// Query by agent
const agentActivities = pq.queryByAgent('AgentA', { limit: 50 });

// Query by activity type
const submissions = pq.queryByActivity('job-submitted');

// Format timeline
const timeline = pq.formatTraceTimeline(trace);
```

---

## 7. REST API Reference

Base URL: `http://localhost:3000`

### 7.1 Health & Metrics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Server health check |
| `GET` | `/stats` | None | Server statistics |
| `GET` | `/metrics` | None | Prometheus-format metrics |

### 7.2 Agent Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/connect` | None | HTTP-based agent connection |
| `GET` | `/agents` | read | List all agents |
| `GET` | `/agents/:agentId` | read | Get agent details |
| `GET` | `/agents/:agentId/card` | read | Get Agent Card (JSON-LD) |
| `PATCH` | `/agents/:agentId/card` | write | Update Agent Card |
| `GET` | `/agents/:agentId/provenance` | read | Get agent's provenance records |
| `GET` | `/.well-known/dap-agent-card` | None | Server's own Agent Card |

**Query Parameters for `/agents`:**
- `capability` — filter by capability name
- `status` — filter by status (active, busy, idle, offline)
- `shimType` — filter by shim type (mavis, claude, codex)

### 7.3 Capabilities

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/capabilities` | read | List all unique capabilities |

### 7.4 Job Queue

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/jobs` | write | Submit a new job |
| `GET` | `/jobs` | read | List jobs (with filters) |
| `GET` | `/jobs/:jobId` | read | Get job details |
| `GET` | `/jobs/:jobId/result` | read | Get job result |
| `POST` | `/jobs/:jobId/claim` | write | Claim a job |
| `POST` | `/jobs/:jobId/start` | write | Start a claimed job |
| `POST` | `/jobs/:jobId/progress` | write | Update job progress |
| `POST` | `/jobs/:jobId/complete` | write | Mark job as completed |
| `POST` | `/jobs/:jobId/fail` | write | Mark job as failed |
| `DELETE` | `/jobs/:jobId` | write | Cancel a pending job |
| `GET` | `/jobs/:jobId/provenance` | read | Get job provenance |
| `GET` | `/jobs/:jobId/trace` | read | Get job trace timeline |

**Query Parameters for `/jobs`:**
- `status` — filter by status
- `type` — filter by job type
- `capability_required` — filter by required capability
- `sort` — sort field (priority, created_at, status)
- `order` — sort order (asc, desc)
- `limit` — max results (default 50)
- `offset` — pagination offset

### 7.5 Provenance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/provenance` | read | Query all provenance records |
| `GET` | `/provenance/stats` | read | Get provenance statistics |

**Query Parameters for `/provenance`:**
- `agent` — filter by agent ID
- `activity` — filter by activity type
- `start` — start date (ISO-8601)
- `end` — end date (ISO-8601)
- `limit` — max results

---

## 8. WebSocket Communication

Connect to `ws://localhost:3000/ws` and send JSON messages.

### 8.1 Register an Agent

```json
{
  "action": "register",
  "agentId": "my-agent",
  "capabilities": [
    { "name": "code-generation", "version": "1.0.0" }
  ]
}
```

Response:
```json
{
  "action": "registered",
  "agentId": "my-agent",
  "status": "active"
}
```

### 8.2 Send a Request (Real-time)

```json
{
  "action": "request",
  "to": "target-agent",
  "payload": {
    "type": "code-review",
    "data": {
      "description": "Review PR #42 for security issues"
    }
  }
}
```

### 8.3 Claim a Job

```json
{
  "action": "job-claim",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "agentId": "my-agent"
}
```

### 8.4 Complete a Job

```json
{
  "action": "job-complete",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "result": {
    "success": true,
    "output": "Code generated successfully"
  }
}
```

### 8.5 Send an Event (Fire-and-forget)

```json
{
  "action": "event",
  "to": "target-agent",
  "payload": {
    "type": "notification",
    "data": { "message": "Build completed" }
  }
}
```

---

## 9. Security

### 9.1 API Key Authentication

The relay supports multiple API keys with scopes:

| Scope | Access |
|-------|--------|
| `read` | Read-only (agents, jobs, capabilities) |
| `write` | Read + write (submit/claim/complete jobs, update cards) |
| `admin` | Full access including management |

**Format:** `key1:scope1,key2:scope2,key3` (scope defaults to `read`)

```bash
# Set in environment
export API_KEYS=my-read-key:read,my-write-key:write,my-admin-key:admin

# Use in requests
curl -H "X-API-Key: my-write-key:write" http://localhost:3000/jobs
```

### 9.2 TLS/HTTPS

For production, enable TLS encryption:

```bash
# Generate self-signed certificates (dev)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes \
  -subj "/CN=localhost/O=DAP Relay"

# Configure
export ENABLE_TLS=true
export TLS_PORT=3443
export TLS_CERT_PATH=./certs/cert.pem
export TLS_KEY_PATH=./certs/key.pem

# Connect via WSS
wss://localhost:3443/ws
```

### 9.3 Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Strict-Transport-Security` | `max-age=31536000` | Force HTTPS |
| `Content-Security-Policy` | `default-src 'self'` | Prevent XSS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer |

### 9.4 Rate Limiting

- Default: 100 requests/minute per API key
- Configurable via `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW_MS`
- Returns `429 Too Many Requests` when exceeded

### 9.5 Invalid Key Logging

Invalid key attempts are logged with:
- Timestamp, client IP, endpoint, HTTP method
- Partial key (first 4 characters masked)

---

## 10. Configuration

### 10.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `WS_PORT` | 3001 | WebSocket server port |
| `TLS_PORT` | 3443 | HTTPS/WSS port |
| `ENABLE_TLS` | false | Enable TLS |
| `TLS_CERT_PATH` | — | TLS certificate path |
| `TLS_KEY_PATH` | — | TLS key path |
| `API_KEYS` | — | Comma-separated keys with scopes |
| `RATE_LIMIT_REQUESTS` | 100 | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Rate limit window (ms) |
| `HEARTBEAT_INTERVAL_MS` | 30000 | Agent heartbeat interval |
| `AGENT_TIMEOUT_MS` | 120000 | Agent timeout (stale detection) |
| `LOG_LEVEL` | info | Logging level |
| `LOG_FILE` | — | Log file path |

### 10.2 SHACL Shape Validation

Validation rules are defined in TTL files:

| Shape File | Validates |
|------------|-----------|
| `shapes/agent-shape.ttl` | Agent registration (agent_id, capabilities, metadata) |
| `shapes/job-shape.ttl` | Job records (job_id, type, priority, status, etc.) |
| `shapes/message-shape.ttl` | Protocol messages |

To add a new field constraint, edit the relevant TTL file and restart the server. No code changes needed.

---

## 11. Troubleshooting

### 11.1 Server Won't Start

```
Error: ENOENT: no such file or directory, open 'data/jobs.json'
```

**Fix:** Create the `data/` directory:
```bash
mkdir -p data
```

### 11.2 Agent Not Registering

Check that the agent is sending the correct registration message. The agent ID must be non-empty and capabilities must be an array.

### 11.3 Job Won't Claim

- Job must be in `pending` status to be claimed
- Job must have `capability_required` matching the agent's capabilities
- Agent must not already have the job claimed by someone else

### 11.4 Job Stuck at CLAIMED

After claiming, the agent must call `/jobs/:id/start` to move the job to `in-progress`. The job cannot be completed without being started first.

### 11.5 Provenance Records Missing

Provenance is auto-generated on job operations. If records are missing:
- Check that the job has progressed through the lifecycle
- Verify the job queue is writing to `data/jobs.json`
- Check server logs for provenance generation errors

### 11.6 Port Conflicts

If port 3000 is in use:
```bash
# Check what's using the port
lsof -i :3000

# Use a different port
export PORT=3001
npm run relay
```

### 11.7 E2E Tests Failing

E2E tests require dynamic port allocation (`port: 0`). If tests fail:
```bash
# Run with longer timeout
npx vitest run test/e2e-integration.test.ts --test-timeout=30000

# Check for port conflicts
lsof -i :3000-3010

# Verify data/ directory exists
ls -la data/
```

### 11.8 TLS Certificate Errors

If using self-signed certificates in production:
- Add the certificate to your system's trusted store
- Or use a CA-signed certificate for production
- For testing, use `--insecure` flag or disable certificate verification (dev only)

### 11.9 Getting Help

```bash
# Check server health
curl http://localhost:3000/health

# Get server stats
curl http://localhost:3000/stats

# View Prometheus metrics
curl http://localhost:3000/metrics
```

---

## Appendix A: Project Structure

```
distributed-agent-protocol/
├── src/
│   ├── protocol/
│   │   ├── types.ts           # TypeScript types + enums
│   │   ├── messages.ts       # Message builders
│   │   └── validation.ts     # Schema validation, rate limiting
│   ├── relay/
│   │   ├── server.ts         # Main server entry
│   │   ├── ws-handler.ts     # WebSocket handling
│   │   ├── rest-handler.ts   # REST API (all endpoints)
│   │   ├── agent-registry.ts # Agent tracking + SHACL validation
│   │   ├── agent-cards.ts    # JSON-LD Agent Cards
│   │   └── job-queue.ts      # Job queue + file persistence
│   ├── provenance/
│   │   └── index.ts          # ProvenanceGenerator + ProvenanceQuery
│   ├── validation/
│   │   └── shacl-validator.ts # TTL-based SHACL validation
│   ├── utils/
│   │   ├── logger.ts         # Structured logging + metrics
│   │   ├── dap-client.ts    # WebSocket client library
│   │   └── agent-card-context.json # JSON-LD context
│   └── shims/
│       ├── base.ts           # Shim interface
│       ├── mavis.ts          # Mavis adapter
│       ├── claude-code.ts    # Claude Code adapter
│       └── codex.ts           # Codex adapter
├── test/
│   ├── agent-registry.test.ts
│   ├── agent-cards.test.ts
│   ├── job-queue.test.ts
│   ├── messages.test.ts
│   ├── provenance.test.ts
│   ├── provenance-query.test.ts
│   ├── shacl-validator.test.ts
│   ├── validation.test.ts
│   ├── e2e-integration.test.ts  # Full stack E2E tests
│   └── *.test.ts
├── shapes/
│   ├── agent-shape.ttl       # Agent SHACL constraints
│   ├── job-shape.ttl         # Job SHACL constraints
│   └── message-shape.ttl      # Message SHACL constraints
├── contexts/
│   ├── dap-prov.json         # PROV-O JSON-LD context
│   └── agent-card-context.json
├── docs/
│   ├── SHACL-INTEGRATION.md  # SHACL validator guide
│   ├── E2E-TESTING.md        # E2E test guide
│   └── PROVENANCE-QUERY.md   # Provenance API docs
├── data/                     # Job persistence (auto-created)
│   └── jobs.json
└── certs/                    # TLS certificates (user-created)
```

## Appendix B: Test Commands

```bash
# All tests
npm test

# E2E integration tests
npm test -- --run test/e2e-integration.test.ts

# SHACL validator tests
npm test -- --run test/shacl-validator.test.ts

# Provenance tests
npm test -- --run test/provenance.test.ts
npm test -- --run test/provenance-query.test.ts

# Agent cards tests
npm test -- --run test/agent-cards.test.ts
```

## Appendix C: Related Documentation

- [SHACL-INTEGRATION.md](./SHACL-INTEGRATION.md) — TTL shape validation guide
- [E2E-TESTING.md](./E2E-TESTING.md) — End-to-end test guide
- [PROVENANCE-QUERY.md](./PROVENANCE-QUERY.md) — Provenance API reference
- [TLS_SETUP.md](./TLS_SETUP.md) — TLS configuration guide