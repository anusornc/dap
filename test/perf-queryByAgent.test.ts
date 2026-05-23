import { test, expect } from 'vitest';
import { JobQueue } from '../src/relay/job-queue.ts';

test('benchmark queryByAgent', () => {
  const queue = new JobQueue('./perf-data-5');
  (queue as any).scheduleSave = () => {};

  const totalJobs = 100000;
  console.log(`Adding ${totalJobs} jobs...`);

  const targetAgentId = 'agent-123';

  for (let i = 0; i < totalJobs; i++) {
    const submitter = i % 50 === 0 ? targetAgentId : `user-${i % 50}`;
    const job = queue.submit(submitter, 'test-type', 1, { data: i });

    if (i % 200 === 0) {
      queue.claim(job.job_id, targetAgentId);
    } else if (i % 10 === 0) {
      queue.claim(job.job_id, `agent-${i % 20}`);
    }
  }

  console.log('Running benchmark for queryByAgent...');

  // Baseline
  const start = performance.now();
  const records = queue.queryByAgent(targetAgentId);
  const end = performance.now();

  console.log(`Found ${records.length} records in ${end - start} ms`);
  expect(records.length).toBeGreaterThan(0);
});
