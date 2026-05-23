/**
 * DAP Message Builders
 * Helper functions to create valid DAP messages
 */

import { v4 as uuidv4 } from 'uuid';
import {
  DAPMessage,
  MessageAction,
  PayloadType,
  AgentInfo,
  ToAddress,
  Capability,
} from './types.js';

// ============ Factory Functions ============

export function createMessage(
  from: AgentInfo,
  to: ToAddress,
  action: MessageAction,
  payloadType: PayloadType,
  data: Record<string, unknown>,
  replyTo?: string
): DAPMessage {
  return {
    version: '1.0.0',
    msg_id: uuidv4(),
    timestamp: new Date().toISOString(),
    from,
    to,
    action,
    payload: {
      type: payloadType,
      data,
    },
    reply_to: replyTo,
  };
}

// ============ Request/Response ============

export function createRequest(
  from: AgentInfo,
  toAgentId: string,
  taskDescription: string,
  taskType: string = 'general',
  replyTo?: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: toAgentId },
    MessageAction.REQUEST,
    PayloadType.TASK_DELEGATION,
    {
      description: taskDescription,
      type: taskType,
      expectedCapabilities: [taskType],
    },
    replyTo
  );
}

export function createResponse(
  from: AgentInfo,
  replyToMsgId: string,
  result: unknown,
  success: boolean = true,
  error?: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: 'unknown' }, // Will be resolved by relay
    MessageAction.RESPONSE,
    PayloadType.RESULT,
    {
      success,
      result,
      error,
      originalMsgId: replyToMsgId,
    },
    replyToMsgId
  );
}

export function createStreamChunk(
  from: AgentInfo,
  replyToMsgId: string,
  chunk: string,
  sequence: number,
  isLast: boolean = false
): DAPMessage {
  return createMessage(
    from,
    { agent_id: 'unknown' },
    MessageAction.STREAM,
    isLast ? PayloadType.STREAM_END : PayloadType.STREAM_CHUNK,
    {
      chunk,
      sequence,
      isLast,
      originalMsgId: replyToMsgId,
    },
    replyToMsgId
  );
}

export function createErrorResponse(
  from: AgentInfo,
  replyToMsgId: string,
  error: string,
  errorCode?: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: 'unknown' },
    MessageAction.ERROR,
    PayloadType.ERROR_REPORT,
    {
      error,
      errorCode,
      originalMsgId: replyToMsgId,
    },
    replyToMsgId
  );
}

// ============ Events ============

export function createEvent(
  from: AgentInfo,
  eventType: string,
  eventData: Record<string, unknown>
): DAPMessage {
  return createMessage(
    from,
    'broadcast',
    MessageAction.EVENT,
    PayloadType.HEARTBEAT,
    {
      eventType,
      ...eventData,
    }
  );
}

export function createHeartbeat(
  from: AgentInfo,
  status: 'healthy' | 'busy' | 'degraded' = 'healthy'
): DAPMessage {
  return createMessage(
    from,
    'broadcast',
    MessageAction.HEARTBEAT,
    PayloadType.HEARTBEAT,
    {
      status,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    }
  );
}

// ============ Job Queue ============

export function createJobSubmission(
  from: AgentInfo,
  jobType: string,
  priority: number,
  payload: Record<string, unknown>,
  capabilityRequired?: string,
  constraints?: Record<string, unknown>
): DAPMessage {
  return createMessage(
    from,
    { topic: `task-queue:${jobType}` },
    MessageAction.JOB_SUBMISSION,
    PayloadType.JOB_SUBMISSION,
    {
      type: jobType,
      priority,
      payload,
      capabilityRequired,
      constraints,
    }
  );
}

export function createJobClaim(
  from: AgentInfo,
  jobId: string,
  capabilityType: string
): DAPMessage {
  return createMessage(
    from,
    { topic: `task-queue:${capabilityType}` },
    MessageAction.JOB_CLAIM,
    PayloadType.JOB_SUBMISSION,
    {
      jobId,
      claimedBy: from.agent_id,
    }
  );
}

export function createJobProgress(
  from: AgentInfo,
  jobId: string,
  progress: number,
  message?: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: 'unknown' }, // Submitter will be resolved
    MessageAction.JOB_PROGRESS,
    PayloadType.RESULT,
    {
      jobId,
      progress,
      message,
    }
  );
}

export function createJobComplete(
  from: AgentInfo,
  jobId: string,
  result: unknown,
  success: boolean = true,
  error?: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: 'unknown' },
    MessageAction.JOB_COMPLETE,
    PayloadType.RESULT,
    {
      jobId,
      success,
      result,
      error,
    }
  );
}

// ============ Capability Discovery ============

export function createCapabilityQuery(
  from: AgentInfo,
  capability?: string
): DAPMessage {
  return createMessage(
    from,
    'broadcast',
    MessageAction.CAPABILITY_QUERY,
    PayloadType.CAPABILITY_QUERY,
    {
      queryCapability: capability,
      timestamp: Date.now(),
    }
  );
}

export function createCapabilityUpdate(
  from: AgentInfo,
  capabilities: Capability[]
): DAPMessage {
  return createMessage(
    from,
    'broadcast',
    MessageAction.CAPABILITY_UPDATE,
    PayloadType.CAPABILITY_QUERY,
    {
      capabilities,
      timestamp: Date.now(),
    }
  );
}

// ============ Broadcast ============

export function createBroadcast(
  from: AgentInfo,
  message: string,
  targetCapability?: string
): DAPMessage {
  const to = targetCapability
    ? { capability: targetCapability }
    : 'broadcast';

  return createMessage(
    from,
    to,
    MessageAction.EVENT,
    PayloadType.TASK_DELEGATION,
    {
      broadcastType: 'general',
      message,
    }
  );
}

// ============ Message Parsing ============

export function parseMessage(raw: unknown): DAPMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;

  try {
    const parsed = JSON.parse(JSON.stringify(raw));

    // Basic validation
    if (!parsed.version || !parsed.msg_id || !parsed.action || !parsed.payload) {
      return null;
    }

    return parsed as DAPMessage;
  } catch {
    return null;
  }
}

// ============ Convenience Builders ============

export function createSimpleChat(
  from: AgentInfo,
  toAgentId: string,
  message: string
): DAPMessage {
  return createMessage(
    from,
    { agent_id: toAgentId },
    MessageAction.EVENT,
    PayloadType.TASK_DELEGATION,
    {
      chatType: 'direct',
      message,
    }
  );
}

export function createTaskDelegation(
  from: AgentInfo,
  toAgentId: string,
  task: {
    description: string;
    type: string;
    context?: Record<string, unknown>;
    priority?: number;
  }
): DAPMessage {
  return createMessage(
    from,
    { agent_id: toAgentId },
    MessageAction.REQUEST,
    PayloadType.TASK_DELEGATION,
    {
      description: task.description,
      type: task.type,
      context: task.context || {},
      priority: task.priority || 5,
    }
  );
}