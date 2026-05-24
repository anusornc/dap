import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WSHandler } from '../../src/relay/ws-handler.js';
import { AgentRegistry } from '../../src/relay/agent-registry.js';
import { WebSocketServer } from 'ws';
import { DAPMessage, MessageAction } from '../../src/protocol/types.js';
import { v4 as uuidv4 } from 'uuid';

describe('WSHandler', () => {
  let wss: any;
  let registry: any;
  let wsHandler: WSHandler;

  beforeEach(() => {
    wss = {
      on: vi.fn(),
    };

    registry = {
      get: vi.fn(),
      getBySocket: vi.fn(),
      getByCapability: vi.fn(),
      getAll: vi.fn(),
      getAllCapabilities: vi.fn(),
      updateHeartbeat: vi.fn(),
      unregister: vi.fn(),
      toJSON: vi.fn(),
    };

    wsHandler = new WSHandler(wss as any, registry as any, {
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 200,
    }, { skipSetup: true });
  });

  afterEach(() => {
    wsHandler.close();
  });

  describe('initialization', () => {
    it('should setup server if skipSetup is false', () => {
      const wssWithOn = { on: vi.fn() };
      new WSHandler(wssWithOn as any, registry as any, {}, { skipSetup: false });
      expect(wssWithOn.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('message routing', () => {
    it('should route direct message to agent', () => {
      const mockSocket = {
        readyState: 1, // OPEN
        send: vi.fn(),
      };

      const targetSocket = {
        readyState: 1,
        send: vi.fn(),
      };

      registry.get.mockReturnValue({
        agentId: 'target-agent',
        socket: targetSocket,
      });

      const msg: DAPMessage = {
        version: '1.0.0',
        msg_id: uuidv4(),
        timestamp: new Date().toISOString(),
        from: { agent_id: 'sender-agent' },
        to: { agent_id: 'target-agent' },
        action: MessageAction.REQUEST,
        payload: {
          type: 'test-type',
          data: { foo: 'bar' }
        }
      };

      // Call handleMessage directly (it's private, but we can test sendToAgent or test via event emission)
      // Since handleMessage is private, we'll mock a socket connection and trigger message event
      const socket = {
        on: vi.fn(),
        readyState: 1,
        send: vi.fn()
      };

      // We can test sendToAgent which uses the internal send
      const result = wsHandler.sendToAgent('target-agent', msg);
      expect(result).toBe(true);
      expect(targetSocket.send).toHaveBeenCalledWith(JSON.stringify(msg));
    });

    it('should return false when sending to non-existent agent', () => {
      registry.get.mockReturnValue(undefined);

      const msg: DAPMessage = {
        version: '1.0.0',
        msg_id: uuidv4(),
        timestamp: new Date().toISOString(),
        from: { agent_id: 'sender-agent' },
        to: { agent_id: 'target-agent' },
        action: MessageAction.REQUEST,
        payload: {
          type: 'test',
          data: {}
        }
      };

      const result = wsHandler.sendToAgent('target-agent', msg);
      expect(result).toBe(false);
    });
  });

  describe('broadcasting', () => {
    it('should broadcast to all connected agents', () => {
      const socket1 = { readyState: 1, send: vi.fn() };
      const socket2 = { readyState: 1, send: vi.fn() };
      const socket3 = { readyState: 2, send: vi.fn() }; // not open

      registry.getAll.mockReturnValue([
        { agentId: 'agent1', socket: socket1 },
        { agentId: 'agent2', socket: socket2 },
        { agentId: 'agent3', socket: socket3 },
      ]);

      const msg: DAPMessage = {
        version: '1.0.0',
        msg_id: uuidv4(),
        timestamp: new Date().toISOString(),
        from: { agent_id: 'sender' },
        to: 'broadcast',
        action: MessageAction.EVENT,
        payload: {
          type: 'broadcast-event',
          data: {}
        }
      };

      wsHandler.broadcastAll(msg);

      expect(socket1.send).toHaveBeenCalledWith(JSON.stringify(msg));
      expect(socket2.send).toHaveBeenCalledWith(JSON.stringify(msg));
      expect(socket3.send).not.toHaveBeenCalled();
    });
  });

  describe('connection counts', () => {
    it('should return connected agent count', () => {
      registry.getAll.mockReturnValue([
        { agentId: 'agent1', socket: { readyState: 1 } },
        { agentId: 'agent2', socket: { readyState: 1 } },
        { agentId: 'agent3', socket: { readyState: 2 } }, // not open
      ]);

      expect(wsHandler.getConnectedCount()).toBe(2);
    });
  });

  // We need to test the connection handling and message parsing,
  // which requires triggering the 'connection' event callback on the wss mock
  describe('connection and message handling', () => {
    let connectionCallback: Function;

    beforeEach(() => {
      const wssWithOn = { on: vi.fn() };
      const handler = new WSHandler(wssWithOn as any, registry as any, {}, { skipSetup: false });

      // Extract the connection callback
      connectionCallback = wssWithOn.on.mock.calls.find(call => call[0] === 'connection')[1];
    });

    it('should setup heartbeat and listeners on connection', () => {
      const socket = {
        on: vi.fn(),
        send: vi.fn()
      };

      connectionCallback(socket, {});

      // Verify listeners were added
      expect(socket.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
});

// Add tests for handleMessage functionalities
describe('message parsing and dispatch', () => {
  let wsHandler: any;
  let connectionCallback: Function;
  let mockSocket: any;

  beforeEach(() => {
    const wssWithOn = { on: vi.fn() };
    const registry = {
      get: vi.fn(),
      getBySocket: vi.fn(),
      getByCapability: vi.fn(),
      getAll: vi.fn(),
      getAllCapabilities: vi.fn(),
      updateHeartbeat: vi.fn(),
      unregister: vi.fn(),
      toJSON: vi.fn(),
    };

    wsHandler = new WSHandler(wssWithOn as any, registry as any, {}, { skipSetup: false });
    connectionCallback = wssWithOn.on.mock.calls.find((call: any) => call[0] === 'connection')[1];

    mockSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1
    };

    connectionCallback(mockSocket, {});
  });

  afterEach(() => {
    wsHandler.close();
  });

  it('should send error on invalid JSON', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    messageCallback(Buffer.from('invalid json'));

    expect(mockSocket.send).toHaveBeenCalled();
    const sentData = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(sentData.action).toBe(MessageAction.ERROR);
    expect(sentData.payload.data.error).toBe('Invalid JSON');
  });

  it('should send error on missing action', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      // no action
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const sentData = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(sentData.action).toBe(MessageAction.ERROR);
    expect(sentData.payload.data.error).toBe('Invalid message format');
  });

  it('should handle request to capability', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const targetSocket = {
      readyState: 1,
      send: vi.fn()
    };

    wsHandler.registry.getByCapability.mockReturnValue([
      { agentId: 'capable-agent', socket: targetSocket }
    ]);

    const msg = {
      version: '1.0.0',
      action: MessageAction.REQUEST,
      to: { capability: 'test-cap' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(wsHandler.registry.getByCapability).toHaveBeenCalledWith('test-cap');
    expect(targetSocket.send).toHaveBeenCalled();
  });

  it('should handle response and resolve pending request', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const resolve = vi.fn();
    const reject = vi.fn();
    const timeout = setTimeout(() => {}, 1000);

    wsHandler.pendingRequests.set('reply-id', {
      resolve,
      reject,
      timeout
    });

    const msg = {
      version: '1.0.0',
      action: MessageAction.RESPONSE,
      reply_to: 'reply-id',
      from: { agent_id: 'responder' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(resolve).toHaveBeenCalledWith(msg);
    expect(wsHandler.pendingRequests.has('reply-id')).toBe(false);
  });

  it('should handle event broadcast to capability', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const targetSocket1 = { readyState: 1, send: vi.fn() };
    const targetSocket2 = { readyState: 1, send: vi.fn() };

    wsHandler.registry.getByCapability.mockReturnValue([
      { agentId: 'agent1', socket: targetSocket1 },
      { agentId: 'agent2', socket: targetSocket2 },
    ]);

    const msg = {
      version: '1.0.0',
      action: MessageAction.EVENT,
      to: { capability: 'test-cap' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(targetSocket1.send).toHaveBeenCalled();
    expect(targetSocket2.send).toHaveBeenCalled();
  });

  it('should handle job submission', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: MessageAction.JOB_SUBMISSION,
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.EVENT);
    expect(response.payload.type).toBe('job-submission-ack');
  });

  it('should handle job claim', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: MessageAction.JOB_CLAIM,
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.EVENT);
    expect(response.payload.type).toBe('job-claim-ack');
  });

  it('should handle heartbeat', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    wsHandler.registry.getBySocket.mockReturnValue({ agentId: 'agent1' });

    const msg = {
      version: '1.0.0',
      action: MessageAction.HEARTBEAT,
      from: { agent_id: 'agent1' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(wsHandler.registry.updateHeartbeat).toHaveBeenCalledWith('agent1');
    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.EVENT);
    expect(response.payload.type).toBe('heartbeat-ack');
  });

  it('should handle capability query', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    wsHandler.registry.getAllCapabilities.mockReturnValue(new Map([['cap1', [{name: 'cap1', version: '1.0'}]]]));
    wsHandler.registry.toJSON.mockReturnValue([{ agent_id: 'agent1' }]);

    const msg = {
      version: '1.0.0',
      action: MessageAction.CAPABILITY_QUERY,
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.RESPONSE);
    expect(response.payload.type).toBe('capability-query-result');
    expect(response.payload.data.agents).toBeDefined();
    expect(response.payload.data.capabilities).toBeDefined();
  });

  it('should handle socket disconnect', () => {
    const closeCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'close')[1];

    wsHandler.registry.getBySocket.mockReturnValue({ agentId: 'agent1' });

    closeCallback();

    expect(wsHandler.registry.unregister).toHaveBeenCalledWith('agent1');
  });
});

describe('additional message parsing and dispatch tests', () => {
  let wsHandler: any;
  let connectionCallback: Function;
  let mockSocket: any;

  beforeEach(() => {
    const wssWithOn = { on: vi.fn() };
    const registry = {
      get: vi.fn(),
      getBySocket: vi.fn(),
      getByCapability: vi.fn(),
      getAll: vi.fn(),
      getAllCapabilities: vi.fn(),
      updateHeartbeat: vi.fn(),
      unregister: vi.fn(),
      toJSON: vi.fn(),
    };

    wsHandler = new WSHandler(wssWithOn as any, registry as any, { heartbeatIntervalMs: 100 }, { skipSetup: false });
    connectionCallback = wssWithOn.on.mock.calls.find((call: any) => call[0] === 'connection')[1];

    mockSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1
    };

    connectionCallback(mockSocket, {});
  });

  afterEach(() => {
    wsHandler.close();
  });

  it('should handle request to specific agent when agent offline', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    wsHandler.registry.get.mockReturnValue(undefined); // Agent not found

    const msg = {
      version: '1.0.0',
      action: MessageAction.REQUEST,
      to: { agent_id: 'offline-agent' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.ERROR);
    expect(response.payload.data.error).toBe('Agent not found or offline');
  });

  it('should handle stream action', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: MessageAction.STREAM,
      reply_to: 'stream-id',
      from: { agent_id: 'sender' },
      payload: { type: 'stream-chunk' }
    };

    const consoleSpy = vi.spyOn(console, 'log');

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WS] Stream chunk for stream-id'));
    consoleSpy.mockRestore();
  });

  it('should handle job complete', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: MessageAction.JOB_COMPLETE,
      from: { agent_id: 'completer-agent' },
      payload: { type: 'job-result' }
    };

    const consoleSpy = vi.spyOn(console, 'log');

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WS] Job completed by completer-agent'));
    consoleSpy.mockRestore();
  });

  it('should warn on unknown action', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: 'UNKNOWN_ACTION',
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    const consoleSpy = vi.spyOn(console, 'warn');

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WS] Unknown action: UNKNOWN_ACTION'));
    consoleSpy.mockRestore();
  });

  it('should trigger heartbeat start', () => {
    vi.useFakeTimers();
    const mockSocketWithHeartbeat = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1
    };

    connectionCallback(mockSocketWithHeartbeat, {});

    // Fast forward past heartbeat interval (config is set to 100 in beforeEach)
    vi.advanceTimersByTime(150);

    expect(mockSocketWithHeartbeat.send).toHaveBeenCalled();
    const sentData = JSON.parse(mockSocketWithHeartbeat.send.mock.calls[0][0]);
    expect(sentData.action).toBe(MessageAction.HEARTBEAT);

    vi.useRealTimers();
  });
});

