import { z } from 'zod';

export const A2A_PROTOCOL_VERSION = '0.3.0';
export const A2A_TRANSPORT_JSONRPC = 'JSONRPC';

export const A2AAgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  stateTransitionHistory: z.boolean().optional(),
  extensions: z.array(z.object({
    uri: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean().optional(),
    params: z.record(z.any()).optional(),
  })).optional(),
});

export const A2AAgentSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

export const A2AAgentCardSchema = z.object({
  protocolVersion: z.string().default(A2A_PROTOCOL_VERSION),
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url(),
  preferredTransport: z.string().default(A2A_TRANSPORT_JSONRPC),
  additionalInterfaces: z.array(z.object({
    url: z.string().url(),
    transport: z.string(),
  })).optional(),
  provider: z.object({
    organization: z.string().optional(),
    url: z.string().url().optional(),
  }).optional(),
  version: z.string().min(1),
  documentationUrl: z.string().url().optional(),
  capabilities: A2AAgentCapabilitiesSchema,
  securitySchemes: z.record(z.any()).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
  defaultInputModes: z.array(z.string()).min(1),
  defaultOutputModes: z.array(z.string()).min(1),
  skills: z.array(A2AAgentSkillSchema),
  supportsAuthenticatedExtendedCard: z.boolean().optional(),
});

export const A2ATextPartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
  metadata: z.record(z.any()).optional(),
});

export const A2ADataPartSchema = z.object({
  kind: z.literal('data'),
  data: z.record(z.any()),
  metadata: z.record(z.any()).optional(),
});

export const A2AFilePartSchema = z.object({
  kind: z.literal('file'),
  file: z.record(z.any()),
  metadata: z.record(z.any()).optional(),
});

export const A2APartSchema = z.union([
  A2ATextPartSchema,
  A2ADataPartSchema,
  A2AFilePartSchema,
]);

export const A2AMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(A2APartSchema).min(1),
  metadata: z.record(z.any()).optional(),
  extensions: z.array(z.string()).optional(),
  referenceTaskIds: z.array(z.string()).optional(),
  messageId: z.string().min(1),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  kind: z.literal('message'),
});

export const A2AMessageSendConfigurationSchema = z.object({
  acceptedOutputModes: z.array(z.string()).optional(),
  historyLength: z.number().int().nonnegative().optional(),
  pushNotificationConfig: z.record(z.any()).optional(),
  blocking: z.boolean().optional(),
}).passthrough();

export const A2AMessageSendParamsSchema = z.object({
  message: A2AMessageSchema,
  configuration: A2AMessageSendConfigurationSchema.optional(),
  metadata: z.record(z.any()).optional(),
});

export const A2AJsonRpcIdSchema = z.union([
  z.string(),
  z.number().int(),
  z.null(),
]);

export const A2AJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.any().optional(),
  id: A2AJsonRpcIdSchema.optional(),
});

export const A2AJsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.any().optional(),
});

export const A2AJsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: A2AJsonRpcIdSchema,
  result: z.any(),
}).strict();

export const A2AJsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: A2AJsonRpcIdSchema,
  error: A2AJsonRpcErrorSchema,
}).strict();

export const A2AJsonRpcResponseSchema = z.union([
  A2AJsonRpcSuccessResponseSchema,
  A2AJsonRpcErrorResponseSchema,
]);

export type A2AAgentCard = z.infer<typeof A2AAgentCardSchema>;
export type A2AAgentSkill = z.infer<typeof A2AAgentSkillSchema>;
export type A2AMessage = z.infer<typeof A2AMessageSchema>;
export type A2AMessageSendParams = z.infer<typeof A2AMessageSendParamsSchema>;
export type A2AJsonRpcId = z.infer<typeof A2AJsonRpcIdSchema>;
export type A2AJsonRpcRequest = z.infer<typeof A2AJsonRpcRequestSchema>;
export type A2AJsonRpcResponse = z.infer<typeof A2AJsonRpcResponseSchema>;

export const A2AJsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AGENT_NOT_FOUND: -32001,
  AGENT_TIMEOUT: -32002,
  AGENT_ERROR: -32003,
} as const;
