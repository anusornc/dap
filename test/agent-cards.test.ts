/**
 * Agent Cards Tests
 * Tests for semantic JSON-LD agent card capability discovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentCards } from '../src/relay/agent-cards.js';
import { AgentRegistry } from '../src/relay/agent-registry.js';
import { Capability, AgentCardStatus } from '../src/protocol/types.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

describe('AgentCards', () => {
  let registry: AgentRegistry;
  let agentCards: AgentCards;
  let tempDir: string;

  beforeEach(() => {
    registry = new AgentRegistry('./shapes', { testMode: true });
    agentCards = new AgentCards(registry);
  });

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true });
      } catch {}
    }
  });

  // ============ Registration Integration Tests ============

  describe('registration integration', () => {
    it('should auto-create card when agent registers', () => {
      const capabilities: Capability[] = [
        { name: 'code-review', version: '1.0.0', maxConcurrent: 2, description: 'Code review capability' }
      ];

      registry.register(
        'test-agent-1',
        { agent_id: 'test-agent-1', capabilities: ['code-review'], version: '1.0.0' },
        {} as any,
        capabilities
      );

      const card = agentCards.getCard('test-agent-1');
      expect(card).not.toBeNull();
      expect(card!.id).toBe('test-agent-1');
      expect(card!.type).toBe('AgentCard');
      expect(card!.name).toBe('test-agent-1');
      expect(card!.capabilities).toHaveLength(1);
      expect(card!.capabilities[0].name).toBe('code-review');
    });

    it('should remove card when agent unregisters', () => {
      registry.register('test-agent', { agent_id: 'test-agent', capabilities: [] }, {} as any, []);
      expect(agentCards.getCard('test-agent')).not.toBeNull();

      registry.unregister('test-agent');
      expect(agentCards.getCard('test-agent')).toBeNull();
    });

    it('should create card with all fields populated', () => {
      const capabilities: Capability[] = [
        { name: 'analysis', version: '2.0.0', maxConcurrent: 3, description: 'Data analysis' }
      ];

      registry.register(
        'full-agent',
        {
          agent_id: 'full-agent',
          name: 'Full Test Agent',
          description: 'A fully featured test agent',
          capabilities: ['analysis'],
          version: '2.1.0',
          metadata: { region: 'us-west' }
        },
        {} as any,
        capabilities
      );

      const card = agentCards.getCard('full-agent')!;
      expect(card.id).toBe('full-agent');
      expect(card.name).toBe('Full Test Agent');
      expect(card.description).toBe('A fully featured test agent');
      expect(card.version).toBe('2.1.0');
      expect(card.protocolVersion).toBe('1.0.0');
      expect(card.status).toBe('active');
      expect(card['@context']).toBe('https://dap-protocol.org/ns/agent-card-context.json');
    });
  });

  // ============ JSON-LD Conversion Tests ============

  describe('toJsonLd', () => {
    it('should convert card to JSON-LD format with @context', () => {
      const capabilities: Capability[] = [
        { name: 'test-cap', version: '1.0.0' }
      ];

      registry.register('jsonld-agent', { agent_id: 'jsonld-agent', capabilities: ['test-cap'] }, {} as any, capabilities);

      const card = agentCards.getCard('jsonld-agent')!;
      const jsonLd = agentCards.toJsonLd(card);

      expect(jsonLd).toHaveProperty('@context');
      expect(jsonLd).toHaveProperty('@type', 'AgentCard');
      expect(jsonLd).toHaveProperty('@id', 'jsonld-agent');
      expect(jsonLd).toHaveProperty('id');
      expect(jsonLd).toHaveProperty('name');
      expect(jsonLd).toHaveProperty('capabilities');
      expect(jsonLd).toHaveProperty('status');
      expect(jsonLd).toHaveProperty('shimType');
    });

    it('should include capability objects in JSON-LD output', () => {
      const capabilities: Capability[] = [
        { name: 'cap-a', version: '1.0.0', description: 'Capability A' },
        { name: 'cap-b', version: '2.0.0', maxConcurrent: 5 }
      ];

      registry.register('multi-cap-agent', { agent_id: 'multi-cap-agent', capabilities: ['cap-a', 'cap-b'] }, {} as any, capabilities);

      const card = agentCards.getCard('multi-cap-agent')!;
      const jsonLd = agentCards.toJsonLd(card) as any;

      expect(jsonLd.capabilities).toHaveLength(2);
      expect(jsonLd.capabilities[0]).toHaveProperty('@type', 'Capability');
      expect(jsonLd.capabilities[0]).toHaveProperty('name', 'cap-a');
    });
  });

  // ============ Query Tests ============

  describe('listCards', () => {
    beforeEach(() => {
      const caps1: Capability[] = [{ name: 'code-review', version: '1.0.0', maxConcurrent: 1 }];
      const caps2: Capability[] = [{ name: 'data-analysis', version: '1.0.0', maxConcurrent: 1 }];
      const caps3: Capability[] = [{ name: 'code-review', version: '1.0.0', maxConcurrent: 1 }];

      registry.register('agent-a', { agent_id: 'agent-a', capabilities: ['code-review'], shimType: 'mavis' }, {} as any, caps1);
      registry.register('agent-b', { agent_id: 'agent-b', capabilities: ['data-analysis'], shimType: 'claude-code' }, {} as any, caps2);
      registry.register('agent-c', { agent_id: 'agent-c', capabilities: ['code-review'], shimType: 'mavis' }, {} as any, caps3);
    });

    it('should return all cards with no filter', () => {
      const cards = agentCards.listCards();
      expect(cards).toHaveLength(3);
    });

    it('should filter by capability', () => {
      const cards = agentCards.listCards({ capability: 'code-review' });
      expect(cards).toHaveLength(2);
      expect(cards.every(c => c.capabilities.some(cap => cap.name === 'code-review'))).toBe(true);
    });

    it('should filter by status', () => {
      const cards = agentCards.listCards({ status: 'active' });
      expect(cards).toHaveLength(3);
    });

    it('should filter by shimType', () => {
      const cards = agentCards.listCards({ shimType: 'mavis' });
      expect(cards).toHaveLength(2);
      expect(cards.every(c => c.shimType === 'mavis')).toBe(true);
    });

    it('should combine multiple filters', () => {
      const cards = agentCards.listCards({
        capability: 'code-review',
        shimType: 'mavis'
      });
      expect(cards).toHaveLength(2);
    });
  });

  describe('getCardByCapability', () => {
    beforeEach(() => {
      const caps1: Capability[] = [{ name: 'file-processing', version: '1.0.0' }];
      const caps2: Capability[] = [{ name: 'web-scraping', version: '1.0.0' }];
      const caps3: Capability[] = [{ name: 'file-processing', version: '1.0.0' }];

      registry.register('fp-agent-1', { agent_id: 'fp-agent-1', capabilities: ['file-processing'] }, {} as any, caps1);
      registry.register('ws-agent', { agent_id: 'ws-agent', capabilities: ['web-scraping'] }, {} as any, caps2);
      registry.register('fp-agent-2', { agent_id: 'fp-agent-2', capabilities: ['file-processing'] }, {} as any, caps3);
    });

    it('should return agents with matching capability', () => {
      const cards = agentCards.getCardByCapability('file-processing');
      expect(cards).toHaveLength(2);
    });

    it('should return empty array for unknown capability', () => {
      const cards = agentCards.getCardByCapability('unknown-cap');
      expect(cards).toHaveLength(0);
    });
  });

  // ============ Update Tests ============

  describe('updateCard', () => {
    beforeEach(() => {
      registry.register('update-test', { agent_id: 'update-test', capabilities: [] }, {} as any, []);
    });

    it('should update status', () => {
      agentCards.updateCard('update-test', { status: 'busy' });
      const card = agentCards.getCard('update-test')!;
      expect(card.status).toBe('busy');
    });

    it('should update metadata', () => {
      agentCards.updateCard('update-test', {
        metadata: { customField: 'customValue', updated: true }
      });
      const card = agentCards.getCard('update-test')!;
      expect(card.metadata?.customField).toBe('customValue');
      expect(card.metadata?.updated).toBe(true);
    });

    it('should merge metadata with existing', () => {
      agentCards.updateCard('update-test', { metadata: { field1: 'value1' } });
      agentCards.updateCard('update-test', { metadata: { field2: 'value2' } });

      const card = agentCards.getCard('update-test')!;
      expect(card.metadata?.field1).toBe('value1');
      expect(card.metadata?.field2).toBe('value2');
    });

    it('should update capabilities', () => {
      const newCapabilities = [
        { name: 'new-cap', version: '1.0.0', description: 'New capability' }
      ];
      agentCards.updateCard('update-test', { capabilities: newCapabilities });

      const card = agentCards.getCard('update-test')!;
      expect(card.capabilities).toHaveLength(1);
      expect(card.capabilities[0].name).toBe('new-cap');
    });

    it('should update endpoints', () => {
      agentCards.updateCard('update-test', {
        endpoints: { httpUrl: 'http://test.local/api' }
      });

      const card = agentCards.getCard('update-test')!;
      expect(card.endpoints.httpUrl).toBe('http://test.local/api');
    });

    it('should not throw for non-existent card', () => {
      expect(() => {
        agentCards.updateCard('non-existent', { status: 'active' });
      }).not.toThrow();
    });
  });

  // ============ Server Card Tests ============

  describe('server card', () => {
    it('should set and get server card', () => {
      const serverCard = {
        id: 'relay-server',
        type: 'AgentCard' as const,
        name: 'Test Server',
        description: 'A test relay server',
        capabilities: [{ name: 'relay', version: '1.0.0' }],
        version: '1.0.0',
        protocolVersion: '1.0.0',
        shimType: 'custom' as const,
        endpoints: {},
        status: 'active' as const,
        metadata: { connectedAgents: 5 },
        '@context': 'https://dap-protocol.org/ns/agent-card-context.json',
      };

      agentCards.setServerCard(serverCard);
      const retrieved = agentCards.getServerCard();

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('relay-server');
      expect(retrieved!.name).toBe('Test Server');
    });

    it('should return null when server card not set', () => {
      const freshCards = new AgentCards(new AgentRegistry('./shapes', { testMode: true }));
      expect(freshCards.getServerCard()).toBeNull();
    });
  });

  // ============ Sync Tests ============

  describe('sync', () => {
    it('should remove stale cards for unregistered agents', () => {
      registry.register('sync-agent', { agent_id: 'sync-agent', capabilities: [] }, {} as any, []);
      expect(agentCards.getCard('sync-agent')).not.toBeNull();

      // Simulate unregister (internal - just check sync works)
      registry.unregister('sync-agent');
      agentCards.sync();

      expect(agentCards.getCard('sync-agent')).toBeNull();
    });

    it('should update status for existing agents', () => {
      const mockSocket = { readyState: 1 };
      registry.register('status-agent', { agent_id: 'status-agent', capabilities: [] }, mockSocket, []);

      agentCards.sync();
      const card = agentCards.getCard('status-agent')!;
      expect(card.status).toBe('active');
    });
  });

  // ============ getAllCapabilities Tests ============

  describe('getAllCapabilities', () => {
    it('should return unique capability names', () => {
      const caps1: Capability[] = [{ name: 'cap-a', version: '1.0.0' }];
      const caps2: Capability[] = [{ name: 'cap-b', version: '1.0.0' }];
      const caps3: Capability[] = [{ name: 'cap-a', version: '1.0.0' }]; // duplicate

      registry.register('agent-1', { agent_id: 'agent-1', capabilities: ['cap-a'] }, {} as any, caps1);
      registry.register('agent-2', { agent_id: 'agent-2', capabilities: ['cap-b'] }, {} as any, caps2);
      registry.register('agent-3', { agent_id: 'agent-3', capabilities: ['cap-a'] }, {} as any, caps3);

      const caps = agentCards.getAllCapabilities();
      expect(caps).toHaveLength(2);
      expect(caps).toContain('cap-a');
      expect(caps).toContain('cap-b');
    });

    it('should return empty array when no agents', () => {
      const caps = agentCards.getAllCapabilities();
      expect(caps).toHaveLength(0);
    });
  });

  // ============ Edge Cases ============

  describe('edge cases', () => {
    it('should handle empty agent info gracefully', () => {
      registry.register('empty-agent', {} as any, {} as any, []);

      const card = agentCards.getCard('empty-agent')!;
      expect(card).not.toBeNull();
      expect(card.id).toBe('empty-agent');
      expect(card.name).toBe('empty-agent');
    });

    it('should handle card without capabilities', () => {
      registry.register('no-caps-agent', { agent_id: 'no-caps-agent', capabilities: [] }, {} as any, []);

      const card = agentCards.getCard('no-caps-agent')!;
      expect(card.capabilities).toHaveLength(0);
    });

    it('should infer shimType from os field when not specified', () => {
      registry.register('os-agent', { agent_id: 'os-agent', os: 'mavis-1.0' }, {} as any, []);

      const card = agentCards.getCard('os-agent')!;
      expect(card.shimType).toBe('mavis');
    });
  });

  // ============ Context URL Tests ============

  describe('context URL', () => {
    it('should use correct JSON-LD context URL', () => {
      registry.register('context-agent', { agent_id: 'context-agent', capabilities: [] }, {} as any, []);

      const card = agentCards.getCard('context-agent')!;
      expect(card['@context']).toBe('https://dap-protocol.org/ns/agent-card-context.json');
    });

    it('should include context in JSON-LD output', () => {
      registry.register('jsonld-context-agent', { agent_id: 'jsonld-context-agent', capabilities: [] }, {} as any, []);

      const card = agentCards.getCard('jsonld-context-agent')!;
      const jsonLd = agentCards.toJsonLd(card) as any;

      expect(jsonLd['@context']).toBeDefined();
      expect(Array.isArray(jsonLd['@context'])).toBe(true);
    });
  });
});