describe('even more message parsing and dispatch tests', () => {
  let wsHandler: any;
  let connectionCallback: Function;
  let mockSocket: any;

  beforeEach(() => {
    const wssWithOn = { on: vi.fn() };
    const registry = {
      get: vi.fn(),
      getBySocket: vi.fn(),
      getByCapability: vi.fn(),
      getAll: vi.fn(),
      getAllCapabilities: vi.fn(),
      updateHeartbeat: vi.fn(),
      unregister: vi.fn(),
      toJSON: vi.fn(),
    };

    wsHandler = new WSHandler(wssWithOn as any, registry as any, { heartbeatIntervalMs: 100 }, { skipSetup: false });
    connectionCallback = wssWithOn.on.mock.calls.find((call: any) => call[0] === 'connection')[1];

    mockSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1
    };

    connectionCallback(mockSocket, {});
  });

  afterEach(() => {
    wsHandler.close();
  });

  it('should handle socket error event', () => {
    const errorCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];

    const consoleSpy = vi.spyOn(console, 'error');

    errorCallback(new Error('socket error'));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WS] Socket error:'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('should handle request with capability but no agents available', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    // Return empty array for capabilities
    wsHandler.registry.getByCapability.mockReturnValue([]);

    const msg = {
      version: '1.0.0',
      action: MessageAction.REQUEST,
      to: { capability: 'missing-cap' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.ERROR);
    expect(response.payload.data.error).toBe('No agent available with capability');
  });

  it('should handle event broadcast to broadcast capability', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const targetSocket1 = { readyState: 1, send: vi.fn() };

    wsHandler.registry.getAll.mockReturnValue([
      { agentId: 'agent1', socket: targetSocket1 },
    ]);

    const msg = {
      version: '1.0.0',
      action: MessageAction.EVENT,
      to: 'broadcast',
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(targetSocket1.send).toHaveBeenCalled();
  });

  it('should handle event to specific agent', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const targetSocket1 = { readyState: 1, send: vi.fn() };

    wsHandler.registry.get.mockReturnValue(
      { agentId: 'agent1', socket: targetSocket1 },
    );

    const msg = {
      version: '1.0.0',
      action: MessageAction.EVENT,
      to: { agent_id: 'agent1' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(targetSocket1.send).toHaveBeenCalled();
  });

  it('should error on request with invalid destination', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const msg = {
      version: '1.0.0',
      action: MessageAction.REQUEST,
      to: { unknown_prop: 'invalid' }, // Invalid 'to'
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(mockSocket.send).toHaveBeenCalled();
    const response = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(response.action).toBe(MessageAction.ERROR);
    expect(response.payload.data.error).toBe('Invalid destination');
  });
});

