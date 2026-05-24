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
} as const;

export type MessageAction = typeof MessageAction[keyof typeof MessageAction];

export const JobStatus = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = typeof JobStatus[keyof typeof JobStatus];

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
} as const;

export type PayloadType = typeof PayloadType[keyof typeof PayloadType];

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

// ============ Types ============

export type Capability = z.infer<typeof CapabilitySchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ToAddress = z.infer<typeof ToAddressSchema>;
export type DAPMessage = z.infer<typeof DAPMessageSchema>;

// ============ Provenance Types ============

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

// ============ Connection Types ============

export interface ConnectionState {
  agentId: string;
  socket: any; // Use any to avoid WebSocket type conflicts
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
  requestTimeoutMs?: number;
  corsAllowedOrigins?: string[];
}

// ============ Event Types ============

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

export type RelayEvent =
  | AgentConnectedEvent
  | AgentDisconnectedEvent
  | JobClaimedEvent
  | JobCompletedEvent;

// ============ Agent Card Types ============

export const AgentCardStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BUSY: 'busy',
} as const;

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

// ============ Helper Types ============

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
