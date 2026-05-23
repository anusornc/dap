/**
 * DAP - Distributed Agent Protocol
 * Core type definitions
 */
import { z } from 'zod';
export declare const MessageAction: {
    readonly REQUEST: "request";
    readonly RESPONSE: "response";
    readonly STREAM: "stream";
    readonly EVENT: "event";
    readonly JOB_SUBMISSION: "job-submission";
    readonly JOB_CLAIM: "job-claim";
    readonly JOB_COMPLETE: "job-complete";
    readonly JOB_PROGRESS: "job-progress";
    readonly JOB_CANCEL: "job-cancel";
    readonly CAPABILITY_QUERY: "capability-query";
    readonly CAPABILITY_UPDATE: "capability-update";
    readonly HEARTBEAT: "heartbeat";
    readonly ERROR: "error";
};
export type MessageAction = typeof MessageAction[keyof typeof MessageAction];
export declare const JobStatus: {
    readonly PENDING: "pending";
    readonly CLAIMED: "claimed";
    readonly IN_PROGRESS: "in-progress";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly CANCELLED: "cancelled";
};
export type JobStatus = typeof JobStatus[keyof typeof JobStatus];
export declare const PayloadType: {
    readonly TASK_DELEGATION: "task-delegation";
    readonly JOB_SUBMISSION: "job-submission";
    readonly RESULT: "result";
    readonly HEARTBEAT: "heartbeat";
    readonly CAPABILITY_QUERY: "capability-query";
    readonly ERROR_REPORT: "error-report";
    readonly STREAM_CHUNK: "stream-chunk";
    readonly STREAM_END: "stream-end";
    readonly CUSTOM_EVENT: "custom-event";
    readonly JOB_CLAIM: "job-claim";
    readonly JOB_RESULT: "job-result";
};
export type PayloadType = typeof PayloadType[keyof typeof PayloadType];
export declare const CapabilitySchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: string;
    maxConcurrent: number;
    description?: string | undefined;
    metadata?: Record<string, any> | undefined;
}, {
    name: string;
    version?: string | undefined;
    maxConcurrent?: number | undefined;
    description?: string | undefined;
    metadata?: Record<string, any> | undefined;
}>;
export declare const AgentInfoSchema: z.ZodObject<{
    agent_id: z.ZodString;
    machine: z.ZodOptional<z.ZodString>;
    os: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    capabilityDetails: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        description: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
        maxConcurrent: number;
        description?: string | undefined;
        metadata?: Record<string, any> | undefined;
    }, {
        name: string;
        version?: string | undefined;
        maxConcurrent?: number | undefined;
        description?: string | undefined;
        metadata?: Record<string, any> | undefined;
    }>, "many">>;
    version: z.ZodOptional<z.ZodString>;
    last_seen: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    agent_id: string;
    capabilities: string[];
    version?: string | undefined;
    metadata?: Record<string, any> | undefined;
    machine?: string | undefined;
    os?: string | undefined;
    capabilityDetails?: {
        name: string;
        version: string;
        maxConcurrent: number;
        description?: string | undefined;
        metadata?: Record<string, any> | undefined;
    }[] | undefined;
    last_seen?: string | undefined;
}, {
    agent_id: string;
    version?: string | undefined;
    metadata?: Record<string, any> | undefined;
    machine?: string | undefined;
    os?: string | undefined;
    capabilities?: string[] | undefined;
    capabilityDetails?: {
        name: string;
        version?: string | undefined;
        maxConcurrent?: number | undefined;
        description?: string | undefined;
        metadata?: Record<string, any> | undefined;
    }[] | undefined;
    last_seen?: string | undefined;
}>;
export declare const ToAddressSchema: z.ZodUnion<[z.ZodObject<{
    agent_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    agent_id: string;
}, {
    agent_id: string;
}>, z.ZodObject<{
    capability: z.ZodString;
}, "strip", z.ZodTypeAny, {
    capability: string;
}, {
    capability: string;
}>, z.ZodObject<{
    topic: z.ZodString;
}, "strip", z.ZodTypeAny, {
    topic: string;
}, {
    topic: string;
}>, z.ZodLiteral<"broadcast">]>;
export declare const DAPMessageSchema: z.ZodObject<{
    version: z.ZodLiteral<"1.0.0">;
    msg_id: z.ZodString;
    timestamp: z.ZodString;
    from: z.ZodObject<{
        agent_id: z.ZodString;
        machine: z.ZodOptional<z.ZodString>;
        os: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        capabilityDetails: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
            maxConcurrent: z.ZodDefault<z.ZodNumber>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
            maxConcurrent: number;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }, {
            name: string;
            version?: string | undefined;
            maxConcurrent?: number | undefined;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }>, "many">>;
        version: z.ZodOptional<z.ZodString>;
        last_seen: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        agent_id: string;
        capabilities: string[];
        version?: string | undefined;
        metadata?: Record<string, any> | undefined;
        machine?: string | undefined;
        os?: string | undefined;
        capabilityDetails?: {
            name: string;
            version: string;
            maxConcurrent: number;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }[] | undefined;
        last_seen?: string | undefined;
    }, {
        agent_id: string;
        version?: string | undefined;
        metadata?: Record<string, any> | undefined;
        machine?: string | undefined;
        os?: string | undefined;
        capabilities?: string[] | undefined;
        capabilityDetails?: {
            name: string;
            version?: string | undefined;
            maxConcurrent?: number | undefined;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }[] | undefined;
        last_seen?: string | undefined;
    }>;
    to: z.ZodUnion<[z.ZodObject<{
        agent_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        agent_id: string;
    }, {
        agent_id: string;
    }>, z.ZodObject<{
        capability: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        capability: string;
    }, {
        capability: string;
    }>, z.ZodObject<{
        topic: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        topic: string;
    }, {
        topic: string;
    }>, z.ZodLiteral<"broadcast">]>;
    action: z.ZodNativeEnum<{
        readonly REQUEST: "request";
        readonly RESPONSE: "response";
        readonly STREAM: "stream";
        readonly EVENT: "event";
        readonly JOB_SUBMISSION: "job-submission";
        readonly JOB_CLAIM: "job-claim";
        readonly JOB_COMPLETE: "job-complete";
        readonly JOB_PROGRESS: "job-progress";
        readonly JOB_CANCEL: "job-cancel";
        readonly CAPABILITY_QUERY: "capability-query";
        readonly CAPABILITY_UPDATE: "capability-update";
        readonly HEARTBEAT: "heartbeat";
        readonly ERROR: "error";
    }>;
    payload: z.ZodObject<{
        type: z.ZodString;
        data: z.ZodRecord<z.ZodString, z.ZodAny>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        data: Record<string, any>;
        metadata?: Record<string, any> | undefined;
    }, {
        type: string;
        data: Record<string, any>;
        metadata?: Record<string, any> | undefined;
    }>;
    reply_to: z.ZodOptional<z.ZodString>;
    correlation_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: "1.0.0";
    msg_id: string;
    timestamp: string;
    from: {
        agent_id: string;
        capabilities: string[];
        version?: string | undefined;
        metadata?: Record<string, any> | undefined;
        machine?: string | undefined;
        os?: string | undefined;
        capabilityDetails?: {
            name: string;
            version: string;
            maxConcurrent: number;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }[] | undefined;
        last_seen?: string | undefined;
    };
    to: {
        agent_id: string;
    } | {
        capability: string;
    } | {
        topic: string;
    } | "broadcast";
    action: "request" | "response" | "stream" | "event" | "job-submission" | "job-claim" | "job-complete" | "job-progress" | "job-cancel" | "capability-query" | "capability-update" | "heartbeat" | "error";
    payload: {
        type: string;
        data: Record<string, any>;
        metadata?: Record<string, any> | undefined;
    };
    reply_to?: string | undefined;
    correlation_id?: string | undefined;
}, {
    version: "1.0.0";
    msg_id: string;
    timestamp: string;
    from: {
        agent_id: string;
        version?: string | undefined;
        metadata?: Record<string, any> | undefined;
        machine?: string | undefined;
        os?: string | undefined;
        capabilities?: string[] | undefined;
        capabilityDetails?: {
            name: string;
            version?: string | undefined;
            maxConcurrent?: number | undefined;
            description?: string | undefined;
            metadata?: Record<string, any> | undefined;
        }[] | undefined;
        last_seen?: string | undefined;
    };
    to: {
        agent_id: string;
    } | {
        capability: string;
    } | {
        topic: string;
    } | "broadcast";
    action: "request" | "response" | "stream" | "event" | "job-submission" | "job-claim" | "job-complete" | "job-progress" | "job-cancel" | "capability-query" | "capability-update" | "heartbeat" | "error";
    payload: {
        type: string;
        data: Record<string, any>;
        metadata?: Record<string, any> | undefined;
    };
    reply_to?: string | undefined;
    correlation_id?: string | undefined;
}>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ToAddress = z.infer<typeof ToAddressSchema>;
export type DAPMessage = z.infer<typeof DAPMessageSchema>;
export interface ProvenanceRecord {
    '@context'?: string[];
    '@graph': unknown[];
}
export interface AgentProvenance {
    registeredAt: string;
    capabilities: ProvenanceRecord;
    lastActivity?: string;
    activityCount: number;
}
export interface JobProvenance {
    submission: ProvenanceRecord;
    claim?: ProvenanceRecord;
    execution?: ProvenanceRecord;
    completion?: ProvenanceRecord;
    delegation?: ProvenanceRecord[];
}
export declare const JobConstraintsSchema: z.ZodObject<{
    maxDurationSeconds: z.ZodOptional<z.ZodNumber>;
    memoryLimitMB: z.ZodOptional<z.ZodNumber>;
    preferredAgent: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    maxDurationSeconds?: number | undefined;
    memoryLimitMB?: number | undefined;
    preferredAgent?: string | undefined;
    tags?: string[] | undefined;
}, {
    maxDurationSeconds?: number | undefined;
    memoryLimitMB?: number | undefined;
    preferredAgent?: string | undefined;
    tags?: string[] | undefined;
}>;
export declare const JobSubmissionSchema: z.ZodObject<{
    type: z.ZodString;
    priority: z.ZodDefault<z.ZodNumber>;
    capabilityRequired: z.ZodOptional<z.ZodString>;
    payload: z.ZodRecord<z.ZodString, z.ZodAny>;
    constraints: z.ZodOptional<z.ZodObject<{
        maxDurationSeconds: z.ZodOptional<z.ZodNumber>;
        memoryLimitMB: z.ZodOptional<z.ZodNumber>;
        preferredAgent: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        maxDurationSeconds?: number | undefined;
        memoryLimitMB?: number | undefined;
        preferredAgent?: string | undefined;
        tags?: string[] | undefined;
    }, {
        maxDurationSeconds?: number | undefined;
        memoryLimitMB?: number | undefined;
        preferredAgent?: string | undefined;
        tags?: string[] | undefined;
    }>>;
    timeoutSeconds: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    payload: Record<string, any>;
    priority: number;
    timeoutSeconds: number;
    capabilityRequired?: string | undefined;
    constraints?: {
        maxDurationSeconds?: number | undefined;
        memoryLimitMB?: number | undefined;
        preferredAgent?: string | undefined;
        tags?: string[] | undefined;
    } | undefined;
}, {
    type: string;
    payload: Record<string, any>;
    priority?: number | undefined;
    capabilityRequired?: string | undefined;
    constraints?: {
        maxDurationSeconds?: number | undefined;
        memoryLimitMB?: number | undefined;
        preferredAgent?: string | undefined;
        tags?: string[] | undefined;
    } | undefined;
    timeoutSeconds?: number | undefined;
}>;
export type JobConstraints = z.infer<typeof JobConstraintsSchema>;
export type JobSubmission = z.infer<typeof JobSubmissionSchema>;
export interface Job {
    job_id: string;
    type: string;
    priority: number;
    submitter: string;
    capability_required?: string;
    payload: Record<string, unknown>;
    constraints?: JobConstraints;
    status: JobStatus;
    claimed_by?: string;
    result?: unknown;
    error?: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    provenance?: JobProvenance;
}
export interface ConnectionState {
    agentId: string;
    socket: any;
    connectedAt: string;
    lastHeartbeat: string;
    capabilities: Capability[];
}
export interface RelayConfig {
    port: number;
    host: string;
    apiKeys: string[];
    enableTls: boolean;
    tlsCertPath?: string;
    tlsKeyPath?: string;
    tlsPort?: number;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    corsAllowedOrigins?: string[];
}
export interface AgentConnectedEvent {
    type: 'agent-connected';
    agentId: string;
    capabilities: Capability[];
    timestamp: string;
}
export interface AgentDisconnectedEvent {
    type: 'agent-disconnected';
    agentId: string;
    reason: string;
    timestamp: string;
}
export interface JobClaimedEvent {
    type: 'job-claimed';
    jobId: string;
    agentId: string;
    timestamp: string;
}
export interface JobCompletedEvent {
    type: 'job-completed';
    jobId: string;
    agentId: string;
    result: unknown;
    timestamp: string;
}
export type RelayEvent = AgentConnectedEvent | AgentDisconnectedEvent | JobClaimedEvent | JobCompletedEvent;
export declare const AgentCardStatus: {
    readonly ACTIVE: "active";
    readonly INACTIVE: "inactive";
    readonly BUSY: "busy";
};
export type AgentCardStatus = typeof AgentCardStatus[keyof typeof AgentCardStatus];
export type ShimType = 'mavis' | 'claude-code' | 'codex' | 'custom';
export interface AgentCardCapability {
    name: string;
    version: string;
    description?: string;
    maxConcurrent?: number;
    metadata?: Record<string, unknown>;
}
export interface AgentCardEndpoints {
    wssUrl?: string;
    httpUrl?: string;
    wsUrl?: string;
}
export interface AgentCard {
    id: string;
    type: 'AgentCard';
    name: string;
    description: string;
    capabilities: AgentCardCapability[];
    version: string;
    protocolVersion: string;
    shimType: ShimType;
    endpoints: AgentCardEndpoints;
    status: AgentCardStatus;
    metadata?: Record<string, unknown>;
    '@context': string;
}
export interface AgentCardFilter {
    capability?: string;
    status?: AgentCardStatus;
    shimType?: ShimType;
}
export interface MessageContext {
    msg: DAPMessage;
    connection: ConnectionState;
    relayTime: number;
}
export interface TaskResult {
    success: boolean;
    data?: unknown;
    error?: string;
    executionTimeMs: number;
}
export interface StreamChunk {
    msg_id: string;
    chunk: string;
    sequence: number;
    isLast: boolean;
}
//# sourceMappingURL=types.d.ts.map