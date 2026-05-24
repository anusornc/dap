import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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

function makeReply(replyTo: string, result: unknown, success = true): DAPMessage {
  return {
    version: '1.0.0',
    msg_id: uuidv4(),
    timestamp: new Date().toISOString(),
    from: {
      agent_id: 'worker',
      capabilities: ['documentation'],
      version: '1.0.0',
    },
    to: { agent_id: 'a2a-gateway' },
    action: success ? MessageAction.RESPONSE : MessageAction.ERROR,
    payload: {
      type: success ? 'result' : 'error-report',
      data: success
        ? { success: true, result }
        : { success: false, error: String(result) },
    },
    reply_to: replyTo,
  };
}

function messageSendBody(id = 'rpc-1', text = 'Run the A2A bridge test'): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId: `message-${id}`,
        kind: 'message',
      },
    },
  };
}

describe('A2A bridge routes', () => {
  let server: RelayServer;
  let httpUrl: string;
  let wsUrl: string;
  let sockets: WebSocket[];

  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/dap-a2a-bridge-${Date.now()}-${Math.random()}`;
    server = new RelayServer({
      port: 0,
      host: '127.0.0.1',
      requestTimeoutMs: 50,
    } as any, { testMode: true });
    await server.start();
    const addr = server.getAddress();
    httpUrl = `http://127.0.0.1:${addr.port}`;
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

  async function connectWorker(): Promise<WebSocket> {
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({
          action: 'register',
          agentId: 'worker',
          capabilities: [{ name: 'documentation', version: '1.0.0', maxConcurrent: 1 }],
          os: 'test-os',
          version: '1.0.0',
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.success && msg.agentId === 'worker') {
          resolve();
        }
      });
      ws.once('error', reject);
    });

    return ws;
  }

  it('serves a relay-level A2A Agent Card', async () => {
    const response = await request(httpUrl).get('/.well-known/agent-card.json');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      protocolVersion: '0.3.0',
      name: 'DAP A2A Gateway',
      preferredTransport: 'JSONRPC',
      capabilities: {
        streaming: false,
      },
    });
    expect(response.body.url).toBe(`${httpUrl}/a2a`);
  });

  it('serves per-agent A2A Agent Cards for connected DAP agents', async () => {
    await connectWorker();

    const response = await request(httpUrl).get('/a2a/agents/worker/.well-known/agent-card.json');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      protocolVersion: '0.3.0',
      name: 'worker',
      url: `${httpUrl}/a2a/agents/worker`,
      capabilities: {
        streaming: false,
      },
    });
    expect(response.body.skills[0]).toMatchObject({
      id: 'documentation',
      name: 'documentation',
    });
  });

  it('routes A2A message/send to a connected DAP worker and returns the reply', async () => {
    const worker = await connectWorker();
    const workerRequest = waitForMessage(worker, msg => msg.action === MessageAction.REQUEST);
    const httpResponse = request(httpUrl)
      .post('/a2a/agents/worker')
      .send(messageSendBody())
      .then(response => response);

    const dapRequest = await workerRequest;
    expect(dapRequest).toMatchObject({
      from: { agent_id: 'a2a-gateway' },
      to: { agent_id: 'worker' },
      payload: {
        data: {
          description: 'Run the A2A bridge test',
          type: 'a2a-message-send',
        },
      },
    });

    worker.send(JSON.stringify(makeReply(dapRequest.msg_id, { ok: true })));

    const response = await httpResponse;
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'rpc-1',
      result: {
        role: 'agent',
        parts: [{ kind: 'data', data: { result: { ok: true } } }],
        kind: 'message',
      },
    });
  });

  it('supports the relay-level A2A gateway when metadata.targetAgentId is provided', async () => {
    const worker = await connectWorker();
    const workerRequest = waitForMessage(worker, msg => msg.action === MessageAction.REQUEST);
    const body = messageSendBody('rpc-gateway');
    (body.params as any).metadata = { targetAgentId: 'worker' };
    const httpResponse = request(httpUrl).post('/a2a').send(body).then(response => response);

    const dapRequest = await workerRequest;
    worker.send(JSON.stringify(makeReply(dapRequest.msg_id, 'gateway ok')));

    const response = await httpResponse;
    expect(response.status).toBe(200);
    expect(response.body.result.parts).toEqual([{ kind: 'text', text: 'gateway ok' }]);
  });

  it('returns JSON-RPC method errors for unsupported methods', async () => {
    const response = await request(httpUrl)
      .post('/a2a/agents/worker')
      .send({ jsonrpc: '2.0', id: 'bad-method', method: 'message/stream', params: {} });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'bad-method',
      error: {
        code: -32601,
      },
    });
  });

  it('returns JSON-RPC parse errors for malformed A2A JSON', async () => {
    const response = await request(httpUrl)
      .post('/a2a/agents/worker')
      .set('content-type', 'application/json')
      .send('{"jsonrpc": "2.0",');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    });
  });

  it('returns JSON-RPC agent-not-found errors for offline targets', async () => {
    const response = await request(httpUrl)
      .post('/a2a/agents/missing')
      .send(messageSendBody('offline'));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'offline',
      error: {
        code: -32001,
        message: 'Agent not found or offline',
      },
    });
  });

  it('returns JSON-RPC timeout errors when the DAP worker does not reply', async () => {
    const worker = await connectWorker();
    const workerRequest = waitForMessage(worker, msg => msg.action === MessageAction.REQUEST);
    const httpResponse = request(httpUrl)
      .post('/a2a/agents/worker')
      .send(messageSendBody('timeout'))
      .then(response => response);

    await workerRequest;

    const response = await httpResponse;
    expect(response.status).toBe(504);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'timeout',
      error: {
        code: -32002,
      },
    });
  });

  it('allows A2A requests to override the default relay timeout', async () => {
    const worker = await connectWorker();
    const workerRequest = waitForMessage(worker, msg => msg.action === MessageAction.REQUEST);
    const body = messageSendBody('long-running');
    (body.params as any).metadata = { timeoutMs: 200 };
    const httpResponse = request(httpUrl)
      .post('/a2a/agents/worker')
      .send(body)
      .then(response => response);

    const dapRequest = await workerRequest;
    await new Promise(resolve => setTimeout(resolve, 75));
    worker.send(JSON.stringify(makeReply(dapRequest.msg_id, 'completed after default timeout')));

    const response = await httpResponse;
    expect(response.status).toBe(200);
    expect(response.body.result.parts).toEqual([{ kind: 'text', text: 'completed after default timeout' }]);
  });
});

describe('A2A bridge API-key behavior', () => {
  it('uses existing REST API-key middleware for A2A endpoints', async () => {
    const keyedServer = new RelayServer({
      port: 0,
      host: '127.0.0.1',
      apiKeys: ['secret'],
    } as any, { testMode: true });
    await keyedServer.start();
    const addr = keyedServer.getAddress();
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const unauthorized = await request(baseUrl).get('/.well-known/agent-card.json');
      expect(unauthorized.status).toBe(401);

      const authorized = await request(baseUrl)
        .get('/.well-known/agent-card.json')
        .set('x-api-key', 'secret');
      expect(authorized.status).toBe(200);
      expect(authorized.body.securitySchemes.apiKey.name).toBe('x-api-key');
    } finally {
      await keyedServer.stop();
    }
  });
});
