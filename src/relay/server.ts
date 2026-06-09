/**
 * DAP Relay Server
 * Main entry point for the distributed agent relay
 */

import { createServer, Server as HTTPServer } from 'http';
import { createServer as createHTTPSServer, Server as HTTPSServer } from 'https';
import { WebSocketServer } from 'ws';
import express from 'express';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { AgentRegistry } from './agent-registry.js';
import { AgentCards } from './agent-cards.js';
import { JobQueue } from './job-queue.js';
import { WSHandler } from './ws-handler.js';
import { ConnectionManager } from './connection-manager.js';
export { RelayRequestError } from './connection-manager.js';
import { RESTHandler } from './rest-handler.js';
import { RelayConfig, DAPMessage } from '../protocol/types.js';
// Note: metrics.ts is imported implicitly via the metrics singletons
// Default metrics (CPU, memory) are collected via collectDefaultMetrics() in metrics.ts

// Load environment
config();

console.log('[Relay] Prometheus metrics enabled - default metrics collected');

const DEFAULT_CONFIG: Partial<RelayConfig> = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  apiKeys: process.env.API_KEYS?.split(',').filter(Boolean) || [],
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000'),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '60000'),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '300000'),
  enableTls: process.env.ENABLE_TLS === 'true',
  tlsCertPath: process.env.TLS_CERT_PATH || './certs/cert.pem',
  tlsKeyPath: process.env.TLS_KEY_PATH || './certs/key.pem',
  tlsPort: parseInt(process.env.TLS_PORT || '3443'),
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',').filter(Boolean) || [],
};

export class RelayServer {
  private httpServer?: HTTPServer;
  private httpsServer?: HTTPSServer;
  private wss: WebSocketServer;
  private app: express.Application;
  private registry: AgentRegistry;
  private agentCards: AgentCards;
  private jobQueue: JobQueue;
  private wsHandler: WSHandler;
  private restHandler: RESTHandler;
  private config: RelayConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private connectionManager: ConnectionManager;
  private _boundPort: number = 0;

  constructor(config: Partial<RelayConfig> = {}, options?: { testMode?: boolean }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RelayConfig;

    // Initialize components
    this.registry = new AgentRegistry('./shapes', { testMode: options?.testMode });
    this.agentCards = new AgentCards(this.registry);
    this.jobQueue = new JobQueue(process.env.DATA_DIR || './data');

    // Express app
    this.app = express();

    // WebSocket server (created lazily based on TLS setting)
    this.wss = new WebSocketServer({ noServer: true });

    // Initialize handlers
    this.wsHandler = new WSHandler(this.wss, this.registry, {
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
    }, { skipSetup: true }); // Skip to avoid duplicate connections - server handles them

    this.restHandler = new RESTHandler(this.registry, this.jobQueue, {
      apiKeys: this.config.apiKeys,
      corsAllowedOrigins: this.config.corsAllowedOrigins,
    });
    this.restHandler.setAgentCards(this.agentCards);
    this.restHandler.setA2ADispatcher(({ targetAgentId, task, timeoutMs }) =>
      this.sendRequestToAgent(targetAgentId, task, { timeoutMs })
    );

    this.connectionManager = new ConnectionManager(
      this.wss,
      this.registry,
      this.jobQueue,
      this.wsHandler,
      this.config,
      () => this._boundPort
    );

    this.setupRoutes();
    this.setupUpgradeHandlers();
    this.connectionManager.start();
    this.startCleanup();

    // Set up server's own agent card
    this.agentCards.setServerCard({
      id: 'relay-server',
      type: 'AgentCard',
      name: 'DAP Relay Server',
      description: 'Central relay server for distributed agent coordination',
      capabilities: [
        { name: 'relay', version: '1.0.0', description: 'Message relay and routing' },
        { name: 'job-queue', version: '1.0.0', description: 'Job submission and management' },
        { name: 'capability-discovery', version: '1.0.0', description: 'Semantic agent card discovery' },
      ],
      version: '1.0.0',
      protocolVersion: '1.0.0',
      shimType: 'custom',
      endpoints: {
        wssUrl: process.env.WSS_URL,
        httpUrl: process.env.HTTP_URL,
      },
      status: 'active',
      metadata: {
        uptime: process.uptime(),
        connectedAgents: 0,
      },
      '@context': 'https://dap-protocol.org/ns/agent-card-context.json',
    });
  }

