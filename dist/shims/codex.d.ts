/**
 * Codex Shim
 * Connects OpenAI Codex agents to the DAP relay
 * Uses file-based task manifests for communication
 */
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
export interface CodexShimConfig {
    relayUrl: string;
    agentId: string;
    apiKey?: string;
    capabilities: any[];
    metadata?: Record<string, unknown>;
    codexTaskDir?: string;
    codexExecutable?: string;
    pollIntervalMs?: number;
}
export declare class CodexShim {
    private config;
    private socket;
    private connected;
    private taskDir;
    private resultDir;
    private pollInterval?;
    private pendingRequests;
    constructor(config: CodexShimConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    private handleIncomingMessage;
    private handleRequest;
    private delegateToCodex;
    private handleResponse;
    private sendMessage;
    private getAgentInfo;
    private startPolling;
    private stopPolling;
}
export declare function runCodexShim(): Promise<void>;
export default CodexShim;
//# sourceMappingURL=codex.d.ts.map