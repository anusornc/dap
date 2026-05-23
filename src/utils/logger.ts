/**
 * Structured Logger
 * JSON-formatted logging for the DAP relay with Prometheus metrics
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

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

export class Logger {
  private service: string;
  private minLevel: LogLevel;

  constructor(service: string, minLevel: LogLevel = LogLevel.INFO) {
    this.service = service;
    this.minLevel = minLevel;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      service: this.service,
      message,
      ...context,
    };

    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  child(service: string): Logger {
    return new Logger(`${this.service}:${service}`, this.minLevel);
  }

  withRequestId(requestId: string): RequestLogger {
    return new RequestLogger(this, requestId);
  }
}

export class RequestLogger {
  private logger: Logger;
  private requestId: string;

  constructor(logger: Logger, requestId: string) {
    this.logger = logger;
    this.requestId = requestId;
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(message, { request_id: this.requestId, ...context });
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(message, { request_id: this.requestId, ...context });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(message, { request_id: this.requestId, ...context });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(message, { request_id: this.requestId, ...context });
  }
}

// Generate unique request ID
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

// Global logger instances
export const relayLogger = new Logger('relay');
export const wsLogger = relayLogger.child('ws');
export const restLogger = relayLogger.child('rest');
export const jobLogger = relayLogger.child('job');
export const agentLogger = relayLogger.child('agent');

// Prometheus histogram buckets (in milliseconds)
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Metrics tracking
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

class MetricsCollector {
  private messagesProcessed: Map<string, number> = new Map();
  private requestDurations: number[] = [];
  private startTime: number = Date.now();
  private recentErrors: number = 0;
  private lastErrorReset: number = Date.now();

  recordMessage(action: string): void {
    this.messagesProcessed.set(action, (this.messagesProcessed.get(action) || 0) + 1);
  }

  recordRequest(durationMs: number): void {
    this.requestDurations.push(durationMs);
    // Keep last 1000 durations for histogram
    if (this.requestDurations.length > 1000) {
      this.requestDurations.shift();
    }
  }

  recordError(): void {
    // Reset error count every 5 minutes to avoid stale data
    if (Date.now() - this.lastErrorReset > 300000) {
      this.recentErrors = 0;
      this.lastErrorReset = Date.now();
    }
    this.recentErrors++;
  }

  getRecentErrorCount(): number {
    return this.recentErrors;
  }

  getMetrics(_jobStats: Record<string, number>, connectedAgents: number): Metrics {
    const sorted = [...this.requestDurations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    // Calculate histogram bucket counts
    const histogram: Record<number, number> = {};
    for (const bucket of LATENCY_BUCKETS) {
      histogram[bucket] = this.requestDurations.filter(d => d <= bucket).length;
    }

    return {
      connectedAgents,
      messagesProcessed: Object.fromEntries(this.messagesProcessed),
      requestsTotal: this.requestDurations.length,
      requestsDuration: [p50, p95, p99],
      uptime: (Date.now() - this.startTime) / 1000,
      memoryUsage: {
        rss: process.memoryUsage().rss,
        heapTotal: process.memoryUsage().heapTotal,
        heapUsed: process.memoryUsage().heapUsed,
      },
      requestHistogram: histogram,
    };
  }

  getLatencyBuckets(): number[] {
    return LATENCY_BUCKETS;
  }
}

export const metricsCollector = new MetricsCollector();

// Validation logging helper
export function logInvalidKeyAttempt(
  apiKey: string | undefined,
  ip: string,
  path: string,
  method: string
): void {
  const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...` : 'none';
  restLogger.warn('Invalid API key attempt', {
    maskedKey,
    ip,
    path,
    method,
  });
  metricsCollector.recordError();
}