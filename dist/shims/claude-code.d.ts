/**
 * Claude Code Shim
 * Connects Claude Code agents to the DAP relay
 */
import { DAPMessage } from '../protocol/types.js';
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
    onEvent?: (event: DAPMessage) => Promise<void>;
}
export interface ClaudeCodeShimConfig {
    relayUrl: string;
    agentId: string;
    apiKey?: string;
    capabilities: any[];
    metadata?: Record<string, unknown>;
    claudePath?: string;
    claudeArgs?: string[];
    workDir?: string;
    maxConcurrent?: number;
}
export declare class ClaudeCodeShim {
    private config;
    private socket;
    private connected;
    private eventHandler?;
    private activeProcesses;
    private pendingRequests;
    constructor(config: ClaudeCodeShimConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    private handleIncomingMessage;
    private handleRequest;
    private executeViaClaudeCode;
    private handleResponse;
    private sendMessage;
    private getAgentInfo;
    private cleanupProcesses;
    setEventHandler(handler: ShimEventHandler): void;
}
export declare function runClaudeShim(): Promise<void>;
export default ClaudeCodeShim;
//# sourceMappingURL=claude-code.d.ts.map