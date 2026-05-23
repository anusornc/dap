/**
 * Agent Registry
 * Tracks connected agents and their capabilities
 * Includes PROV-O provenance tracking
 */
import { Capability, AgentInfo, AgentProvenance } from '../protocol/types.js';
/**
 * Simplified ProvenanceRecord for agent provenance queries
 */
export interface SimplifiedProvenanceRecord {
    entity: string;
    activity: string;
    timestamp: string;
    agentId: string;
    metadata: Record<string, unknown>;
    generatedAt: string;
}
export interface RegisteredAgent {
    agentId: string;
    agentInfo: any;
    socket: any;
    connectedAt: Date;
    lastHeartbeat: Date;
    capabilities: Map<string, Capability>;
    provenance?: AgentProvenance;
}
export declare class AgentRegistry {
    private agents;
    private capabilityIndex;
    private heartbeatHistory;
    private shaclValidator;
    constructor(shapesDir?: string, options?: {
        testMode?: boolean;
    });
    register(agentId: string, agentInfo: AgentInfo, socket: any, capabilities?: Capability[]): {
        agent?: RegisteredAgent;
        error?: {
            message: string;
            errors?: any[];
        };
        valid: boolean;
    };
    unregister(agentId: string): void;
    get(agentId: string): RegisteredAgent | undefined;
    getBySocket(socket: any): RegisteredAgent | undefined;
    has(agentId: string): boolean;
    getAll(): RegisteredAgent[];
    getByCapability(capability: string): RegisteredAgent[];
    getAllCapabilities(): Map<string, string[]>;
    updateHeartbeat(agentId: string): boolean;
    getStaleAgents(timeoutMs: number): RegisteredAgent[];
    getStats(): {
        totalAgents: number;
        capabilities: string[];
        agentsByCapability: Map<string, number>;
    };
    /**
     * Extract activity type from a provenance record
     */
    private extractActivityType;
    /**
     * Convert a provenance chain to a simplified query record
     */
    private toQueryRecord;
    /**
     * Get all provenance records for a specific agent
     */
    getAgentProvenance(agentId: string): SimplifiedProvenanceRecord[];
    /**
     * Get registration chain for an agent (registration + heartbeats)
     */
    getRegistrationChain(agentId: string): SimplifiedProvenanceRecord[];
    toJSON(): any[];
}
//# sourceMappingURL=agent-registry.d.ts.map