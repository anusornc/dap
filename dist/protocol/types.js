/**
 * DAP - Distributed Agent Protocol
 * Core type definitions
 */
import { z } from 'zod';
// ============ Enums ============
export const MessageAction = {
    REQUEST: 'request',
    RESPONSE: 'response',
    STREAM: 'stream',
    EVENT: 'event',
    JOB_SUBMISSION: 'job-submission',
    JOB_CLAIM: 'job-claim',
    JOB_COMPLETE: 'job-complete',
    JOB_PROGRESS: 'job-progress',
    JOB_CANCEL: 'job-cancel',
    CAPABILITY_QUERY: 'capability-query',
    CAPABILITY_UPDATE: 'capability-update',
    HEARTBEAT: 'heartbeat',
    ERROR: 'error',
};
export const JobStatus = {
    PENDING: 'pending',
    CLAIMED: 'claimed',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
};
export const PayloadType = {
    TASK_DELEGATION: 'task-delegation',
    JOB_SUBMISSION: 'job-submission',
    RESULT: 'result',
    HEARTBEAT: 'heartbeat',
    CAPABILITY_QUERY: 'capability-query',
    ERROR_REPORT: 'error-report',
    STREAM_CHUNK: 'stream-chunk',
    STREAM_END: 'stream-end',
    CUSTOM_EVENT: 'custom-event',
    JOB_CLAIM: 'job-claim',
    JOB_RESULT: 'job-result',
};
// ============ Schemas ============
export const CapabilitySchema = z.object({
    name: z.string().min(1),
    version: z.string().default('1.0.0'),
    maxConcurrent: z.number().int().positive().default(1),
    description: z.string().optional(),
    metadata: z.record(z.any()).optional(),
});
export const AgentInfoSchema = z.object({
    agent_id: z.string().min(1),
    machine: z.string().optional(),
    os: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    capabilityDetails: z.array(CapabilitySchema).optional(),
    version: z.string().optional(),
    last_seen: z.string().datetime().optional(),
    metadata: z.record(z.any()).optional(),
});
export const ToAddressSchema = z.union([
    z.object({ agent_id: z.string() }),
    z.object({ capability: z.string() }),
    z.object({ topic: z.string() }),
    z.literal('broadcast'),
]);
export const DAPMessageSchema = z.object({
    version: z.literal('1.0.0'),
    msg_id: z.string().uuid(),
    timestamp: z.string().datetime(),
    from: AgentInfoSchema,
    to: ToAddressSchema,
    action: z.nativeEnum(MessageAction),
    payload: z.object({
        type: z.string(), // Allow any string for flexibility
        data: z.record(z.any()),
        metadata: z.record(z.any()).optional(),
    }),
    reply_to: z.string().uuid().optional(),
    correlation_id: z.string().optional(),
});
// ============ Job Types ============
export const JobConstraintsSchema = z.object({
    maxDurationSeconds: z.number().positive().optional(),
    memoryLimitMB: z.number().positive().optional(),
    preferredAgent: z.string().optional(),
    tags: z.array(z.string()).optional(),
});
export const JobSubmissionSchema = z.object({
    type: z.string().min(1),
    priority: z.number().int().min(0).max(10).default(5),
    capabilityRequired: z.string().optional(),
    payload: z.record(z.string(), z.any()),
    constraints: JobConstraintsSchema.optional(),
    timeoutSeconds: z.number().positive().default(300),
});
// ============ Agent Card Types ============
export const AgentCardStatus = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    BUSY: 'busy',
};
//# sourceMappingURL=types.js.map