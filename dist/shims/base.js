/**
 * Base Agent Shim Interface
 * Abstract interface for connecting agents to the relay
 */
export class BaseShim {
    config;
    socket = null;
    connected = false;
    eventHandler;
    pendingRequests = new Map();
    constructor(config) {
        this.config = config;
    }
    // ============ Connection ============
    async connect() {
        // Implementation in subclasses
    }
    async disconnect() {
        if (this.socket) {
            this.socket.close(1000, 'Client disconnect');
            this.socket = null;
            this.connected = false;
        }
    }
    isConnected() {
        return this.connected;
    }
    // ============ Message Handling ============
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async handleMessage(_msg) {
        // Handle in subclasses
    }
    async sendToLocalAgent(task) {
        // Default implementation - override in subclasses
        console.log(`[Shim] Executing task: ${task.description}`);
        // Simulate task execution
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: true,
                    data: `Task "${task.description}" completed`,
                    executionTimeMs: 100,
                });
            }, 100);
        });
    }
    async sendMessage(msg) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to relay');
        }
        this.socket.send(JSON.stringify(msg));
    }
    async sendRequest(toAgentId, task, timeoutMs = 60000) {
        const msgId = crypto.randomUUID();
        const msg = {
            version: '1.0.0',
            msg_id: msgId,
            timestamp: new Date().toISOString(),
            from: {
                agent_id: this.config.agentId,
                capabilities: this.config.capabilities.map(c => c.name),
                capabilityDetails: this.config.capabilities,
                metadata: this.config.metadata,
            },
            to: { agent_id: toAgentId },
            action: 'request',
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
                reject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(msgId, { resolve, reject, timeout });
            this.sendMessage(msg).then(() => {
                // Wait for response
            }).catch((err) => {
                clearTimeout(timeout);
                this.pendingRequests.delete(msgId);
                reject(err);
            });
        });
    }
    // ============ Event Handlers ============
    setEventHandler(handler) {
        this.eventHandler = handler;
    }
    // ============ Capability Queries ============
    async queryCapabilities() {
        const msg = {
            version: '1.0.0',
            msg_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            from: {
                agent_id: this.config.agentId,
                capabilities: this.config.capabilities.map(c => c.name),
            },
            to: 'broadcast',
            action: 'capability-query',
            payload: {
                type: 'capability-query',
                data: {},
            },
        };
        // For now, this is a fire-and-forget query
        // Response will come back as an event
        this.sendMessage(msg);
        return new Promise((resolve) => {
            // In a real implementation, we'd wait for the response
            // For now, return empty
            setTimeout(() => resolve(new Map()), 1000);
        });
    }
    // ============ Utility ============
    getAgentInfo() {
        return {
            agent_id: this.config.agentId,
            capabilities: this.config.capabilities.map(c => c.name),
            capabilityDetails: this.config.capabilities,
            metadata: this.config.metadata,
            version: '1.0.0',
        };
    }
}
// ============ Generic DAP Client Shim ============
export class GenericDAPShim extends BaseShim {
    async connect() {
        const url = new URL(this.config.relayUrl);
        if (this.config.apiKey) {
            url.searchParams.set('token', this.config.apiKey);
        }
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(url.toString());
            this.socket.onopen = () => {
                console.log(`[Shim] Connected to relay`);
                // Register with server
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
                resolve();
            };
            this.socket.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.action === 'request' && this.eventHandler?.onTask) {
                        const task = {
                            taskId: msg.msg_id,
                            description: msg.payload.data.description,
                            type: msg.payload.data.type,
                            context: msg.payload.data.context,
                            priority: msg.payload.data.priority,
                        };
                        const result = await this.sendToLocalAgent(task);
                        // Send response
                        await this.sendMessage({
                            version: '1.0.0',
                            msg_id: crypto.randomUUID(),
                            timestamp: new Date().toISOString(),
                            from: this.getAgentInfo(),
                            to: { agent_id: msg.from.agent_id },
                            action: 'response',
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
                        });
                    }
                    else {
                        await this.handleMessage(msg);
                    }
                }
                catch (err) {
                    console.error('[Shim] Message handling error:', err);
                }
            };
            this.socket.onclose = () => {
                console.log('[Shim] Disconnected from relay');
                this.connected = false;
            };
            this.socket.onerror = (err) => {
                console.error('[Shim] Connection error:', err);
                reject(err);
            };
        });
    }
    async disconnect() {
        await super.disconnect();
    }
    isConnected() {
        return this.connected;
    }
    async handleMessage(msg) {
        switch (msg.action) {
            case 'event':
                await this.eventHandler?.onEvent?.(msg);
                break;
            case 'response':
                const pending = this.pendingRequests.get(msg.reply_to || '');
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.resolve(msg);
                    this.pendingRequests.delete(msg.reply_to || '');
                }
                break;
            default:
                console.log(`[Shim] Unhandled message type: ${msg.action}`);
        }
    }
    async sendToLocalAgent(task) {
        // Default implementation - override in subclasses
        console.log(`[Shim] Executing task: ${task.description}`);
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: true,
                    data: `Task "${task.description}" completed`,
                    executionTimeMs: 100,
                });
            }, 100);
        });
    }
}
//# sourceMappingURL=base.js.map