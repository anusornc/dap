/**
 * Agent Cards
 * Semantic JSON-LD capability discovery for DAP relay
 */

import { AgentCard, AgentCardCapability, AgentCardStatus, AgentCardFilter, ShimType } from '../protocol/types.js';
import { AgentRegistry, RegisteredAgent } from './agent-registry.js';
import { agentLogger } from '../utils/logger.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load JSON-LD context for agent cards
const AGENT_CARD_CONTEXT_URL = 'https://dap-protocol.org/ns/agent-card-context.json';
const LOCAL_CONTEXT_PATH = join(__dirname, '../utils/agent-card-context.json');

function loadLocalContext(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(LOCAL_CONTEXT_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export class AgentCards {
  private registry: AgentRegistry;
  private cards: Map<string, AgentCard> = new Map();
  private context: Record<string, unknown> | null;
  private serverCard: AgentCard | null = null; // Instance-level server card

  constructor(registry: AgentRegistry) {
    this.registry = registry;
    this.context = loadLocalContext();

    // Inject into registry so registration auto-creates card
    this.injectIntoRegistry();

    agentLogger.info('AgentCards initialized', {
      contextLoaded: !!this.context,
      contextUrl: AGENT_CARD_CONTEXT_URL,
    });
  }

  /**
   * Inject card creation into agent registry registration flow
   */
  private injectIntoRegistry(): void {
    // Wrap the registry's register method to auto-create cards
    const originalRegister = this.registry.register.bind(this.registry);
    const originalUnregister = this.registry.unregister.bind(this.registry);

    this.registry.register = (agentId: string, agentInfo: any, socket: any, capabilities: any[] = []) => {
      const result = originalRegister(agentId, agentInfo, socket, capabilities);

      // Auto-create agent card on successful registration
      if (result.valid && result.agent) {
        this.createCard(result.agent);
      }

      return result;
    };

    this.registry.unregister = (agentId: string) => {
      // Remove card when agent unregisters
      this.removeCard(agentId);
      originalUnregister(agentId);
    };
  }

  /**
   * Create an AgentCard from a registered agent
   */
  private createCard(agent: RegisteredAgent): AgentCard {
    const capabilities: AgentCardCapability[] = Array.from(agent.capabilities.values()).map(cap => ({
      name: cap.name,
      version: cap.version || '1.0.0',
      description: cap.description,
      maxConcurrent: cap.maxConcurrent,
      metadata: cap.metadata,
    }));

    // Extract shim type from agent info or metadata
    const shimType = this.extractShimType(agent.agentInfo);

    const card: AgentCard = {
      id: agent.agentId,
      type: 'AgentCard',
      name: agent.agentInfo.name || agent.agentId,
      description: agent.agentInfo.description || `Agent ${agent.agentId}`,
      capabilities,
      version: agent.agentInfo.version || '1.0.0',
      protocolVersion: '1.0.0',
      shimType,
      endpoints: this.buildEndpoints(agent),
      status: this.determineStatus(agent),
      metadata: agent.agentInfo.metadata || {},
      '@context': AGENT_CARD_CONTEXT_URL,
    };

    this.cards.set(agent.agentId, card);

    agentLogger.debug('Agent card created', {
      agentId: agent.agentId,
      capabilities: capabilities.map(c => c.name),
      status: card.status,
    });

    return card;
  }

  /**
   * Extract shim type from agent info
   */
  private extractShimType(agentInfo: any): ShimType {
    if (agentInfo.shimType) return agentInfo.shimType as ShimType;
    if (agentInfo.metadata?.shimType) return agentInfo.metadata.shimType as ShimType;

    // Try to infer from other fields
    if (agentInfo.os?.includes('mavis')) return 'mavis';
    if (agentInfo.os?.includes('claude')) return 'claude-code';
    if (agentInfo.os?.includes('codex')) return 'codex';

    return 'custom';
  }

  /**
   * Build endpoint URLs from agent info
   */
  private buildEndpoints(agent: RegisteredAgent): AgentCard['endpoints'] {
    const endpoints: AgentCard['endpoints'] = {};

    if (agent.agentInfo.endpoints) {
      return agent.agentInfo.endpoints;
    }

    // Build from metadata if available
    if (agent.agentInfo.metadata?.wssUrl) {
      endpoints.wssUrl = agent.agentInfo.metadata.wssUrl;
    }
    if (agent.agentInfo.metadata?.httpUrl) {
      endpoints.httpUrl = agent.agentInfo.metadata.httpUrl;
    }
    if (agent.agentInfo.metadata?.wsUrl) {
      endpoints.wsUrl = agent.agentInfo.metadata.wsUrl;
    }

    return endpoints;
  }

  /**
   * Determine agent status based on heartbeat
   */
  private determineStatus(agent: RegisteredAgent): AgentCardStatus {
    const now = Date.now();
    const heartbeatAge = now - agent.lastHeartbeat.getTime();

    // Consider stale if no heartbeat for 90 seconds
    if (heartbeatAge > 90000) {
      return 'inactive';
    }

    // Check if agent has pending jobs (would require job queue integration)
    // For now, agents with recent heartbeat are active
    return 'active';
  }

  /**
   * Convert AgentCard to JSON-LD format with @context
   */
  toJsonLd(card: AgentCard): object {
    return {
      '@context': [
        'https://www.w3.org/ns/json-ld/contexts/person.jsonld',
        AGENT_CARD_CONTEXT_URL,
      ],
      '@type': 'AgentCard',
      '@id': card.id,
      id: card.id,
      type: 'AgentCard',
      name: card.name,
      description: card.description,
      capabilities: card.capabilities.map(cap => ({
        '@type': 'Capability',
        name: cap.name,
        version: cap.version,
        description: cap.description,
        maxConcurrent: cap.maxConcurrent,
        metadata: cap.metadata,
      })),
      version: card.version,
      protocolVersion: card.protocolVersion,
      shimType: card.shimType,
      endpoints: card.endpoints,
      status: card.status,
      metadata: card.metadata,
    };
  }

  /**
   * Get a single agent card by ID
   */
  getCard(agentId: string): AgentCard | null {
    return this.cards.get(agentId) || null;
  }

  /**
   * List all agent cards with optional filtering
   */
  listCards(filters?: AgentCardFilter): AgentCard[] {
    let cards = Array.from(this.cards.values());

    if (!filters) return cards;

    if (filters.capability) {
      cards = cards.filter(card =>
        card.capabilities.some(cap => cap.name === filters.capability)
      );
    }

    if (filters.status) {
      cards = cards.filter(card => card.status === filters.status);
    }

    if (filters.shimType) {
      cards = cards.filter(card => card.shimType === filters.shimType);
    }

    return cards;
  }

  /**
   * Get agents that have a specific capability
   */
  getCardByCapability(capability: string): AgentCard[] {
    return Array.from(this.cards.values()).filter(card =>
      card.capabilities.some(cap => cap.name === capability)
    );
  }

  /**
   * Update an agent card with partial data
   */
  updateCard(agentId: string, partial: Partial<AgentCard>): void {
    const card = this.cards.get(agentId);
    if (!card) {
      agentLogger.warn('Attempted to update non-existent card', { agentId });
      return;
    }

    // Update allowed fields
    if (partial.status !== undefined) {
      card.status = partial.status;
    }
    if (partial.capabilities !== undefined) {
      card.capabilities = partial.capabilities;
    }
    if (partial.metadata !== undefined) {
      card.metadata = { ...card.metadata, ...partial.metadata };
    }
    if (partial.endpoints !== undefined) {
      card.endpoints = { ...card.endpoints, ...partial.endpoints };
    }

    agentLogger.info('Agent card updated', { agentId, updatedFields: Object.keys(partial) });
  }

  /**
   * Remove an agent card (called when agent unregisters)
   */
  removeCard(agentId: string): void {
    this.cards.delete(agentId);
    agentLogger.debug('Agent card removed', { agentId });
  }

  /**
   * Get all unique capabilities across all agent cards
   */
  getAllCapabilities(): string[] {
    const capabilities = new Set<string>();

    for (const card of this.cards.values()) {
      for (const cap of card.capabilities) {
        capabilities.add(cap.name);
      }
    }

    return Array.from(capabilities);
  }

  /**
   * Set the server's own agent card for the well-known endpoint
   */
  setServerCard(card: AgentCard): void {
    this.serverCard = card;
    agentLogger.info('Server agent card set', { cardId: card.id });
  }

  /**
   * Get the server's own agent card
   */
  getServerCard(): AgentCard | null {
    return this.serverCard;
  }

  /**
   * Sync cards with registry state
   */
  sync(): void {
    const registryAgents = this.registry.getAll();

    // Remove cards for agents no longer in registry
    const registryIds = new Set(registryAgents.map(a => a.agentId));
    for (const [cardId] of this.cards) {
      if (!registryIds.has(cardId)) {
        this.removeCard(cardId);
      }
    }

    // Update status for existing agents
    for (const agent of registryAgents) {
      const card = this.cards.get(agent.agentId);
      if (card) {
        card.status = this.determineStatus(agent);
      }
    }

    agentLogger.debug('Agent cards synced', {
      totalCards: this.cards.size,
      registryAgents: registryAgents.length,
    });
  }
}