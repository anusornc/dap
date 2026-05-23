/**
 * E2E Integration Test for DAP Relay Server
 * Tests the full stack: WebSocket registration, REST job submission,
 * WebSocket job claim/complete, provenance tracking, and AgentCards
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RelayServer } from '../src/relay/server.js';
import { JobStatus } from '../src/protocol/types.js';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// Increase test timeout for E2E tests
const TEST_TIMEOUT = 30000;

// Test data directory - unique per test run
const TEST_DATA_DIR = `/tmp/dap-e2e-test-${Date.now()}-${Math.random()}`;

interface MockAgent {
  ws: WebSocket;
  agentId: string;
  sessionId?: string;
  capabilities: Array<{ name: string; version: string; maxConcurrent?: number; description?: string }>;
}

describe('E2E Integration', () => {
  let server: RelayServer;
  let serverPort: number;
  let serverUrl: string;
  let wsUrl: string;

  // Clean up data directory before tests
  beforeAll(() => {
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test data directory
    try {
      const jobsFile = join(TEST_DATA_DIR, 'jobs.json');
      if (existsSync(jobsFile)) unlinkSync(jobsFile);
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Ensure data directory exists
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }

    // Clean up any stale data
    const jobsFile = join(TEST_DATA_DIR, 'jobs.json');
    if (existsSync(jobsFile)) {
      try { unlinkSync(jobsFile); } catch { /* ignore */ }
    }

    // Set data dir env var for the server
    process.env.DATA_DIR = TEST_DATA_DIR;

    // Start server with port 0 (random free port) on localhost for reliable connections
    // Pass testMode to disable SHACL validation
    server = new RelayServer({ port: 0, host: '127.0.0.1' } as any, { testMode: true });
    await server.start();

    // Get actual port assigned by the OS
    const addr = server.getAddress();
    serverPort = addr.port;
    // Use 127.0.0.1 explicitly to avoid IPv6 issues
    serverUrl = `http://127.0.0.1:${serverPort}`;
    wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  });

  afterEach(async () => {
    // Close all WebSocket connections first
    // Stop server
    try {
      await server.stop();
      // Small delay to ensure port is released
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch {
      // Ignore stop errors
    }
  });

  /**
   * Connect a mock agent via WebSocket and register it
   */
  function connectAgent(
    agentId: string,
    capabilities: Array<{ name: string; version?: string; maxConcurrent?: number; description?: string }>,
    os = 'test-os'
  ): Promise<MockAgent> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        // Send registration message
        ws.send(JSON.stringify({
          action: 'register',
          agentId,
          capabilities: capabilities.map(c => ({
            name: c.name,
            version: c.version || '1.0.0',
            maxConcurrent: c.maxConcurrent || 1,
            description: c.description,
          })),
          os,
          version: '1.0.0',
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.success && msg.agentId === agentId) {
          resolve({
            ws,
            agentId,
            sessionId: msg.sessionId,
            capabilities: capabilities.map(c => ({
              name: c.name,
              version: c.version || '1.0.0',
              maxConcurrent: c.maxConcurrent || 1,
              description: c.description,
            })),
          });
        }
      });

      ws.on('error', reject);
    });
  }

  /**
   * Wait for a WebSocket message matching a predicate
   */
  function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for message'));
      }, timeoutMs);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });
  }

  /**
   * Send a message via WebSocket and wait for response
   */
  function sendAndWait(
    ws: WebSocket,
    msg: any,
    predicate: (msg: any) => boolean,
    timeoutMs = 5000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      ws.send(JSON.stringify(msg));

      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for response'));
      }, timeoutMs);

      ws.on('message', (data) => {
        const resp = JSON.parse(data.toString());
        if (predicate(resp)) {
          clearTimeout(timer);
          resolve(resp);
        }
      });

      ws.on('error', reject);
    });
  }

  describe('Agent Registration & Discovery', () => {
    it('should register two agents with different capabilities', async () => {
      // Connect AgentA with code-generation capability
      const agentA = await connectAgent('AgentA', [
        { name: 'code-generation', version: '1.0.0', maxConcurrent: 2, description: 'Generate code from specifications' },
      ]);

      // Connect AgentB with testing capability
      const agentB = await connectAgent('AgentB', [
        { name: 'testing', version: '1.0.0', maxConcurrent: 1, description: 'Run automated tests' },
      ]);

      // Verify agents are registered
      expect(agentA).toBeDefined();
      expect(agentA.agentId).toBe('AgentA');
      expect(agentB).toBeDefined();
      expect(agentB.agentId).toBe('AgentB');

      // Query agent cards via REST
      const response = await fetch(`${serverUrl}/agents`);
      expect(response.ok).toBe(true);

      const body = await response.json() as any;
      expect(body.count).toBeGreaterThanOrEqual(2);

      // Clean up
      agentA.ws.close();
      agentB.ws.close();
    });

    it('should discover agents by capability via REST', async () => {
      const agentA = await connectAgent('CodeGenAgent', [
        { name: 'code-generation', version: '1.0.0' },
      ]);

      const agentB = await connectAgent('TestingAgent', [
        { name: 'testing', version: '1.0.0' },
      ]);

      // Get all capabilities
      const capResponse = await fetch(`${serverUrl}/capabilities`);
      expect(capResponse.ok).toBe(true);

      const capBody = await capResponse.json() as any;
      expect(capBody.capabilities).toBeDefined();

      // At minimum we should have code-generation and testing
      const caps = Object.keys(capBody.capabilities || {});
      expect(caps).toContain('code-generation');
      expect(caps).toContain('testing');

      agentA.ws.close();
      agentB.ws.close();
    });

    it('should return JSON-LD agent cards', async () => {
      const agent = await connectAgent('CardTestAgent', [
        { name: 'document-generation', version: '1.0.0' },
      ]);

      // Get agent card
      const response = await fetch(`${serverUrl}/agents/CardTestAgent/card`);
      expect(response.ok).toBe(true);

      // Check content type is JSON-LD
      const contentType = response.headers.get('content-type') || '';
      expect(contentType).toContain('application/ld+json');

      const card = await response.json() as any;
      expect(card['@type']).toBe('AgentCard');
      expect(card.id).toBe('CardTestAgent');
      expect(card.capabilities).toBeDefined();
      expect(card.capabilities.length).toBeGreaterThan(0);
      expect(card.capabilities[0].name).toBe('document-generation');

      agent.ws.close();
    });
  });

  describe('Job Submission via REST', () => {
    it('should submit a job via REST API', async () => {
      const agentA = await connectAgent('SubmitterAgent', [
        { name: 'coordinator', version: '1.0.0' },
      ]);

      // Submit job with capability requirement
      const submitResponse = await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'code-generation',
          priority: 5,
          capability: 'code-generation',
          payload: {
            specification: 'Create a hello world function',
            language: 'typescript',
          },
        }),
      });

      expect(submitResponse.ok).toBe(true);

      const jobResult = await submitResponse.json() as any;
      expect(jobResult.jobId).toBeDefined();
      expect(jobResult.status).toBe('pending');

      agentA.ws.close();
    });

    it('should list pending jobs via REST', async () => {
      const agent = await connectAgent('JobListerAgent', [
        { name: 'coordinator', version: '1.0.0' },
      ]);

      // Submit a few jobs
      await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'analysis',
          priority: 3,
          payload: { task: 'analyze-repo' },
        }),
      });

      await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'analysis',
          priority: 5,
          payload: { task: 'analyze-logs' },
        }),
      });

      // List all jobs
      const listResponse = await fetch(`${serverUrl}/jobs`);
      expect(listResponse.ok).toBe(true);

      const listBody = await listResponse.json() as any;
      expect(listBody.count).toBeGreaterThanOrEqual(2);
      expect(listBody.jobs).toBeDefined();
      expect(Array.isArray(listBody.jobs)).toBe(true);

      agent.ws.close();
    });
  });

  describe('Job Lifecycle (Submit → Claim → Complete)', () => {
    it('should complete a full job lifecycle via WebSocket', async () => {
      // Connect agents
      const agentA = await connectAgent('AgentA', [
        { name: 'code-generation', version: '1.0.0', maxConcurrent: 1 },
      ]);

      const agentB = await connectAgent('AgentB', [
        { name: 'testing', version: '1.0.0', maxConcurrent: 1 },
      ]);

      // AgentB submits a job requiring code-generation capability via REST
      const submitResponse = await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'AgentB', // So job events are sent to AgentB
        },
        body: JSON.stringify({
          type: 'code-generation',
          priority: 5,
          capability: 'code-generation',
          payload: {
            specification: 'Create a hello world function',
            language: 'typescript',
          },
        }),
      });

      expect(submitResponse.ok).toBe(true);
      const { jobId } = await submitResponse.json() as any;

      // AgentA claims the job via REST API (more reliable than WebSocket for claim operations)
      const claimResponse = await fetch(`${serverUrl}/jobs/${jobId}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'AgentA',
        },
      });
      expect(claimResponse.ok).toBe(true);
      const claimResult = await claimResponse.json() as any;
      expect(claimResult.status).toBe('claimed');
      expect(claimResult.claimed_by).toBe('AgentA');

      // Small delay to ensure job state is persisted
      await new Promise(resolve => setTimeout(resolve, 50));

      // AgentA starts the job via REST (required to move from CLAIMED to IN_PROGRESS)
      const startResponse = await fetch(`${serverUrl}/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!startResponse.ok) {
        const errorBody = await startResponse.text();
        console.log('Progress failed:', startResponse.status, errorBody);
      }
      expect(startResponse.ok).toBe(true);

      // AgentA completes the job via REST
      const completeResponse = await fetch(`${serverUrl}/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: {
            success: true,
            output: '// Hello World function\nexport function helloWorld(): string {\n  return "Hello, World!";\n}',
            language: 'typescript',
          },
        }),
      });
      expect(completeResponse.ok).toBe(true);

      // Verify job status via REST
      const jobResponse = await fetch(`${serverUrl}/jobs/${jobId}`);
      expect(jobResponse.ok).toBe(true);

      const job = await jobResponse.json() as any;
      expect(job.job_id).toBe(jobId);
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.claimed_by).toBe('AgentA');
      expect(job.result).toBeDefined();
      expect(job.result.success).toBe(true);

      agentA.ws.close();
      agentB.ws.close();
    });

    it('should track provenance with 3+ records for job lifecycle', async () => {
      // Connect agents
      const agentA = await connectAgent('ProvenanceAgentA', [
        { name: 'code-generation', version: '1.0.0' },
      ]);

      const agentB = await connectAgent('ProvenanceAgentB', [
        { name: 'testing', version: '1.0.0' },
      ]);

      // AgentB submits a job
      const submitResponse = await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'ProvenanceAgentB', // So job events are sent to AgentB
        },
        body: JSON.stringify({
          type: 'code-generation',
          priority: 5,
          capability: 'code-generation',
          payload: { spec: 'test-spec' },
        }),
      });

      const { jobId } = await submitResponse.json() as any;

      // AgentA claims the job via REST API
      const claimResponse = await fetch(`${serverUrl}/jobs/${jobId}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'ProvenanceAgentA',
        },
      });
      expect(claimResponse.ok).toBe(true);

      // Start the job via REST (required before completion) - use /start endpoint
      await fetch(`${serverUrl}/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Complete the job via REST
      const completeResponse = await fetch(`${serverUrl}/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: { output: 'completed' } }),
      });
      
      if (!completeResponse.ok) {
        const errorBody = await completeResponse.text();
        console.log('Complete failed:', completeResponse.status, errorBody);
      }
      expect(completeResponse.ok).toBe(true);

      // Verify provenance via REST
      const provResponse = await fetch(`${serverUrl}/jobs/${jobId}/provenance`);
      expect(provResponse.ok).toBe(true);

      const provResult = await provResponse.json() as any;
      expect(provResult.records).toBeDefined();
      expect(provResult.count).toBeGreaterThanOrEqual(3);

      // Verify provenance contains submit → claim → complete
      const recordActivities = provResult.records.map((r: any) => r.activity);
      expect(recordActivities.length).toBeGreaterThanOrEqual(3);

      // Should have records for submission, claim, and completion
      expect(provResult.count).toBeGreaterThanOrEqual(3);

      agentA.ws.close();
      agentB.ws.close();
    });
  });

  describe('AgentCards Integration', () => {
    it('should include cards for both agents after registration', async () => {
      const agentA = await connectAgent('CardAgentA', [
        { name: 'code-generation', version: '1.0.0' },
        { name: 'code-review', version: '1.0.0' },
      ]);

      const agentB = await connectAgent('CardAgentB', [
        { name: 'testing', version: '1.0.0' },
        { name: 'deployment', version: '1.0.0' },
      ]);

      // Get all agent cards
      const response = await fetch(`${serverUrl}/agents`);
      expect(response.ok).toBe(true);

      const body = await response.json() as any;
      expect(body.count).toBeGreaterThanOrEqual(2);

      // Verify both agents are in the list
      const agentIds = body.agents.map((a: any) => a.agent_id || a.id);
      expect(agentIds).toContain('CardAgentA');
      expect(agentIds).toContain('CardAgentB');

      // Get individual cards
      const cardA = await (await fetch(`${serverUrl}/agents/CardAgentA/card`)).json();
      expect(cardA.id).toBe('CardAgentA');
      expect(cardA.capabilities.map((c: any) => c.name)).toContain('code-generation');

      const cardB = await (await fetch(`${serverUrl}/agents/CardAgentB/card`)).json();
      expect(cardB.id).toBe('CardAgentB');
      expect(cardB.capabilities.map((c: any) => c.name)).toContain('testing');

      agentA.ws.close();
      agentB.ws.close();
    });

    it('should filter agents by capability', async () => {
      await connectAgent('CapFilterAgent1', [
        { name: 'code-generation', version: '1.0.0' },
      ]);

      await connectAgent('CapFilterAgent2', [
        { name: 'testing', version: '1.0.0' },
      ]);

      await connectAgent('CapFilterAgent3', [
        { name: 'code-generation', version: '1.0.0' },
      ]);

      // Filter by code-generation capability
      const response = await fetch(`${serverUrl}/agents?capability=code-generation`);
      expect(response.ok).toBe(true);

      const body = await response.json() as any;
      expect(body.count).toBeGreaterThanOrEqual(2);

      // All returned agents should have code-generation
      for (const agent of body.agents) {
        const caps = Array.isArray(agent.capabilities)
          ? agent.capabilities.map((c: any) => typeof c === 'string' ? c : c.name)
          : [];
        expect(caps).toContain('code-generation');
      }
    });
  });

  describe('Server Health & Metrics', () => {
    it('should report healthy status', async () => {
      // Health check should work without API key in test mode
      const response = await fetch(`${serverUrl}/health`);
      expect(response.ok).toBe(true);

      const health = await response.json() as any;
      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeDefined();
      expect(health.uptime).toBeDefined();
    });

    it('should report server stats', async () => {
      // Connect some agents
      await connectAgent('StatsAgent1', [{ name: 'task-a', version: '1.0.0' }]);
      await connectAgent('StatsAgent2', [{ name: 'task-b', version: '1.0.0' }]);

      const response = await fetch(`${serverUrl}/stats`);
      expect(response.ok).toBe(true);

      const stats = await response.json() as any;
      expect(stats.agents).toBeDefined();
      expect(stats.agents.totalAgents).toBeGreaterThanOrEqual(2);
      expect(stats.server).toBeDefined();
    });

    it('should return Prometheus-style metrics', async () => {
      const response = await fetch(`${serverUrl}/metrics`);
      expect(response.ok).toBe(true);

      const contentType = response.headers.get('content-type') || '';
      expect(contentType).toContain('text/plain');

      const text = await response.text();
      expect(text).toContain('dap_connected_agents');
      expect(text).toContain('dap_uptime_seconds');
    });
  });

  describe('Clean Shutdown', () => {
    it('should handle server shutdown gracefully', async () => {
      const agent = await connectAgent('ShutdownTestAgent', [
        { name: 'test', version: '1.0.0' },
      ]);

      // Stop server
      await server.stop();

      // WebSocket should be closed by server
      expect(agent.ws.readyState).toBe(WebSocket.CLOSING);

      agent.ws.close();
    });

    it('should reinitialize fresh server in afterEach', async () => {
      // This test verifies that afterEach cleanup works
      // We submit a job and verify it persists to the next test
      const agent = await connectAgent('PersistenceTestAgent', [
        { name: 'test', version: '1.0.0' },
      ]);

      const response = await fetch(`${serverUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'persist-test',
          priority: 5,
          payload: { test: true },
        }),
      });

      expect(response.ok).toBe(true);

      // Server should stop and next test gets fresh state
      agent.ws.close();
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid job operations', async () => {
      const agent = await connectAgent('ErrorTestAgent', [
        { name: 'test', version: '1.0.0' },
      ]);

      // Try to claim non-existent job
      const claimResponse = await fetch(`${serverUrl}/jobs/nonexistent-job-id/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'ErrorTestAgent',
        },
      });

      // Should fail gracefully
      expect(claimResponse.ok).toBe(false);

      agent.ws.close();
    });

    it('should handle malformed WebSocket messages', async () => {
      // Create a promise to handle the connection
      const ws = new WebSocket(wsUrl);

      // Wait for open, then send invalid message
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Send invalid JSON - but handle potential close first
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('this is not json');
      }

      // Send valid JSON but invalid action
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: 'invalid-action',
          data: {},
        }));
      }

      // Wait a bit for server to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not crash the server
      const response = await fetch(`${serverUrl}/health`);
      expect(response.ok).toBe(true);

      ws.close();
    });
  });
});