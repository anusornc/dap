/**
 * Codex Shim
 * Connects OpenAI Codex agents to the DAP relay
 * Uses file-based task manifests for communication
 */

import { DAPMessage, MessageAction } from '../protocol/types.js';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

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

export class CodexShim {
  private config: CodexShimConfig;
  private socket: WebSocket | null = null;
  private connected: boolean = false;
  private taskDir: string;
  private resultDir: string;
  private pollInterval?: NodeJS.Timeout;
  private pendingRequests: Map<string, any> = new Map();

  constructor(config: CodexShimConfig) {
    this.config = {
      codexTaskDir: join(homedir(), '.codex', 'tasks'),
      pollIntervalMs: 1000,
      ...config,
    };
    this.taskDir = join(this.config.codexTaskDir!, 'incoming');
    this.resultDir = join(this.config.codexTaskDir!, 'results');
  }

  async connect(): Promise<void> {
    await mkdir(this.taskDir, { recursive: true });
    await mkdir(this.resultDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const url = new URL(this.config.relayUrl);
      if (this.config.apiKey) {
        url.searchParams.set('token', this.config.apiKey);
      }

      console.log(`[Codex Shim] Connecting to relay: ${this.config.relayUrl}`);

      this.socket = new WebSocket(url.toString());

      this.socket.onopen = () => {
        console.log('[Codex Shim] Connected to relay');

        const registerMsg = {
          action: 'register',
          agentId: this.config.agentId,
          capabilities: this.config.capabilities,
          metadata: {
            ...this.config.metadata,
            framework: 'openai-codex',
            version: '1.0.0',
          },
          os: process.platform,
          version: '1.0.0',
        };

        this.socket!.send(JSON.stringify(registerMsg));
        this.connected = true;

        this.startPolling();

        resolve();
      };

      this.socket.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data) as DAPMessage;
          await this.handleIncomingMessage(msg);
        } catch (err) {
          console.error('[Codex Shim] Message handling error:', err);
        }
      };

      this.socket.onclose = () => {
        console.log('[Codex Shim] Disconnected');
        this.connected = false;
        this.stopPolling();
      };

      this.socket.onerror = (err) => {
        console.error('[Codex Shim] Socket error:', err);
        reject(err);
      };
    });
  }

  async disconnect(): Promise<void> {
    this.stopPolling();

    if (this.socket) {
      this.socket.send(JSON.stringify({
        action: 'unregister',
        agentId: this.config.agentId,
      }));
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  private async handleIncomingMessage(msg: DAPMessage): Promise<void> {
    switch (msg.action) {
      case MessageAction.REQUEST:
        await this.handleRequest(msg);
        break;

      case MessageAction.RESPONSE:
        await this.handleResponse(msg);
        break;

      default:
        console.log(`[Codex Shim] Unhandled: ${msg.action}`);
    }
  }

  private async handleRequest(msg: DAPMessage): Promise<void> {
    const task: Task = {
      taskId: msg.msg_id,
      description: msg.payload.data.description,
      type: msg.payload.data.type,
      context: msg.payload.data.context,
      priority: msg.payload.data.priority,
    };

    console.log(`[Codex Shim] Delegating task: ${task.type}`);

    try {
      const result = await this.delegateToCodex(task);

      const response: DAPMessage = {
        version: '1.0.0',
        msg_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        from: this.getAgentInfo(),
        to: { agent_id: msg.from?.agent_id || 'unknown' },
        action: MessageAction.RESPONSE,
        payload: {
          type: 'result',
          data: {
            success: result.success,
            result: result.data,
            error: result.error,
            executionTimeMs: result.executionTimeMs,
          },
        },
        reply_to: msg.msg_id,
      };

      await this.sendMessage(response);
    } catch (err) {
      const errorResponse: DAPMessage = {
        version: '1.0.0',
        msg_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        from: this.getAgentInfo(),
        to: { agent_id: msg.from?.agent_id || 'unknown' },
        action: MessageAction.ERROR,
        payload: {
          type: 'error-report',
          data: { error: String(err) },
        },
        reply_to: msg.msg_id,
      };

      await this.sendMessage(errorResponse);
    }
  }

  private async delegateToCodex(task: Task): Promise<TaskResult> {
    const startTime = Date.now();
    const taskFile = join(this.taskDir, `${task.taskId}.json`);
    const resultFile = join(this.resultDir, `${task.taskId}.json`);

    await writeFile(taskFile, JSON.stringify({
      taskId: task.taskId,
      description: task.description,
      type: task.type,
      context: task.context,
      priority: task.priority,
      createdAt: new Date().toISOString(),
      callbackWs: this.config.relayUrl,
    }, null, 2));

    const maxWaitTime = 300000;
    const pollInterval = this.config.pollIntervalMs || 1000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitTime) {
      try {
        const resultContent = await readFile(resultFile, 'utf-8');
        const result = JSON.parse(resultContent);

        await unlink(taskFile).catch(() => {});
        await unlink(resultFile).catch(() => {});

        return {
          success: result.success ?? true,
          data: result.data ?? result.stdout ?? result,
          error: result.error,
          executionTimeMs: Date.now() - startTime,
        };
      } catch {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    await unlink(taskFile).catch(() => {});

    return {
      success: false,
      error: `Task timeout after ${maxWaitTime}ms`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async handleResponse(msg: DAPMessage): Promise<void> {
    const pending = this.pendingRequests.get(msg.reply_to || '');
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(msg);
      this.pendingRequests.delete(msg.reply_to || '');
    }
  }

  private async sendMessage(msg: DAPMessage): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private getAgentInfo(): any {
    return {
      agent_id: this.config.agentId,
      capabilities: this.config.capabilities.map((c: any) => c.name || c),
      capabilityDetails: this.config.capabilities,
      metadata: this.config.metadata,
      version: '1.0.0',
    };
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      void this.sendMessage({
        version: '1.0.0',
        msg_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        from: this.getAgentInfo(),
        to: 'broadcast',
        action: MessageAction.HEARTBEAT,
        payload: {
          type: 'heartbeat',
          data: { status: 'healthy' },
        },
      });
    }, this.config.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }
}

export async function runCodexShim(): Promise<void> {
  const args = process.argv.slice(2);

  const config: CodexShimConfig = {
    relayUrl: 'ws://localhost:3000/ws',
    agentId: `codex-${process.env.USER || 'user'}-${Date.now()}`,
    capabilities: [
      { name: 'code-completion', version: '1.0.0', maxConcurrent: 3 },
      { name: 'refactoring', version: '1.0.0', maxConcurrent: 2 },
      { name: 'documentation', version: '1.0.0', maxConcurrent: 2 },
    ],
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--relay':
        config.relayUrl = args[++i];
        break;
      case '--api-key':
        config.apiKey = args[++i];
        break;
      case '--agent-id':
        config.agentId = args[++i];
        break;
      case '--task-dir':
        config.codexTaskDir = args[++i];
        break;
    }
  }

  const shim = new CodexShim(config);

  console.log(`[Codex Shim] Starting with agent ID: ${config.agentId}`);

  await shim.connect();

  console.log('[Codex Shim] Connected and ready');

  process.on('SIGINT', async () => {
    console.log('[Codex Shim] Shutting down...');
    await shim.disconnect();
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexShim().catch(console.error);
}

export default CodexShim;
