/**
 * DAP Protocol Validation
 * Schema validation using Zod
 */

import { z } from 'zod';
import { DAPMessageSchema, JobSubmissionSchema, AgentInfoSchema } from './types.js';

// ============ Message Validation ============

export function validateMessage(raw: unknown): {
  success: true;
  data: z.infer<typeof DAPMessageSchema>;
} | {
  success: false;
  error: string;
} {
  try {
    const result = DAPMessageSchema.safeParse(raw);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');

    return { success: false, error: `Validation failed: ${errors}` };
  } catch (err) {
    return { success: false, error: `Invalid message format: ${err}` };
  }
}

// ============ Job Validation ============

export function validateJobSubmission(raw: unknown): {
  success: true;
  data: z.infer<typeof JobSubmissionSchema>;
} | {
  success: false;
  error: string;
} {
  try {
    const result = JobSubmissionSchema.safeParse(raw);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');

    return { success: false, error: `Job validation failed: ${errors}` };
  } catch (err) {
    return { success: false, error: `Invalid job format: ${err}` };
  }
}

// ============ Agent Info Validation ============

export function validateAgentInfo(raw: unknown): {
  success: true;
  data: z.infer<typeof AgentInfoSchema>;
} | {
  success: false;
  error: string;
} {
  try {
    const result = AgentInfoSchema.safeParse(raw);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');

    return { success: false, error: `Agent info validation failed: ${errors}` };
  } catch (err) {
    return { success: false, error: `Invalid agent info format: ${err}` };
  }
}

// ============ Security Validation ============

// API Key scopes
export const ApiKeyScope = {
  READ: 'read',         // Read-only access (agents, jobs, capabilities)
  WRITE: 'write',       // Read + write access (submit jobs, claim jobs)
  ADMIN: 'admin',       // Full access including management
} as const;

export type ApiKeyScope = typeof ApiKeyScope[keyof typeof ApiKeyScope];

// API Key configuration with scope
export interface ApiKeyConfig {
  key: string;
  scope: ApiKeyScope;
  description?: string;
  createdAt?: string;
}

// Parse API keys from env format: key1:scope1,key2:scope2,key3
export function parseApiKeys(apiKeysEnv: string | undefined): ApiKeyConfig[] {
  if (!apiKeysEnv?.trim()) return [];

  const results: ApiKeyConfig[] = [];

  for (const entry of apiKeysEnv.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    const key = colonIndex > 0 ? trimmed.substring(0, colonIndex) : trimmed;
    const scopeStr = colonIndex > 0 ? trimmed.substring(colonIndex + 1) : '';

    if (!key) continue;

    let keyScope: ApiKeyScope = ApiKeyScope.READ; // Default scope
    if (scopeStr && Object.values(ApiKeyScope).includes(scopeStr as ApiKeyScope)) {
      keyScope = scopeStr as ApiKeyScope;
    }

    results.push({
      key,
      scope: keyScope,
      description: `Key ending in ...${key.slice(-4)}`,
      createdAt: new Date().toISOString(),
    });
  }

  return results;
}

// Store parsed API keys (call parseApiKeys once at module load)
const validApiKeyConfigs = parseApiKeys(process.env.API_KEYS);
export const validApiKeys = validApiKeyConfigs.map(k => k.key);

// ============ Invalid Key Attempt Logging ============

export interface InvalidKeyLog {
  key: string;
  timestamp: number;
  ip: string;
  endpoint: string;
  method: string;
}

const invalidKeyLog: InvalidKeyLog[] = [];
const MAX_INVALID_LOG_SIZE = 100;

export function logInvalidKeyAttempt(key: string, ip: string, endpoint: string, method: string): void {
  invalidKeyLog.push({
    key: key ? `${key.slice(0, 4)}***` : '(empty)',
    timestamp: Date.now(),
    ip,
    endpoint,
    method,
  });

  // Keep log bounded
  while (invalidKeyLog.length > MAX_INVALID_LOG_SIZE) {
    invalidKeyLog.shift();
  }

  // Log to console (in production, use proper structured logging)
  console.warn(`[Security] Invalid API key attempt: key=${key ? `${key.slice(0, 4)}***` : '(empty)'}, ip=${ip}, endpoint=${endpoint}, method=${method}`);
}

