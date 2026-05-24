import { describe, it } from 'vitest';
import { AgentRegistry } from '../src/relay/agent-registry.js';

describe('AgentRegistry Performance', () => {
  it('should measure getBySocket performance', () => {
    const registry = new AgentRegistry(undefined, { testMode: true });

    const numAgents = 10000;
    const sockets = [];

    // override console.log to suppress spam
    const originalLog = console.log;
    console.log = () => {};

    for (let i = 0; i < numAgents; i++) {
      const socket = { id: i };
      sockets.push(socket);
      registry.register(`agent-${i}`, { name: `Agent ${i}`, os: 'linux', version: '1.0' } as any, socket, []);
    }

    console.log = originalLog;

    const start = process.hrtime.bigint();

    let found = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const randomSocket = sockets[Math.floor(Math.random() * numAgents)];
      const agent = registry.getBySocket(randomSocket);
      if (agent) found++;
    }

    const end = process.hrtime.bigint();
    const timeMs = Number(end - start) / 1_000_000;

    console.log(`Found ${found} agents in ${timeMs.toFixed(2)} ms`);
    console.log(`Average time per lookup: ${(timeMs / iterations).toFixed(4)} ms`);
  });
});
