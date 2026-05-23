/**
 * Claude Code Shim
 * Connects Claude Code agents to the DAP relay
 */
import { MessageAction } from '../protocol/types.js';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
export class ClaudeCodeShim {
    config;
    socket = null;
    connected = false;
    eventHandler;
    activeProcesses = new Map();
    pendingRequests = new Map();
    constructor(config) {
        this.config = {
            claudePath: 'claude',
            maxConcurrent: 2,
            ...config,
        };
    }
    async connect() {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.relayUrl);
            if (this.config.apiKey) {
                url.searchParams.set('token', this.config.apiKey);
            }
            console.log(`[Claude Shim] Connecting to relay: ${this.config.relayUrl}`);
            this.socket = new WebSocket(url.toString());
            this.socket.onopen = () => {
                console.log('[Claude Shim] Connected to relay');
                const registerMsg = {
                    action: 'register',
                    agentId: this.config.agentId,
                    capabilities: this.config.capabilities,
                    metadata: {
                        ...this.config.metadata,
                        framework: 'claude-code',
                        version: '1.0.0',
                    },
                    os: process.platform,
                    version: '1.0.0',
                };
                this.socket.send(JSON.stringify(registerMsg));
                this.connected = true;
                // Set up default event handler
                this.eventHandler = {
                    onTask: undefined,
                    onEvent: undefined,
                };
                resolve();
            };
            this.socket.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    await this.handleIncomingMessage(msg);
                }
                catch (err) {
                    console.error('[Claude Shim] Message handling error:', err);
                }
            };
            this.socket.onclose = (event) => {
                console.log(`[Claude Shim] Disconnected: ${event.code}`);
                this.connected = false;
                this.cleanupProcesses();
            };
            this.socket.onerror = (err) => {
                console.error('[Claude Shim] Socket error:', err);
                reject(err);
            };
        });
    }
    async disconnect() {
        this.cleanupProcesses();
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
    isConnected() {
        return this.connected && this.socket?.readyState === WebSocket.OPEN;
    }
    async handleIncomingMessage(msg) {
        console.log(`[Claude Shim] Received: ${msg.action} from ${msg.from?.agent_id}`);
        // Call event handler if set
        await this.eventHandler?.onEvent?.(msg);
        switch (msg.action) {
            case MessageAction.REQUEST:
                await this.handleRequest(msg);
                break;
            case MessageAction.RESPONSE:
                await this.handleResponse(msg);
                break;
            default:
                console.log(`[Claude Shim] Unhandled: ${msg.action}`);
        }
    }
    async handleRequest(msg) {
        const task = {
            taskId: msg.msg_id,
            description: msg.payload.data.description,
            type: msg.payload.data.type,
            context: msg.payload.data.context,
            priority: msg.payload.data.priority,
        };
        console.log(`[Claude Shim] Task: ${task.type} - ${task.description}`);
        try {
            const result = await this.executeViaClaudeCode(task);
            const response = {
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
        }
        catch (err) {
            const errorResponse = {
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
    async executeViaClaudeCode(task) {
        const startTime = Date.now();
        if (this.activeProcesses.size >= (this.config.maxConcurrent || 2)) {
            return {
                success: false,
                error: 'Max concurrent tasks reached',
                executionTimeMs: Date.now() - startTime,
            };
        }
        const taskFile = join(tmpdir(), `claude-task-${Date.now()}.json`);
        await writeFile(taskFile, JSON.stringify({
            taskId: task.taskId,
            description: task.description,
            type: task.type,
            context: task.context,
            priority: task.priority,
        }, null, 2));
        try {
            const result = await new Promise((resolve, reject) => {
                const args = [
                    '--print',
                    task.description,
                ];
                if (this.config.claudeArgs) {
                    args.push(...this.config.claudeArgs);
                }
                const proc = spawn(this.config.claudePath, args, {
                    cwd: this.config.workDir || process.cwd(),
                    env: { ...process.env },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                this.activeProcesses.set(task.taskId, proc);
                let stdout = '';
                let stderr = '';
                proc.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });
                proc.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });
                proc.on('close', (code) => {
                    this.activeProcesses.delete(task.taskId);
                    resolve({ stdout, stderr, code: code || 0 });
                });
                proc.on('error', (err) => {
                    this.activeProcesses.delete(task.taskId);
                    reject(err);
                });
                setTimeout(() => {
                    if (this.activeProcesses.has(task.taskId)) {
                        proc.kill();
                        reject(new Error('Task timeout'));
                    }
                }, 120000);
            });
            return {
                success: result.code === 0,
                data: result.stdout,
                error: result.code !== 0 ? result.stderr : undefined,
                executionTimeMs: Date.now() - startTime,
            };
        }
        catch (err) {
            return {
                success: false,
                error: String(err),
                executionTimeMs: Date.now() - startTime,
            };
        }
        finally {
            try {
                await unlink(taskFile);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    }
    async handleResponse(msg) {
        const pending = this.pendingRequests.get(msg.reply_to || '');
        if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve(msg);
            this.pendingRequests.delete(msg.reply_to || '');
        }
    }
    async sendMessage(msg) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        }
    }
    getAgentInfo() {
        return {
            agent_id: this.config.agentId,
            capabilities: this.config.capabilities.map((c) => c.name || c),
            capabilityDetails: this.config.capabilities,
            metadata: this.config.metadata,
            version: '1.0.0',
        };
    }
    cleanupProcesses() {
        for (const [, proc] of this.activeProcesses.entries()) {
            proc.kill();
        }
        this.activeProcesses.clear();
    }
    setEventHandler(handler) {
        this.eventHandler = handler;
    }
}
export async function runClaudeShim() {
    const args = process.argv.slice(2);
    const config = {
        relayUrl: 'ws://localhost:3000/ws',
        agentId: `claude-${process.env.USER || 'user'}-${Date.now()}`,
        capabilities: [
            { name: 'code-generation', version: '1.0.0', maxConcurrent: 2 },
            { name: 'refactoring', version: '1.0.0', maxConcurrent: 1 },
            { name: 'testing', version: '1.0.0', maxConcurrent: 2 },
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
            case '--claude-path':
                config.claudePath = args[++i];
                break;
            case '--work-dir':
                config.workDir = args[++i];
                break;
        }
    }
    const shim = new ClaudeCodeShim(config);
    console.log(`[Claude Shim] Starting with agent ID: ${config.agentId}`);
    await shim.connect();
    console.log('[Claude Shim] Connected and ready');
    process.on('SIGINT', async () => {
        console.log('[Claude Shim] Shutting down...');
        await shim.disconnect();
        process.exit(0);
    });
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runClaudeShim().catch(console.error);
}
export default ClaudeCodeShim;
//# sourceMappingURL=claude-code.js.map