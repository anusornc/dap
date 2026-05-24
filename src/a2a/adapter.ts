import { v4 as uuidv4 } from 'uuid';
import { AgentCard, DAPMessage } from '../protocol/types.js';
import {
  A2A_PROTOCOL_VERSION,
  A2A_TRANSPORT_JSONRPC,
  A2AAgentCard,
  A2AAgentSkill,
  A2AJsonRpcErrorCode,
  A2AJsonRpcId,
  A2AJsonRpcRequest,
  A2AJsonRpcResponse,
  A2AMessage,
  A2AMessageSendParams,
  A2AMessageSendParamsSchema,
} from './types.js';

export interface A2ACardOptions {
  baseUrl: string;
  requiresApiKey?: boolean;
}

export interface DapTaskFromA2A {
  description: string;
  type: string;
  context: Record<string, unknown>;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function skillId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'general';
}

function apiKeySecurity(requiresApiKey?: boolean): Pick<A2AAgentCard, 'security' | 'securitySchemes'> {
  if (!requiresApiKey) {
    return {};
  }

  return {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
    security: [{ apiKey: [] }],
  };
}

function capabilityToSkill(capability: AgentCard['capabilities'][number]): A2AAgentSkill {
  return {
    id: skillId(capability.name),
    name: capability.name,
    description: capability.description || `DAP capability ${capability.name}`,
    tags: ['dap', capability.name],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['text/plain', 'application/json'],
  };
}

export function dapAgentCardToA2A(card: AgentCard, options: A2ACardOptions): A2AAgentCard {
  const url = joinUrl(options.baseUrl, `/a2a/agents/${encodeURIComponent(card.id)}`);
  const skills = card.capabilities.length > 0
    ? card.capabilities.map(capabilityToSkill)
    : [{
      id: 'general',
      name: 'general',
      description: `Delegate work to DAP agent ${card.name}`,
      tags: ['dap', 'general'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain', 'application/json'],
    }];

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: card.name,
    description: card.description,
    url,
    preferredTransport: A2A_TRANSPORT_JSONRPC,
    additionalInterfaces: [{ url, transport: A2A_TRANSPORT_JSONRPC }],
    provider: { organization: 'DAP Relay' },
    version: card.version,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    ...apiKeySecurity(options.requiresApiKey),
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills,
    supportsAuthenticatedExtendedCard: false,
  };
}

export function createRelayA2ACard(
  options: A2ACardOptions & { agentCount?: number; version?: string }
): A2AAgentCard {
  const url = joinUrl(options.baseUrl, '/a2a');
  const agentCount = options.agentCount ?? 0;

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: 'DAP A2A Gateway',
    description: `A2A compatibility gateway for ${agentCount} connected DAP agent${agentCount === 1 ? '' : 's'}`,
    url,
    preferredTransport: A2A_TRANSPORT_JSONRPC,
    additionalInterfaces: [{ url, transport: A2A_TRANSPORT_JSONRPC }],
    provider: { organization: 'DAP Relay' },
    version: options.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    ...apiKeySecurity(options.requiresApiKey),
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [{
      id: 'delegate-to-dap-agent',
      name: 'delegate-to-dap-agent',
      description: 'Delegate a synchronous message/send request to a connected DAP agent. Provide metadata.targetAgentId when using the gateway endpoint.',
      tags: ['dap', 'relay', 'delegation'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain', 'application/json'],
    }],
    supportsAuthenticatedExtendedCard: false,
  };
}

export function messageSendParamsToDapTask(params: A2AMessageSendParams): DapTaskFromA2A {
  const parsed = A2AMessageSendParamsSchema.parse(params);
  const textParts = parsed.message.parts
    .filter((part): part is Extract<typeof part, { kind: 'text' }> => part.kind === 'text')
    .map(part => part.text)
    .filter(Boolean);
  const dataParts = parsed.message.parts
    .filter((part): part is Extract<typeof part, { kind: 'data' }> => part.kind === 'data')
    .map(part => part.data);
  const fileParts = parsed.message.parts
    .filter((part): part is Extract<typeof part, { kind: 'file' }> => part.kind === 'file')
    .map(part => part.file);

  const requestedSkill = parsed.metadata?.skillId || parsed.message.metadata?.skillId;
  const taskType = typeof requestedSkill === 'string' && requestedSkill.length > 0
    ? requestedSkill
    : 'a2a-message-send';

  return {
    description: textParts.join('\n\n') || 'A2A message/send request',
    type: taskType,
    context: {
      a2a: {
        messageId: parsed.message.messageId,
        taskId: parsed.message.taskId,
        contextId: parsed.message.contextId,
        role: parsed.message.role,
        metadata: parsed.metadata,
        messageMetadata: parsed.message.metadata,
        configuration: parsed.configuration,
      },
      dataParts,
      fileParts,
    },
  };
}

function resultToParts(result: unknown): A2AMessage['parts'] {
  if (typeof result === 'string') {
    return [{ kind: 'text', text: result }];
  }

  if (result === undefined || result === null) {
    return [{ kind: 'text', text: '' }];
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return [{ kind: 'text', text: String(result) }];
  }

  return [{ kind: 'data', data: { result } }];
}

export function dapReplyToA2AMessage(reply: DAPMessage, request: A2AMessageSendParams): A2AMessage {
  const data = reply.payload.data;
  const result = data.result ?? data.data ?? data;

  return {
    role: 'agent',
    parts: resultToParts(result),
    messageId: reply.msg_id || uuidv4(),
    taskId: request.message.taskId,
    contextId: request.message.contextId,
    kind: 'message',
    metadata: {
      dapMessageId: reply.msg_id,
      dapReplyTo: reply.reply_to,
      dapAction: reply.action,
    },
  };
}

export function jsonRpcSuccess(id: A2AJsonRpcId | undefined, result: unknown): A2AJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

export function jsonRpcError(
  id: A2AJsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
): A2AJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      data,
    },
  };
}

export function unsupportedMethodError(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
  return jsonRpcError(
    request.id,
    A2AJsonRpcErrorCode.METHOD_NOT_FOUND,
    `Unsupported A2A method: ${request.method}`
  );
}
