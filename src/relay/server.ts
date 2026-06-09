/**
 * DAP Relay Server
 * Main entry point for the distributed agent relay
 */

import { createServer, Server as HTTPServer } from 'http';
import { createServer as createHTTPSServer, Server as HTTPSServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { AgentRegistry } from './agent-registry.js';
import { AgentCards } from './agent-cards.js';
import { JobQueue } from './job-queue.js';
import { WSHandler } from './ws-handler.js';
import { RESTHandler } from './rest-handler.js';
import { RelayConfig, MessageAction, PayloadType, DAPMessage } from '../protocol/types.js';
import { validateMessage, sanitizeAgentId } from '../protocol/validation.js';
import { v4 as uuidv4 } from 'uuid';
import { wsConnections, connectedAgents } from '../utils/metrics.js';
// Note: metrics.ts is imported implicitly via the metrics singletons
// Default metrics (CPU, memory) are collected via collectDefaultMetrics() in metrics.ts

// Load environment
config();

console.log('[Relay] Prometheus metrics enabled - default metrics collected');

const DEFAULT_CONFIG: Partial<RelayConfig> = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  apiKeys: process.env.API_KEYS?.split(',').filter(Boolean) || [],
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000'),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '60000'),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '300000'),
  enableTls: process.env.ENABLE_TLS === 'true',
  tlsCertPath: process.env.TLS_CERT_PATH || './certs/cert.pem',
  tlsKeyPath: process.env.TLS_KEY_PATH || './certs/key.pem',
  tlsPort: parseInt(process.env.TLS_PORT || '3443'),
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',').filter(Boolean) || [],
};

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

type PendingRelayRequest = SocketPendingRelayRequest | PromisePendingRelayRequest;

export class RelayServer {
  private httpServer?: HTTPServer;
  private httpsServer?: HTTPSServer;
  private wss: WebSocketServer;
  private app: express.Application;
  private registry: AgentRegistry;
  private agentCards: AgentCards;
  private jobQueue: JobQueue;
  private wsHandler: WSHandler;
  private restHandler: RESTHandler;
  private config: RelayConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private pendingRequests: Map<string, PendingRelayRequest> = new Map();
  private _boundPort: number = 0;

  constructor(config: Partial<RelayConfig> = {}, options?: { testMode?: boolean }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RelayConfig;

    // Initialize components
    this.registry = new AgentRegistry('./shapes', { testMode: options?.testMode });
    this.agentCards = new AgentCards(this.registry);
    this.jobQueue = new JobQueue(process.env.DATA_DIR || './data');

    // Express app
    this.app = express();

    // WebSocket server (created lazily based on TLS setting)
    this.wss = new WebSocketServer({ noServer: true });

    // Initialize handlers
    this.wsHandler = new WSHandler(this.wss, this.registry, {
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
    }, { skipSetup: true }); // Skip to avoid duplicate connections - server handles them

    this.restHandler = new RESTHandler(this.registry, this.jobQueue, {
      apiKeys: this.config.apiKeys,
      corsAllowedOrigins: this.config.corsAllowedOrigins,
    });
    this.restHandler.setAgentCards(this.agentCards);
    this.restHandler.setA2ADispatcher(({ targetAgentId, task, timeoutMs }) =>
      this.sendRequestToAgent(targetAgentId, task, { timeoutMs })
    );

    this.setupRoutes();
    this.setupUpgradeHandlers();
    this.handleWSConnection();
    this.startCleanup();

    // Set up server's own agent card
    this.agentCards.setServerCard({
      id: 'relay-server',
      type: 'AgentCard',
      name: 'DAP Relay Server',
      description: 'Central relay server for distributed agent coordination',
      capabilities: [
        { name: 'relay', version: '1.0.0', description: 'Message relay and routing' },
        { name: 'job-queue', version: '1.0.0', description: 'Job submission and management' },
        { name: 'capability-discovery', version: '1.0.0', description: 'Semantic agent card discovery' },
      ],
      version: '1.0.0',
      protocolVersion: '1.0.0',
      shimType: 'custom',
      endpoints: {
        wssUrl: process.env.WSS_URL,
        httpUrl: process.env.HTTP_URL,
      },
      status: 'active',
      metadata: {
        uptime: process.uptime(),
        connectedAgents: 0,
      },
      '@context': 'https://dap-protocol.org/ns/agent-card-context.json',
    });
  }

