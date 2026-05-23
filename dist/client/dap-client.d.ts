/**
 * DAP Client Library
 * Easy-to-use client for connecting agents to the relay
 */
import { DAPMessage, Capability, Job } from '../protocol/types.js';
export interface DAPClientConfig {
    relayUrl: string;
    agentId: string;
    apiKey?: string;
    capabilities: Capability[];
    metadata?: Record<string, unknown>;
    reconnectIntervalMs?: number;
    requestTimeoutMs?: number;
}
export type MessageHandler = (msg: DAPMessage) => Promise<void>;
export declare class DAPClient {
    private config;
    private socket;
    private connected;
    private messageHandlers;
    private pendingRequests;
    private reconnectTimer?;
    private reconnectAttempts;
    constructor(config: DAPClientConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    private scheduleReconnect;
    private handleMessage;
    on(action: string, handler: MessageHandler): void;
    off(action: string): void;
    private send;
    private getAgentInfo;
    sendRequest(toAgentId: string, task: {
        description: string;
        type: string;
        context?: Record<string, unknown>;
        priority?: number;
    }, timeoutMs?: number): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
        executionTimeMs: number;
    }>;
    sendEvent(to: string | {
        capability?: string;
        agent_id?: string;
    }, eventType: string, data: Record<string, unknown>): Promise<void>;
    submitJob(jobType: string, payload: Record<string, unknown>, options?: {
        priority?: number;
        capabilityRequired?: string;
        constraints?: Record<string, unknown>;
        timeoutSeconds?: number;
    }): Promise<string>;
    claimJob(capability: string): Promise<Job | null>;
    completeJob(jobId: string, result: unknown, error?: string): Promise<void>;
    getCapabilities(): Promise<Map<string, string[]>>;
    getAgentId(): string;
    getCapabilitiesList(): string[];
}
export declare function createDAPClient(config: DAPClientConfig): DAPClient;
export default DAPClient;
//# sourceMappingURL=dap-client.d.ts.map