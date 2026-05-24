import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { RelayServer } from '../src/relay/server.js';
import { DAPMessage, MessageAction } from '../src/protocol/types.js';

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for message'));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function makeRequest(fromAgentId: string, toAgentId: string): DAPMessage {
  return {
    version: '1.0.0',
    msg_id: uuidv4(),
    timestamp: new Date().toISOString(),
    from: {
      agent_id: fromAgentId,
      capabilities: ['requester'],
      version: '1.0.0',
    },
    to: { agent_id: toAgentId },
    action: MessageAction.REQUEST,
    payload: {
      type: 'task-delegation',
      data: {
        description: 'route this request',
        type: 'routing-test',
      },
    },
  };
}

function makeReply(
  action: typeof MessageAction.RESPONSE | typeof MessageAction.ERROR,
  fromAgentId: string,
  toAgentId: string,
  replyTo: string,
  data: Record<string, unknown>
): DAPMessage {
  return {
    version: '1.0.0',
    msg_id: uuidv4(),
    timestamp: new Date().toISOString(),
    from: {
      agent_id: fromAgentId,
      capabilities: ['worker'],
      version: '1.0.0',
    },
    to: { agent_id: toAgentId },
    action,
    payload: {
      type: action === MessageAction.ERROR ? 'error-report' : 'result',
      data,
    },
    reply_to: replyTo,
  };
}

