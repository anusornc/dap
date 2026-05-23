/**
 * WebSocket Handler
 * Manages real-time agent connections
 */
import { WebSocketServer } from 'ws';
import { DAPMessage } from '../protocol/types.js';
import { AgentRegistry } from './agent-registry.js';
export interface WSHandlerConfig {
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    maxMessageSize: number;
}
export declare class WSHandler {
    private wss;
    private registry;
    private heartbeatIntervals;
    private pendingRequests;
    private config;
    constructor(wss: WebSocketServer, registry: AgentRegistry, config?: Partial<WSHandlerConfig>, options?: {
        skipSetup?: boolean;
    });
    private setupServer;
    private handleConnection;
    private handleMessage;
    private handleRequest;
    private handleResponse;
    private handleStream;
    private handleEvent;
    private handleJobSubmission;
    private handleJobClaim;
    private handleJobComplete;
    private handleHeartbeat;
    private handleCapabilityQuery;
    private send;
    private sendError;
    private broadcast;
    private broadcastToCapability;
    private startHeartbeat;
    private handleDisconnect;
    sendToAgent(agentId: string, msg: DAPMessage): boolean;
    broadcastAll(msg: DAPMessage): void;
    getConnectedCount(): number;
    close(): void;
}
//# sourceMappingURL=ws-handler.d.ts.map