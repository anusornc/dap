import { JobQueue } from './dist/relay/job-queue.js';

async function run() {
  const queue = new JobQueue();

  // Create 100,000 jobs
  console.log("Submitting 100,000 jobs...");
  for (let i = 0; i < 100000; i++) {
    const job = queue.submit(`submitter-${i % 100}`, `type-${i % 10}`, 1, { data: i });
    // claim 10% of them
    if (i % 10 === 0) {
      queue.claim(job.job_id, `agent-${i % 1000}`);
    }
  }

  // Measure getByAgent
  const targetAgent = 'agent-500';
  console.log(`Measuring getByAgent for ${targetAgent}...`);

  const start = process.hrtime.bigint();

  let totalMatches = 0;
  for (let i = 0; i < 1000; i++) {
    const matches = queue.getByAgent(`agent-${i}`);
    totalMatches += matches.length;
  }

  const end = process.hrtime.bigint();
  const timeMs = Number(end - start) / 1_000_000;

  console.log(`Found ${totalMatches} total matches in 1000 queries.`);
  console.log(`Time taken: ${timeMs.toFixed(2)} ms`);
}

run().catch(console.error);
