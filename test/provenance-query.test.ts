/**
 * Provenance Query Tests
 * Tests for PROV-O provenance query API
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue } from '../src/relay/job-queue.js';
import { AgentRegistry } from '../src/relay/agent-registry.js';
import { ProvenanceQuery } from '../src/provenance/index.js';

describe('JobQueue Provenance Queries', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue(`/tmp/test-prov-query-${Date.now()}`);
  });

  describe('getProvenance', () => {
    it('should return empty array for non-existent job', () => {
      const records = queue.getProvenance('non-existent-job');
      expect(records).toEqual([]);
    });

    it('should return 1 record for newly submitted job', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, { prompt: 'test' });
      const records = queue.getProvenance(job.job_id);

      expect(records).toHaveLength(1);
      expect(records[0].activity).toContain('Submission');
      expect(records[0].entity).toBe(job.job_id);
    });

    it('should return 2 records for claimed job', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');
      const records = queue.getProvenance(job.job_id);

      expect(records).toHaveLength(2);
      expect(records[0].activity).toContain('Submission');
      expect(records[1].activity).toContain('Claim');
    });

    it('should return 3 records for completed job', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, { result: 'success' });
      const records = queue.getProvenance(job.job_id);

      expect(records).toHaveLength(3);
      expect(records.map(r => r.activity)).toContain('dap:JobSubmission');
      expect(records.map(r => r.activity)).toContain('dap:JobClaim');
      expect(records.map(r => r.activity)).toContain('dap:JobExecution');
    });
  });

  describe('queryByAgent', () => {
    it('should return records for specific agent', () => {
      const job1 = queue.submit('agent-1', 'type-a', 5, {});
      const job2 = queue.submit('agent-2', 'type-b', 5, {});
      queue.claim(job1.job_id, 'agent-3');
      queue.claim(job2.job_id, 'agent-3');

      const records = queue.queryByAgent('agent-3');
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records.every(r => r.agentId === 'agent-3')).toBe(true);
    });

    it('should filter by date range', () => {
      const job = queue.submit('agent-1', 'type-a', 5, {});
      queue.claim(job.job_id, 'agent-2');

      const yesterday = new Date(Date.now() - 86400000);
      const tomorrow = new Date(Date.now() + 86400000);

      const records = queue.queryByAgent('agent-2', yesterday, tomorrow);
      expect(records.length).toBeGreaterThan(0);
    });

    it('should return empty for non-existent agent', () => {
      const records = queue.queryByAgent('non-existent-agent');
      expect(records).toEqual([]);
    });
  });

  describe('queryByActivity', () => {
    it('should return records matching activity type', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');

      const records = queue.queryByActivity('Submission');
      expect(records.length).toBeGreaterThan(0);
      expect(records.every(r => r.activity.includes('Submission'))).toBe(true);
    });

    it('should return empty for non-existent activity', () => {
      const records = queue.queryByActivity('NonExistentActivity');
      expect(records).toEqual([]);
    });

    it('should filter by date range', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});

      const yesterday = new Date(Date.now() - 86400000);
      const tomorrow = new Date(Date.now() + 86400000);

      const records = queue.queryByActivity('Submission', yesterday, tomorrow);
      expect(records.length).toBeGreaterThan(0);
    });
  });

  describe('getProvenanceStats', () => {
    it('should return correct stats after submitting jobs', () => {
      queue.submit('agent-1', 'type-a', 5, {});
      queue.submit('agent-2', 'type-b', 5, {});

      const stats = queue.getProvenanceStats();

      expect(stats.totalRecords).toBe(2);
      expect(stats.byActivity['dap:JobSubmission']).toBe(2);
      expect(stats.byAgent['agent-1']).toBe(1);
      expect(stats.byAgent['agent-2']).toBe(1);
      expect(stats.timeRange.earliest).toBeDefined();
      expect(stats.timeRange.latest).toBeDefined();
    });

    it('should return zero stats for empty queue', () => {
      const stats = queue.getProvenanceStats();

      expect(stats.totalRecords).toBe(0);
      expect(stats.byActivity).toEqual({});
      expect(stats.byAgent).toEqual({});
      expect(stats.timeRange.earliest).toBeNull();
      expect(stats.timeRange.latest).toBeNull();
    });
  });
});

describe('AgentRegistry Provenance Queries', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry('./shapes', { testMode: true });
  });

  describe('getAgentProvenance', () => {
    it('should return empty array for non-existent agent', () => {
      const records = registry.getAgentProvenance('non-existent');
      expect(records).toEqual([]);
    });

    it('should return registration provenance for registered agent', () => {
      registry.register('agent-1', {
        agent_id: 'agent-1',
        capabilities: ['code-generation'],
        os: 'linux',
      }, {} as any, [{ name: 'code-generation' }]);

      const records = registry.getAgentProvenance('agent-1');
      expect(records.length).toBeGreaterThan(0);
      expect(records.some(r => r.activity === 'dap:AgentRegistration')).toBe(true);
    });

    it('should include heartbeats in provenance', () => {
      registry.register('agent-1', {
        agent_id: 'agent-1',
        capabilities: [],
      }, {} as any, []);

      registry.updateHeartbeat('agent-1');
      registry.updateHeartbeat('agent-1');

      const records = registry.getAgentProvenance('agent-1');
      const heartbeats = records.filter(r => r.activity === 'dap:Heartbeat');
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getRegistrationChain', () => {
    it('should return empty array for non-existent agent', () => {
      const records = registry.getRegistrationChain('non-existent');
      expect(records).toEqual([]);
    });

    it('should return registration and heartbeat chain', () => {
      registry.register('agent-1', {
        agent_id: 'agent-1',
        capabilities: [],
      }, {} as any, []);

      registry.updateHeartbeat('agent-1');

      const records = registry.getRegistrationChain('agent-1');
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records[0].activity).toBe('dap:AgentRegistration');
    });
  });
});

describe('ProvenanceQuery', () => {
  let queue: JobQueue;
  let registry: AgentRegistry;
  let query: ProvenanceQuery;

  beforeEach(() => {
    queue = new JobQueue(`/tmp/test-prov-query-${Date.now()}`);
    registry = new AgentRegistry('./shapes', { testMode: true });
    query = new ProvenanceQuery(queue, registry);
  });

  describe('trace', () => {
    it('should trace job through submit → claim → complete (3+ records)', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, { prompt: 'test' });
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, { result: 'done' });

      const trace = query.trace(job.job_id);

      expect(trace.length).toBeGreaterThanOrEqual(3);
      expect(trace[0].activity).toBe('JOB_SUBMISSION');
      expect(trace[trace.length - 1].activity).toBe('JOB_COMPLETED');
    });

    it('should return empty array for non-existent job', () => {
      const trace = query.trace('non-existent-job');
      expect(trace).toEqual([]);
    });

    it('should include timestamps in trace', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');

      const trace = query.trace(job.job_id);
      expect(trace.every(step => step.timestamp)).toBe(true);
    });
  });

  describe('findRootCause', () => {
    it('should trace a failed job and identify failure point', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.fail(job.job_id, 'Connection timeout');

      const rootCause = query.findRootCause(job.job_id);
      expect(rootCause).toContain('Connection timeout');
    });

    it('should return "Job not found" for non-existent job', () => {
      const rootCause = query.findRootCause('non-existent');
      expect(rootCause).toBe('Job not found');
    });

    it('should return "Job did not fail" for successful job', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, { result: 'success' });

      const rootCause = query.findRootCause(job.job_id);
      expect(rootCause).toBe('Job did not fail');
    });
  });

  describe('getActivityTimeline', () => {
    it('should return activity timeline for agent', () => {
      const job1 = queue.submit('agent-1', 'type-a', 5, {});
      queue.claim(job1.job_id, 'agent-2');
      queue.start(job1.job_id);
      queue.complete(job1.job_id, { result: 'done' });

      registry.register('agent-3', {
        agent_id: 'agent-3',
        capabilities: [],
      }, {} as any, []);

      const timeline = query.getActivityTimeline('agent-2');
      expect(timeline.length).toBeGreaterThan(0);
    });

    it('should return empty timeline for non-existent agent', () => {
      const timeline = query.getActivityTimeline('non-existent');
      expect(timeline).toEqual([]);
    });

    it('should filter by date range', () => {
      const job = queue.submit('agent-1', 'type-a', 5, {});
      queue.claim(job.job_id, 'agent-2');

      const range = {
        from: new Date(Date.now() - 86400000),
        to: new Date(Date.now() + 86400000),
      };

      const timeline = query.getActivityTimeline('agent-2', range);
      expect(timeline.length).toBeGreaterThan(0);
    });
  });

  describe('formatTraceTimeline', () => {
    it('should format trace as human-readable timeline', () => {
      const job = queue.submit('agent-1', 'code-generation', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, { result: 'done' });

      const trace = query.trace(job.job_id);
      const formatted = query.formatTraceTimeline(trace);

      expect(formatted).toContain('JOB EXECUTION TRACE');
      expect(formatted).toContain('Step 1');
      expect(formatted).toContain('JOB_SUBMISSION');
    });

    it('should return "No trace available" for empty trace', () => {
      const formatted = query.formatTraceTimeline([]);
      expect(formatted).toBe('No trace available');
    });
  });
});