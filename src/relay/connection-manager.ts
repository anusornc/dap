import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { DAPMessage, MessageAction, PayloadType, RelayConfig } from '../protocol/types.js';
import { validateMessage, sanitizeAgentId } from '../protocol/validation.js';
import { AgentRegistry } from './agent-registry.js';
import { JobQueue } from './job-queue.js';
import { WSHandler } from './ws-handler.js';
import { wsConnections, connectedAgents } from '../utils/metrics.js';

export class RelayRequestError extends Error {
  code: string;
  details?: string;

  constructor(message: string, code: string, details?: string) {
    super(message);
    this.name = 'RelayRequestError';
    this.code = code;
    this.details = details;
  }
}

interface PendingRelayRequestBase {
  requesterAgentId: string;
  targetAgentId?: string;
  timeout: NodeJS.Timeout;
}

interface SocketPendingRelayRequest extends PendingRelayRequestBase {
  kind: 'socket';
  requesterSocket: any;
}

interface PromisePendingRelayRequest extends PendingRelayRequestBase {
  kind: 'promise';
  resolve: (msg: DAPMessage) => void;
  reject: (err: RelayRequestError) => void;
}

export type PendingRelayRequest = SocketPendingRelayRequest | PromisePendingRelayRequest;

export class ConnectionManager {
  private wss: WebSocketServer;
  private registry: AgentRegistry;
  private jobQueue: JobQueue;
  private wsHandler: WSHandler;
  private config: RelayConfig;
  private getBoundPort: () => number;
  private pendingRequests: Map<string, PendingRelayRequest> = new Map();

  constructor(
    wss: WebSocketServer,
    registry: AgentRegistry,
    jobQueue: JobQueue,
    wsHandler: WSHandler,
    config: RelayConfig,
    getBoundPort: () => number
  ) {
    this.wss = wss;
    this.registry = registry;
    this.jobQueue = jobQueue;
    this.wsHandler = wsHandler;
    this.config = config;
    this.getBoundPort = getBoundPort;
  }

  start(): void {
    this.wss.on('connection', (socket, request) => {
      const baseUrl = `http://127.0.0.1:${this.getBoundPort() || this.config.port}`;
      const url = new URL(request.url || '/', baseUrl);
      const token = url.searchParams.get('token');

      // Validate token if API keys are configured
      if (this.config.apiKeys.length > 0 && !this.config.apiKeys.includes(token || '')) {
        socket.close(4001, 'Unauthorized');
        return;
      }

      console.log(`[Relay] New WebSocket connection`);

      // Update metrics
      wsConnections.inc();
      connectedAgents.inc();

      socket.on('message', (data) => {
        try {
          const raw = JSON.parse(data.toString());

          // Check for registration message
          if (raw.action === 'register') {
            this.handleRegistration(socket as any, raw);
            return;
          }

          // Validate and route regular messages
          const result = validateMessage(raw);
          if (result.success) {
            this.handleMessage(socket as any, result.data);
          }
        } catch (err) {
          console.error('[Relay] Invalid message:', err);
          socket.send(JSON.stringify({
            error: 'Invalid message format',
          }));
        }
      });

      socket.on('close', () => {
        const agent = this.registry.getBySocket(socket as any);
        this.clearPendingForSocket(socket as any, 'Socket disconnected');
        if (agent) {
          console.log(`[Relay] Agent disconnected: ${agent.agentId}`);
          this.registry.unregister(agent.agentId);
        }
        // Update metrics
        wsConnections.dec();
        connectedAgents.dec();
      });

      socket.on('error', (err) => {
        console.error('[Relay] Socket error:', err);
      });
    });
  }

  stop(): void {
    for (const [msgId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msgId);
      if (pending.kind === 'promise') {
        pending.reject(new RelayRequestError('Server shutting down', 'SERVER_SHUTDOWN'));
      }
    }
  }

