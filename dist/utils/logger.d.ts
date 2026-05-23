/**
 * Structured Logger
 * JSON-formatted logging for the DAP relay with Prometheus metrics
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export interface LogEntry {
    timestamp: string;
    level: string;
    service: string;
    message: string;
    request_id?: string;
    [key: string]: unknown;
}
export interface RequestLogEntry {
    method: string;
    path: string;
    status: number;
    latency_ms: number;
    request_id: string;
    agent_id?: string;
}
export declare class Logger {
    private service;
    private minLevel;
    constructor(service: string, minLevel?: LogLevel);
    private log;
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    child(service: string): Logger;
    withRequestId(requestId: string): RequestLogger;
}
export declare class RequestLogger {
    private logger;
    private requestId;
    constructor(logger: Logger, requestId: string);
    info(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
}
export declare function generateRequestId(): string;
export declare const relayLogger: Logger;
export declare const wsLogger: Logger;
export declare const restLogger: Logger;
export declare const jobLogger: Logger;
export declare const agentLogger: Logger;
export interface Metrics {
    connectedAgents: number;
    messagesProcessed: Record<string, number>;
    requestsTotal: number;
    requestsDuration: number[];
    uptime: number;
    memoryUsage: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
    };
    requestHistogram: Record<number, number>;
}
declare class MetricsCollector {
    private messagesProcessed;
    private requestDurations;
    private startTime;
    private recentErrors;
    private lastErrorReset;
    recordMessage(action: string): void;
    recordRequest(durationMs: number): void;
    recordError(): void;
    getRecentErrorCount(): number;
    getMetrics(_jobStats: Record<string, number>, connectedAgents: number): Metrics;
    getLatencyBuckets(): number[];
}
export declare const metricsCollector: MetricsCollector;
export declare function logInvalidKeyAttempt(apiKey: string | undefined, ip: string, path: string, method: string): void;
export {};
//# sourceMappingURL=logger.d.ts.map