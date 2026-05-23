/**
 * Prometheus Metrics for DAP Relay Server
 * Comprehensive instrumentation for monitoring and observability
 */
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
declare const register: Registry<"text/plain; version=0.0.4; charset=utf-8">;
export declare const jobsSubmitted: Counter<"type" | "priority">;
export declare const jobsClaimed: Counter<string>;
export declare const jobsCompleted: Counter<string>;
export declare const jobsFailed: Counter<string>;
export declare const jobsCancelled: Counter<string>;
export declare const pendingJobs: Gauge<"type">;
export declare const claimedJobs: Gauge<string>;
export declare const inProgressJobs: Gauge<string>;
export declare const jobDuration: Histogram<string>;
export declare const activeAgents: Gauge<"shimType">;
export declare const agentsRegistered: Counter<string>;
export declare const agentHeartbeats: Counter<string>;
export declare const staleAgents: Gauge<string>;
export declare const wsConnections: Gauge<string>;
export declare const messagesTotal: Counter<"action" | "direction">;
export declare const messageSize: Histogram<string>;
export declare const requestsTotal: Counter<"path" | "status" | "method">;
export declare const requestDuration: Histogram<"path" | "method">;
export declare const errorsTotal: Counter<"type" | "endpoint">;
export declare const rateLimited: Counter<string>;
export declare const connectedAgents: Gauge<string>;
export declare const uptimeSeconds: Gauge<string>;
export { register };
//# sourceMappingURL=metrics.d.ts.map