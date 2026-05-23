/**
 * Base Agent Shim Interface
 * Abstract interface for connecting agents to the relay
 */
import { DAPMessage, Capability, AgentInfo } from '../protocol/types.js';
export interface ShimConfig {
    relayUrl: string;
    agentId: string;
    apiKey?: string;
    capabilities: Capability[];
    metadata?: Record<string, unknown>;
}
export interface Task {
    taskId: string;
    description: string;
    type: string;
    context?: Record<string, unknown>;
    priority?: number;
}
export interface TaskResult {
    success: boolean;
    data?: unknown;
    error?: string;
    executionTimeMs: number;
}
export interface ShimEventHandler {
    onTask?: (task: Task) => Promise<TaskResult>;
    onJobClaim?: (job: any) => Promise<void>;
    onJobComplete?: (jobId: string, result: unknown) => Promise<void>;
    onEvent?: (event: DAPMessage) => Promise<void>;
    onError?: (error: Error) => void;
}
export declare class BaseShim {
    protected config: ShimConfig;
    protected socket: WebSocket | null;
    protected connected: boolean;
    protected eventHandler?: ShimEventHandler;
    protected pendingRequests: Map<string, {
        resolve: (msg: DAPMessage) => void;
        reject: (err: Error) => void;
        timeout: NodeJS.Timeout;
    }>;
    constructor(config: ShimConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    protected handleMessage(_msg: DAPMessage): Promise<void>;
    protected sendToLocalAgent(task: Task): Promise<TaskResult>;
    protected sendMessage(msg: DAPMessage): Promise<void>;
    protected sendRequest(toAgentId: string, task: Task, timeoutMs?: number): Promise<DAPMessage>;
    setEventHandler(handler: ShimEventHandler): void;
    queryCapabilities(): Promise<Map<string, string[]>>;
    protected getAgentInfo(): AgentInfo;
}
export declare class GenericDAPShim extends BaseShim {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    protected handleMessage(msg: DAPMessage): Promise<void>;
    protected sendToLocalAgent(task: Task): Promise<TaskResult>;
}
//# sourceMappingURL=base.d.ts.map