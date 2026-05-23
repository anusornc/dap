# End-to-End Testing Guide

Integration testing for the DAP relay server, covering full stack behavior from HTTP/REST API to WebSocket messaging, agent registration, and job lifecycle.

## Overview

End-to-End (E2E) tests verify that the complete DAP system works correctly as a whole — not just individual components in isolation. Unlike unit tests that test single functions, E2E tests start the actual server, register agents, submit jobs, and verify the complete flow including:

- Server startup and initialization
- REST API endpoints
- WebSocket connections
- Agent registration with capability discovery
- Job lifecycle (submit → claim → start → complete/fail)
- Provenance chain generation

## Running E2E Tests

```bash
# Run all E2E tests
npx vitest run test/e2e-integration.test.ts

# Run with watch mode (auto-reload on changes)
npx vitest test test/e2e-integration.test.ts

# Run with verbose output
npx vitest run test/e2e-integration.test.ts --reporter=verbose
```

## Test File Location

E2E tests should be placed at `test/e2e-integration.test.ts` (not in the unit test directories).

## Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../src/relay/agent-registry.js';
import { JobQueue } from '../src/relay/job-queue.js';
// ... other imports

describe('DAP E2E Integration', () => {
  let registry: AgentRegistry;
  let queue: JobQueue;

  // ===== Lifecycle Hooks =====

  beforeAll(async () => {
    // Start server or initialize shared resources once
    registry = new AgentRegistry('./shapes', { testMode: true });
    queue = new JobQueue('./data/test');
  });

  afterAll(async () => {
    // Cleanup: close server, clear data files
    cleanupTestData();
  });

  beforeEach(() => {
    // Reset state before each test
    // Clear the registry and queue
  });

  afterEach(() => {
    // Verify cleanup after each test
  });

  // ===== Test Cases =====
});
```

## What E2E Tests Cover

### 1. Server Startup

```typescript
it('should start server and accept connections', async () => {
  const server = startTestServer(8081);
  
  const response = await fetch('http://localhost:8081/health');
  expect(response.ok).toBe(true);
  
  const health = await response.json();
  expect(health.status).toBe('ok');
  
  await server.close();
});
```

### 2. Agent Registration

```typescript
it('should register agent and return capability list', async () => {
  const agentInfo = {
    agent_id: 'worker-001',
    capabilities: ['code-generation', 'testing'],
    version: '1.0.0',
    os: 'linux',
  };

  const result = registry.register('worker-001', agentInfo, mockSocket, [
    { name: 'code-generation' },
    { name: 'testing' },
  ]);

  expect(result.valid).toBe(true);
  expect(registry.has('worker-001')).toBe(true);

  const capabilities = registry.getByCapability('code-generation');
  expect(capabilities.length).toBe(1);
  expect(capabilities[0].agentId).toBe('worker-001');
});
```

### 3. Job Lifecycle

```typescript
it('should complete full job lifecycle', () => {
  // Submit a job
  const job = queue.submit('client-001', 'code-generation', 5, { prompt: 'Write tests' });
  expect(job.status).toBe('pending');
  expect(job.job_id).toBeDefined();

  // Claim the job
  const claimed = queue.claim(job.job_id, 'worker-001');
  expect(claimed?.status).toBe('claimed');
  expect(claimed?.claimed_by).toBe('worker-001');

  // Start work
  const started = queue.start(job.job_id);
  expect(started?.status).toBe('in-progress');

  // Complete the job
  const result = { output: 'Generated 42 test cases' };
  const completed = queue.complete(job.job_id, result);
  expect(completed?.status).toBe('completed');
  expect(completed?.result).toEqual(result);
});
```

### 4. Job Failure Handling

```typescript
it('should handle job failure with error message', () => {
  const job = queue.submit('client-001', 'code-generation', 5, { prompt: 'fail' });
  queue.claim(job.job_id, 'worker-001');
  queue.start(job.job_id);

  const failed = queue.fail(job.job_id, 'Compilation error: missing semicolon');
  expect(failed?.status).toBe('failed');
  expect(failed?.error).toBe('Compilation error: missing semicolon');
});
```

### 5. Provenance Chain

```typescript
it('should generate provenance records for job lifecycle', () => {
  const job = queue.submit('client-001', 'analysis', 5, { data: 'test' });
  queue.claim(job.job_id, 'worker-001');
  queue.start(job.job_id);
  queue.complete(job.job_id, { result: 'done' });

  const provenance = queue.getProvenance(job.job_id);
  
  // Should have submission, claim, and completion records
  expect(provenance.length).toBeGreaterThanOrEqual(2);
  
  // Records should be sorted by timestamp
  const timestamps = provenance.map(r => r.timestamp);
  expect(timestamps).toEqual(timestamps.sort());
});
```

### 6. Capability-Based Agent Matching

```typescript
it('should find agents by required capability', () => {
  // Register agents with different capabilities
  registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['coding'] }, socket1, [
    { name: 'coding' },
  ]);
  registry.register('agent-2', { agent_id: 'agent-2', capabilities: ['testing'] }, socket2, [
    { name: 'testing' },
  ]);
  registry.register('agent-3', { agent_id: 'agent-3', capabilities: ['coding', 'testing'] }, socket3, [
    { name: 'coding' },
    { name: 'testing' },
  ]);

  // Find coding agents
  const codingAgents = registry.getByCapability('coding');
  expect(codingAgents.length).toBe(2);
});
```

## Test Lifecycle Pattern

### Server Management

```typescript
describe('DAP Server E2E', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    // Start server on a specific port
    server = await startServer({ port: 0 });  // port: 0 = random available port
    baseUrl = server.url;
  });

  afterAll(async () => {
    await server.close();
  });
});
```

### Data Cleanup

```typescript
describe('Job Queue E2E', () => {
  const testDataDir = './data/e2e-test';

  beforeEach(() => {
    // Clear test data directory
    fs.rmSync(testDataDir, { recursive: true, force: true });
    fs.mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    // Leave clean state for next test
  });

  afterAll(() => {
    // Final cleanup
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });
});
```

## Adding New E2E Tests

### 1. Identify the Scenario

Pick the highest-value test cases:
- Critical user flows (registration, job submission, completion)
- Error handling paths (failures, cancellations)
- Edge cases (empty data, concurrent operations)

### 2. Write the Test

```typescript
it('should handle job cancellation by submitter', () => {
  // Arrange
  const job = queue.submit('client-001', 'task', 5, { data: 'test' });
  
  // Act - cancel before any agent claims it
  const cancelled = queue.cancel(job.job_id, 'No longer needed');
  
  // Assert
  expect(cancelled?.status).toBe('cancelled');
  expect(cancelled?.error).toBe('No longer needed');
  
  // Verify claim is no longer possible
  const claimAttempt = queue.claim(job.job_id, 'worker-001');
  expect(claimAttempt).toBeNull();
});
```

### 3. Verify with testMode

Always use `testMode: true` to bypass SHACL validation in E2E tests:

```typescript
const registry = new AgentRegistry('./shapes', { testMode: true });
```

### 4. Include Cleanup

```typescript
afterEach(() => {
  // Remove test agents
  registry.unregister('test-agent-id');
  
  // Remove test jobs
  const jobs = queue.getBySubmitter('test-client');
  for (const job of jobs) {
    queue.cancel(job.job_id);
  }
});
```

## Known Constraints

### Single-Process Limitation

E2E tests run in a single Node.js process. They **cannot** test:
- Real cross-machine communication
- Network latency effects
- Distributed consensus
- True multi-node scenarios

For cross-machine testing, use the manual test scripts:
- `scripts/test-cross-machine.sh` — spawns separate processes

### testMode Required

SHACL validation must be disabled in tests to avoid:
- File system dependencies (shapes directory)
- Slow validation overhead
- Flaky tests due to timing

```typescript
const registry = new AgentRegistry('./shapes', { testMode: true });
const queue = new JobQueue('./data/test');  // testMode not needed for queue
```

### Port Conflicts

Each test file should use unique ports or let the OS assign them:

```typescript
// Bad: fixed port may conflict
const server = await startServer({ port: 8081 });

