/**
 * REST API Handler
 * HTTP endpoints for relay management
 */
import express from 'express';
import { AgentRegistry } from './agent-registry.js';
import { AgentCards } from './agent-cards.js';
import { JobQueue } from './job-queue.js';
export interface RESTHandlerConfig {
    apiKeys: string[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
}
export declare class RESTHandler {
    private app;
    private registry;
    private agentCards;
    private jobQueue;
    private config;
    private provenanceQuery;
    constructor(registry: AgentRegistry, jobQueue: JobQueue, config?: Partial<RESTHandlerConfig>);
    /**
     * Set the AgentCards instance (called after AgentCards is created)
     */
    setAgentCards(agentCards: AgentCards): void;
    private setupMiddleware;
    private setupRoutes;
    getApp(): express.Application;
}
//# sourceMappingURL=rest-handler.d.ts.map