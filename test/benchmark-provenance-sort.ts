import { AgentRegistry, SimplifiedProvenanceRecord } from '../src/relay/agent-registry.js';
import { AgentInfo } from '../src/protocol/types.js';
import { performance } from 'perf_hooks';

const registry = new AgentRegistry('./shapes', { testMode: true });

const agentId = 'bench-agent-1';
registry.register(agentId, { agent_id: agentId, capabilities: [] } as AgentInfo, null, []);

// Add a large number of heartbeats
const numHeartbeats = 10000;
for (let i = 0; i < numHeartbeats; i++) {
  registry.updateHeartbeat(agentId);
}

// Measure performance of getAgentProvenance
const numTrials = 100;
let totalTime = 0;

for (let i = 0; i < numTrials; i++) {
  const start = performance.now();
  registry.getAgentProvenance(agentId);
  const end = performance.now();
  totalTime += (end - start);
}

console.log(`Average time for getAgentProvenance (${numHeartbeats} records): ${totalTime / numTrials} ms`);
