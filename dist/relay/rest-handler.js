/**
 * REST API Handler
 * HTTP endpoints for relay management
 */
import express from 'express';
import cors from 'cors';
import { validateApiKey, checkCombinedRateLimit } from '../protocol/validation.js';
import { logInvalidKeyAttempt } from '../protocol/validation.js';
import { JobStatus, AgentCardStatus } from '../protocol/types.js';
import { restLogger, metricsCollector } from '../utils/logger.js';
import { ProvenanceQuery } from '../provenance/index.js';
import { requestsTotal, requestDuration, errorsTotal, rateLimited, register, } from '../utils/metrics.js';
export class RESTHandler {
    app;
    registry;
    agentCards = null;
    jobQueue;
    config;
    provenanceQuery;
    constructor(registry, jobQueue, config = {}) {
        this.app = express();
        this.registry = registry;
        this.jobQueue = jobQueue;
        this.config = {
            apiKeys: config.apiKeys ?? [],
            rateLimitWindowMs: config.rateLimitWindowMs ?? 60000,
            rateLimitMaxRequests: config.rateLimitMaxRequests ?? 100,
            corsAllowedOrigins: config.corsAllowedOrigins ?? [],
        };
        this.provenanceQuery = new ProvenanceQuery(jobQueue, registry);
        this.setupMiddleware();
        this.setupRoutes();
    }
    /**
     * Set the AgentCards instance (called after AgentCards is created)
     */
    setAgentCards(agentCards) {
        this.agentCards = agentCards;
    }
    setupMiddleware() {
        // JSON body parser
        this.app.use(express.json({ limit: '1mb' }));
        // Security headers middleware
        this.app.use((_req, res, next) => {
            // Prevent MIME type sniffing
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // Prevent clickjacking
            res.setHeader('X-Frame-Options', 'DENY');
            // Enable XSS filter (legacy but still useful)
            res.setHeader('X-XSS-Protection', '1; mode=block');
            // Strict Transport Security (HSTS) - force HTTPS
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            // Content Security Policy
            res.setHeader('Content-Security-Policy', "default-src 'self'");
            // Referrer Policy
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            // Permissions Policy
            res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
            next();
        });
        // API key auth middleware
        this.app.use((req, res, next) => {
            // Skip health check
            if (req.path === '/health') {
                return next();
            }
            const apiKey = req.headers['x-api-key'];
            const ip = req.ip || 'unknown';
            if (this.config.apiKeys.length > 0 && !validateApiKey(apiKey, this.config.apiKeys)) {
                // Log invalid key attempt
                logInvalidKeyAttempt(apiKey, ip, req.path, req.method);
                return res.status(401).json({ error: 'Invalid or missing API key' });
            }
            // Rate limiting - use combined (key + IP)
            const rateLimit = checkCombinedRateLimit(apiKey, ip, this.config.rateLimitMaxRequests, this.config.rateLimitWindowMs);
            res.setHeader('X-RateLimit-Remaining', rateLimit.keyRemaining.toString());
            res.setHeader('X-RateLimit-Reset', rateLimit.resetAt.toString());
            if (!rateLimit.allowed) {
                // Update rate limit metrics
                rateLimited.inc();
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
                    blockedBy: rateLimit.blockedBy,
                });
            }
            next();
        });
        // CORS
        this.app.use(cors({
            origin: this.config.corsAllowedOrigins && this.config.corsAllowedOrigins.length > 0 ? this.config.corsAllowedOrigins : false,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'X-API-Key']
        }));
        // Request logging with structured logs
        this.app.use((req, res, next) => {
            const startTime = Date.now();
            const requestId = Math.random().toString(36).substring(7);
            // Log request
            restLogger.info('Request started', {
                requestId,
                method: req.method,
                path: req.path,
                agentId: req.headers['x-agent-id'],
            });
            // Log response on finish
            res.on('finish', () => {
                const duration = Date.now() - startTime;
                const durationSeconds = duration / 1000;
                // Update metrics
                const path = req.route?.path || req.path;
                requestsTotal.labels(req.method, path, res.statusCode.toString()).inc();
                requestDuration.labels(req.method, path).observe(durationSeconds);
                // Legacy metrics collector
                metricsCollector.recordRequest(duration);
                restLogger.info('Request completed', {
                    requestId,
                    method: req.method,
                    path: req.path,
                    status: res.statusCode,
                    durationMs: duration,
                });
            });
            next();
        });
    }
    setupRoutes() {
        // ============ Health ============
        this.app.get('/health', (_req, res) => {
            const memUsage = process.memoryUsage();
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                responseTimeMs: Date.now(),
                connections: this.registry.getAll().length,
                memory: {
                    rss: memUsage.rss,
                    heapTotal: memUsage.heapTotal,
                    heapUsed: memUsage.heapUsed,
                },
            });
        });
        // ============ Agent Routes ============
        // Register new agent (via HTTP for initial handshake)
        this.app.post('/connect', (req, res) => {
            const { agentId } = req.body;
            if (!agentId) {
                res.status(400).json({ error: 'agentId is required' });
                return;
            }
            res.json({
                success: true,
                agentId,
                serverInfo: {
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                },
            });
        });
        // List all agents with optional filtering (AgentCards aware)
        this.app.get('/agents', (req, res) => {
            if (this.agentCards) {
                const { capability, status, shimType } = req.query;
                const cards = this.agentCards.listCards({
                    capability: capability,
                    status: status,
                    shimType: shimType,
                });
                // Return JSON-LD format
                res.setHeader('Content-Type', 'application/ld+json');
                res.json({
                    '@context': 'https://dap-protocol.org/ns/agent-card-context.json',
                    '@type': 'AgentCardCollection',
                    count: cards.length,
                    agents: cards.map(card => this.agentCards.toJsonLd(card)),
                });
                return;
            }
            // Fallback to basic agent list
            const agents = this.registry.toJSON();
            res.json({
                count: agents.length,
                agents,
            });
        });
        // Get specific agent
        this.app.get('/agents/:agentId', (req, res) => {
            const agent = this.registry.get(req.params.agentId);
            if (!agent) {
                res.status(404).json({ error: 'Agent not found' });
                return;
            }
            res.json({
                agentId: agent.agentId,
                agentInfo: agent.agentInfo,
                connectedAt: agent.connectedAt.toISOString(),
                lastHeartbeat: agent.lastHeartbeat.toISOString(),
                capabilities: Array.from(agent.capabilities.entries()).map(([, cap]) => ({
                    ...cap,
                })),
            });
        });
        // Get agent card (JSON-LD)
        this.app.get('/agents/:agentId/card', (req, res) => {
            if (!this.agentCards) {
                res.status(503).json({ error: 'Agent cards not initialized' });
                return;
            }
            const card = this.agentCards.getCard(req.params.agentId);
            if (!card) {
                res.status(404).json({ error: 'Agent card not found' });
                return;
            }
            // Return JSON-LD format
            res.setHeader('Content-Type', 'application/ld+json');
            res.json(this.agentCards.toJsonLd(card));
        });
        // Update agent card (PATCH)
        this.app.patch('/agents/:agentId/card', (req, res) => {
            if (!this.agentCards) {
                res.status(503).json({ error: 'Agent cards not initialized' });
                return;
            }
            const card = this.agentCards.getCard(req.params.agentId);
            if (!card) {
                res.status(404).json({ error: 'Agent card not found' });
                return;
            }
            // Validate status if provided
            const { status, metadata } = req.body;
            if (status && !Object.values(AgentCardStatus).includes(status)) {
                res.status(400).json({ error: 'Invalid status value' });
                return;
            }
            this.agentCards.updateCard(req.params.agentId, { status, metadata });
            // Return updated card in JSON-LD format
            const updatedCard = this.agentCards.getCard(req.params.agentId);
            res.setHeader('Content-Type', 'application/ld+json');
            res.json(this.agentCards.toJsonLd(updatedCard));
        });
        // ============ Well-Known Agent Card ============
        this.app.get('/.well-known/dap-agent-card', (_req, res) => {
            if (!this.agentCards) {
                res.status(503).json({ error: 'Agent cards not initialized' });
                return;
            }
            const serverCard = this.agentCards.getServerCard();
            if (!serverCard) {
                res.status(404).json({ error: 'Server agent card not configured' });
                return;
            }
            res.setHeader('Content-Type', 'application/ld+json');
            res.json(this.agentCards.toJsonLd(serverCard));
        });
        // Get agents by capability
        this.app.get('/capabilities', (_req, res) => {
            const capabilities = this.registry.getAllCapabilities();
            res.json({
                capabilities: Object.fromEntries(capabilities),
                stats: this.registry.getStats(),
            });
        });
        // ============ Job Routes ============
        // Submit job
        this.app.post('/jobs', (req, res) => {
            const { type, priority, capability, payload, constraints, timeoutSeconds } = req.body;
            if (!type || !payload) {
                // Update validation error metrics
                errorsTotal.labels('validation', '/jobs').inc();
                res.status(400).json({ error: 'type and payload are required' });
                return;
            }
            const submitter = req.headers['x-agent-id'] || 'http-api';
            const job = this.jobQueue.submit(submitter, type, priority ?? 5, payload, capability, constraints, timeoutSeconds ?? 300);
            res.status(201).json({
                jobId: job.job_id,
                status: job.status,
                created_at: job.created_at,
            });
        });
        // List jobs
        this.app.get('/jobs', (req, res) => {
            const { status, type, capability, submitter, limit, offset } = req.query;
            const jobs = this.jobQueue.query({
                status: status,
                type: type,
                capabilityRequired: capability,
                submitter: submitter,
                limit: limit ? parseInt(limit) : undefined,
                offset: offset ? parseInt(offset) : undefined,
            });
            res.json({
                count: jobs.length,
                jobs,
            });
        });
        // Get specific job
        this.app.get('/jobs/:jobId', (req, res) => {
            const job = this.jobQueue.get(req.params.jobId);
            if (!job) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }
            res.json(job);
        });
        // Get job result
        this.app.get('/jobs/:jobId/result', (req, res) => {
            const job = this.jobQueue.get(req.params.jobId);
            if (!job) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }
            if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.FAILED) {
                res.status(400).json({
                    error: 'Job not completed',
                    status: job.status,
                });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
                result: job.result,
                error: job.error,
                completed_at: job.completed_at,
            });
        });
        // Claim job
        this.app.post('/jobs/:jobId/claim', (req, res) => {
            const agentId = req.headers['x-agent-id'];
            if (!agentId) {
                res.status(400).json({ error: 'x-agent-id header required' });
                return;
            }
            const job = this.jobQueue.claim(req.params.jobId, agentId);
            if (!job) {
                res.status(400).json({ error: 'Job not available for claiming' });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
                claimed_by: job.claimed_by,
            });
        });
        // Start job (move from CLAIMED to IN_PROGRESS)
        this.app.post('/jobs/:jobId/start', (req, res) => {
            const job = this.jobQueue.start(req.params.jobId);
            if (!job) {
                res.status(400).json({ error: 'Job cannot be started' });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
            });
        });
        // Update job progress
        this.app.post('/jobs/:jobId/progress', (req, res) => {
            const { message } = req.body;
            const job = this.jobQueue.progress(req.params.jobId, message);
            if (!job) {
                res.status(400).json({ error: 'Job not in progress' });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
            });
        });
        // Complete job
        this.app.post('/jobs/:jobId/complete', (req, res) => {
            const { result, error } = req.body;
            let job;
            if (error) {
                job = this.jobQueue.fail(req.params.jobId, error);
            }
            else {
                job = this.jobQueue.complete(req.params.jobId, result);
            }
            if (!job) {
                res.status(400).json({ error: 'Job not in progress' });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
                result: job.result,
                error: job.error,
            });
        });
        // Cancel job
        this.app.delete('/jobs/:jobId', (req, res) => {
            const { reason } = req.body;
            const job = this.jobQueue.cancel(req.params.jobId, reason);
            if (!job) {
                res.status(400).json({ error: 'Job cannot be cancelled' });
                return;
            }
            res.json({
                jobId: job.job_id,
                status: job.status,
            });
        });
        // ============ Provenance Routes ============
        // Get job provenance
        this.app.get('/jobs/:jobId/provenance', (req, res) => {
            const records = this.jobQueue.getProvenance(req.params.jobId);
            if (records.length === 0) {
                res.status(404).json({ error: 'No provenance found for job' });
                return;
            }
            res.json({
                jobId: req.params.jobId,
                count: records.length,
                records,
            });
        });
        // Get job trace (human-readable timeline)
        this.app.get('/jobs/:jobId/trace', (req, res) => {
            const trace = this.provenanceQuery.trace(req.params.jobId);
            if (trace.length === 0) {
                res.status(404).json({ error: 'Job not found or has no trace' });
                return;
            }
            res.json({
                jobId: req.params.jobId,
                trace,
            });
        });
        // Get agent provenance
        this.app.get('/agents/:agentId/provenance', (req, res) => {
            const records = this.registry.getAgentProvenance(req.params.agentId);
            if (records.length === 0) {
                res.status(404).json({ error: 'No provenance found for agent' });
                return;
            }
            res.json({
                agentId: req.params.agentId,
                count: records.length,
                records,
            });
        });
        // Get provenance stats
        this.app.get('/provenance/stats', (_req, res) => {
            const stats = this.jobQueue.getProvenanceStats();
            res.json(stats);
        });
        // Query provenance by filters
        this.app.get('/provenance', (req, res) => {
            const { agentId, activity, from, to } = req.query;
            let records = [];
            if (agentId) {
                records = this.jobQueue.queryByAgent(agentId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
            }
            else if (activity) {
                records = this.jobQueue.queryByActivity(activity, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
            }
            else {
                res.status(400).json({ error: 'agentId or activity query parameter required' });
                return;
            }
            res.json({
                count: records.length,
                records,
            });
        });
        // ============ Stats ============
        this.app.get('/stats', (_req, res) => {
            res.json({
                agents: this.registry.getStats(),
                jobs: this.jobQueue.getStats(),
                server: {
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    version: '1.0.0',
                },
            });
        });
        // ============ Metrics (Prometheus) ============
        this.app.get('/metrics', async (_req, res) => {
            try {
                res.set('Content-Type', register.contentType);
                res.send(await register.metrics());
            }
            catch (err) {
                res.status(500).send(String(err));
            }
        });
    }
    getApp() {
        return this.app;
    }
}
//# sourceMappingURL=rest-handler.js.map