describe('RelayServer request/reply routing', () => {
  let server: RelayServer;
  let wsUrl: string;
  let sockets: WebSocket[];

  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/dap-relay-routing-${Date.now()}-${Math.random()}`;
    server = new RelayServer({
      port: 0,
      host: '127.0.0.1',
      requestTimeoutMs: 50,
    } as any, { testMode: true });
    await server.start();
    const addr = server.getAddress();
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
    sockets = [];
  });

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
    await server.stop();
  });

  async function connectAgent(agentId: string, capability: string): Promise<WebSocket> {
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({
          action: 'register',
          agentId,
          capabilities: [{ name: capability, version: '1.0.0', maxConcurrent: 1 }],
          os: 'test-os',
          version: '1.0.0',
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.success && msg.agentId === agentId) {
          resolve();
        }
      });
      ws.once('error', reject);
    });

    return ws;
  }

  it('routes a response back to the original requester by reply_to', async () => {
    const requester = await connectAgent('requester', 'requester');
    const worker = await connectAgent('worker', 'worker');
    const request = makeRequest('requester', 'worker');

    const workerRequest = waitForMessage(worker, msg => msg.msg_id === request.msg_id);
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);

    requester.send(JSON.stringify(request));
    expect(await workerRequest).toMatchObject({ action: MessageAction.REQUEST });

    worker.send(JSON.stringify(makeReply(
      MessageAction.RESPONSE,
      'worker',
      'requester',
      request.msg_id,
      { success: true, result: { ok: true } }
    )));

    expect(await requesterReply).toMatchObject({
      action: MessageAction.RESPONSE,
      reply_to: request.msg_id,
      payload: { data: { success: true, result: { ok: true } } },
    });
  });

  it('routes an error back to the original requester by reply_to', async () => {
    const requester = await connectAgent('requester', 'requester');
    const worker = await connectAgent('worker', 'worker');
    const request = makeRequest('requester', 'worker');

    const workerRequest = waitForMessage(worker, msg => msg.msg_id === request.msg_id);
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);

    requester.send(JSON.stringify(request));
    await workerRequest;

    worker.send(JSON.stringify(makeReply(
      MessageAction.ERROR,
      'worker',
      'requester',
      request.msg_id,
      { success: false, error: 'worker failed' }
    )));

    expect(await requesterReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: request.msg_id,
      payload: { data: { success: false, error: 'worker failed' } },
    });
  });

  it('returns a requester-visible error when the target is offline', async () => {
    const requester = await connectAgent('requester', 'requester');
    const request = makeRequest('requester', 'missing-worker');
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);

    requester.send(JSON.stringify(request));

    expect(await requesterReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: request.msg_id,
      payload: { data: { success: false, error: 'Agent not found or offline' } },
    });
  });

  it('returns a requester-visible error when the target does not respond before timeout', async () => {
    const requester = await connectAgent('requester', 'requester');
    const worker = await connectAgent('worker', 'worker');
    const request = makeRequest('requester', 'worker');

    const workerRequest = waitForMessage(worker, msg => msg.msg_id === request.msg_id);
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);

    requester.send(JSON.stringify(request));
    await workerRequest;

    expect(await requesterReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: request.msg_id,
      payload: { data: { success: false } },
    });
  });

  it('rejects messages whose from.agent_id does not match the registered socket', async () => {
    const requester = await connectAgent('requester', 'requester');
    await connectAgent('worker', 'worker');
    const request = makeRequest('impostor', 'worker');
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);

    requester.send(JSON.stringify(request));

    expect(await requesterReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: request.msg_id,
      payload: {
        data: {
          success: false,
          error: 'Message from.agent_id does not match registered socket identity',
        },
      },
    });
  });

  it('returns an error to the sender for an unknown reply_to', async () => {
    const worker = await connectAgent('worker', 'worker');
    const unknownReply = makeReply(
      MessageAction.RESPONSE,
      'worker',
      'requester',
      uuidv4(),
      { success: true, result: 'orphaned' }
    );
    const senderReply = waitForMessage(worker, msg => msg.reply_to === unknownReply.msg_id);

    worker.send(JSON.stringify(unknownReply));

    expect(await senderReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: unknownReply.msg_id,
      payload: { data: { success: false, error: 'Unknown reply_to' } },
    });
  });

  it('returns a requester-visible error when a non-target agent responds', async () => {
    const requester = await connectAgent('requester', 'requester');
    const worker = await connectAgent('worker', 'worker');
    const intruder = await connectAgent('intruder', 'worker');
    const request = makeRequest('requester', 'worker');

    const workerRequest = waitForMessage(worker, msg => msg.msg_id === request.msg_id);
    const requesterReply = waitForMessage(requester, msg => msg.reply_to === request.msg_id);
    const intruderReply = waitForMessage(intruder, msg => msg.action === MessageAction.ERROR);

    requester.send(JSON.stringify(request));
    await workerRequest;

    const intruderMsg = makeReply(
      MessageAction.RESPONSE,
      'intruder',
      'requester',
      request.msg_id,
      { success: true, result: 'not authorized' }
    );
    intruder.send(JSON.stringify(intruderMsg));

    expect(await intruderReply).toMatchObject({
      action: MessageAction.ERROR,
      reply_to: intruderMsg.msg_id,
      payload: { data: { success: false, error: 'Unauthorized responder' } },
    });

    worker.send(JSON.stringify(makeReply(
      MessageAction.RESPONSE,
      'worker',
      'requester',
      request.msg_id,
      { success: true, result: 'authorized response' }
    )));

    expect(await requesterReply).toMatchObject({
      action: MessageAction.RESPONSE,
      reply_to: request.msg_id,
      payload: { data: { success: true, result: 'authorized response' } },
    });
  });

  it('rejects registration when agentId would be sanitized', async () => {
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({
          action: 'register',
          agentId: 'agent.with.dots',
          capabilities: [{ name: 'worker', version: '1.0.0', maxConcurrent: 1 }],
          os: 'test-os',
          version: '1.0.0',
        }));
      });
      ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg).toMatchObject({
          success: false,
          error: 'agentId contains unsupported characters',
          sanitizedAgentId: 'agentwithdots',
        });
        resolve();
      });
      ws.once('error', reject);
    });
  });

  it('handles capability queries on the active RelayServer path', async () => {
    const requester = await connectAgent('requester', 'requester');
    await connectAgent('worker', 'worker');
    const query: DAPMessage = {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: {
        agent_id: 'requester',
        capabilities: ['requester'],
        version: '1.0.0',
      },
      to: 'broadcast',
      action: MessageAction.CAPABILITY_QUERY,
      payload: {
        type: 'capability-query',
        data: {},
      },
    };
    const response = waitForMessage(requester, msg => msg.reply_to === query.msg_id);

    requester.send(JSON.stringify(query));

    expect(await response).toMatchObject({
      action: MessageAction.RESPONSE,
      reply_to: query.msg_id,
      payload: {
        type: 'capability-query-result',
        data: {
          capabilities: {
            requester: ['requester'],
            worker: ['worker'],
          },
        },
      },
    });
  });
});
