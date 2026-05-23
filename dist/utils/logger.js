/**
 * Structured Logger
 * JSON-formatted logging for the DAP relay with Prometheus metrics
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
export class Logger {
    service;
    minLevel;
    constructor(service, minLevel = LogLevel.INFO) {
        this.service = service;
        this.minLevel = minLevel;
    }
    log(level, message, context) {
        if (level < this.minLevel)
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            level: LOG_LEVEL_NAMES[level],
            service: this.service,
            message,
            ...context,
        };
        console.log(JSON.stringify(entry));
    }
    debug(message, context) {
        this.log(LogLevel.DEBUG, message, context);
    }
    info(message, context) {
        this.log(LogLevel.INFO, message, context);
    }
    warn(message, context) {
        this.log(LogLevel.WARN, message, context);
    }
    error(message, context) {
        this.log(LogLevel.ERROR, message, context);
    }
    child(service) {
        return new Logger(`${this.service}:${service}`, this.minLevel);
    }
    withRequestId(requestId) {
        return new RequestLogger(this, requestId);
    }
}
export class RequestLogger {
    logger;
    requestId;
    constructor(logger, requestId) {
        this.logger = logger;
        this.requestId = requestId;
    }
    info(message, context) {
        this.logger.info(message, { request_id: this.requestId, ...context });
    }
    error(message, context) {
        this.logger.error(message, { request_id: this.requestId, ...context });
    }
    warn(message, context) {
        this.logger.warn(message, { request_id: this.requestId, ...context });
    }
    debug(message, context) {
        this.logger.debug(message, { request_id: this.requestId, ...context });
    }
}
// Generate unique request ID
export function generateRequestId() {
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
class MetricsCollector {
    messagesProcessed = new Map();
    requestDurations = [];
    startTime = Date.now();
    recentErrors = 0;
    lastErrorReset = Date.now();
    recordMessage(action) {
        this.messagesProcessed.set(action, (this.messagesProcessed.get(action) || 0) + 1);
    }
    recordRequest(durationMs) {
        this.requestDurations.push(durationMs);
        // Keep last 1000 durations for histogram
        if (this.requestDurations.length > 1000) {
            this.requestDurations.shift();
        }
    }
    recordError() {
        // Reset error count every 5 minutes to avoid stale data
        if (Date.now() - this.lastErrorReset > 300000) {
            this.recentErrors = 0;
            this.lastErrorReset = Date.now();
        }
        this.recentErrors++;
    }
    getRecentErrorCount() {
        return this.recentErrors;
    }
    getMetrics(_jobStats, connectedAgents) {
        const sorted = [...this.requestDurations].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
        // Calculate histogram bucket counts
        const histogram = {};
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
    getLatencyBuckets() {
        return LATENCY_BUCKETS;
    }
}
export const metricsCollector = new MetricsCollector();
// Validation logging helper
export function logInvalidKeyAttempt(apiKey, ip, path, method) {
    const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...` : 'none';
    restLogger.warn('Invalid API key attempt', {
        maskedKey,
        ip,
        path,
        method,
    });
    metricsCollector.recordError();
}
//# sourceMappingURL=logger.js.map