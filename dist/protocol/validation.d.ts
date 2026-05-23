/**
 * DAP Protocol Validation
 * Schema validation using Zod
 */
import { z } from 'zod';
import { DAPMessageSchema, JobSubmissionSchema, AgentInfoSchema } from './types.js';
export declare function validateMessage(raw: unknown): {
    success: true;
    data: z.infer<typeof DAPMessageSchema>;
} | {
    success: false;
    error: string;
};
export declare function validateJobSubmission(raw: unknown): {
    success: true;
    data: z.infer<typeof JobSubmissionSchema>;
} | {
    success: false;
    error: string;
};
export declare function validateAgentInfo(raw: unknown): {
    success: true;
    data: z.infer<typeof AgentInfoSchema>;
} | {
    success: false;
    error: string;
};
export declare const ApiKeyScope: {
    readonly READ: "read";
    readonly WRITE: "write";
    readonly ADMIN: "admin";
};
export type ApiKeyScope = typeof ApiKeyScope[keyof typeof ApiKeyScope];
export interface ApiKeyConfig {
    key: string;
    scope: ApiKeyScope;
    description?: string;
    createdAt?: string;
}
export declare function parseApiKeys(apiKeysEnv: string | undefined): ApiKeyConfig[];
export declare const validApiKeys: string[];
export interface InvalidKeyLog {
    key: string;
    timestamp: number;
    ip: string;
    endpoint: string;
    method: string;
}
export declare function logInvalidKeyAttempt(key: string, ip: string, endpoint: string, method: string): void;
export declare function getInvalidKeyAttempts(): ReadonlyArray<InvalidKeyLog>;
export declare function validateApiKey(apiKey: string | undefined, validKeys?: string[]): boolean;
export declare function validateApiKeyWithScope(apiKey: string | undefined): {
    valid: boolean;
    scope?: ApiKeyScope;
    keyConfig?: ApiKeyConfig;
};
export declare function hasScope(apiKey: string | undefined, requiredScope: ApiKeyScope): boolean;
export declare function sanitizeAgentId(agentId: string): string;
export declare function sanitizeMessage(msg: string, maxLength?: number): string;
export declare function checkRateLimit(identifier: string, maxRequests?: number, windowMs?: number): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
};
export declare function checkKeyRateLimit(apiKey: string | undefined, maxRequests?: number, windowMs?: number): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
};
export declare function checkCombinedRateLimit(apiKey: string | undefined, ip: string, maxRequests?: number, windowMs?: number): {
    allowed: boolean;
    keyRemaining: number;
    ipRemaining: number;
    resetAt: number;
    blockedBy?: 'key' | 'ip';
};
//# sourceMappingURL=validation.d.ts.map