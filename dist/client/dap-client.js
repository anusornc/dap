/**
 * DAP Client Library
 * Easy-to-use client for connecting agents to the relay
 */
import { v4 as uuidv4 } from 'uuid';
import { MessageAction, } from '../protocol/types.js';
export class DAPClient {
    config;
    socket = null;
    connected = false;
    messageHandlers = new Map();
    pendingRequests = new Map();
    reconnectTimer;
    reconnectAttempts = 0;
    constructor(config) {
        this.config = {
            reconnectIntervalMs: 5000,
            requestTimeoutMs: 60000,
            ...config,
        };
    }
    // ============ Connection ============
    async connect() {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.relayUrl);
            if (this.config.apiKey) {
                url.searchParams.set('token', this.config.apiKey);
            }
            this.socket = new WebSocket(url.toString());
            this.socket.onopen = () => {
                console.log(`[DAPClient] Connected to ${this.config.relayUrl}`);
                const registerMsg = {
                    action: 'register',
                    agentId: this.config.agentId,
                    capabilities: this.config.capabilities,
                    metadata: this.config.metadata,
                    os: process.platform,
                    version: '1.0.0',
                };
                this.socket.send(JSON.stringify(registerMsg));
                this.connected = true;
                this.reconnectAttempts = 0;
                resolve();
            };
            this.socket.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    await this.handleMessage(msg);
                }
                catch (err) {
                    console.error('[DAPClient] Message handling error:', err);
                }
            };
            this.socket.onclose = (event) => {
                console.log(`[DAPClient] Disconnected: ${event.code}`);
                this.connected = false;
                this.scheduleReconnect();
            };
            this.socket.onerror = (err) => {
                console.error('[DAPClient] Connection error:', err);
                reject(err);
            };
        });
    }
    async disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.socket) {
            this.socket.close(1000, 'Client disconnect');
            this.socket = null;
            this.connected = false;
        }
    }
    isConnected() {
        return this.connected && this.socket?.readyState === WebSocket.OPEN;
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts++;
        const delay = Math.min(this.config.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1), 60000);
        console.log(`[DAPClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            try {
                await this.connect();
                console.log('[DAPClient] Reconnected');
            }
            catch {
                // Will try again
            }
        }, delay);
    }
    // ============ Message Handling ============
    async handleMessage(msg) {
        if (msg.action === MessageAction.RESPONSE || msg.action === MessageAction.ERROR) {
            const pending = this.pendingRequests.get(msg.reply_to || '');
            if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(msg);
                this.pendingRequests.delete(msg.reply_to || '');
                return;
            }
        }
        for (const handler of this.messageHandlers.values()) {
            try {
                await handler(msg);
            }
            catch (err) {
                console.error('[DAPClient] Handler error:', err);
            }
        }
    }
    on(action, handler) {
        this.messageHandlers.set(action, handler);
    }
    off(action) {
        this.messageHandlers.delete(action);
    }
    // ============ Sending Messages ============
    async send(msg) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to relay');
        }
        this.socket.send(JSON.stringify(msg));
    }
    getAgentInfo() {
        return {
            agent_id: this.config.agentId,
            capabilities: this.config.capabilities.map(c => c.name),
            capabilityDetails: this.config.capabilities,
            metadata: this.config.metadata,
            version: '1.0.0',
        };
    }
    // ============ P2P Messaging ============
    async sendRequest(toAgentId, task, timeoutMs) {
        const startTime = Date.now();
        const msgId = uuidv4();
        const msg = {
            version: '1.0.0',
            msg_id: msgId,
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: { agent_id: toAgentId },
            action: MessageAction.REQUEST,
            payload: {
                type: 'task-delegation',
                data: task,
            },
        };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(msgId);
                reject(new Error(`Request timeout after ${timeoutMs || this.config.requestTimeoutMs}ms`));
            }, timeoutMs || this.config.requestTimeoutMs);
            this.pendingRequests.set(msgId, {
                resolve: (responseMsg) => {
                    const data = responseMsg.payload.data;
                    resolve({
                        success: data.success,
                        result: data.result,
                        error: data.error,
                        executionTimeMs: Date.now() - startTime,
                    });
                },
                reject,
                timeout,
            });
            this.send(msg).catch(reject);
        });
    }
    async sendEvent(to, eventType, data) {
        const msg = {
            version: '1.0.0',
            msg_id: uuidv4(),
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: typeof to === 'string' ? to : to,
            action: MessageAction.EVENT,
            payload: {
                type: 'custom-event',
                data: {
                    eventType,
                    ...data,
                },
            },
        };
        await this.send(msg);
    }
    // ============ Job Queue ============
    async submitJob(jobType, payload, options) {
        const msgId = uuidv4();
        const msg = {
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
                    priority: options?.priority ?? 5,
                    payload,
                    capabilityRequired: options?.capabilityRequired,
                    constraints: options?.constraints,
                    timeoutSeconds: options?.timeoutSeconds ?? 300,
                },
            },
        };
        await this.send(msg);
        return msgId;
    }
    async claimJob(capability) {
        const msg = {
            version: '1.0.0',
            msg_id: uuidv4(),
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: { capability },
            action: MessageAction.JOB_CLAIM,
            payload: {
                type: 'job-claim',
                data: {
                    agentId: this.config.agentId,
                    capability,
                },
            },
        };
        await this.send(msg);
        return null;
    }
    async completeJob(jobId, result, error) {
        const msg = {
            version: '1.0.0',
            msg_id: uuidv4(),
            timestamp: new Date().toISOString(),
            from: this.getAgentInfo(),
            to: { agent_id: 'relay' },
            action: MessageAction.JOB_COMPLETE,
            payload: {
                type: 'job-result',
                data: {
                    jobId,
                    success: !error,
                    result,
                    error,
                },
            },
        };
        await this.send(msg);
    }
    // ============ Capability Discovery ============
    async getCapabilities() {
        return new Promise((resolve) => {
            const msg = {
                version: '1.0.0',
                msg_id: uuidv4(),
                timestamp: new Date().toISOString(),
                from: this.getAgentInfo(),
                to: 'broadcast',
                action: MessageAction.CAPABILITY_QUERY,
                payload: {
                    type: 'capability-query',
                    data: {},
                },
            };
            const handler = async (response) => {
                if (response.action === MessageAction.RESPONSE) {
                    this.messageHandlers.delete('capability-response');
                    resolve(new Map(Object.entries(response.payload.data.capabilities || {})));
                }
            };
            this.messageHandlers.set('capability-response', handler);
            this.send(msg);
            setTimeout(() => {
                this.messageHandlers.delete('capability-response');
                resolve(new Map());
            }, 5000);
        });
    }
    // ============ Utility ============
    getAgentId() {
        return this.config.agentId;
    }
    getCapabilitiesList() {
        return this.config.capabilities.map(c => c.name);
    }
}
export function createDAPClient(config) {
    return new DAPClient(config);
}
export default DAPClient;
//# sourceMappingURL=dap-client.js.map