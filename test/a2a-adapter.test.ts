import { describe, expect, it } from 'vitest';
import { MessageAction, AgentCard, DAPMessage } from '../src/protocol/types.js';
import {
  A2AAgentCardSchema,
  A2AJsonRpcErrorCode,
  A2AJsonRpcResponseSchema,
} from '../src/a2a/types.js';
import {
  dapAgentCardToA2A,
  dapReplyToA2AMessage,
  jsonRpcError,
  messageSendParamsToDapTask,
} from '../src/a2a/adapter.js';

describe('A2A adapter', () => {
  const dapCard: AgentCard = {
    id: 'codex-mac',
    type: 'AgentCard',
    name: 'codex-mac',
    description: 'Mac Codex worker',
    capabilities: [
      { name: 'refactoring', version: '1.0.0', description: 'Refactor code' },
      { name: 'documentation', version: '1.0.0' },
    ],
    version: '1.0.0',
    protocolVersion: '1.0.0',
    shimType: 'codex',
    endpoints: {},
    status: 'active',
    '@context': 'https://dap-protocol.org/ns/agent-card-context.json',
  };

  it('maps DAP agent cards to A2A-shaped cards without claiming streaming', () => {
    const card = dapAgentCardToA2A(dapCard, {
      baseUrl: 'http://127.0.0.1:3000',
      requiresApiKey: true,
    });

    expect(A2AAgentCardSchema.parse(card)).toMatchObject({
      protocolVersion: '0.3.0',
      name: 'codex-mac',
      url: 'http://127.0.0.1:3000/a2a/agents/codex-mac',
      preferredTransport: 'JSONRPC',
      capabilities: {
        streaming: false,
      },
      securitySchemes: {
        apiKey: {
          name: 'x-api-key',
        },
      },
    });
    expect(card.skills.map(skill => skill.id)).toEqual(['refactoring', 'documentation']);
  });

  it('converts A2A message/send params to a DAP task payload', () => {
    const task = messageSendParamsToDapTask({
      message: {
        role: 'user',
        parts: [
          { kind: 'text', text: 'Please inspect this repo.' },
          { kind: 'data', data: { path: 'src/relay/server.ts' } },
        ],
        messageId: 'msg-1',
        kind: 'message',
        metadata: { skillId: 'code-review' },
      },
      metadata: { targetAgentId: 'codex-mac' },
    });

    expect(task).toMatchObject({
      description: 'Please inspect this repo.',
      type: 'code-review',
      context: {
        dataParts: [{ path: 'src/relay/server.ts' }],
      },
    });
  });

  it('converts DAP replies to A2A agent messages', () => {
    const reply: DAPMessage = {
      version: '1.0.0',
      msg_id: 'reply-1',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'codex-mac', capabilities: ['documentation'] },
      to: { agent_id: 'a2a-gateway' },
      action: MessageAction.RESPONSE,
      payload: {
        type: 'result',
        data: { success: true, result: { ok: true } },
      },
      reply_to: 'request-1',
    };

    const message = dapReplyToA2AMessage(reply, {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'go' }],
        messageId: 'a2a-msg-1',
        taskId: 'task-1',
        contextId: 'ctx-1',
        kind: 'message',
      },
    });

    expect(message).toMatchObject({
      role: 'agent',
      messageId: 'reply-1',
      taskId: 'task-1',
      contextId: 'ctx-1',
      parts: [{ kind: 'data', data: { result: { ok: true } } }],
      kind: 'message',
    });
  });

  it('creates valid JSON-RPC error responses', () => {
    const response = jsonRpcError('req-1', A2AJsonRpcErrorCode.METHOD_NOT_FOUND, 'Nope');

    expect(A2AJsonRpcResponseSchema.parse(response)).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: -32601,
        message: 'Nope',
      },
    });
  });
});
