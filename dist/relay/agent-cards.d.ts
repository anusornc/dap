/**
 * Agent Cards
 * Semantic JSON-LD capability discovery for DAP relay
 */
import { AgentCard, AgentCardFilter } from '../protocol/types.js';
import { AgentRegistry } from './agent-registry.js';
export declare class AgentCards {
    private registry;
    private cards;
    private context;
    private serverCard;
    constructor(registry: AgentRegistry);
    /**
     * Inject card creation into agent registry registration flow
     */
    private injectIntoRegistry;
    /**
     * Create an AgentCard from a registered agent
     */
    private createCard;
    /**
     * Extract shim type from agent info
     */
    private extractShimType;
    /**
     * Build endpoint URLs from agent info
     */
    private buildEndpoints;
    /**
     * Determine agent status based on heartbeat
     */
    private determineStatus;
    /**
     * Convert AgentCard to JSON-LD format with @context
     */
    toJsonLd(card: AgentCard): object;
    /**
     * Get a single agent card by ID
     */
    getCard(agentId: string): AgentCard | null;
    /**
     * List all agent cards with optional filtering
     */
    listCards(filters?: AgentCardFilter): AgentCard[];
    /**
     * Get agents that have a specific capability
     */
    getCardByCapability(capability: string): AgentCard[];
    /**
     * Update an agent card with partial data
     */
    updateCard(agentId: string, partial: Partial<AgentCard>): void;
    /**
     * Remove an agent card (called when agent unregisters)
     */
    removeCard(agentId: string): void;
    /**
     * Get all unique capabilities across all agent cards
     */
    getAllCapabilities(): string[];
    /**
     * Set the server's own agent card for the well-known endpoint
     */
    setServerCard(card: AgentCard): void;
    /**
     * Get the server's own agent card
     */
    getServerCard(): AgentCard | null;
    /**
     * Sync cards with registry state
     */
    sync(): void;
}
//# sourceMappingURL=agent-cards.d.ts.map