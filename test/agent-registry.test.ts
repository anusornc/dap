/**
 * Agent Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../src/relay/agent-registry.js';
import { Capability } from '../src/protocol/types.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry('./shapes', { testMode: true });
  });

  describe('register', () => {
    it('should register an agent with capabilities', () => {
      const capabilities: Capability[] = [
        { name: 'code-review', version: '1.0.0', maxConcurrent: 2 }
      ];

      const result = registry.register(
        'agent-1',
        { agent_id: 'agent-1', capabilities: ['code-review'] },
        {} as any,
        capabilities
      );

      expect(result.valid).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent!.agentId).toBe('agent-1');
      expect(result.agent!.capabilities.get('code-review')).toBeDefined();
    });

    it('should replace existing registration', () => {
      const caps1: Capability[] = [{ name: 'task-a', version: '1.0.0', maxConcurrent: 1 }];
      const caps2: Capability[] = [{ name: 'task-b', version: '1.0.0', maxConcurrent: 1 }];

      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['task-a'] }, {} as any, caps1);
      const result2 = registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['task-b'] }, {} as any, caps2);

      const stats = registry.getStats();
      expect(stats.totalAgents).toBe(1);
      expect(result2.agent?.capabilities.has('task-b')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should remove agent from registry', () => {
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: [] }, {} as any, []);
      registry.unregister('agent-1');
      expect(registry.has('agent-1')).toBe(false);
    });

    it('should clean up capability index', () => {
      const caps: Capability[] = [{ name: 'code-review', version: '1.0.0', maxConcurrent: 1 }];
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['code-review'] }, {} as any, caps);
      registry.unregister('agent-1');
      const agents = registry.getByCapability('code-review');
      expect(agents.length).toBe(0);
    });
  });

  describe('getByCapability', () => {
    it('should return agents with matching capability', () => {
      const caps: Capability[] = [{ name: 'code-review', version: '1.0.0', maxConcurrent: 2 }];
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['code-review'] }, {} as any, caps);
      const agents = registry.getByCapability('code-review');
      expect(agents.length).toBe(1);
      expect(agents[0].agentId).toBe('agent-1');
    });

    it('should return empty array for unknown capability', () => {
      const agents = registry.getByCapability('unknown-capability');
      expect(agents.length).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('should update last heartbeat time', () => {
      const caps: Capability[] = [];
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: [] }, {} as any, caps);
      const before = registry.get('agent-1')?.lastHeartbeat;
      registry.updateHeartbeat('agent-1');
      const after = registry.get('agent-1')?.lastHeartbeat;
      expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() || 0);
    });

    it('should return false for unknown agent', () => {
      const result = registry.updateHeartbeat('unknown-agent');
      expect(result).toBe(false);
    });
  });

  describe('getStaleAgents', () => {
    it('should detect agents with stale heartbeats', () => {
      const caps: Capability[] = [];
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: [] }, {} as any, caps);
      const agent = registry.get('agent-1')!;
      agent.lastHeartbeat = new Date(Date.now() - 120000);
      const stale = registry.getStaleAgents(60000);
      expect(stale.length).toBe(1);
      expect(stale[0].agentId).toBe('agent-1');
    });

    it('should return empty for healthy agents', () => {
      const caps: Capability[] = [];
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: [] }, {} as any, caps);
      const stale = registry.getStaleAgents(60000);
      expect(stale.length).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const caps1: Capability[] = [
        { name: 'code-review', version: '1.0.0', maxConcurrent: 1 },
        { name: 'data-analysis', version: '1.0.0', maxConcurrent: 1 }
      ];
      const caps2: Capability[] = [{ name: 'code-review', version: '1.0.0', maxConcurrent: 1 }];

      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['code-review', 'data-analysis'] }, {} as any, caps1);
      registry.register('agent-2', { agent_id: 'agent-2', capabilities: ['code-review'] }, {} as any, caps2);

      const stats = registry.getStats();
      expect(stats.totalAgents).toBe(2);
      expect(stats.capabilities).toContain('code-review');
      expect(stats.capabilities).toContain('data-analysis');
      expect(stats.agentsByCapability.get('code-review')).toBe(2);
      expect(stats.agentsByCapability.get('data-analysis')).toBe(1);
    });
  });

  describe('toJSON', () => {
    it('should serialize all agents', () => {
      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['task-a'] }, {} as any, []);
      registry.register('agent-2', { agent_id: 'agent-2', capabilities: ['task-b'] }, {} as any, []);
      const json = registry.toJSON();
      expect(json.length).toBe(2);
      expect(json.map(a => a.agent_id)).toContain('agent-1');
      expect(json.map(a => a.agent_id)).toContain('agent-2');
    });
  });
});