  private handleRegistration(socket: any, msg: any): void {
    const { agentId, capabilities, metadata, os, version } = msg;

    if (!agentId) {
      socket.send(JSON.stringify({ error: 'agentId required' }));
      socket.close(4000, 'Missing agentId');
      return;
    }

    const sanitizedId = sanitizeAgentId(agentId);
    if (sanitizedId !== agentId) {
      socket.send(JSON.stringify({
        success: false,
        error: 'agentId contains unsupported characters',
        sanitizedAgentId: sanitizedId,
      }));
      socket.close(4000, 'Invalid agentId');
      return;
    }

    const agentInfo: any = {
      agent_id: sanitizedId,
      os: os || 'unknown',
      capabilities: capabilities?.map((c: any) => c.name || c) || [],
      capabilityDetails: capabilities || [],
      version: version || '1.0.0',
      metadata: metadata || {},
    };

    const regResult = this.registry.register(sanitizedId, agentInfo, socket, capabilities || []);
    if (!regResult.valid) {
      socket.send(JSON.stringify({
        success: false,
        error: regResult.error?.message || 'Registration validation failed',
        validationErrors: regResult.error?.errors || [],
      }));
      socket.close();
      return;
    }

    console.log(`[Relay] Agent registered: ${sanitizedId} with capabilities: ${agentInfo.capabilities.join(', ')}`);

    socket.send(JSON.stringify({
      success: true,
      agentId: sanitizedId,
      sessionId: uuidv4(),
      serverVersion: '1.0.0',
    }));
  }

  private handleMessage(socket: any, msg: DAPMessage): void {
    const registeredAgent = this.registry.getBySocket(socket);
    if (!registeredAgent) {
      this.sendRelayError(socket, msg, 'Socket is not registered');
      return;
    }

    if (registeredAgent.agentId !== msg.from.agent_id) {
      this.sendRelayError(
        socket,
        msg,
        'Message from.agent_id does not match registered socket identity',
        `Registered agent: ${registeredAgent.agentId}`
      );
      return;
    }

    switch (msg.action) {
      case MessageAction.REQUEST:
        this.handleRequest(socket, msg);
        break;

      case MessageAction.RESPONSE:
      case MessageAction.ERROR:
        this.handleReply(socket, msg);
        break;

      case MessageAction.EVENT:
        this.handleEvent(msg);
        break;

      case MessageAction.JOB_SUBMISSION:
        this.handleJobSubmission(msg);
        break;

      case MessageAction.JOB_CLAIM:
        this.handleJobClaim(msg);
        break;

      case MessageAction.JOB_COMPLETE:
        this.handleJobComplete(msg);
        break;

      case MessageAction.HEARTBEAT:
        this.registry.updateHeartbeat(msg.from.agent_id);
        break;

      case MessageAction.CAPABILITY_QUERY:
        this.handleCapabilityQuery(socket, msg);
        break;

      default:
        console.warn(`[Relay] Unknown action: ${msg.action}`);
    }
  }

  private handleRequest(socket: any, msg: DAPMessage): void {
    const to = msg.to;

    if (typeof to === 'object' && to !== null && 'agent_id' in to) {
      const target = this.registry.get(to.agent_id);
      if (target && target.socket.readyState === 1) { // OPEN
        this.trackPendingRequest(msg, socket, target.agentId);
        target.socket.send(JSON.stringify(msg));
      } else {
        this.sendRelayError(socket, msg, 'Agent not found or offline', `Agent: ${to.agent_id}`);
      }
    } else if (typeof to === 'object' && to !== null && 'capability' in to) {
      const agents = this.registry.getByCapability(to.capability)
        .filter(agent => agent.socket.readyState === 1);
      if (agents.length > 0) {
        // Route to first available (round-robin for better load distribution)
        const agent = agents[Math.floor(Math.random() * agents.length)];
        this.trackPendingRequest(msg, socket, agent.agentId);
        agent.socket.send(JSON.stringify(msg));
      } else {
        this.sendRelayError(socket, msg, 'No agent available with capability', `Capability: ${to.capability}`);
      }
    } else {
      this.sendRelayError(socket, msg, 'Invalid destination', 'Missing to.agent_id or to.capability');
    }
  }

