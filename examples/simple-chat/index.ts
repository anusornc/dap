/**
 * Simple Chat Example
 * Two agents communicating in real-time
 */

import { DAPClient, DAPClientConfig } from '../src/client/dap-client.js';

async function main() {
  // Agent A - initiates conversation
  const agentAConfig: DAPClientConfig = {
    relayUrl: process.env.RELAY_URL || 'ws://localhost:3000/ws',
    agentId: 'agent-alpha',
    apiKey: process.env.API_KEY,
    capabilities: [
      { name: 'chat', version: '1.0.0', maxConcurrent: 5 },
      { name: 'coordinator', version: '1.0.0', maxConcurrent: 1 },
    ],
    metadata: { role: 'initiator' },
  };

  // Agent B - responds to messages
  const agentBConfig: DAPClientConfig = {
    relayUrl: process.env.RELAY_URL || 'ws://localhost:3000/ws',
    agentId: 'agent-beta',
    apiKey: process.env.API_KEY,
    capabilities: [
      { name: 'chat', version: '1.0.0', maxConcurrent: 5 },
      { name: 'data-analysis', version: '1.0.0', maxConcurrent: 2 },
    ],
    metadata: { role: 'responder' },
  };

  // Create clients
  const agentA = new DAPClient(agentAConfig);
  const agentB = new DAPClient(agentBConfig);

  // Set up message handlers
  agentB.on('request', async (msg) => {
    console.log(`[Agent B] Received from ${msg.from.agent_id}: ${msg.payload.data.description}`);

    // Respond with analysis result
    const result = await simulateAnalysis(msg.payload.data.description);

    console.log(`[Agent B] Sending response to ${msg.from.agent_id}`);
  });

  // Connect both agents
  console.log('[Example] Connecting Agent A...');
  await agentA.connect();
  console.log('[Example] Agent A connected');

  console.log('[Example] Connecting Agent B...');
  await agentB.connect();
  console.log('[Example] Agent B connected');

  // Agent A sends a message to Agent B
  console.log('\n[Example] Agent A sending request to Agent B...');
  const result = await agentA.sendRequest('agent-beta', {
    description: 'Analyze the sales data from Q1 and provide insights',
    type: 'data-analysis',
    context: {
      dataSource: 'sales-db',
      quarter: 'Q1',
    },
  });

  console.log('\n[Example] Result:', {
    success: result.success,
    result: result.result,
    error: result.error,
    executionTimeMs: result.executionTimeMs,
  });

  // Clean up
  await agentA.disconnect();
  await agentB.disconnect();

  console.log('\n[Example] Done!');
}

async function simulateAnalysis(description: string): Promise<{ insights: string[] }> {
  // Simulate some processing time
  await new Promise(resolve => setTimeout(resolve, 500));

  return {
    insights: [
      'Revenue increased by 15% compared to previous quarter',
      'Top performing product: Widget Pro',
      'Customer retention rate: 87%',
    ],
  };
}

main().catch(console.error);