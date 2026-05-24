/**
 * Message Builders Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createRequest,
  createResponse,
  createHeartbeat,
  createJobSubmission,
  createJobComplete,
  createBroadcast,
  parseMessage
} from '../src/protocol/messages.js';

describe('createRequest', () => {
  it('should create a valid request message', () => {
    const from = { agent_id: 'agent-1', capabilities: ['code-review'] };
    const msg = createRequest(from, 'agent-2', 'Review PR #42', 'code-review');

    expect(msg.version).toBe('1.0.0');
    expect(msg.msg_id).toBeDefined();
    expect(msg.from.agent_id).toBe('agent-1');
    expect(msg.to).toEqual({ agent_id: 'agent-2' });
    expect(msg.action).toBe('request');
    expect(msg.payload.type).toBe('task-delegation');
    expect(msg.payload.data.description).toBe('Review PR #42');
    expect(msg.payload.data.type).toBe('code-review');
  });

  it('should include reply_to when provided', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const originalMsgId = 'original-123';
    const msg = createRequest(from, 'agent-2', 'task', 'general', originalMsgId);

    expect(msg.reply_to).toBe(originalMsgId);
  });
});

describe('createResponse', () => {
  it('should create a success response', () => {
    const from = { agent_id: 'agent-2', capabilities: [] };
    const msg = createResponse(from, 'reply-123', { result: 'done' }, true);

    expect(msg.action).toBe('response');
    expect(msg.payload.type).toBe('result');
    expect(msg.payload.data.success).toBe(true);
    expect(msg.payload.data.result).toEqual({ result: 'done' });
    expect(msg.reply_to).toBe('reply-123');
  });

  it('should create an error response', () => {
    const from = { agent_id: 'agent-2', capabilities: [] };
    const msg = createResponse(from, 'reply-123', null, false, 'Task failed');

    expect(msg.payload.data.success).toBe(false);
    expect(msg.payload.data.error).toBe('Task failed');
  });
});

describe('createHeartbeat', () => {
  it('should create heartbeat with status', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createHeartbeat(from, 'healthy');

    expect(msg.action).toBe('heartbeat');
    expect(msg.payload.type).toBe('heartbeat');
    expect(msg.payload.data.status).toBe('healthy');
  });

  it('should default to healthy status', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createHeartbeat(from);

    expect(msg.payload.data.status).toBe('healthy');
  });
});

describe('createJobSubmission', () => {
  it('should create a job submission', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createJobSubmission(from, 'code-review', 5, { pr: 42 });

    expect(msg.action).toBe('job-submission');
    expect(msg.payload.type).toBe('job-submission');
    expect(msg.payload.data.type).toBe('code-review');
    expect(msg.payload.data.priority).toBe(5);
    expect(msg.payload.data.payload).toEqual({ pr: 42 });
    expect(msg.to).toEqual({ topic: 'task-queue:code-review' });
  });

  it('should include capability requirement', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createJobSubmission(from, 'data-analysis', 3, { query: 'test' }, 'data-analysis');

    expect(msg.payload.data.capabilityRequired).toBe('data-analysis');
  });
});

describe('createJobComplete', () => {
  it('should create a success completion', () => {
    const from = { agent_id: 'agent-2', capabilities: [] };
    const msg = createJobComplete(from, 'job-123', { review: 'LGTM' }, true);

    expect(msg.action).toBe('job-complete');
    expect(msg.payload.data.jobId).toBe('job-123');
    expect(msg.payload.data.success).toBe(true);
    expect(msg.payload.data.result).toEqual({ review: 'LGTM' });
  });

  it('should create a failure completion', () => {
    const from = { agent_id: 'agent-2', capabilities: [] };
    const msg = createJobComplete(from, 'job-123', null, false, 'Timeout');

    expect(msg.payload.data.success).toBe(false);
    expect(msg.payload.data.error).toBe('Timeout');
  });
});

describe('createBroadcast', () => {
  it('should create a broadcast message', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createBroadcast(from, 'System alert');

    expect(msg.to).toBe('broadcast');
    expect(msg.action).toBe('event');
    expect(msg.payload.data.message).toBe('System alert');
  });

  it('should target specific capability', () => {
    const from = { agent_id: 'agent-1', capabilities: [] };
    const msg = createBroadcast(from, 'Request for code reviewers', 'code-review');

    expect(msg.to).toEqual({ capability: 'code-review' });
  });
});

describe('parseMessage', () => {
  it('should parse valid JSON', () => {
    const raw = {
      version: '1.0.0',
      msg_id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'agent-1', capabilities: [] },
      to: { agent_id: 'agent-2' },
      action: 'request',
      payload: { type: 'task-delegation', data: {} }
    };

    const result = parseMessage(raw);
    expect(result).not.toBeNull();
    expect(result?.msg_id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should return null for invalid JSON', () => {
    const result = parseMessage('not json');
    expect(result).toBeNull();
  });

  it('should return null for null input', () => {
    const result = parseMessage(null);
    expect(result).toBeNull();
  });

  it('should return null for missing required fields', () => {
    const result = parseMessage({ foo: 'bar' });
    expect(result).toBeNull();
  });

  it('should return null when JSON.stringify throws an error (e.g. cyclic reference)', () => {
    const obj: any = { version: '1.0.0', msg_id: '123', action: 'request', payload: {} };
    obj.self = obj; // Create a cyclic reference
    const result = parseMessage(obj);
    expect(result).toBeNull();
  });
});