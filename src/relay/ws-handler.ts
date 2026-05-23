/**
 * WebSocket Handler
 * Manages real-time agent connections
 */

import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  DAPMessage,
  MessageAction,
} from '../protocol/types.js';
import { AgentRegistry } from './agent-registry.js';
import {
  messagesTotal,
  messageSize,
  wsConnections,
} from '../utils/metrics.js';

export interface WSHandlerConfig {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxMessageSize: number;
}

export class WSHandler {
  private wss: WebSocketServer;
  private registry: AgentRegistry;
  private heartbeatIntervals: Map<any, NodeJS.Timeout> = new Map();
  private pendingRequests: Map<string, {
    resolve: (msg: DAPMessage) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private config: WSHandlerConfig;

  constructor(
    wss: WebSocketServer,
    registry: AgentRegistry,
    config: Partial<WSHandlerConfig> = {},
    options?: { skipSetup?: boolean }
  ) {
    this.wss = wss;
    this.registry = registry;
    this.config = {
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 60000,
      maxMessageSize: config.maxMessageSize ?? 1024 * 1024, // 1MB
    };

    // Skip server setup if the relay server handles connections
    // This avoids duplicate message handling
    if (!options?.skipSetup) {
      this.setupServer();
    }
  }

  private setupServer(): void {
    this.wss.on('connection', (socket, request) => {
      this.handleConnection(socket, request);
    });
  }

  private handleConnection(socket: any, _request: any): void {
    const connectionId = uuidv4();
    console.log(`[WS] New connection: ${connectionId}`);

    // Update metrics
    wsConnections.inc();

    // Set up heartbeat
    this.startHeartbeat(socket, connectionId);

    // Handle messages
    socket.on('message', (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString());
        const msg = raw as DAPMessage;

        // Record message metrics
        const action = msg.action || 'unknown';
        messagesTotal.labels(action, 'in').inc();
        messageSize.observe(data.length);

        if (!msg.action) {
          this.sendError(socket, 'Invalid message format', 'Missing action');
          return;
        }

        this.handleMessage(socket, msg);
      } catch (err) {
        console.error(`[WS] Message parse error:`, err);
        this.sendError(socket, 'Invalid JSON', String(err));
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      this.handleDisconnect(socket);
    });

    // Handle errors
    socket.on('error', (err: Error) => {
      console.error(`[WS] Socket error:`, err);
    });
  }

  private handleMessage(socket: any, msg: DAPMessage): void {
    console.log(`[WS] Message received: ${msg.action} from ${msg.from?.agent_id}`);

    switch (msg.action) {
      case MessageAction.REQUEST:
        this.handleRequest(socket, msg);
        break;

      case MessageAction.RESPONSE:
        this.handleResponse(socket, msg);
        break;

      case MessageAction.STREAM:
        this.handleStream(socket, msg);
        break;

      case MessageAction.EVENT:
        this.handleEvent(socket, msg);
        break;

      case MessageAction.JOB_SUBMISSION:
        this.handleJobSubmission(socket, msg);
        break;

      case MessageAction.JOB_CLAIM:
        this.handleJobClaim(socket, msg);
        break;

      case MessageAction.JOB_COMPLETE:
        this.handleJobComplete(socket, msg);
        break;

      case MessageAction.HEARTBEAT:
        this.handleHeartbeat(socket, msg);
        break;

      case MessageAction.CAPABILITY_QUERY:
        this.handleCapabilityQuery(socket, msg);
        break;

      default:
        console.warn(`[WS] Unknown action: ${msg.action}`);
    }
  }

  private handleRequest(socket: any, msg: DAPMessage): void {
    const to = msg.to as any;

    if ('agent_id' in to) {
      // Direct message to agent
      const targetAgent = this.registry.get(to.agent_id);
      if (targetAgent && targetAgent.socket.readyState === 1) {
        this.send(targetAgent.socket, msg);
      } else {
        this.sendError(socket, 'Agent not found or offline', `Agent: ${to.agent_id}`);
      }
    } else if ('capability' in to) {
      // Route to agent with capability
      const agents = this.registry.getByCapability(to.capability);
      const available = agents.filter(a => a.socket.readyState === 1);

      if (available.length > 0) {
        // Pick first available
        this.send(available[0].socket, msg);
      } else {
        this.sendError(socket, 'No agent available with capability', `Capability: ${to.capability}`);
      }
    } else {
      this.sendError(socket, 'Invalid destination', 'Missing to.agent_id or to.capability');
    }
  }

  private handleResponse(_socket: any, msg: DAPMessage): void {
    // Find pending request
    const pending = this.pendingRequests.get(msg.reply_to || '');
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(msg);
      this.pendingRequests.delete(msg.reply_to || '');
    }