describe('coverage tweaks', () => {
  let wsHandler: any;
  let connectionCallback: Function;
  let mockSocket: any;

  beforeEach(() => {
    const wssWithOn = { on: vi.fn() };
    const registry = {
      get: vi.fn(),
      getBySocket: vi.fn(),
      getByCapability: vi.fn(),
      getAll: vi.fn(),
      getAllCapabilities: vi.fn(),
      updateHeartbeat: vi.fn(),
      unregister: vi.fn(),
      toJSON: vi.fn(),
    };

    wsHandler = new WSHandler(wssWithOn as any, registry as any, { heartbeatIntervalMs: 100 }, { skipSetup: false });
    connectionCallback = wssWithOn.on.mock.calls.find((call: any) => call[0] === 'connection')[1];

    mockSocket = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1
    };

    connectionCallback(mockSocket, {});
  });

  afterEach(() => {
    wsHandler.close();
  });

  it('should handle request to specific agent directly', () => {
    const messageCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

    const targetSocket = { readyState: 1, send: vi.fn() };
    wsHandler.registry.get.mockReturnValue({ agentId: 'agent1', socket: targetSocket });

    const msg = {
      version: '1.0.0',
      action: MessageAction.REQUEST,
      to: { agent_id: 'agent1' },
      from: { agent_id: 'sender' },
      payload: { type: 'test' }
    };

    messageCallback(Buffer.from(JSON.stringify(msg)));

    expect(targetSocket.send).toHaveBeenCalled();
  });
});