export function getInvalidKeyAttempts(): ReadonlyArray<InvalidKeyLog> {
  return invalidKeyLog;
}

// ============ API Key Validation ============

export function validateApiKey(
  apiKey: string | undefined,
  validKeys: string[] = validApiKeys
): boolean {
  if (!apiKey) return false;
  return validKeys.includes(apiKey);
}

// Validate API key and return its scope
export function validateApiKeyWithScope(
  apiKey: string | undefined
): { valid: boolean; scope?: ApiKeyScope; keyConfig?: ApiKeyConfig } {
  if (!apiKey) {
    return { valid: false };
  }

  const keyConfig = validApiKeyConfigs.find(k => k.key === apiKey);
  if (!keyConfig) {
    return { valid: false };
  }

  return { valid: true, scope: keyConfig.scope, keyConfig };
}

// Check if a key has required scope
export function hasScope(apiKey: string | undefined, requiredScope: ApiKeyScope): boolean {
  const { valid, scope } = validateApiKeyWithScope(apiKey);
  if (!valid || !scope) return false;

  // Scope hierarchy: ADMIN > WRITE > READ
  const scopeLevel: Record<ApiKeyScope, number> = {
    [ApiKeyScope.READ]: 1,
    [ApiKeyScope.WRITE]: 2,
    [ApiKeyScope.ADMIN]: 3,
  };

  return scopeLevel[scope] >= scopeLevel[requiredScope];
}

export function sanitizeAgentId(agentId: string): string {
  // Only allow alphanumeric, dash, underscore
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export function sanitizeMessage(msg: string, maxLength: number = 10000): string {
  if (typeof msg !== 'string') return '';
  return msg.slice(0, maxLength).replace(/[\x00-\x1F\x7F]/g, '');
}

// ============ Rate Limiting ============

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Separate rate limit maps: one by API key, one by IP
const rateLimitByKey = new Map<string, RateLimitEntry>();
const rateLimitByIP = new Map<string, RateLimitEntry>();

// Default rate limits from environment
const DEFAULT_RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '100');
const DEFAULT_RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

export function checkRateLimit(
  identifier: string,
  maxRequests: number = DEFAULT_RATE_LIMIT_REQUESTS,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitByKey.get(identifier);

  if (!entry || now > entry.resetAt) {
    rateLimitByKey.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

// Per-key rate limiting - uses the API key as the identifier
export function checkKeyRateLimit(
  apiKey: string | undefined,
  maxRequests: number = DEFAULT_RATE_LIMIT_REQUESTS,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = apiKey || 'anonymous';
  return checkRateLimit(key, maxRequests, windowMs);
}

// Combined rate limiting - checks both key and IP
export function checkCombinedRateLimit(
  apiKey: string | undefined,
  ip: string,
  maxRequests: number = DEFAULT_RATE_LIMIT_REQUESTS,
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS
): { allowed: boolean; keyRemaining: number; ipRemaining: number; resetAt: number; blockedBy?: 'key' | 'ip' } {
  const keyResult = checkKeyRateLimit(apiKey, maxRequests, windowMs);
  const ipResult = checkRateLimit(`ip:${ip}`, maxRequests, windowMs);

  if (!keyResult.allowed) {
    return { allowed: false, keyRemaining: 0, ipRemaining: ipResult.remaining, resetAt: keyResult.resetAt, blockedBy: 'key' };
  }

  if (!ipResult.allowed) {
    return { allowed: false, keyRemaining: keyResult.remaining, ipRemaining: 0, resetAt: ipResult.resetAt, blockedBy: 'ip' };
  }

  return {
    allowed: true,
    keyRemaining: keyResult.remaining,
    ipRemaining: ipResult.remaining,
    resetAt: Math.min(keyResult.resetAt, ipResult.resetAt)
  };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitByKey.entries()) {
    if (now > entry.resetAt) {
      rateLimitByKey.delete(key);
    }
  }
  for (const [key, entry] of rateLimitByIP.entries()) {
    if (now > entry.resetAt) {
      rateLimitByIP.delete(key);
    }
  }
}, 60000); // Every minute