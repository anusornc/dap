/**
 * Prometheus Metrics for DAP Relay Server
 * Comprehensive instrumentation for monitoring and observability
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
const register = new Registry();

// Add default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// ============ Job Metrics ============

export const jobsSubmitted = new Counter({
  name: 'dap_jobs_submitted_total',
  help: 'Total jobs submitted',
  labelNames: ['type', 'priority'],
  registers: [register],
});

export const jobsClaimed = new Counter({
  name: 'dap_jobs_claimed_total',
  help: 'Total jobs claimed',
  registers: [register],
});

export const jobsCompleted = new Counter({
  name: 'dap_jobs_completed_total',
  help: 'Total jobs completed',
  registers: [register],
});

export const jobsFailed = new Counter({
  name: 'dap_jobs_failed_total',
  help: 'Total jobs failed',
  registers: [register],
});

export const jobsCancelled = new Counter({
  name: 'dap_jobs_cancelled_total',
  help: 'Total jobs cancelled',
  registers: [register],
});

export const pendingJobs = new Gauge({
  name: 'dap_pending_jobs',
  help: 'Pending jobs currently in queue',
  labelNames: ['type'],
  registers: [register],
});

export const claimedJobs = new Gauge({
  name: 'dap_claimed_jobs',
  help: 'Jobs that have been claimed but not started',
  registers: [register],
});

export const inProgressJobs = new Gauge({
  name: 'dap_in_progress_jobs',
  help: 'Jobs currently being processed',
  registers: [register],
});

export const jobDuration = new Histogram({
  name: 'dap_job_duration_seconds',
  help: 'Job duration in seconds from submission to completion',
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [register],
});

// ============ Agent Metrics ============

export const activeAgents = new Gauge({
  name: 'dap_active_agents',
  help: 'Currently active agents',
  labelNames: ['shimType'],
  registers: [register],
});

export const agentsRegistered = new Counter({
  name: 'dap_agents_registered_total',
  help: 'Total agents registered since server start',
  registers: [register],
});

export const agentHeartbeats = new Counter({
  name: 'dap_agent_heartbeats_total',
  help: 'Total heartbeat messages received',
  registers: [register],
});

export const staleAgents = new Gauge({
  name: 'dap_stale_agents',
  help: 'Agents that have missed heartbeats (considered stale)',
  registers: [register],
});

export const wsConnections = new Gauge({
  name: 'dap_ws_connections',
  help: 'Current WebSocket connections',
  registers: [register],
});

// ============ Message Metrics ============

export const messagesTotal = new Counter({
  name: 'dap_messages_total',
  help: 'Total messages processed',
  labelNames: ['action', 'direction'],
  registers: [register],
});

export const messageSize = new Histogram({
  name: 'dap_message_size_bytes',
  help: 'Message size in bytes',
  buckets: [128, 512, 1024, 4096, 16384, 65536],
  registers: [register],
});

// ============ System Metrics ============

export const requestsTotal = new Counter({
  name: 'dap_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const requestDuration = new Histogram({
  name: 'dap_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  labelNames: ['method', 'path'],
  registers: [register],
});

export const errorsTotal = new Counter({
  name: 'dap_errors_total',
  help: 'Total errors by type and endpoint',
  labelNames: ['type', 'endpoint'],
  registers: [register],
});

export const rateLimited = new Counter({
  name: 'dap_rate_limited_total',
  help: 'Total requests rejected due to rate limiting',
  registers: [register],
});

// ============ Legacy Metric Aliases (for backward compatibility) ============
// These provide the same metrics as the original /metrics endpoint format

export const connectedAgents = new Gauge({
  name: 'dap_connected_agents',
  help: 'Number of connected agents (alias for dap_active_agents total)',
  registers: [register],
});

export const uptimeSeconds = new Gauge({
  name: 'dap_uptime_seconds',
  help: 'Server uptime in seconds',
  registers: [register],
});

// Update uptime gauge every second
let serverStartTime = Date.now();
setInterval(() => {
  uptimeSeconds.set((Date.now() - serverStartTime) / 1000);
}, 1000);

// Export the registry for /metrics endpoint
export { register };