  private setupUpgradeHandlers(): void {
    // HTTP server handles upgrade for WebSocket
    this.httpServer = createServer(this.app);
    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', `http://127.0.0.1:${this._boundPort || this.config.port}`);
      const pathname = url.pathname;
      
      if (pathname === '/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // HTTPS server for TLS
    if (this.config.enableTls) {
      try {
        const options = {
          cert: readFileSync(this.config.tlsCertPath!),
          key: readFileSync(this.config.tlsKeyPath!),
        };
        
        this.httpsServer = createHTTPSServer(options, this.app);
        this.httpsServer.on('upgrade', (request, socket, head) => {
          const pathname = new URL(request.url || '/', `https://${request.headers.host}`).pathname;
          
          if (pathname === '/ws') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
              this.wss.emit('connection', ws, request);
            });
          } else {
            socket.destroy();
          }
        });
      } catch (err) {
        console.warn('[Relay] TLS enabled but certificates not found. Running HTTP only.');
        this.config.enableTls = false;
      }
    }
  }

  private setupRoutes(): void {
    // Use REST handler's app
    this.app.use(this.restHandler.getApp());
  }

  private startCleanup(): void {
    // Remove stale agents every minute
    this.cleanupInterval = setInterval(() => {
      const stale = this.registry.getStaleAgents(this.config.heartbeatTimeoutMs);

      for (const agent of stale) {
        console.log(`[Relay] Removing stale agent: ${agent.agentId}`);
        agent.socket.close(4002, 'Heartbeat timeout');
        this.registry.unregister(agent.agentId);
      }

      // Clean old jobs
      const removedJobs = this.jobQueue.cleanStale(7 * 24 * 60 * 60 * 1000); // 7 days
      if (removedJobs.length > 0) {
        console.log(`[Relay] Cleaned ${removedJobs.length} old jobs`);
      }
    }, 60000);
  }

  // ============ Public API ============

  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Start HTTP server
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer!.address() as any;
        this._boundPort = addr?.port || this.config.port;
        console.log(`  HTTP:  http://${this.config.host}:${this._boundPort}`);

        // Start HTTPS server if TLS enabled
        if (this.config.enableTls && this.httpsServer) {
          this.httpsServer.listen(this.config.tlsPort, this.config.host, () => {
            console.log(`  HTTPS: https://${this.config.host}:${this.config.tlsPort}`);
            finish();
          });
        } else {
          finish();
        }
      });

      const finish = () => {
        console.log(`
 ╔════════════════════════════════════════════════════════╗
 ║           DAP Relay Server v1.0.0                      ║
 ╠════════════════════════════════════════════════════════╣
 ║  HTTP:    http://${this.config.host}:${this._boundPort}                      ║
 ║  WebSocket: ws://${this.config.host}:${this._boundPort}/ws                ║${this.config.enableTls ? `
 ║  HTTPS:   https://${this.config.host}:${this.config.tlsPort}                     ║
 ║  WSS:     wss://${this.config.host}:${this.config.tlsPort}/ws              ║` : ''}
 ╠════════════════════════════════════════════════════════╣
 ║  API Keys: ${this.config.apiKeys.length > 0 ? this.config.apiKeys.join(', ') : 'none (open)'}     ║
 ║  Heartbeat: ${this.config.heartbeatIntervalMs}ms / timeout ${this.config.heartbeatTimeoutMs}ms       ║
 ║  TLS:     ${this.config.enableTls ? `enabled (port ${this.config.tlsPort})` : 'disabled'}              ║
 ╚════════════════════════════════════════════════════════╝
        `);
        resolve();
      };
    });
  }

  async stop(): Promise<void> {
    console.log('[Relay] Shutting down...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.connectionManager.stop();

    // Close all WebSocket connections
    for (const agent of this.registry.getAll()) {
      agent.socket.close(1001, 'Server shutting down');
    }

    // Close servers
    return new Promise((resolve) => {
      const servers: HTTPServer[] = [this.httpServer!];
      if (this.httpsServer) servers.push(this.httpsServer);

      let closed = 0;
      for (const server of servers) {
        server.close(() => {
          closed++;
          if (closed === servers.length) {
            console.log('[Relay] Server stopped');
            resolve();
          }
        });
      }
    });
  }

  getAddress(): { host: string; port: number; tlsPort?: number } {
    return {
      host: this.config.host,
      port: this._boundPort || this.config.port,
      tlsPort: this.config.enableTls ? this.config.tlsPort : undefined,
    };
  }

  async sendRequestToAgent(
    targetAgentId: string,
    task: {
      description: string;
      type: string;
      context?: Record<string, unknown>;
      priority?: number;
    },
    options: { timeoutMs?: number; fromAgentId?: string } = {}
  ): Promise<DAPMessage> {
    return this.connectionManager.sendRequestToAgent(targetAgentId, task, options);
  }
}

// ============ CLI Entry Point ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const relay = new RelayServer();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await relay.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await relay.stop();
    process.exit(0);
  });

  relay.start().catch(console.error);
}

export default RelayServer;
