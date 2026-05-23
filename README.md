# DAP - Distributed Agent Protocol

**A protocol for heterogeneous AI agents to coordinate across machines and networks.**

```
┌─────────────┐    WebSocket    ┌─────────────┐    WebSocket    ┌─────────────┐
│   Mavis     │───────────────►│   Relay     │◄───────────────│  Claude     │
│   (macOS)   │◄───────────────│   Server    │───────────────►│  Code (Win) │
│             │                │  (any host) │                │             │
└─────────────┘                └──────┬──────┘                └─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │      Shared Task Board           │
                    └─────────────────────────────────┘
```

## Features

- **Cross-network**: Works over the public internet through NAT/firewalls
- **Heterogeneous**: Supports any agent framework via lightweight shim adapters
- **Dual-mode**: Real-time request/response + asynchronous job queue
- **Minimal dependencies**: Relay server is ~200 lines of Node.js
- **Multi-platform**: Windows, Linux, macOS support

## Quick Start

### 1. Install Dependencies

```bash
cd distributed-agent-protocol
npm install
```

### 2. Start the Relay Server

```bash
# Copy and edit env file (optional)
cp .env.example .env

# Start the relay
npm run relay
```

The server will start on `http://localhost:3000` with WebSocket at `ws://localhost:3000/ws`.

### 3. Connect an Agent

**Mavis Shim:**
```bash
npm run shim:mavis -- --relay ws://localhost:3000/ws --agent-id my-mavis-agent
```

**Claude Code Shim:**
```bash
npm run shim:claude -- --relay ws://localhost:3000/ws --agent-id my-claude-agent
```

### 4. Send a Message

Use the client library to send messages between agents:

```typescript
import { DAPClient } from './src/client/dap-client.js';

const client = new DAPClient({
  relayUrl: 'ws://localhost:3000/ws',
  agentId: 'my-agent',
  capabilities: [
    { name: 'code-review', version: '1.0.0', maxConcurrent: 2 },
  ],
});

await client.connect();

// Send a task to another agent
const result = await client.sendRequest('target-agent-id', {
  description: 'Review this PR for security issues',
  type: 'code-review',
});

console.log(result);
```

## Architecture

### Protocol

Every message is a JSON envelope:

```json
{
  "version": "1.0.0",
  "msg_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "from": { "agent_id": "agent-1", "capabilities": ["code-review"] },
  "to": { "agent_id": "agent-2" },
  "action": "request",
  "payload": {
    "type": "task-delegation",
    "data": { "description": "Review PR #42" }
  }
}
```

### Actions

| Action | Description | Mode |
|--------|-------------|------|
| `request` | Real-time request/response | P2P |
| `response` | Reply to a request | P2P |
| `stream` | Chunked response | P2P |
| `event` | Fire-and-forget notification | P2P |
| `job-submission` | Submit task to queue | Async |
| `job-claim` | Agent claims a job | Async |
| `job-complete` | Report job done | Async |

### Shim Adapters

Each agent framework gets a thin shim that:
1. Connects to relay via WebSocket
2. Translates DAP messages ↔ native communication
3. Advertises capabilities on connect

### SHACL Validation

Agents, jobs, and messages are validated against TTL shape definitions in `shapes/`. This provides declarative, human-readable validation rules separate from code. See [docs/SHACL-INTEGRATION.md](./docs/SHACL-INTEGRATION.md) for details.

### Provenance Tracking

Every job operation generates a PROV-O-compliant audit record. You can trace job lifecycle, find root causes of failures, and query by agent or activity. See [docs/PROVENANCE-QUERY.md](./docs/PROVENANCE-QUERY.md) for details.

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/agents` | List connected agents |
| `GET` | `/agents/:agentId` | Get agent details |
| `GET` | `/agents/:agentId/card` | Get agent card (JSON-LD) |
| `PATCH` | `/agents/:agentId/card` | Update agent card |
| `GET` | `/capabilities` | List all capabilities |
| `GET` | `/.well-known/dap-agent-card` | Get server's agent card |
| `POST` | `/jobs` | Submit job to queue |
| `GET` | `/jobs` | List pending jobs |
| `GET` | `/jobs/:id` | Get job status |

### Agent Cards (JSON-LD)

Agent Cards provide semantic capability discovery using JSON-LD. Each registered agent automatically gets a card published at `/agents/:agentId/card`.

**Example Agent Card:**
```json
{
  "@context": ["https://www.w3.org/ns/json-ld/contexts/person.jsonld", "https://dap-protocol.org/ns/agent-card-context.json"],
  "@type": "AgentCard",
  "@id": "my-agent-id",
  "id": "my-agent-id",
  "type": "AgentCard",
  "name": "My Agent",
  "description": "AI agent with code review capabilities",
  "capabilities": [
    {
      "@type": "Capability",
      "name": "code-review",
      "version": "1.0.0",
      "description": "Security and quality code review"
    }
  ],
  "version": "1.0.0",
  "protocolVersion": "1.0.0",
  "shimType": "mavis",
  "endpoints": {
    "wssUrl": "wss://agent.example.com/agent",
    "httpUrl": "https://agent.example.com/api"
  },
  "status": "active",
  "metadata": {
    "region": "us-west",
    "os": "macos"
  }
}
```

**Filtering Agents by Capability:**
```bash
# Find agents with code-review capability
curl http://localhost:3000/agents?capability=code-review

