/**
 * Job Queue Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue, JobFilter } from '../src/relay/job-queue.js';
import { JobStatus } from '../src/protocol/types.js';

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    // Use unique temp dir for each test
    queue = new JobQueue(`/tmp/test-jobs-${Date.now()}-${Math.random()}`);
  });

  describe('submit', () => {
    it('should create a job with pending status', () => {
      const job = queue.submit('agent-1', 'code-review', 5, { repo: 'test' });

      expect(job.job_id).toBeDefined();
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.type).toBe('code-review');
      expect(job.submitter).toBe('agent-1');
      expect(job.priority).toBe(5);
    });

    it('should create jobs with different priorities', () => {
      const job1 = queue.submit('agent-1', 'task', 1, {});
      const job2 = queue.submit('agent-2', 'task', 10, {});

      expect(job1.priority).toBeLessThan(job2.priority);
    });

    it('should index jobs by type and capability', () => {
      queue.submit('agent-1', 'code-review', 5, { pr: 1 }, 'code-review');
      queue.submit('agent-2', 'data-analysis', 5, {}, 'data-analysis');

      const available = queue.findAvailable('code-review');
      expect(available).not.toBeNull();
      expect(available?.type).toBe('code-review');
    });
  });

  describe('claim', () => {
    it('should change job status to claimed', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      const claimed = queue.claim(job.job_id, 'agent-2');

      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe(JobStatus.CLAIMED);
      expect(claimed?.claimed_by).toBe('agent-2');
    });

    it('should not claim already claimed jobs', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      const result = queue.claim(job.job_id, 'agent-3');

      expect(result).toBeNull();
    });

    it('should not claim completed jobs', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, { result: 'done' });

      const result = queue.claim(job.job_id, 'agent-3');
      expect(result).toBeNull();
    });
  });

  describe('start', () => {
    it('should change claimed job to in-progress', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      const started = queue.start(job.job_id);

      expect(started).not.toBeNull();
      expect(started?.status).toBe(JobStatus.IN_PROGRESS);
    });

    it('should not start pending jobs directly', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      const result = queue.start(job.job_id);

      expect(result).toBeNull();
    });
  });

  describe('complete', () => {
    it('should mark job as completed with result', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      const completed = queue.complete(job.job_id, { review: 'LGTM' });

      expect(completed).not.toBeNull();
      expect(completed?.status).toBe(JobStatus.COMPLETED);
      expect(completed?.result).toEqual({ review: 'LGTM' });
      expect(completed?.completed_at).toBeDefined();
    });

    it('should not complete pending jobs', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      const result = queue.complete(job.job_id, {});

      expect(result).toBeNull();
    });
  });

  describe('fail', () => {
    it('should mark job as failed with error', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      const failed = queue.fail(job.job_id, 'Timeout exceeded');

      expect(failed).not.toBeNull();
      expect(failed?.status).toBe(JobStatus.FAILED);
      expect(failed?.error).toBe('Timeout exceeded');
    });
  });

  describe('cancel', () => {
    it('should cancel pending job', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      const cancelled = queue.cancel(job.job_id, 'User cancelled');

      expect(cancelled).not.toBeNull();
      expect(cancelled?.status).toBe(JobStatus.CANCELLED);
      expect(cancelled?.error).toBe('User cancelled');
    });

    it('should not cancel completed jobs', () => {
      const job = queue.submit('agent-1', 'task', 5, {});
      queue.claim(job.job_id, 'agent-2');
      queue.start(job.job_id);
      queue.complete(job.job_id, {});

      const result = queue.cancel(job.job_id, 'Too late');
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    beforeEach(() => {
      queue.submit('agent-1', 'code-review', 5, { pr: 1 });
      queue.submit('agent-2', 'code-review', 3, { pr: 2 });
      queue.submit('agent-3', 'data-analysis', 5, {});
    });

    it('should filter by status', () => {
      const pending = queue.query({ status: JobStatus.PENDING });
      expect(pending.length).toBe(3);
    });

    it('should filter by type', () => {
      const reviews = queue.query({ type: 'code-review' });
      expect(reviews.length).toBe(2);
    });

    it('should sort by priority', () => {
      const jobs = queue.query({ type: 'code-review' });
      expect(jobs[0].priority).toBeLessThanOrEqual(jobs[1].priority);
    });

    it('should support pagination', () => {
      const first = queue.query({ limit: 1, offset: 0 });
      expect(first.length).toBe(1);

      const second = queue.query({ limit: 1, offset: 1 });
      expect(second.length).toBe(1);
      expect(second[0].job_id).not.toBe(first[0].job_id);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      queue.submit('agent-1', 'code-review', 5, {});
      queue.submit('agent-2', 'data-analysis', 5, {});

      const stats = queue.getStats();
      expect(stats.totalJobs).toBe(2);
      expect(stats.byType['code-review']).toBe(1);
      expect(stats.byType['data-analysis']).toBe(1);
      expect(stats.byStatus['pending']).toBe(2);
    });
  });

  describe('persistence', () => {
    it('should survive restart', () => {
      const dataDir = `/tmp/test-persistence-${Date.now()}-${Math.random()}`;
      const queue1 = new JobQueue(dataDir);
      queue1.submit('agent-1', 'test-task', 5, { data: 'test' });
      queue1.forceSave();

      const queue2 = new JobQueue(dataDir);
      const job = queue2.query({ type: 'test-task' })[0];

      expect(job).toBeDefined();
      expect(job?.payload).toEqual({ data: 'test' });
    });

    it('should handle missing data directory', () => {
      const queue = new JobQueue('/tmp/nonexistent-dir');
      expect(() => queue.submit('agent', 'task', 5, {})).not.toThrow();
    });
  });
});