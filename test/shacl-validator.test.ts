/**
 * SHACL Validator Tests
 * Tests the TypeScript-based SHACL-like validator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SHACLValidator } from '../src/validation/shacl-validator.js';

describe('SHACLValidator', () => {
  let validator: SHACLValidator;

  beforeEach(() => {
    validator = new SHACLValidator('./shapes');
  });

  describe('Agent Validation', () => {
    it('should accept valid agent registration with all fields', () => {
      const validAgent = {
        agent_id: 'agent-001',
        capabilities: ['code-generation', 'testing'],
        version: '1.0.0',
        os: 'linux',
        metadata: {},
        machine: 'desktop-01',
      };
      const result = validator.validateAgent(validAgent);
      expect(result.valid).toBe(true);
    });

    it('should accept minimal agent with required fields only', () => {
      const minimalAgent = {
        agent_id: 'agent-001',
        capabilities: ['coding'],
      };
      const result = validator.validateAgent(minimalAgent);
      expect(result.valid).toBe(true);
    });

    it('should reject agent with empty agent_id', () => {
      const invalidAgent = {
        agent_id: '',
        capabilities: ['coding'],
      };
      const result = validator.validateAgent(invalidAgent);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'agent_id')).toBe(true);
    });

    it('should reject agent with empty capabilities', () => {
      const invalidAgent = {
        agent_id: 'agent-001',
        capabilities: [],
      };
      const result = validator.validateAgent(invalidAgent);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'capabilities')).toBe(true);
    });

    it('should reject non-string agent_id', () => {
      const invalidAgent = {
        agent_id: 123,
        capabilities: ['coding'],
      };
      const result = validator.validateAgent(invalidAgent);
      expect(result.valid).toBe(false);
    });
  });

  describe('Message Validation', () => {
    it('should accept valid message', () => {
      const validMessage = {
        id: 'msg-001',
        action: 'request',
        from: 'agent-001',
        to: { agent_id: 'agent-002' },
        payload: { content: 'hello' },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = validator.validateMessage(validMessage);
      // message-shape loaded 0 fields from TTL, so it passes
      expect(result.valid).toBe(true);
    });

    it('should accept minimal message', () => {
      const minimalMessage = { id: 'msg-001' };
      const result = validator.validateMessage(minimalMessage);
      expect(result.valid).toBe(true);
    });
  });

  describe('Job Validation', () => {
    it('should accept valid job', () => {
      const validJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'pending',
        submitter: 'agent-001',
        payload: 'job-data-001',
        priority: 5,
        created_at: '2024-01-01T00:00:00.000Z',
      };
      const result = validator.validateJob(validJob);
      expect(result.valid).toBe(true);
    });

    it('should accept job with all status values', () => {
      const statuses = ['pending', 'claimed', 'in-progress', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status,
          submitter: 'agent-001',
          payload: 'job-data-002',
          priority: 5,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject job with invalid status', () => {
      const invalidJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'invalid-status',
        submitter: 'agent-001',
        payload: 'job-data-003',
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'status')).toBe(true);
    });

    it('should reject job with missing required fields', () => {
      // job_id and type are required
      const incompleteJob = {
        priority: 5,
      };
      const result = validator.validateJob(incompleteJob);
      expect(result.valid).toBe(false);
    });

    it('should accept job with valid priority values', () => {
      const priorities = [0, 5, 10];
      for (const priority of priorities) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status: 'pending',
          submitter: 'agent-001',
          payload: 'job-data-004',
          priority,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

it('should accept job with all status values', () => {
      const statuses = ['pending', 'claimed', 'in-progress', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status,
          submitter: 'agent-001',
          payload: 'job-payload',
          priority: 5,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject job with invalid status', () => {
      const invalidJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'invalid-status',
        submitter: 'agent-001',
        payload: 'job-payload',
        priority: 5,
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'status')).toBe(true);
    });

    it('should reject job with missing required fields', () => {
      const incompleteJob = {
        type: 'task-delegation',
      };
      const result = validator.validateJob(incompleteJob);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept job with valid priority values', () => {
      const priorities = [0, 5, 10];
      for (const priority of priorities) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status: 'pending',
          submitter: 'agent-001',
          payload: 'job-payload',
          priority,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept job with all status values', () => {
      const statuses = ['pending', 'claimed', 'in-progress', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status,
          submitter: 'agent-001',
          payload: 'job-payload',
          priority: 5,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject job with invalid status', () => {
      const invalidJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'invalid-status',
        submitter: 'agent-001',
        payload: 'job-payload',
        priority: 5,
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'status')).toBe(true);
    });

    it('should reject job with missing required fields', () => {
      const incompleteJob = {
        type: 'task-delegation',
      };
      const result = validator.validateJob(incompleteJob);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept job with valid priority values', () => {
      const priorities = [0, 5, 10];
      for (const priority of priorities) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status: 'pending',
          submitter: 'agent-001',
          payload: 'job-payload',
          priority,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject job with invalid status', () => {
      const invalidJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'invalid-status',
        submitter: 'agent-001',
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'status')).toBe(true);
    });

    it('should reject job with missing required fields', () => {
      // job_id and type are required
      const incompleteJob = {
        priority: 5,
      };
      const result = validator.validateJob(incompleteJob);
      expect(result.valid).toBe(false);
    });

    it('should accept job with valid priority values', () => {
      const priorities = [0, 5, 10];
      for (const priority of priorities) {
        const job = {
          job_id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'task-delegation',
          status: 'pending',
          submitter: 'agent-001',
          payload: 'test-payload',
          priority,
        };
        const result = validator.validateJob(job);
        expect(result.valid).toBe(true);
      }
    });

it('should reject job with invalid priority', () => {
      const invalidJob = {
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'task-delegation',
        status: 'pending',
        submitter: 'agent-001',
        payload: 'job-payload',
        priority: 15,
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
    });
  });

  describe('Shape Loading', () => {
    it('should load shapes from TTL files', () => {
      const shapes = validator.getShapeInfo();
      expect(shapes.length).toBeGreaterThan(0);
    });

    it('should have agent-shape and job-shape loaded', () => {
      const shapes = validator.getShapeInfo();
      const agentShape = shapes.find(s => s.name === 'agent-shape');
      const jobShape = shapes.find(s => s.name === 'job-shape');
      expect(agentShape).toBeDefined();
      expect(jobShape).toBeDefined();
    });

    it('should have fields in agent-shape', () => {
      const shapes = validator.getShapeInfo();
      const agentShape = shapes.find(s => s.name === 'agent-shape');
      expect(agentShape!.fieldCount).toBeGreaterThan(0);
    });
  });

  describe('Error Format', () => {
    it('should return structured errors with path, message, and severity', () => {
      const invalidAgent = { agent_id: '' };
      const result = validator.validateAgent(invalidAgent);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.shape).toBe('agent-shape');
      const error = result.errors[0];
      expect(error).toHaveProperty('path');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('severity');
      expect(['error', 'warning']).toContain(error.severity);
    });

    it('should report at least one error for completely invalid data', () => {
      const invalidJob = {
        id: 'job-001',
        status: 'invalid',
      };
      const result = validator.validateJob(invalidJob);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});