# Find active agents of a specific shim type
curl http://localhost:3000/agents?status=active&shimType=mavis
```

**Well-Known Endpoint:**
The server's own agent card is available at `/.well-known/dap-agent-card` for service discovery:
```bash
curl http://localhost:3000/.well-known/dap-agent-card
```

**Updating Agent Cards:**
Agents can update their metadata and status:
```bash
curl -X PATCH http://localhost:3000/agents/my-agent/card \
  -H "Content-Type: application/json" \
  -d '{"status": "busy", "metadata": {"currentTask": "PR #123"}}'
```

### WebSocket Messages

Connect to `/ws` and send JSON messages. Register with:

```json
{
  "action": "register",
  "agentId": "my-agent",
  "capabilities": [
    { "name": "code-review", "version": "1.0.0" }
  ]
}
```

## Security

### API Key Authentication

The relay supports multiple API keys with different scopes:

| Scope | Access Level |
|-------|-------------|
| `read` | Read-only access (agents, jobs, capabilities) |
| `write` | Read + write access (submit jobs, claim jobs) |
| `admin` | Full access including management |

**Format:** `key1:scope1,key2:scope2,key3` (scope defaults to `read` if not specified)

**Usage:**
```bash
# Single key with write access
export API_KEYS=my-secure-key:write

# Multiple keys with different scopes
export API_KEYS=key-read:read,key-write:write,key-admin:admin

# Include in requests via header
curl -H "X-API-Key: my-secure-key:write" http://localhost:3000/agents
```

### TLS/HTTPS Support

For production deployments, enable TLS to encrypt all traffic:

1. **Generate self-signed certificates** (for development):
```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes \
  -subj "/CN=localhost/O=DAP Relay"
```

2. **Configure environment:**
```bash
export ENABLE_TLS=true
export TLS_PORT=3443
export TLS_CERT_PATH=./certs/cert.pem
export TLS_KEY_PATH=./certs/key.pem
```

3. **Connect via WSS:**
```bash
wss://localhost:3443/ws
```

### Security Headers

The REST API includes security headers by default:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Strict-Transport-Security` | `max-age=31536000` | Force HTTPS (HSTS) |
| `Content-Security-Policy` | `default-src 'self'` | Prevent XSS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer |

### Rate Limiting

Per-key rate limiting is enforced to prevent abuse:

- Default: 100 requests per minute per API key
- Configurable via `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW_MS`
- Returns `429 Too Many Requests` when exceeded

### Invalid Key Logging

Invalid API key attempts are logged with:
- Timestamp
- Client IP
- Endpoint attempted
- HTTP method
- Partial key (first 4 characters masked)

## Documentation

| Document | Description |
|----------|-------------|
| **[USER-MANUAL.md](./docs/USER-MANUAL.md)** | Complete user guide — setup, API, architecture |
| **[SHACL-INTEGRATION.md](./docs/SHACL-INTEGRATION.md)** | TTL shape validation guide |
| **[E2E-TESTING.md](./docs/E2E-TESTING.md)** | End-to-end test guide |
| **[PROVENANCE-QUERY.md](./docs/PROVENANCE-QUERY.md)** | Provenance API reference |
| **[TLS_SETUP.md](./docs/TLS_SETUP.md)** | TLS configuration guide |

## Project Structure

```
distributed-agent-protocol/
├── src/
│   ├── protocol/          # Core protocol definitions
│   │   ├── types.ts       # TypeScript types (including AgentCard)
│   │   ├── messages.ts    # Message builders
│   │   └── validation.ts   # Schema validation + rate limiting
│   ├── relay/             # Relay server
│   │   ├── server.ts       # Main entry (dual HTTP + WebSocket)
│   │   ├── ws-handler.ts   # WebSocket handling
│   │   ├── rest-handler.ts # REST API (24 endpoints)
│   │   ├── agent-registry.ts # Connected agents (SHACL validated)
│   │   ├── agent-cards.ts  # JSON-LD Agent Cards
│   │   └── job-queue.ts    # Task board (file-backed persistence)
│   ├── provenance/         # Provenance tracking
│   │   └── index.ts        # ProvenanceGenerator + ProvenanceQuery
│   ├── validation/         # SHACL-like validation
│   │   └── shacl-validator.ts # TTL-based schema validation
│   ├── utils/              # Utilities
│   │   ├── logger.ts       # Structured logging + Prometheus metrics
│   │   ├── dap-client.ts   # WebSocket client library
│   │   └── agent-card-context.json # JSON-LD context
│   └── shims/              # Agent adapters
│       ├── base.ts        # Shim interface
│       ├── mavis.ts       # Mavis adapter
│       ├── claude-code.ts # Claude Code adapter
│       └── codex.ts       # Codex adapter
├── test/                   # Test suite (184 tests)
│   ├── unit tests (8 files)
│   └── e2e-integration.test.ts  # Full stack E2E tests (16 tests)
├── shapes/                 # SHACL TTL shapes
│   ├── agent-shape.ttl
│   ├── job-shape.ttl
│   └── message-shape.ttl
├── contexts/               # JSON-LD contexts
│   ├── dap-prov.json      # PROV-O provenance context
│   └── agent-card-context.json
├── data/                   # Job persistence (auto-created)
└── docs/                  # Documentation
    ├── USER-MANUAL.md      # Complete user guide
    ├── SHACL-INTEGRATION.md
    ├── E2E-TESTING.md
    ├── PROVENANCE-QUERY.md
    └── TLS_SETUP.md

## License

MIT