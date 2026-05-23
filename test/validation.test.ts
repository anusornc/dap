/**
 * Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { validateMessage, validateApiKey, sanitizeAgentId, checkRateLimit, sanitizeMessage } from '../src/protocol/validation.js';
import { DAPMessageSchema } from '../src/protocol/types.js';

describe('validateMessage', () => {
  it('should validate a correct message', () => {
    const validMsg = {
      version: '1.0.0',
      msg_id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'agent-1', capabilities: ['code-review'] },
      to: { agent_id: 'agent-2' },
      action: 'request',
      payload: { type: 'task-delegation', data: { description: 'test' } }
    };

    const result = validateMessage(validMsg);
    expect(result.success).toBe(true);
  });

  it('should reject invalid version', () => {
    const invalidMsg = {
      version: '99.0.0',
      msg_id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'agent-1', capabilities: [] },
      to: { agent_id: 'agent-2' },
      action: 'request',
      payload: { type: 'task-delegation', data: {} }
    };

    const result = validateMessage(invalidMsg);
    expect(result.success).toBe(false);
  });

  it('should reject invalid UUID', () => {
    const invalidMsg = {
      version: '1.0.0',
      msg_id: 'not-a-uuid',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'agent-1', capabilities: [] },
      to: { agent_id: 'agent-2' },
      action: 'request',
      payload: { type: 'task-delegation', data: {} }
    };

    const result = validateMessage(invalidMsg);
    expect(result.success).toBe(false);
  });

  it('should reject missing action', () => {
    const invalidMsg = {
      version: '1.0.0',
      msg_id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: new Date().toISOString(),
      from: { agent_id: 'agent-1', capabilities: [] },
      to: { agent_id: 'agent-2' },
      action: 'invalid-action',
      payload: { type: 'task-delegation', data: {} }
    };

    const result = validateMessage(invalidMsg);
    expect(result.success).toBe(false);
  });

  it('should accept null input gracefully', () => {
    const result = validateMessage(null);
    expect(result.success).toBe(false);
  });
});

describe('validateApiKey', () => {
  it('should validate matching key', () => {
    const validKeys = ['key1', 'key2', 'key3'];
    expect(validateApiKey('key1', validKeys)).toBe(true);
    expect(validateApiKey('key2', validKeys)).toBe(true);
  });

  it('should reject non-matching key', () => {
    const validKeys = ['key1', 'key2'];
    expect(validateApiKey('key3', validKeys)).toBe(false);
  });

  it('should reject undefined key', () => {
    expect(validateApiKey(undefined, ['key1'])).toBe(false);
  });

  it('should handle empty key list', () => {
    expect(validateApiKey('any-key', [])).toBe(false);
  });
});

describe('sanitizeAgentId', () => {
  it('should allow alphanumeric and dash/underscore', () => {
    expect(sanitizeAgentId('agent-123')).toBe('agent-123');
    expect(sanitizeAgentId('my_agent_1')).toBe('my_agent_1');
    expect(sanitizeAgentId('Agent-ABC')).toBe('Agent-ABC');
  });

  it('should remove invalid characters', () => {
    expect(sanitizeAgentId('agent@123!')).toBe('agent123');
    expect(sanitizeAgentId('my agent')).toBe('myagent');
    expect(sanitizeAgentId('test/file')).toBe('testfile');
  });

  it('should truncate to 64 characters', () => {
    const longId = 'a'.repeat(100);
    expect(sanitizeAgentId(longId).length).toBe(64);
  });

  it('should handle empty string', () => {
    expect(sanitizeAgentId('')).toBe('');
  });

  it('should remove emojis and non-ASCII characters', () => {
    expect(sanitizeAgentId('agent🚀123')).toBe('agent123');
    expect(sanitizeAgentId('agent-日本')).toBe('agent-');
    expect(sanitizeAgentId('agëñt')).toBe('agt');
  });

  it('should handle exactly 64 characters correctly', () => {
    const exactly64 = 'a'.repeat(64);
    expect(sanitizeAgentId(exactly64)).toBe(exactly64);
    expect(sanitizeAgentId(exactly64).length).toBe(64);
  });
});

describe('sanitizeMessage', () => {
  it('should return empty string for non-string inputs', () => {
    expect(sanitizeMessage(null as any)).toBe('');
    expect(sanitizeMessage(undefined as any)).toBe('');
    expect(sanitizeMessage(123 as any)).toBe('');
    expect(sanitizeMessage({} as any)).toBe('');
  });

  it('should allow valid strings without modification', () => {
    const validStr = 'Hello, World! This is a valid message 123.';
    expect(sanitizeMessage(validStr)).toBe(validStr);
  });

  it('should truncate strings exceeding default max length of 10000', () => {
    const longMsg = 'a'.repeat(15000);
    const sanitized = sanitizeMessage(longMsg);
    expect(sanitized.length).toBe(10000);
    expect(sanitized).toBe('a'.repeat(10000));
  });

  it('should truncate strings based on custom max length', () => {
    const msg = '1234567890';
    expect(sanitizeMessage(msg, 5)).toBe('12345');
  });

  it('should remove control characters', () => {
    const msgWithControlChars = 'Hello\x00World\x1FTest\x7F!';
    expect(sanitizeMessage(msgWithControlChars)).toBe('HelloWorldTest!');
  });
});

describe('checkRateLimit', () => {
  it('should allow first request', () => {
    const uniqueKey = `test-key-${Date.now()}-${Math.random()}`;
    const result = checkRateLimit(uniqueKey, 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('should track request count', () => {
    const uniqueKey = `test-key-track-${Date.now()}-${Math.random()}`;
    checkRateLimit(uniqueKey, 10, 60000);
    checkRateLimit(uniqueKey, 10, 60000);
    const result = checkRateLimit(uniqueKey, 10, 60000);

    expect(result.remaining).toBe(7);
  });

  it('should block when limit exceeded', () => {
    const uniqueKey = `test-key-block-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      checkRateLimit(uniqueKey, 10, 60000);
    }

    const result = checkRateLimit(uniqueKey, 10, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track different keys separately', () => {
    const key1 = `key1-${Date.now()}-${Math.random()}`;
    const key2 = `key2-${Date.now()}-${Math.random()}`;
    checkRateLimit(key1, 5, 60000);
    checkRateLimit(key1, 5, 60000);

    const result1 = checkRateLimit(key1, 5, 60000);
    const result2 = checkRateLimit(key2, 5, 60000);

    expect(result1.remaining).toBe(2);
    expect(result2.remaining).toBe(4);
  });
});