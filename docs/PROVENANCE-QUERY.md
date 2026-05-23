# Provenance Query API

PROV-O compliant provenance tracking for job execution and agent activity tracing.

## Overview

The Provenance Query API enables root-cause tracing and activity analysis through the PROV-O provenance chain. It provides query methods for jobs and agents, REST endpoints for HTTP access, and a `ProvenanceQuery` class for complex analysis.

## ProvenanceRecord Shape

```typescript
interface ProvenanceRecord {
  entity: string;        // URI of the thing being described
  activity: string;      // What happened (e.g., "dap:JobSubmission")
  timestamp: string;     // ISO 8601 timestamp
  agentId: string;       // Agent responsible
  metadata: object;      // Additional context
  generatedAt: string;   // ISO 8601 when record was created
}
```

## JobQueue Methods

### getProvenance(jobId: string): ProvenanceRecord[]

Returns all provenance records for a specific job, sorted by timestamp.

```typescript
const records = queue.getProvenance('job-123');
// Returns: [{ entity: 'job-123', activity: 'dap:JobSubmission', ... }, ...]
```

### queryByAgent(agentId: string, from?: Date, to?: Date): ProvenanceRecord[]

Query provenance records by agent ID, optionally filtered by date range.

```typescript
const records = queue.queryByAgent('agent-1', new Date('2026-01-01'), new Date());
```

### queryByActivity(activity: string, from?: Date, to?: Date): ProvenanceRecord[]

Query provenance records by activity type.

```typescript
const records = queue.queryByActivity('JobExecution');
```

### getProvenanceStats(): ProvenanceStats

Returns aggregate statistics.

```typescript
const stats = queue.getProvenanceStats();
// {
//   totalRecords: 42,
//   byActivity: { 'dap:JobSubmission': 10, ... },
//   byAgent: { 'agent-1': 15, ... },
//   timeRange: { earliest: '2026-01-01T...', latest: '2026-05-21T...' }
// }
```

## AgentRegistry Methods

### getAgentProvenance(agentId: string): ProvenanceRecord[]

Returns all provenance records for an agent (registration + heartbeats).

### getRegistrationChain(agentId: string): ProvenanceRecord[]

Returns the registration chain: registration event + all heartbeats.

## REST Endpoints

### GET /jobs/:jobId/provenance

Returns array of ProvenanceRecord for the job.

```bash
curl http://localhost:8080/jobs/abc-123/provenance
```

### GET /jobs/:jobId/trace

Returns human-readable execution timeline.

```bash
curl http://localhost:8080/jobs/abc-123/trace
```

Response:
```json
{
  "jobId": "abc-123",
  "trace": [
    {
      "step": 1,
      "timestamp": "2026-05-21T10:00:00Z",
      "activity": "JOB_SUBMISSION",
      "description": "Job submitted by agent-1",
      "agentId": "agent-1"
    },
    ...
  ]
}
```

### GET /agents/:agentId/provenance

Returns agent's provenance chain.

### GET /provenance/stats

Returns aggregate provenance statistics.

### GET /provenance?agentId=<id>&from=<date>&to=<date>

Query provenance with filters.

## ProvenanceQuery Class

```typescript
import { ProvenanceQuery } from './provenance/index.js';

const query = new ProvenanceQuery(jobQueue, agentRegistry);
```

### trace(jobId: string): TraceStep[]

Rebuilds full execution timeline from provenance chain.

### findRootCause(jobId: string): string

Identifies which step failed and returns the error description.

```typescript
const cause = query.findRootCause('job-123');
// "Error: Connection timeout"
```

### getActivityTimeline(agentId: string, range?: DateRange): TimelineEvent[]

Returns chronological activity events for an agent.

### formatTraceTimeline(trace: TraceStep[]): string

Formats trace as human-readable text.

## Example: Full Job Trace

```typescript
const job = queue.submit('client-1', 'code-generation', 5, { prompt: 'Hello' });
queue.claim(job.job_id, 'worker-1');
queue.start(job.job_id);
// ... work happens ...
queue.complete(job.job_id, { output: 'Hello, World!' });

// Get trace
const trace = query.trace(job.job_id);
// [
//   { step: 1, activity: 'JOB_SUBMISSION', description: 'Job submitted by client-1', ... },
//   { step: 2, activity: 'JOB_CLAIM', description: 'Job claimed by worker-1', ... },
//   { step: 3, activity: 'JOB_COMPLETED', description: 'Job completed successfully', ... }
// ]

// Find root cause if failed
const cause = query.findRootCause(job.job_id);
```

## Example: Agent Activity Analysis

```typescript
// Get all activity for an agent today
const today = new Date();
today.setHours(0, 0, 0, 0);

const timeline = query.getActivityTimeline('worker-1', {
  from: today,
  to: new Date()
});

// Print human-readable report
const trace = query.trace(failedJobId);
console.log(query.formatTraceTimeline(trace));
```