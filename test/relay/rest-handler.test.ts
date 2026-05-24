import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { RESTHandler } from '../../src/relay/rest-handler.js';
import { AgentRegistry } from '../../src/relay/agent-registry.js';
import { JobQueue } from '../../src/relay/job-queue.js';
import { AgentCards } from '../../src/relay/agent-cards.js';
import { JobStatus, AgentCardStatus } from '../../src/protocol/types.js';

vi.mock('../../src/relay/agent-registry.js');
vi.mock('../../src/relay/job-queue.js');
vi.mock('../../src/relay/agent-cards.js');
vi.mock('../../src/provenance/index.js', () => ({
  ProvenanceQuery: vi.fn().mockImplementation(() => ({
    trace: vi.fn().mockReturnValue([{ event: 'started' }]),
  })),
  ProvenanceGenerator: vi.fn().mockImplementation(() => ({
    recordActivity: vi.fn(),
  })),
}));
vi.mock('../../src/utils/logger.js', () => ({
  restLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  metricsCollector: { recordRequest: vi.fn() },
}));
vi.mock('../../src/utils/metrics.js', () => ({
  requestsTotal: { labels: () => ({ inc: vi.fn() }) },
  requestDuration: { labels: () => ({ observe: vi.fn() }) },
  errorsTotal: { labels: () => ({ inc: vi.fn() }) },
  rateLimited: { inc: vi.fn() },
  register: { metrics: vi.fn().mockResolvedValue('metrics'), contentType: 'text/plain' },
}));
vi.mock('../../src/protocol/validation.js', () => ({
  validateApiKey: vi.fn().mockReturnValue(true),
  checkCombinedRateLimit: vi.fn().mockReturnValue({ allowed: true, keyRemaining: 99, resetAt: Date.now() + 60000 }),
  logInvalidKeyAttempt: vi.fn(),
}));

import express from 'express';

