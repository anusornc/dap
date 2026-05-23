/**
 * Mavis Shim
 * Connects Mavis agents to the DAP relay
 */
import { MessageAction } from '../protocol/types.js';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
export class MavisShim {
    config;
    socket = null;
    connected = false;
    eventHandler;
    pendingRequests = new Map();
    constructor(config) {
        this.config = {
            timeoutMs: 60000,
            ...config,
        };
    }
    async connect() {
        const { exec } = await import('child_process');
        return new Promise((resolve, reject) => {
            exec('which mavis', (err) => {
                if (err) {
                    console.warn('[Mavis Shim] mavis CLI not found in PATH');
                }
                console.log(`[Mavis Shim] Connecting to relay: ${this.config.relayUrl}`);
                const url = new URL(this.config.relayUrl);
                if (this.config.apiKey) {
                    url.searchParams.set('token', this.config.apiKey);
                }
                this.socket = new WebSocket(url.toString());
                this.socket.onopen = () => {
                    console.log('[Mavis Shim] Connected to relay');
                    const registerMsg = {
                        action: 'register',
                        agentId: this.config.agentId,
                        capabilities: this.config.capabilities,
                        metadata: {
                            ...this.config.metadata,
                            framework: 'mavis',
                            mavisVersion: '1.0.0',
                        },
                        os: process.platform,
                        version: '1.0.0',
                    };
                    this.socket.send(JSON.stringify(registerMsg));
                    this.connected = true;
                    resolve();
                };
                this.socket.onmessage = async (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        await this.handleIncomingMessage(msg);
                    }
                    catch (err) {
                        console.error('[Mavis Shim] Message handling error:', err);
                    }
                };
                this.socket.onclose = (event) => {
                    console.log(`[Mavis Shim] Disconnected: ${event.code} ${event.reason}`);
                    this.connected = false;
                };
                this.socket.onerror = (err) => {
                    console.error('[Mavis Shim] Socket error:', err);
                    reject(err);
                };
            });
        });
    }
    async disconnect() {
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
        console.log(`[Mavis Shim] Received: ${msg.action} from ${msg.from?.agent_id}`);
        switch (msg.action) {
            case MessageAction.REQUEST:
                await this.handleRequest(msg);
                break;
            case MessageAction.RESPONSE:
                await this.handleResponse(msg);
                break;
            case MessageAction.EVENT:
                await this.handleEvent(msg);
                break;
            case MessageAction.JOB_CLAIM:
                await this.handleJobClaim(msg);
                break;
            case MessageAction.HEARTBEAT:
                break;
            default:
                console.log(`[Mavis Shim] Unknown action: ${msg.action}`);
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
        console.log(`[Mavis Shim] Task delegation: ${task.type} - ${task.description}`);
        try {
            const result = await this.executeViaMavis(task);
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
                    data: {
                        error: String(err),
                    },
                },
                reply_to: msg.msg_id,
            };
            await this.sendMessage(errorResponse);
        }
    }
    async executeViaMavis(task) {
        const startTime = Date.now();
        const taskFile = join(tmpdir(), `dap-task-${Date.now()}.json`);
        await writeFile(taskFile, JSON.stringify({
            taskId: task.taskId,
            description: task.description,
            type: task.type,
            context: task.context,
        }, null, 2));
        try {
            const { exec } = await import('child_process');
            const result = await new Promise((resolve, reject) => {
                const targetAgent = this.config.mavisAgentName || 'mavis';
                const sessionFlag = this.config.mavisSessionId
                    ? `--session ${this.config.mavisSessionId}`
                    : '';
                const cmd = `mavis communication send --to ${targetAgent} ${sessionFlag} --command prompt --content "Task from DAP relay: ${task.description}"`;
                exec(cmd, {
                    timeout: this.config.timeoutMs,
                }, (err, stdout, stderr) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve({ stdout, stderr });
                    }
                });
            });
            return {
                success: true,
                data: result.stdout,
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
        await this.eventHandler?.onEvent?.(msg);
    }
    async handleEvent(msg) {
        await this.eventHandler?.onEvent?.(msg);
    }
    async handleJobClaim(msg) {
        console.log(`[Mavis Shim] Job claim notification`);
        await this.eventHandler?.onJobClaim?.(msg.payload.data);
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
    async delegateTask(targetAgentId, task, timeoutMs = 120000) {
        const startTime = Date.now();
        const msgId = crypto.randomUUID();
        const request = {
            version: '1.0.0',
            msg_id: msgId,
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: { agent_id: targetAgentId },
            action: MessageAction.REQUEST,
            payload: {
                type: 'task-delegation',
                data: {
                    description: task.description,
                    type: task.type,
                    context: task.context,
                    priority: task.priority,
                },
            },
        };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(msgId);
                reject(new Error(`Task delegation timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(msgId, {
                resolve: async (msg) => {
                    const result = msg.payload.data;
                    resolve({
                        success: result.success,
                        data: result.result,
                        error: result.error,
                        executionTimeMs: Date.now() - startTime,
                    });
                },
                reject: (err) => {
                    reject(err);
                },
                timeout,
            });
            this.sendMessage(request).catch(reject);
        });
    }
    async submitJob(jobType, payload, priority = 5, capabilityRequired) {
        const msgId = crypto.randomUUID();
        const submission = {
            version: '1.0.0',
            msg_id: msgId,
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: { topic: `task-queue:${jobType}` },
            action: MessageAction.JOB_SUBMISSION,
            payload: {
                type: 'job-submission',
                data: {
                    type: jobType,
                    priority,
                    payload,
                    capabilityRequired,
                },
            },
        };
        await this.sendMessage(submission);
        return msgId;
    }
    setEventHandler(handler) {
        this.eventHandler = handler;
    }
}
// ============ CLI Runner ============
export async function runMavisShim() {
    const args = process.argv.slice(2);
    const config = {
        relayUrl: 'ws://localhost:3000/ws',
        agentId: `mavis-${process.env.USER || 'user'}-${Date.now()}`,
        capabilities: [
            { name: 'task-planning', version: '1.0.0', maxConcurrent: 2 },
            { name: 'code-review', version: '1.0.0', maxConcurrent: 1 },
            { name: 'document-generation', version: '1.0.0', maxConcurrent: 3 },
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
            case '--session':
                config.mavisSessionId = args[++i];
                break;
        }
    }
    const shim = new MavisShim(config);
    console.log(`[Mavis Shim] Starting with agent ID: ${config.agentId}`);
    console.log(`[Mavis Shim] Relay URL: ${config.relayUrl}`);
    await shim.connect();
    console.log('[Mavis Shim] Connected and ready');
    process.on('SIGINT', async () => {
        console.log('[Mavis Shim] Shutting down...');
        await shim.disconnect();
        process.exit(0);
    });
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runMavisShim().catch(console.error);
}
export default MavisShim;
//# sourceMappingURL=mavis.js.map