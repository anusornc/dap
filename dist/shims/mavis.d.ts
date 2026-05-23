/**
 * Mavis Shim
 * Connects Mavis agents to the DAP relay
 */
import { DAPMessage } from '../protocol/types.js';
export interface ShimConfig {
    relayUrl: string;
    agentId: string;
    apiKey?: string;
    capabilities: any[];
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
/**
 * Mavis Shim Configuration
 */
export interface MavisShimConfig extends ShimConfig {
    mavisSessionId?: string;
    mavisAgentName?: string;
    timeoutMs?: number;
}
export declare class MavisShim {
    private config;
    private socket;
    private connected;
    private eventHandler?;
    private pendingRequests;
    constructor(config: MavisShimConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    private handleIncomingMessage;
    private handleRequest;
    private executeViaMavis;
    private handleResponse;
    private handleEvent;
    private handleJobClaim;
    private sendMessage;
    private getAgentInfo;
    delegateTask(targetAgentId: string, task: Task, timeoutMs?: number): Promise<TaskResult>;
    submitJob(jobType: string, payload: Record<string, unknown>, priority?: number, capabilityRequired?: string): Promise<string>;
    setEventHandler(handler: ShimEventHandler): void;
}
export declare function runMavisShim(): Promise<void>;
export default MavisShim;
//# sourceMappingURL=mavis.d.ts.map