  private setupUpgradeHandlers(): void {
    // HTTP server handles upgrade for WebSocket
    this.httpServer = createServer(this.app);
    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', `http://127.0.0.1:${this._boundPort || this.config.port}`);
      const pathname = url.pathname;
      
      if (pathname === '/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // HTTPS server for TLS
    if (this.config.enableTls) {
      try {
        const options = {
          cert: readFileSync(this.config.tlsCertPath!),
          key: readFileSync(this.config.tlsKeyPath!),
        };
        
        this.httpsServer = createHTTPSServer(options, this.app);
        this.httpsServer.on('upgrade', (request, socket, head) => {
          const pathname = new URL(request.url || '/', `https://${request.headers.host}`).pathname;
          
          if (pathname === '/ws') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
              this.wss.emit('connection', ws, request);
            });
          } else {
            socket.destroy();
          }
        });
      } catch (err) {
        console.warn('[Relay] TLS enabled but certificates not found. Running HTTP only.');
        this.config.enableTls = false;
      }
    }
  }

  private setupRoutes(): void {
    // Use REST handler's app
    this.app.use(this.restHandler.getApp());
  }

  private handleWSConnection(): void {
    this.wss.on('connection', (socket, request) => {
      const baseUrl = `http://127.0.0.1:${this._boundPort || this.config.port}`;
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

  private handleRegistration(socket: WebSocket, msg: any): void {
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

  private handleMessage(socket: WebSocket, msg: DAPMessage): void {
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

  private handleRequest(socket: WebSocket, msg: DAPMessage): void {
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

  private handleReply(socket: WebSocket, msg: DAPMessage): void {
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

  private sendRelayError(socket: WebSocket, originalMsg: DAPMessage, error: string, details?: string): void {
    this.sendRelayErrorReply(socket, originalMsg.msg_id, originalMsg.from.agent_id, error, details);
  }

  private sendRelayErrorReply(socket: WebSocket, replyTo: string, toAgentId: string, error: string, details?: string): void {
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

  private clearPendingForSocket(socket: WebSocket, reason: string): void {
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

  private handleCapabilityQuery(socket: WebSocket, msg: DAPMessage): void {
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

  private startCleanup(): void {
    // Remove stale agents every minute
    this.cleanupInterval = setInterval(() => {
      const stale = this.registry.getStaleAgents(this.config.heartbeatTimeoutMs);

      for (const agent of stale) {
        console.log(`[Relay] Removing stale agent: ${agent.agentId}`);
        agent.socket.close(4002, 'Heartbeat timeout');
        this.registry.unregister(agent.agentId);
      }

      // Clean old jobs
      const removedJobs = this.jobQueue.cleanStale(7 * 24 * 60 * 60 * 1000); // 7 days
      if (removedJobs.length > 0) {
        console.log(`[Relay] Cleaned ${removedJobs.length} old jobs`);
      }
    }, 60000);
  }

  // ============ Public API ============

  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Start HTTP server
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer!.address() as any;
        this._boundPort = addr?.port || this.config.port;
        console.log(`  HTTP:  http://${this.config.host}:${this._boundPort}`);

        // Start HTTPS server if TLS enabled
        if (this.config.enableTls && this.httpsServer) {
          this.httpsServer.listen(this.config.tlsPort, this.config.host, () => {
            console.log(`  HTTPS: https://${this.config.host}:${this.config.tlsPort}`);
            finish();
          });
        } else {
          finish();
        }
      });

      const finish = () => {
        console.log(`
 ╔════════════════════════════════════════════════════════╗
 ║           DAP Relay Server v1.0.0                      ║
 ╠════════════════════════════════════════════════════════╣
 ║  HTTP:    http://${this.config.host}:${this._boundPort}                      ║
 ║  WebSocket: ws://${this.config.host}:${this._boundPort}/ws                ║${this.config.enableTls ? `
 ║  HTTPS:   https://${this.config.host}:${this.config.tlsPort}                     ║
 ║  WSS:     wss://${this.config.host}:${this.config.tlsPort}/ws              ║` : ''}
 ╠════════════════════════════════════════════════════════╣
 ║  API Keys: ${this.config.apiKeys.length > 0 ? this.config.apiKeys.join(', ') : 'none (open)'}     ║
 ║  Heartbeat: ${this.config.heartbeatIntervalMs}ms / timeout ${this.config.heartbeatTimeoutMs}ms       ║
 ║  TLS:     ${this.config.enableTls ? `enabled (port ${this.config.tlsPort})` : 'disabled'}              ║
 ╚════════════════════════════════════════════════════════╝
        `);
        resolve();
      };
    });
  }

  async stop(): Promise<void> {
    console.log('[Relay] Shutting down...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all WebSocket connections
    for (const agent of this.registry.getAll()) {
      agent.socket.close(1001, 'Server shutting down');
    }

    for (const [msgId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msgId);
      if (pending.kind === 'promise') {
        pending.reject(new RelayRequestError('Server shutting down', 'SERVER_SHUTDOWN'));
      }
    }

    // Close servers
    return new Promise((resolve) => {
      const servers: HTTPServer[] = [this.httpServer!];
      if (this.httpsServer) servers.push(this.httpsServer);

      let closed = 0;
      for (const server of servers) {
        server.close(() => {
          closed++;
          if (closed === servers.length) {
            console.log('[Relay] Server stopped');
            resolve();
          }
        });
      }
    });
  }

  getAddress(): { host: string; port: number; tlsPort?: number } {
    return {
      host: this.config.host,
      port: this._boundPort || this.config.port,
      tlsPort: this.config.enableTls ? this.config.tlsPort : undefined,
    };
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

// ============ CLI Entry Point ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const relay = new RelayServer();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await relay.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await relay.stop();
    process.exit(0);
  });

  relay.start().catch(console.error);
}

export default RelayServer;