  private handleReply(socket: any, msg: DAPMessage): void {
    const pending = this.pendingRequests.get(msg.reply_to || '');
    if (!pending) {
      console.warn(`[Relay] Reply without pending request: ${msg.reply_to || 'missing reply_to'}`);
      this.sendRelayError(socket, msg, 'Unknown reply_to', msg.reply_to);
      return;
    }

    if (pending.targetAgentId && pending.targetAgentId !== msg.from.agent_id) {
      this.sendRelayErrorReply(
        socket,
        msg.msg_id,
        msg.from.agent_id,
        'Unauthorized responder',
        `Expected: ${pending.targetAgentId}; got: ${msg.from.agent_id}`
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(msg.reply_to || '');

    if (pending.kind === 'socket' && pending.requesterSocket.readyState === 1) {
      pending.requesterSocket.send(JSON.stringify(msg));
    } else if (pending.kind === 'promise') {
      pending.resolve(msg);
    }

    console.log(`[Relay] ${msg.action} from ${msg.from.agent_id} routed to ${pending.requesterAgentId}`);
  }

  private trackPendingRequest(msg: DAPMessage, requesterSocket: any, targetAgentId?: string): void {
    const existing = this.pendingRequests.get(msg.msg_id);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const requesterAgentId = this.registry.getBySocket(requesterSocket)?.agentId || msg.from.agent_id;
    const timeout = setTimeout(() => {
      const pending = this.pendingRequests.get(msg.msg_id);
      if (!pending) return;

      this.pendingRequests.delete(msg.msg_id);
      const details = targetAgentId ? `Target: ${targetAgentId}` : undefined;
      if (pending.kind === 'socket') {
        this.sendRelayError(
          pending.requesterSocket,
          msg,
          `Request timeout after ${this.config.requestTimeoutMs}ms`,
          details
        );
      } else {
        pending.reject(new RelayRequestError(
          `Request timeout after ${this.config.requestTimeoutMs}ms`,
          'AGENT_TIMEOUT',
          details
        ));
      }
    }, this.config.requestTimeoutMs || 300000);

    this.pendingRequests.set(msg.msg_id, {
      kind: 'socket',
      requesterAgentId,
      requesterSocket,
      targetAgentId,
      timeout,
    });
  }

  private trackPendingPromiseRequest(
    msg: DAPMessage,
    targetAgentId: string,
    resolve: (msg: DAPMessage) => void,
    reject: (err: RelayRequestError) => void,
    timeoutMs?: number
  ): void {
    const requestTimeoutMs = timeoutMs || this.config.requestTimeoutMs || 300000;
    const timeout = setTimeout(() => {
      const pending = this.pendingRequests.get(msg.msg_id);
      if (!pending) return;

      this.pendingRequests.delete(msg.msg_id);
      if (pending.kind === 'promise') {
        pending.reject(new RelayRequestError(
          `Request timeout after ${requestTimeoutMs}ms`,
          'AGENT_TIMEOUT',
          `Target: ${targetAgentId}`
        ));
      }
    }, requestTimeoutMs);

    this.pendingRequests.set(msg.msg_id, {
      kind: 'promise',
      requesterAgentId: msg.from.agent_id,
      targetAgentId,
      timeout,
      resolve,
      reject,
    });
  }

  private sendRelayError(socket: any, originalMsg: DAPMessage, error: string, details?: string): void {
    this.sendRelayErrorReply(socket, originalMsg.msg_id, originalMsg.from.agent_id, error, details);
  }

  private sendRelayErrorReply(socket: any, replyTo: string, toAgentId: string, error: string, details?: string): void {
    if (socket.readyState !== 1) return;

    const errorMsg: DAPMessage = {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: {
        agent_id: 'relay-server',
        capabilities: ['relay'],
        version: '1.0.0',
      },
      to: { agent_id: toAgentId },
      action: MessageAction.ERROR,
      payload: {
        type: 'error-report',
        data: {
          success: false,
          error,
          details,
        },
      },
      reply_to: replyTo,
    };

    socket.send(JSON.stringify(errorMsg));
  }

  private clearPendingForSocket(socket: any, reason: string): void {
    const disconnectedAgent = this.registry.getBySocket(socket);
    for (const [msgId, pending] of this.pendingRequests.entries()) {
      if (pending.kind === 'socket' && pending.requesterSocket === socket) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msgId);
      } else if (pending.targetAgentId && disconnectedAgent?.agentId === pending.targetAgentId) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msgId);
        if (pending.kind === 'socket') {
          this.sendRelayErrorReply(
            pending.requesterSocket,
            msgId,
            pending.requesterAgentId,
            reason,
            `Target: ${pending.targetAgentId}`
          );
        } else {
          pending.reject(new RelayRequestError(reason, 'AGENT_DISCONNECTED', `Target: ${pending.targetAgentId}`));
        }
      }
    }
  }

  private handleEvent(msg: DAPMessage): void {
    const to = msg.to;

    if (to === 'broadcast') {
      this.wsHandler.broadcastAll(msg);
    } else if (typeof to === 'object' && to !== null && 'capability' in to) {
      const agents = this.registry.getByCapability(to.capability);
      for (const agent of agents) {
        if (agent.socket.readyState === 1) {
          agent.socket.send(JSON.stringify(msg));
        }
      }
    }
  }

  private handleCapabilityQuery(socket: any, msg: DAPMessage): void {
    const capabilities = this.registry.getAllCapabilities();
    const agents = this.registry.toJSON();

    socket.send(JSON.stringify({
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay-server', capabilities: ['relay'] },
      to: { agent_id: msg.from.agent_id },
      action: MessageAction.RESPONSE,
      payload: {
        type: 'capability-query-result',
        data: {
          capabilities: Object.fromEntries(capabilities),
          agents,
        },
      },
      reply_to: msg.msg_id,
    } as DAPMessage));
  }

  private handleJobSubmission(msg: DAPMessage): void {
    const { type, priority, payload, capabilityRequired, constraints } = msg.payload.data;

    const job = this.jobQueue.submit(
      msg.from.agent_id,
      type,
      priority ?? 5,
      payload,
      capabilityRequired,
      constraints
    );

    // Notify sender
    const sender = this.registry.get(msg.from.agent_id);
    if (sender) {
      sender.socket.send(JSON.stringify({
        action: MessageAction.EVENT,
        payload: {
          type: 'job-submitted',
          data: {
            jobId: job.job_id,
            status: job.status,
          },
        },
      }));
    }
  }

  private handleJobClaim(msg: DAPMessage): void {
    const { jobId } = msg.payload.data;
    const job = this.jobQueue.claim(jobId, msg.from.agent_id);

    if (job) {
      // Notify submitter
      const submitter = this.registry.get(job.submitter);
      if (submitter) {
        submitter.socket.send(JSON.stringify({
          action: MessageAction.EVENT,
          payload: {
            type: 'job-claimed',
            data: {
              jobId,
              claimedBy: msg.from.agent_id,
            },
          },
        }));
      }
    }
  }

  private handleJobComplete(msg: DAPMessage): void {
    const { jobId, result, error } = msg.payload.data;

    let job;
    if (error) {
      job = this.jobQueue.fail(jobId, error);
    } else {
      job = this.jobQueue.complete(jobId, result);
    }

    if (job) {
      // Notify submitter
      const submitter = this.registry.get(job.submitter);
      if (submitter) {
        submitter.socket.send(JSON.stringify({
          action: MessageAction.EVENT,
          payload: {
            type: 'job-completed',
            data: {
              jobId,
              status: job.status,
              result: job.result,
              error: job.error,
            },
          },
        }));
      }
    }
  }

  async sendRequestToAgent(
    targetAgentId: string,
    task: {
      description: string;
      type: string;
      context?: Record<string, unknown>;
      priority?: number;
    },
    options: { timeoutMs?: number; fromAgentId?: string } = {}
  ): Promise<DAPMessage> {
    const target = this.registry.get(targetAgentId);
    if (!target || target.socket.readyState !== 1) {
      throw new RelayRequestError('Agent not found or offline', 'AGENT_NOT_FOUND', `Agent: ${targetAgentId}`);
    }

    const msg: DAPMessage = {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: {
        agent_id: options.fromAgentId || 'a2a-gateway',
        capabilities: ['a2a-gateway'],
        version: '1.0.0',
      },
      to: { agent_id: targetAgentId },
      action: MessageAction.REQUEST,
      payload: {
        type: PayloadType.TASK_DELEGATION,
        data: task,
      },
    };

    return new Promise((resolve, reject) => {
      this.trackPendingPromiseRequest(msg, targetAgentId, resolve, reject, options.timeoutMs);
      try {
        target.socket.send(JSON.stringify(msg));
      } catch (err) {
        const pending = this.pendingRequests.get(msg.msg_id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.msg_id);
        }
        reject(new RelayRequestError(
          'Failed to send request to target agent',
          'AGENT_SEND_FAILED',
          err instanceof Error ? err.message : String(err)
        ));
      }
    });
  }
}