    console.log(`[WS] Response to ${msg.reply_to}`);
  }

  private handleStream(_socket: any, msg: DAPMessage): void {
    if (msg.reply_to) {
      console.log(`[WS] Stream chunk for ${msg.reply_to}`);
    }
  }

  private handleEvent(_socket: any, msg: DAPMessage): void {
    const to = msg.to as any;

    if (to === 'broadcast') {
      this.broadcast(msg, msg.from?.agent_id);
    } else if ('capability' in to) {
      this.broadcastToCapability(msg, to.capability, msg.from?.agent_id);
    } else if ('agent_id' in to) {
      const target = this.registry.get(to.agent_id);
      if (target && target.socket.readyState === 1) {
        this.send(target.socket, msg);
      }
    }
  }

  private handleJobSubmission(socket: any, _msg: DAPMessage): void {
    this.send(socket, {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay', capabilities: [] },
      to: { agent_id: 'unknown' },
      action: MessageAction.EVENT,
      payload: {
        type: 'job-submission-ack',
        data: { received: true },
      },
    } as DAPMessage);
  }

  private handleJobClaim(socket: any, _msg: DAPMessage): void {
    this.send(socket, {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay', capabilities: [] },
      to: { agent_id: 'unknown' },
      action: MessageAction.EVENT,
      payload: {
        type: 'job-claim-ack',
        data: { claimed: true },
      },
    } as DAPMessage);
  }

  private handleJobComplete(_socket: any, msg: DAPMessage): void {
    console.log(`[WS] Job completed by ${msg.from?.agent_id}`);
  }

  private handleHeartbeat(socket: any, msg: DAPMessage): void {
    const agent = this.registry.getBySocket(socket);
    if (agent) {
      this.registry.updateHeartbeat(agent.agentId);
    }

    // Respond with heartbeat ack
    this.send(socket, {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay', capabilities: [] },
      to: { agent_id: msg.from?.agent_id || 'unknown' },
      action: MessageAction.EVENT,
      payload: {
        type: 'heartbeat-ack',
        data: { serverTime: Date.now() },
      },
    } as DAPMessage);
  }

  private handleCapabilityQuery(socket: any, msg: DAPMessage): void {
    const capabilities = this.registry.getAllCapabilities();
    const agents = this.registry.toJSON();

    this.send(socket, {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay', capabilities: [] },
      to: { agent_id: msg.from?.agent_id || 'unknown' },
      action: MessageAction.RESPONSE,
      payload: {
        type: 'capability-query-result',
        data: {
          capabilities: Object.fromEntries(capabilities),
          agents,
        },
      },
    } as DAPMessage);
  }

  // ============ Helper Methods ============

  private send(socket: any, msg: DAPMessage): void {
    if (socket.readyState === 1) { // OPEN
      const msgStr = JSON.stringify(msg);
      socket.send(msgStr);
      // Record outgoing message metrics
      const action = msg.action || 'unknown';
      messagesTotal.labels(action, 'out').inc();
      messageSize.observe(Buffer.byteLength(msgStr, 'utf8'));
    }
  }

  private sendError(socket: any, error: string, details?: string): void {
    this.send(socket, {
      version: '1.0.0',
      msg_id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: { agent_id: 'relay', capabilities: [] },
      to: { agent_id: 'unknown' },
      action: MessageAction.ERROR,
      payload: {
        type: 'error-report',
        data: { error, details },
      },
    } as DAPMessage);
  }

  private broadcast(msg: DAPMessage, excludeAgentId?: string): void {
    for (const agent of this.registry.getAll()) {
      if (agent.agentId !== excludeAgentId && agent.socket.readyState === 1) {
        this.send(agent.socket, msg);
      }
    }
  }

  private broadcastToCapability(msg: DAPMessage, capability: string, excludeAgentId?: string): void {
    const agents = this.registry.getByCapability(capability);
    for (const agent of agents) {
      if (agent.agentId !== excludeAgentId && agent.socket.readyState === 1) {
        this.send(agent.socket, msg);
      }
    }
  }

  private startHeartbeat(socket: any, connectionId: string): void {
    const interval = setInterval(() => {
      if (socket.readyState === 1) {
        this.send(socket, {
          version: '1.0.0',
          msg_id: uuidv4(),
          timestamp: new Date().toISOString(),
          from: { agent_id: 'relay', capabilities: [] },
          to: 'broadcast',
          action: MessageAction.HEARTBEAT,
          payload: {
            type: 'heartbeat',
            data: { connectionId },
          },
        } as DAPMessage);
      }
    }, this.config.heartbeatIntervalMs);

    this.heartbeatIntervals.set(socket, interval);
  }

  private handleDisconnect(socket: any): void {
    const agent = this.registry.getBySocket(socket);
    if (agent) {
      console.log(`[WS] Agent disconnected: ${agent.agentId}`);
      this.registry.unregister(agent.agentId);
    }

    // Update metrics
    wsConnections.dec();

    // Clear heartbeat interval
    const interval = this.heartbeatIntervals.get(socket);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(socket);
    }
  }

  // ============ Public Methods ============

  sendToAgent(agentId: string, msg: DAPMessage): boolean {
    const agent = this.registry.get(agentId);
    if (agent && agent.socket.readyState === 1) {
      this.send(agent.socket, msg);
      return true;
    }
    return false;
  }

  broadcastAll(msg: DAPMessage): void {
    this.broadcast(msg);
  }

  getConnectedCount(): number {
    return this.registry.getAll().filter(a => a.socket.readyState === 1).length;
  }

  close(): void {
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();
  }
}