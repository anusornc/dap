import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DAPClient, createDAPClient, DAPClientConfig } from '../src/client/dap-client.js';
import { DAPMessage, MessageAction } from '../src/protocol/types.js';

const WEBSOCKET_OPEN = 1;

// Mock WebSocket
class MockWebSocket {
  static OPEN = WEBSOCKET_OPEN;
  url: string;
  readyState: number = 0; // CONNECTING

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  send = vi.fn();
  close = vi.fn((code = 1000, reason = '') => {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code, reason });
  });

  constructor(url: string) {
    this.url = url;
    // Simulate connection delay
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }

  // Helper to simulate incoming messages
  simulateMessage(msg: Partial<DAPMessage>) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(msg) });
    }
  }
}

describe('createDAPClient', () => {
  it('should return a new DAPClient instance with the given config', () => {
    const config: DAPClientConfig = {
      relayUrl: 'ws://localhost:3000',
      agentId: 'test-agent',
      capabilities: [{ name: 'test-cap', version: '1.0.0' }],
    };

    const client = createDAPClient(config);
    expect(client).toBeInstanceOf(DAPClient);
    expect(client.getAgentId()).toBe('test-agent');
    expect(client.getCapabilitiesList()).toEqual(['test-cap']);
    expect((client as any).config.relayUrl).toBe('ws://localhost:3000');
    expect((client as any).config.reconnectIntervalMs).toBe(5000); // Check default values
    expect((client as any).config.requestTimeoutMs).toBe(60000); // Check default values
  });

  it('should override default config with provided values', () => {
    const config: DAPClientConfig = {
      relayUrl: 'ws://localhost:3000',
      agentId: 'test-agent',
      capabilities: [{ name: 'test-cap', version: '1.0.0' }],
      reconnectIntervalMs: 1000,
      requestTimeoutMs: 10000,
    };

    const client = createDAPClient(config);
    expect(client).toBeInstanceOf(DAPClient);
    expect((client as any).config.reconnectIntervalMs).toBe(1000);
    expect((client as any).config.requestTimeoutMs).toBe(10000);
  });
});

