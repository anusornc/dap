/**
 * DAP Relay Server
 * Main entry point for the distributed agent relay
 */
import { RelayConfig } from '../protocol/types.js';
export declare class RelayServer {
    private httpServer?;
    private httpsServer?;
    private wss;
    private app;
    private registry;
    private agentCards;
    private jobQueue;
    private wsHandler;
    private restHandler;
    private config;
    private cleanupInterval?;
    private _boundPort;
    constructor(config?: Partial<RelayConfig>, options?: {
        testMode?: boolean;
    });
    private setupUpgradeHandlers;
    private setupRoutes;
    private handleWSConnection;
    private handleRegistration;
    private handleMessage;
    private handleRequest;
    private handleResponse;
    private handleEvent;
    private handleJobSubmission;
    private handleJobClaim;
    private handleJobComplete;
    private startCleanup;
    start(): Promise<void>;
    stop(): Promise<void>;
    getAddress(): {
        host: string;
        port: number;
        tlsPort?: number;
    };
}
export default RelayServer;
//# sourceMappingURL=server.d.ts.map