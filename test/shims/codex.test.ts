import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexShim, CodexShimConfig } from '../../src/shims/codex.js';
import * as fs from 'fs/promises';
import { join } from 'path';
import { DAPMessage, MessageAction } from '../../src/protocol/types.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
}));

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  url: string;
  readyState: number = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }
}
global.WebSocket = MockWebSocket as any;

// Mock crypto.randomUUID if not present
if (!global.crypto) {
  (global as any).crypto = {
    randomUUID: () => 'mock-uuid',
  };
} else if (!global.crypto.randomUUID) {
  (global.crypto as any).randomUUID = () => 'mock-uuid';
} else {
  vi.spyOn(global.crypto, 'randomUUID').mockReturnValue('mock-uuid');
}

describe('CodexShim', () => {
  let shim: CodexShim;
  let config: CodexShimConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    config = {
      relayUrl: 'ws://localhost:3000/ws',
      agentId: 'test-codex',
      capabilities: [{ name: 'code-completion', version: '1.0.0' }],
      codexTaskDir: '/mock/dir',
      pollIntervalMs: 100,
    };

    shim = new CodexShim(config);
  });

  afterEach(async () => {
    await shim.disconnect();
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('creates directories and connects to WebSocket', async () => {
      const connectPromise = shim.connect();

      // Wait for connect to establish socket
      await Promise.resolve();

      // Now socket is created, advance timers to trigger onopen
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      expect(fs.mkdir).toHaveBeenCalledWith(join('/mock/dir', 'incoming'), { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith(join('/mock/dir', 'results'), { recursive: true });
      expect(shim.isConnected()).toBe(true);

      // Verify register message
      const ws = (shim as any).socket;
      expect(ws.send).toHaveBeenCalled();
      const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
      const msg = JSON.parse(lastCall);
      expect(msg.action).toBe('register');
      expect(msg.agentId).toBe('test-codex');
    });

    it('uses heartbeat interval independently from task polling interval', async () => {
      shim = new CodexShim({
        ...config,
        pollIntervalMs: 100,
        heartbeatIntervalMs: 1000,
      });
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      ws.send.mockClear();

      await vi.advanceTimersByTimeAsync(500);
      expect(ws.send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(ws.send.mock.calls[0][0]).action).toBe(MessageAction.HEARTBEAT);
    });

    it('ignores registration acknowledgements without logging unhandled messages', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      if (ws.onmessage) {
        await ws.onmessage({ data: JSON.stringify({ success: true, agentId: 'test-codex' }) });
      }

      expect(logSpy).not.toHaveBeenCalledWith('[Codex Shim] Unhandled: undefined');
      logSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('sends unregister message and closes socket', async () => {
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      ws.send.mockClear();

      await shim.disconnect();

      expect(ws.send).toHaveBeenCalled();
      const lastCall = ws.send.mock.calls[0][0];
      const msg = JSON.parse(lastCall);
      expect(msg.action).toBe('unregister');
      expect(ws.close).toHaveBeenCalledWith(1000, 'Client disconnect');
      expect(shim.isConnected()).toBe(false);
    });
  });

  describe('handleIncomingMessage (REQUEST)', () => {
    it('delegates to codex and replies with result', async () => {
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      ws.send.mockClear();

      // Mock readFile to simulate task completion
      (fs.readFile as any).mockResolvedValue(JSON.stringify({
        success: true,
        data: 'mock result'
      }));

      const requestMsg: DAPMessage = {
        version: '1.0.0',
        msg_id: 'req-1',
        timestamp: new Date().toISOString(),
        from: { agent_id: 'caller' },
        to: { agent_id: 'test-codex' },
        action: MessageAction.REQUEST,
        payload: {
          type: 'code-completion',
          data: {
            description: 'do something',
            type: 'test-task',
          }
        }
      };

      // Trigger message handling
      if (ws.onmessage) {
        const messagePromise = ws.onmessage({ data: JSON.stringify(requestMsg) });
        // Advance timers past the pollInterval
        await vi.advanceTimersByTimeAsync(150);
        await messagePromise;
      }

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalled();

      // Verify response sent via WebSocket
      expect(ws.send).toHaveBeenCalled();
      const responseCall = ws.send.mock.calls
        .map(call => call[0])
        .find(raw => JSON.parse(raw).action === MessageAction.RESPONSE);
      expect(responseCall).toBeDefined();
      const responseMsg = JSON.parse(responseCall);

      expect(responseMsg.action).toBe(MessageAction.RESPONSE);
      expect(responseMsg.reply_to).toBe('req-1');
      expect(responseMsg.payload.data.success).toBe(true);
      expect(responseMsg.payload.data.result).toBe('mock result');
    });

    it('handles delegate timeout correctly', async () => {
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      ws.send.mockClear();

      // Mock readFile to always fail, forcing a timeout
      (fs.readFile as any).mockRejectedValue(new Error('not found'));

      const requestMsg: DAPMessage = {
        version: '1.0.0',
        msg_id: 'req-2',
        timestamp: new Date().toISOString(),
        from: { agent_id: 'caller' },
        to: { agent_id: 'test-codex' },
        action: MessageAction.REQUEST,
        payload: {
          type: 'code-completion',
          data: {
            description: 'timeout test',
            type: 'test-task',
          }
        }
      };

      let messagePromise;
      if (ws.onmessage) {
        messagePromise = ws.onmessage({ data: JSON.stringify(requestMsg) });
      }

      // Advance timers past maxWaitTime (300000ms)
      await vi.advanceTimersByTimeAsync(300500);
      await messagePromise;

      expect(ws.send).toHaveBeenCalled();
      const responseCall = ws.send.mock.calls
        .map(call => call[0])
        .find(raw => JSON.parse(raw).action === MessageAction.RESPONSE);
      expect(responseCall).toBeDefined();
      const responseMsg = JSON.parse(responseCall);

      expect(responseMsg.action).toBe(MessageAction.RESPONSE);
      expect(responseMsg.reply_to).toBe('req-2');
      expect(responseMsg.payload.data.success).toBe(false);
      expect(responseMsg.payload.data.error).toContain('Task timeout after 300000ms');
    });

    it('honors A2A metadata timeout overrides while waiting for worker results', async () => {
      const connectPromise = shim.connect();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await connectPromise;

      const ws = (shim as any).socket;
      ws.send.mockClear();

      (fs.readFile as any).mockRejectedValue(new Error('not found'));

      const requestMsg: DAPMessage = {
        version: '1.0.0',
        msg_id: 'req-3',
        timestamp: new Date().toISOString(),
        from: { agent_id: 'caller' },
        to: { agent_id: 'test-codex' },
        action: MessageAction.REQUEST,
        payload: {
          type: 'code-completion',
          data: {
            description: 'timeout override test',
            type: 'test-task',
            context: {
              a2a: {
                metadata: { timeoutMs: 600000 },
              },
            },
          }
        }
      };

      let messagePromise;
      if (ws.onmessage) {
        messagePromise = ws.onmessage({ data: JSON.stringify(requestMsg) });
      }

      await vi.advanceTimersByTimeAsync(300500);
      const earlyResponseCall = ws.send.mock.calls
        .map(call => call[0])
        .find(raw => JSON.parse(raw).action === MessageAction.RESPONSE);
      expect(earlyResponseCall).toBeUndefined();

      await vi.advanceTimersByTimeAsync(300000);
      await messagePromise;

      const responseCall = ws.send.mock.calls
        .map(call => call[0])
        .find(raw => JSON.parse(raw).action === MessageAction.RESPONSE);
      expect(responseCall).toBeDefined();
      const responseMsg = JSON.parse(responseCall);

      expect(responseMsg.payload.data.success).toBe(false);
      expect(responseMsg.payload.data.error).toContain('Task timeout after 600000ms');
    });
  });
});