describe('DAPClient', () => {
  let originalWebSocket: any;
  let client: DAPClient;
  let config: DAPClientConfig;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket as any;

    config = {
      relayUrl: 'ws://localhost:3000',
      agentId: 'test-agent',
      capabilities: [{ name: 'test-cap', version: '1.0.0' }],
      reconnectIntervalMs: 10, // Fast for testing
      requestTimeoutMs: 50
    };
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should initialize correctly', () => {
    client = createDAPClient(config);
    expect(client).toBeInstanceOf(DAPClient);
    expect(client.getAgentId()).toBe('test-agent');
    expect(client.isConnected()).toBe(false);
  });

  describe('Connection Lifecycle', () => {
    it('should connect and send register message', async () => {
      client = createDAPClient(config);

      const connectPromise = client.connect();

      // Wait for the MockWebSocket to trigger onopen
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      // Check that it sent the register message
      const socket = (client as any).socket as MockWebSocket;
      expect(socket.send).toHaveBeenCalledTimes(1);

      const sentData = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sentData.action).toBe('register');
      expect(sentData.agentId).toBe('test-agent');
      expect(sentData.capabilities).toEqual([{ name: 'test-cap', version: '1.0.0' }]);
    });

    it('should include API key in URL if provided', async () => {
      client = createDAPClient({ ...config, apiKey: 'test-key' });
      await client.connect();

      const socket = (client as any).socket as MockWebSocket;
      expect(socket.url).toContain('token=test-key');
    });

    it('should disconnect and cleanup', async () => {
      client = createDAPClient(config);
      await client.connect();

      const socket = (client as any).socket as MockWebSocket;
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(socket.close).toHaveBeenCalled();
      expect((client as any).socket).toBeNull();
    });

    it('should attempt reconnection when socket closes unexpectedly', async () => {
      vi.useFakeTimers();
      client = createDAPClient(config);

      // We need to advance timers because connect() uses a timeout in MockWebSocket
      const connectPromise = client.connect();
      vi.advanceTimersByTime(20);
      await connectPromise;

      const firstSocket = (client as any).socket as MockWebSocket;

      // Mock reconnect logic requires waiting
      const connectSpy = vi.spyOn(client, 'connect');

      // Simulate unexpected close
      if (firstSocket.onclose) firstSocket.onclose({ code: 1006, reason: 'Abnormal Closure' });

      expect(client.isConnected()).toBe(false);

      // Fast forward past the reconnect timer (config.reconnectIntervalMs is 10)
      vi.advanceTimersByTime(15);

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      client = createDAPClient(config);
      await client.connect();
    });

    it('should route messages to registered handlers', async () => {
      const handlerSpy = vi.fn();
      client.on('request', handlerSpy);

      const socket = (client as any).socket as MockWebSocket;

      const msg = {
        action: 'request',
        msg_id: 'test-123',
        payload: { type: 'test', data: {} }
      };

      socket.simulateMessage(msg);

      // Wait a tick for async handler execution
      await new Promise(r => setTimeout(r, 0));

      expect(handlerSpy).toHaveBeenCalledTimes(1);
      expect(handlerSpy).toHaveBeenCalledWith(msg);
    });

    it('should not call handler after off() is called', async () => {
      const handlerSpy = vi.fn();
      client.on('request', handlerSpy);
      client.off('request');

      const socket = (client as any).socket as MockWebSocket;

      const msg = {
        action: 'request',
        msg_id: 'test-123',
        payload: { type: 'test', data: {} }
      };

      socket.simulateMessage(msg);

      await new Promise(r => setTimeout(r, 0));

      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      client.on('request', handler);

      const socket = (client as any).socket as MockWebSocket;
      socket.simulateMessage({ action: 'request', msg_id: '1' });

      await new Promise(r => setTimeout(r, 0));

      expect(handler).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('P2P Messaging', () => {
    beforeEach(async () => {
      client = createDAPClient(config);
      await client.connect();
    });

    it('should send events correctly', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      await client.sendEvent('agent-2', 'custom-event', { foo: 'bar' });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);

      expect(sentMsg.action).toBe('event');
      expect(sentMsg.to).toBe('agent-2');
      expect(sentMsg.payload.type).toBe('custom-event');
      expect(sentMsg.payload.data.eventType).toBe('custom-event');
      expect(sentMsg.payload.data.foo).toBe('bar');
    });

    it('should send requests and resolve when response arrives', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const requestPromise = client.sendRequest('agent-2', {
        description: 'do work',
        type: 'work'
      });

      // Get the message ID that was sent
      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);
      const msgId = sentMsg.msg_id;

      // Simulate response
      socket.simulateMessage({
        action: 'response',
        reply_to: msgId,
        payload: {
          type: 'result',
          data: { success: true, result: 'done' }
        }
      });

      const result = await requestPromise;
      expect(result.success).toBe(true);
      expect(result.result).toBe('done');
    });

    it('should send requests and resolve relay errors as failed results', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const requestPromise = client.sendRequest('missing-agent', {
        description: 'do work',
        type: 'work'
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);
      const msgId = sentMsg.msg_id;

      socket.simulateMessage({
        action: 'error',
        reply_to: msgId,
        payload: {
          type: 'error-report',
          data: {
            success: false,
            error: 'Agent not found or offline'
          }
        }
      });

      const result = await requestPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent not found or offline');
    });

    it('should reject requests on timeout', async () => {
      vi.useFakeTimers();

      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const requestPromise = client.sendRequest('agent-2', {
        description: 'do work',
        type: 'work'
      }, 100); // 100ms timeout

      vi.advanceTimersByTime(150);

      await expect(requestPromise).rejects.toThrow(/timeout/i);
    });
  });

  describe('Job Queue & Capability Discovery', () => {
    beforeEach(async () => {
      client = createDAPClient(config);
      await client.connect();
    });

    it('should submit jobs correctly', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const payload = { url: 'http://example.com' };
      const jobId = await client.submitJob('crawl', payload, {
        priority: 8,
        capabilityRequired: 'crawler'
      });

      expect(jobId).toBeDefined();
      expect(socket.send).toHaveBeenCalledTimes(1);

      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sentMsg.action).toBe('job-submission');
      expect(sentMsg.to).toEqual({ topic: 'task-queue:crawl' });
      expect(sentMsg.payload.data.type).toBe('crawl');
      expect(sentMsg.payload.data.priority).toBe(8);
      expect(sentMsg.payload.data.payload).toEqual(payload);
      expect(sentMsg.payload.data.capabilityRequired).toBe('crawler');
    });

    it('should claim jobs correctly', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      await client.claimJob('test-cap');

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);

      expect(sentMsg.action).toBe('job-claim');
      expect(sentMsg.to).toEqual({ capability: 'test-cap' });
      expect(sentMsg.payload.data.capability).toBe('test-cap');
    });

    it('should complete jobs correctly (success)', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      await client.completeJob('job-123', { status: 'done' });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);

      expect(sentMsg.action).toBe('job-complete');
      expect(sentMsg.to).toEqual({ agent_id: 'relay' });
      expect(sentMsg.payload.data.jobId).toBe('job-123');
      expect(sentMsg.payload.data.success).toBe(true);
      expect(sentMsg.payload.data.result).toEqual({ status: 'done' });
      expect(sentMsg.payload.data.error).toBeUndefined();
    });

    it('should complete jobs correctly (error)', async () => {
      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      await client.completeJob('job-123', null, 'Task failed');

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);

      expect(sentMsg.action).toBe('job-complete');
      expect(sentMsg.payload.data.success).toBe(false);
      expect(sentMsg.payload.data.error).toBe('Task failed');
    });

    it('should gather capabilities from broadcast responses', async () => {
      vi.useFakeTimers();

      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const capabilitiesPromise = client.getCapabilities();

      // Wait for the broadcast message to be sent
      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sentMsg.action).toBe('capability-query');
      expect(sentMsg.to).toBe('broadcast');

      // Simulate responses from agents
      socket.simulateMessage({
        action: 'response',
        reply_to: sentMsg.msg_id,
        payload: {
          type: 'result',
          data: {
            capabilities: {
              'cap1': ['agent1', 'agent2'],
              'cap2': ['agent3']
            }
          }
        }
      });

      const caps = await capabilitiesPromise;
      expect(caps.size).toBe(2);
      expect(caps.get('cap1')).toEqual(['agent1', 'agent2']);
      expect(caps.get('cap2')).toEqual(['agent3']);

      vi.useRealTimers();
    });

    it('should resolve with empty map on capability timeout', async () => {
      vi.useFakeTimers();

      const socket = (client as any).socket as MockWebSocket;
      socket.send.mockClear();

      const capabilitiesPromise = client.getCapabilities();

      // Fast forward past the 5s timeout
      vi.advanceTimersByTime(5100);

      const caps = await capabilitiesPromise;
      expect(caps.size).toBe(0);

      vi.useRealTimers();
    });
  });
});
