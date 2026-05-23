import { JobQueue } from './src/relay/job-queue.js';

async function run() {
  const queue = new JobQueue('/tmp/test-jobs');

  // Disable saving to avoid IO bottleneck during benchmark setup
  (queue as any).scheduleSave = () => {};

  // Create 10,000 jobs
  console.log("Submitting 10,000 jobs...");
  for (let i = 0; i < 10000; i++) {
    const job = queue.submit(`submitter-${i % 100}`, `type-${i % 10}`, 1, { data: i });
    // claim 10% of them
    if (i % 10 === 0) {
      queue.claim(job.job_id, `agent-${i % 100}`);
    }
  }

  console.log(`Measuring getByAgent...`);

  const start = process.hrtime.bigint();

  let totalMatches = 0;
  for (let i = 0; i < 10000; i++) {
    const matches = queue.getByAgent(`agent-${i % 100}`);
    totalMatches += matches.length;
  }

  const end = process.hrtime.bigint();
  const timeMs = Number(end - start) / 1_000_000;

  console.log(`Found ${totalMatches} total matches in 10000 queries.`);
  console.log(`Time taken: ${timeMs.toFixed(2)} ms`);
}

run().catch(console.error);
