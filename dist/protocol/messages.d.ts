/**
 * DAP Message Builders
 * Helper functions to create valid DAP messages
 */
import { DAPMessage, MessageAction, PayloadType, AgentInfo, ToAddress, Capability } from './types.js';
export declare function createMessage(from: AgentInfo, to: ToAddress, action: MessageAction, payloadType: PayloadType, data: Record<string, unknown>, replyTo?: string): DAPMessage;
export declare function createRequest(from: AgentInfo, toAgentId: string, taskDescription: string, taskType?: string, replyTo?: string): DAPMessage;
export declare function createResponse(from: AgentInfo, replyToMsgId: string, result: unknown, success?: boolean, error?: string): DAPMessage;
export declare function createStreamChunk(from: AgentInfo, replyToMsgId: string, chunk: string, sequence: number, isLast?: boolean): DAPMessage;
export declare function createErrorResponse(from: AgentInfo, replyToMsgId: string, error: string, errorCode?: string): DAPMessage;
export declare function createEvent(from: AgentInfo, eventType: string, eventData: Record<string, unknown>): DAPMessage;
export declare function createHeartbeat(from: AgentInfo, status?: 'healthy' | 'busy' | 'degraded'): DAPMessage;
export declare function createJobSubmission(from: AgentInfo, jobType: string, priority: number, payload: Record<string, unknown>, capabilityRequired?: string, constraints?: Record<string, unknown>): DAPMessage;
export declare function createJobClaim(from: AgentInfo, jobId: string, capabilityType: string): DAPMessage;
export declare function createJobProgress(from: AgentInfo, jobId: string, progress: number, message?: string): DAPMessage;
export declare function createJobComplete(from: AgentInfo, jobId: string, result: unknown, success?: boolean, error?: string): DAPMessage;
export declare function createCapabilityQuery(from: AgentInfo, capability?: string): DAPMessage;
export declare function createCapabilityUpdate(from: AgentInfo, capabilities: Capability[]): DAPMessage;
export declare function createBroadcast(from: AgentInfo, message: string, targetCapability?: string): DAPMessage;
export declare function parseMessage(raw: unknown): DAPMessage | null;
export declare function createSimpleChat(from: AgentInfo, toAgentId: string, message: string): DAPMessage;
export declare function createTaskDelegation(from: AgentInfo, toAgentId: string, task: {
    description: string;
    type: string;
    context?: Record<string, unknown>;
    priority?: number;
}): DAPMessage;
//# sourceMappingURL=messages.d.ts.map