describe('RESTHandler', () => {
  let app: express.Application;
  let handler: RESTHandler;
  let mockRegistry: vi.Mocked<AgentRegistry>;
  let mockQueue: vi.Mocked<JobQueue>;
  let mockAgentCards: vi.Mocked<AgentCards>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    mockRegistry = new AgentRegistry(null as any) as any;
    mockQueue = new JobQueue() as any;
    mockAgentCards = new AgentCards(mockRegistry, null as any) as any;

    // Default mock implementations
    mockRegistry.getAll.mockReturnValue([]);

    handler = new RESTHandler(mockRegistry, mockQueue, { apiKeys: [] });
    // In our test, RESTHandler instantiates its own app using express() inside constructor.
    // The issue description stated it expected an express.Application parameter but the codebase
    // uses `this.app = express();` inside the RESTHandler constructor directly.
    // Therefore, the code implementation of `RESTHandler` doesn't take app as the first parameter.
    // We stick to the actual code implementation (constructor(registry, jobQueue, config)).
    handler.setAgentCards(mockAgentCards);
  });

  describe('Health Route', () => {
    it('should return health status', async () => {
      const app = handler.getApp();
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('connections', 0);
    });
  });

  describe('Agent Routes', () => {
    it('POST /connect - should return agentId', async () => {
      const app = handler.getApp();
      const response = await request(app).post('/connect').send({ agentId: 'agent-123' });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('agentId', 'agent-123');
    });

    it('POST /connect - should error if agentId is missing', async () => {
      const app = handler.getApp();
      const response = await request(app).post('/connect').send({});
      expect(response.status).toBe(400);
    });

    it('GET /agents - should list agents via AgentCards when set', async () => {
      const app = handler.getApp();
      mockAgentCards.listCards.mockReturnValue([{ agentId: 'agent-123', status: AgentCardStatus.ONLINE }] as any);
      mockAgentCards.toJsonLd.mockReturnValue({ '@id': 'did:dap:agent-123' } as any);

      const response = await request(app).get('/agents');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.agents[0]).toEqual({ '@id': 'did:dap:agent-123' });
    });

    it('GET /agents - should fallback to basic registry if agentCards not set', async () => {
      handler.setAgentCards(null as any);
      const app = handler.getApp();
      mockRegistry.toJSON.mockReturnValue([{ agentId: 'basic-agent' }] as any);

      const response = await request(app).get('/agents');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.agents[0].agentId).toBe('basic-agent');
    });

    it('GET /agents/:agentId - should return specific agent from registry', async () => {
      const app = handler.getApp();
      const mockAgent = {
        agentId: 'agent-123',
        agentInfo: {},
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        capabilities: new Map([['cap1', { name: 'cap1' }]]),
      };
      mockRegistry.get.mockReturnValue(mockAgent as any);

      const response = await request(app).get('/agents/agent-123');
      expect(response.status).toBe(200);
      expect(response.body.agentId).toBe('agent-123');
      expect(response.body.capabilities).toBeDefined();
    });

    it('GET /agents/:agentId - should return 404 if not found', async () => {
      const app = handler.getApp();
      mockRegistry.get.mockReturnValue(undefined);

      const response = await request(app).get('/agents/missing-agent');
      expect(response.status).toBe(404);
    });

    it('GET /agents/:agentId/card - should return card via JSON-LD', async () => {
      const app = handler.getApp();
      mockAgentCards.getCard.mockReturnValue({ agentId: 'agent-123' } as any);
      mockAgentCards.toJsonLd.mockReturnValue({ '@id': 'did:dap:agent-123' } as any);

      const response = await request(app).get('/agents/agent-123/card');
      expect(response.status).toBe(200);
      expect(response.body['@id']).toBe('did:dap:agent-123');
    });

    it('PATCH /agents/:agentId/card - should update card status', async () => {
      const app = handler.getApp();
      mockAgentCards.getCard.mockReturnValue({ agentId: 'agent-123' } as any);
      mockAgentCards.toJsonLd.mockReturnValue({ '@id': 'did:dap:agent-123', status: AgentCardStatus.OFFLINE } as any);

      const response = await request(app).patch('/agents/agent-123/card').send({ status: AgentCardStatus.OFFLINE });
      expect(response.status).toBe(200);
      expect(mockAgentCards.updateCard).toHaveBeenCalledWith('agent-123', { status: AgentCardStatus.OFFLINE, metadata: undefined });
    });

    it('GET /.well-known/dap-agent-card - should return server card', async () => {
      const app = handler.getApp();
      mockAgentCards.getServerCard.mockReturnValue({ isServer: true } as any);
      mockAgentCards.toJsonLd.mockReturnValue({ '@id': 'did:dap:server' } as any);

      const response = await request(app).get('/.well-known/dap-agent-card');
      expect(response.status).toBe(200);
      expect(response.body['@id']).toBe('did:dap:server');
    });

    it('GET /capabilities - should return all capabilities from registry', async () => {
      const app = handler.getApp();
      mockRegistry.getAllCapabilities.mockReturnValue(new Map([['cap1', ['agent1']]]));
      mockRegistry.getStats.mockReturnValue({ total: 1 } as any);

      const response = await request(app).get('/capabilities');
      expect(response.status).toBe(200);
      expect(response.body.capabilities.cap1).toEqual(['agent1']);
      expect(response.body.stats.total).toBe(1);
    });
  });

  describe('Job Routes', () => {
    it('POST /jobs - should validate required fields', async () => {
      const app = handler.getApp();
      const response = await request(app).post('/jobs').send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/required/);
    });

    it('POST /jobs - should submit a job', async () => {
      const app = handler.getApp();
      mockQueue.submit.mockReturnValue({ job_id: 'job-1', status: JobStatus.PENDING, created_at: new Date() } as any);

      const response = await request(app)
        .post('/jobs')
        .send({ type: 'test-job', payload: { foo: 'bar' } });

      expect(response.status).toBe(201);
      expect(response.body.jobId).toBe('job-1');
    });

    it('GET /jobs - should query jobs', async () => {
      const app = handler.getApp();
      mockQueue.query.mockReturnValue([{ job_id: 'job-1' }] as any);

      const response = await request(app).get('/jobs?status=PENDING');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    it('GET /jobs/:jobId - should return specific job', async () => {
      const app = handler.getApp();
      mockQueue.get.mockReturnValue({ job_id: 'job-1' } as any);

      const response = await request(app).get('/jobs/job-1');
      expect(response.status).toBe(200);
      expect(response.body.job_id).toBe('job-1');
    });

    it('GET /jobs/:jobId/result - should return job result if completed', async () => {
      const app = handler.getApp();
      mockQueue.get.mockReturnValue({ job_id: 'job-1', status: JobStatus.COMPLETED, result: 'done' } as any);

      const response = await request(app).get('/jobs/job-1/result');
      expect(response.status).toBe(200);
      expect(response.body.result).toBe('done');
    });

    it('GET /jobs/:jobId/result - should return 400 if not completed', async () => {
      const app = handler.getApp();
      mockQueue.get.mockReturnValue({ job_id: 'job-1', status: JobStatus.PENDING } as any);

      const response = await request(app).get('/jobs/job-1/result');
      expect(response.status).toBe(400);
    });

    it('POST /jobs/:jobId/claim - should claim a job', async () => {
      const app = handler.getApp();
      mockQueue.claim.mockReturnValue({ job_id: 'job-1', status: JobStatus.CLAIMED } as any);

      const response = await request(app)
        .post('/jobs/job-1/claim')
        .set('x-agent-id', 'agent-1');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(JobStatus.CLAIMED);
    });

    it('POST /jobs/:jobId/start - should start a job', async () => {
      const app = handler.getApp();
      mockQueue.start.mockReturnValue({ job_id: 'job-1', status: JobStatus.IN_PROGRESS } as any);

      const response = await request(app).post('/jobs/job-1/start');
      expect(response.status).toBe(200);
    });

    it('POST /jobs/:jobId/progress - should update progress', async () => {
      const app = handler.getApp();
      mockQueue.progress.mockReturnValue({ job_id: 'job-1', status: JobStatus.IN_PROGRESS } as any);

      const response = await request(app).post('/jobs/job-1/progress').send({ message: 'working' });
      expect(response.status).toBe(200);
    });

    it('POST /jobs/:jobId/complete - should complete a job', async () => {
      const app = handler.getApp();
      mockQueue.complete.mockReturnValue({ job_id: 'job-1', status: JobStatus.COMPLETED, result: 'done' } as any);

      const response = await request(app).post('/jobs/job-1/complete').send({ result: 'done' });
      expect(response.status).toBe(200);
      expect(response.body.result).toBe('done');
    });

    it('DELETE /jobs/:jobId - should cancel a job', async () => {
      const app = handler.getApp();
      mockQueue.cancel.mockReturnValue({ job_id: 'job-1', status: JobStatus.CANCELLED } as any);

      const response = await request(app).delete('/jobs/job-1').send({ reason: 'cancel test' });
      expect(response.status).toBe(200);
    });
  });

  describe('Provenance and Other Routes', () => {
    it('GET /jobs/:jobId/provenance - should return provenance records', async () => {
      const app = handler.getApp();
      mockQueue.getProvenance.mockReturnValue([{ activity_id: 'act-1' }] as any);

      const response = await request(app).get('/jobs/job-1/provenance');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    it('GET /jobs/:jobId/trace - should return trace via ProvenanceQuery', async () => {
      const app = handler.getApp();
      const response = await request(app).get('/jobs/job-1/trace');
      expect(response.status).toBe(200);
      expect(response.body.trace[0].event).toBe('started');
    });

    it('GET /agents/:agentId/provenance - should return agent provenance', async () => {
      const app = handler.getApp();
      mockRegistry.getAgentProvenance.mockReturnValue([{ activity_id: 'act-1' }] as any);

      const response = await request(app).get('/agents/agent-1/provenance');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    it('GET /provenance/stats - should return stats', async () => {
      const app = handler.getApp();
      mockQueue.getProvenanceStats.mockReturnValue({ total: 5 } as any);

      const response = await request(app).get('/provenance/stats');
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
    });

    it('GET /provenance - should query provenance by agentId', async () => {
      const app = handler.getApp();
      mockQueue.queryByAgent.mockReturnValue([{ activity_id: 'act-1' }] as any);

      const response = await request(app).get('/provenance?agentId=agent-1');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    it('GET /stats - should return aggregated stats', async () => {
      const app = handler.getApp();
      mockRegistry.getStats.mockReturnValue({ agents: 1 } as any);
      mockQueue.getStats.mockReturnValue({ jobs: 2 } as any);

      const response = await request(app).get('/stats');
      expect(response.status).toBe(200);
      expect(response.body.agents.agents).toBe(1);
      expect(response.body.jobs.jobs).toBe(2);
    });

    it('GET /metrics - should return prometheus metrics', async () => {
      const app = handler.getApp();
      const response = await request(app).get('/metrics');
      expect(response.status).toBe(200);
      expect(response.text).toBe('metrics');
    });
  });
});
