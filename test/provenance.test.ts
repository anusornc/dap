/**
 * Provenance Tests
 * Tests for PROV-O compliant provenance tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue } from '../src/relay/job-queue.js';
import { AgentRegistry } from '../src/relay/agent-registry.js';
import { ProvenanceGenerator, DAPActivityTypes, DAPEntityTypes } from '../src/provenance/index.js';

describe('ProvenanceGenerator', () => {
  let generator: ProvenanceGenerator;

  beforeEach(() => {
    generator = new ProvenanceGenerator();
  });

  describe('createAgentRecord', () => {
    it('should create a valid PROV-O agent record', () => {
      const agent = generator.createAgentRecord('test-agent', 'dap:AIAgent', 'Test Agent');
      
      expect(agent['@id']).toBe('test-agent');
      expect(agent['@type']).toContain('dap:AIAgent');
      expect(agent['prov:label']).toBe('Test Agent');
    });

    it('should use agentId as label if not provided', () => {
      const agent = generator.createAgentRecord('test-agent');
      
      expect(agent['prov:label']).toBe('test-agent');
    });
  });

  describe('createMessageEntity', () => {
    it('should create a message entity', () => {
      const entity = generator.createMessageEntity('msg-123', 'request', { data: 'test' });
      
      expect(entity['@id']).toBe('msg-123');
      expect(entity['@type']).toBe(DAPEntityTypes.DAP_MESSAGE);
      expect(entity['prov:label']).toContain('request');
      expect(entity['prov:value']).toEqual({ data: 'test' });
    });
  });

  describe('createJobActivity', () => {
    it('should create a job activity with all options', () => {
      const activity = generator.createJobActivity('job-123', DAPActivityTypes.JOB_EXECUTION, {
        startedAtTime: '2026-05-21T10:00:00Z',
        endedAtTime: '2026-05-21T10:05:00Z',
        associatedAgent: 'agent-1',
        usedEntities: ['entity-1'],
        generatedEntities: ['entity-2'],
        hadRole: 'worker',
      });

      expect(activity['@type']).toBe(DAPActivityTypes.JOB_EXECUTION);
      expect(activity['prov:startedAtTime']).toBe('2026-05-21T10:00:00Z');
      expect(activity['prov:endedAtTime']).toBe('2026-05-21T10:05:00Z');
      expect(activity['prov:wasAssociatedWith']).toBe('agent-1');
      expect(activity['prov:used']).toContain('entity-1');
      expect(activity['prov:generated']).toContain('entity-2');
      expect(activity['prov:qualifiedAssociation']).toBeDefined();
    });

    it('should generate unique activity IDs', () => {
      const activity1 = generator.createJobActivity('job-1', DAPActivityTypes.JOB_SUBMISSION);
      const activity2 = generator.createJobActivity('job-2', DAPActivityTypes.JOB_SUBMISSION);
      
      expect(activity1['@id']).not.toBe(activity2['@id']);
    });
  });

  describe('createJobSubmissionRecord', () => {
    it('should create a complete provenance chain for job submission', () => {
      const chain = generator.createJobSubmissionRecord(
        'job-123',
        'submitter-1',
        'code-generation',
        { prompt: 'generate hello world' },
        'code-generation'
      );

      expect(chain['@context']).toContain('https://www.w3.org/ns/prov');
      expect(chain['@graph']).toHaveLength(3);
      
      // Check job input entity
      const jobInput = chain['@graph'].find(e => e['@type'] === DAPEntityTypes.DAP_JOB_INPUT);
      expect(jobInput).toBeDefined();
      expect(jobInput!['prov:wasAttributedTo']).toBe('submitter-1');

      // Check job entity
      const jobEntity = chain['@graph'].find(e => e['@id'] === 'job-123');
      expect(jobEntity).toBeDefined();

      // Check submission activity
      const submission = chain['@graph'].find(e => e['@type'] === DAPActivityTypes.JOB_SUBMISSION);
      expect(submission).toBeDefined();
      expect(submission!['prov:wasAssociatedWith']).toBe('submitter-1');
    });
  });

  describe('createJobCompletionRecord', () => {
    it('should create provenance for successful completion', () => {
      const chain = generator.createJobCompletionRecord(
        'job-123',
        'worker-1',
        'submitter-1',
        { output: 'hello world' },
        undefined,
        'job-123-input'
      );

      expect(chain['@graph'].length).toBeGreaterThanOrEqual(2);
      
      const result = chain['@graph'].find(e => e['@type'] === DAPEntityTypes.DAP_JOB_RESULT);
      expect(result).toBeDefined();
      expect(result!['prov:value']).toEqual({ output: 'hello world' });
      expect(result!['prov:wasAttributedTo']).toBe('worker-1');
      expect(result!['prov:wasDerivedFrom']).toBe('job-123-input');
    });

    it('should create provenance for failed completion', () => {
      const chain = generator.createJobCompletionRecord(
        'job-123',
        'worker-1',
        'submitter-1',
        undefined,
        'Task timed out'
      );

      const error = chain['@graph'].find(e => e['@id'] === 'job-123-error');
      expect(error).toBeDefined();
      expect(error!['prov:value']).toBe('Task timed out');
    });
  });

  describe('createDelegationRecord', () => {
    it('should create delegation provenance with actedOnBehalfOf', () => {
      const chain = generator.createDelegationRecord(
        'delegator-1',
        'delegatee-1',
        'code-generation',
        'job-123'
      );

      expect(chain['@graph'].length).toBe(3);
      
      const delegatee = chain['@graph'].find(e => e['@id'] === 'delegatee-1') as any;
      expect(delegatee['prov:actedOnBehalfOf']).toBeDefined();
      expect(delegatee['prov:actedOnBehalfOf']['prov:agent']).toBe('delegator-1');
    });
  });

  describe('mergeChains', () => {
    it('should merge multiple provenance chains', () => {
      const chain1 = generator.createAgentRegistrationRecord('agent-1', ['code-generation']);
      const chain2 = generator.createJobSubmissionRecord('job-1', 'agent-1', 'code-generation', {});
      
      const merged = generator.mergeChains(chain1, chain2);

      expect(merged['@context'].length).toBeGreaterThanOrEqual(2);
      expect(merged['@graph'].length).toBeGreaterThanOrEqual(4);
    });
  });
});

describe('JobQueue with Provenance', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue(`/tmp/test-provenance-${Date.now()}`);
  });

  it('should generate provenance on job submission', () => {
    const job = queue.submit('agent-1', 'code-generation', 5, { prompt: 'test' });

    expect(job.provenance).toBeDefined();
    expect(job.provenance!.submission).toBeDefined();
    expect(job.provenance!.submission['@graph']).toBeDefined();
    expect(job.provenance!.submission['@graph'].length).toBeGreaterThan(0);
  });

  it('should generate provenance on job claim', () => {
    const job = queue.submit('agent-1', 'code-generation', 5, {});
    queue.claim(job.job_id, 'agent-2');

    const updated = queue.get(job.job_id);
    expect(updated!.provenance!.claim).toBeDefined();
    expect(updated!.provenance!.claim['@graph'].some(
      (e: any) => e['prov:wasAssociatedWith'] === 'agent-2'
    )).toBe(true);
  });

  it('should query provenance by submitting and claiming agents', () => {
    const job = queue.submit('agent-1', 'code-generation', 5, {});
    queue.claim(job.job_id, 'agent-2');

    const submitted = queue.queryByAgent('agent-1');
    const claimed = queue.queryByAgent('agent-2');

    expect(submitted.map(record => record.entity)).toContain(job.job_id);
    expect(claimed.map(record => record.entity)).toContain(job.job_id);
    expect(queue.queryByAgent('agent-3')).toEqual([]);
  });

  it('should generate provenance on job completion', () => {
    const job = queue.submit('agent-1', 'code-generation', 5, {});
    queue.claim(job.job_id, 'agent-2');
    queue.start(job.job_id);
    queue.complete(job.job_id, { result: 'success' });

    const updated = queue.get(job.job_id);
    expect(updated!.provenance!.completion).toBeDefined();
  });

  it('should generate provenance on job failure', () => {
    const job = queue.submit('agent-1', 'code-generation', 5, {});
    queue.claim(job.job_id, 'agent-2');
    queue.start(job.job_id);
    queue.fail(job.job_id, 'Timeout');

    const updated = queue.get(job.job_id);
    expect(updated!.provenance!.completion).toBeDefined();
  });

  it('should preserve provenance through restart', async () => {
    const testDir = `/tmp/test-provenance-restart-${Date.now()}`;
    const queue = new JobQueue(testDir);
    
    queue.submit('agent-1', 'code-generation', 5, { test: true });
    await queue.forceSave();

    // Create new instance with SAME directory to test persistence
    const queue2 = new JobQueue(testDir);
    const job = queue2.getBySubmitter('agent-1')[0];
    
    expect(job).toBeDefined();
    expect(job.provenance).toBeDefined();
    expect(job.provenance!.submission['@graph']).toHaveLength(3);
  });
});

describe('AgentRegistry with Provenance', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry('./shapes', { testMode: true });
  });

  it('should generate provenance on agent registration', () => {
    registry.register('agent-1', {
      agent_id: 'agent-1',
      capabilities: ['code-generation'],
      os: 'linux',
      version: '1.0.0',
    }, {} as any, [{ name: 'code-generation' }]);

    const agent = registry.get('agent-1');
    expect(agent!.provenance).toBeDefined();
    expect(agent!.provenance!.registeredAt).toBeDefined();
    expect(agent!.provenance!.capabilities['@graph']).toBeDefined();
  });

  it('should track activity count on heartbeat', () => {
    registry.register('agent-1', {
      agent_id: 'agent-1',
      capabilities: [],
    }, {} as any, []);

    const initialCount = registry.get('agent-1')!.provenance!.activityCount;
    registry.updateHeartbeat('agent-1');
    registry.updateHeartbeat('agent-1');

    expect(registry.get('agent-1')!.provenance!.activityCount).toBe(initialCount + 2);
  });
});