// Good: let OS pick available port
const server = await startServer({ port: 0 });
const port = server.address().port;
```

### Data File Persistence

JobQueue persists to disk. Use isolated data directories per test:

```typescript
// Use unique test data directory
const queue = new JobQueue(`./data/test-${Date.now()}`);

// Or clean before each test
beforeEach(() => {
  fs.rmSync('./data/test', { recursive: true, force: true });
});
```

## Test Strategy Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Pyramid                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        E2E Tests                                 │
│                 test/e2e-integration.test.ts                   │
│    Full stack: server + REST + WebSocket + persistence          │
│    Runs in: real environment, slower (seconds)                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                   Integration Tests                             │
│          test/job-queue.test.ts, test/agent-registry.test.ts   │
│    Component interaction, file system, persistence              │
│    Runs in: test environment with mocks, medium speed            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     Unit Tests                                   │
│           test/shacl-validator.test.ts, test/messages.test.ts   │
│    Single functions, isolated logic                             │
│    Runs in: in-memory, fast (milliseconds)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### When to Write Each Type

| Type | When to Write | Example |
|------|--------------|---------|
| Unit | Logic changes, edge cases | Add new validation rule |
| Integration | Component interactions | JobQueue persistence |
| E2E | New API endpoints, user flows | Full job lifecycle |

### Running the Full Suite

```bash
# Unit + Integration only (fast)
npx vitest run test --exclude='**/e2e*.test.ts'

# Full suite including E2E (slow)
npx vitest run

# Watch mode for development
npx vitest
```

## Troubleshooting

### Port Already in Use

```
Error: listen EADDRINUSE :::8081
```

**Fix**: Use port 0 for automatic assignment, or stop other processes using the port:

```bash
# Find process using port
lsof -i :8081

# Kill it
kill -9 <PID>
```

### Stale Data Files

Tests fail due to leftover job data from previous runs.

**Fix**: Use isolated data directories or clean before tests:

```typescript
beforeEach(() => {
  const testDir = './data/e2e-test';
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  queue = new JobQueue(testDir);
});
```

### Timeout Issues

Tests hang or timeout, especially WebSocket tests.

**Fix**: Increase timeout or add explicit cleanup:

```typescript
// In vitest.config.ts
export default defineConfig({
  test: {
    timeout: 10000,  // 10 seconds
  },
});

// In test
it('should connect', async () => {
  const ws = new WebSocket('ws://localhost:8081', {
    handshakeTimeout: 5000,
  });
  
  // Always cleanup
  ws.close();
}, 10000);
```

### SHACL Validation Failures

Tests fail with validation errors in non-testMode runs.

**Fix**: Ensure testMode is enabled:

```typescript
const registry = new AgentRegistry('./shapes', { testMode: true });
```

### "Cannot find module" Errors

TypeScript modules not resolving.

**Fix**: Check vitest config includes TypeScript handling and build if needed:

```bash
npm run build
npx vitest run test/e2e-integration.test.ts
```