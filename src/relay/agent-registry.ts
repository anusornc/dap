/**
 * Agent Registry
 * Tracks connected agents and their capabilities
 * Includes PROV-O provenance tracking
 */

import { Capability, AgentInfo, AgentProvenance } from '../protocol/types.js';
import { ProvenanceGenerator } from '../provenance/index.js';
import { SHACLValidator } from '../validation/shacl-validator.js';
import {
  activeAgents,
  agentsRegistered,
  agentHeartbeats,
  staleAgents,
} from '../utils/metrics.js';

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

// Shared provenance generator instance
const provenance = new ProvenanceGenerator();

export interface RegisteredAgent {
  agentId: string;
  agentInfo: any;
  socket: any;
  connectedAt: Date;
  lastHeartbeat: Date;
  capabilities: Map<string, Capability>;
  provenance?: AgentProvenance;
}

export class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private heartbeatHistory: Map<string, { timestamp: string }[]> = new Map();
  private socketIndex: Map<any, string> = new Map();
  private shaclValidator: SHACLValidator | null = null;

  constructor(shapesDir?: string, options?: { testMode?: boolean }) {
    try {
      this.shaclValidator = new SHACLValidator(shapesDir || './shapes');
      console.log('[AgentRegistry] SHACL validator initialized');
    } catch (err) {
      console.warn('[AgentRegistry] SHACL validator init failed, continuing without it:', err);
    }
    if (options?.testMode) {
      this.shaclValidator = null; // Disable validation in test mode
      console.log('[AgentRegistry] Running in test mode — SHACL validation disabled');
    }
  }

  // ============ Registration ============

  register(
    agentId: string,
    agentInfo: AgentInfo,
    socket: any,
    capabilities: Capability[] = []
  ): { agent?: RegisteredAgent; error?: { message: string; errors?: any[] }; valid: boolean } {
    // SHACL validation for agent registration (skip in test mode)
    if (this.shaclValidator && this.shaclValidator.hasShapes()) {
      const result = this.shaclValidator.validateAgent(agentInfo);
      if (!result.valid) {
        console.warn('[AgentRegistry] SHACL validation failed for agent registration:', result.errors);
        return { valid: false, error: { message: 'Agent registration validation failed', errors: result.errors } };
      }
    }

    // Remove existing registration if any
    this.unregister(agentId);

    const agent: RegisteredAgent = {
      agentId,
      agentInfo,
      socket,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      capabilities: new Map(capabilities.map(c => [c.name, c])),
    };

    // Generate PROV-O provenance record for agent registration
    const capabilityNames = capabilities.map(c => c.name || (c as any));
    const capabilityList = Array.isArray(capabilityNames) ? capabilityNames as string[] : [];
    
    agent.provenance = {
      registeredAt: new Date().toISOString(),
      capabilities: provenance.createAgentRegistrationRecord(
        agentId,
        capabilityList,
        agentInfo.os,
        agentInfo.version
      ),
      activityCount: 0,
    };

    // Track registration heartbeat
    this.heartbeatHistory.set(agentId, [{
      timestamp: new Date().toISOString(),
    }]);

    this.agents.set(agentId, agent);
    if (socket) {
      this.socketIndex.set(socket, agentId);
    }

    // Index by capability
    for (const cap of capabilities) {
      if (!this.capabilityIndex.has(cap.name)) {
        this.capabilityIndex.set(cap.name, new Set());
      }
      this.capabilityIndex.get(cap.name)!.add(agentId);
    }

    // Update metrics
    const shimType = (agentInfo as any).shimType || 'unknown';
    activeAgents.labels(shimType).inc();
    agentsRegistered.inc();

    console.log(`[AgentRegistry] Agent registered: ${agentId} with ${capabilities.length} capabilities`);
    return { agent, valid: true };
  }

  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Remove from capability index
    for (const [, agentIds] of this.capabilityIndex.entries()) {
      agentIds.delete(agentId);
    }

    // Clean empty capability sets
    for (const [cap, agentIds] of this.capabilityIndex.entries()) {
      if (agentIds.size === 0) {
        this.capabilityIndex.delete(cap);
      }
    }

    // Update metrics
    const shimType = (agent.agentInfo as any).shimType || 'unknown';
    activeAgents.labels(shimType).dec();

    if (agent.socket) {
      this.socketIndex.delete(agent.socket);
    }
    this.agents.delete(agentId);
  }

  // ============ Queries ============

  get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  getBySocket(socket: any): RegisteredAgent | undefined {
    const agentId = this.socketIndex.get(socket);
    if (agentId) {
      return this.agents.get(agentId);
    }
    return undefined;
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getAll(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  getByCapability(capability: string): RegisteredAgent[] {
    const agentIds = this.capabilityIndex.get(capability);
    if (!agentIds) return [];

    return Array.from(agentIds)
      .map(id => this.agents.get(id))
      .filter((a): a is RegisteredAgent => a !== undefined);
  }

  getAllCapabilities(): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [cap, agentIds] of this.capabilityIndex.entries()) {
      result.set(cap, Array.from(agentIds));
    }

    return result;
  }

  // ============ Heartbeat ============

  updateHeartbeat(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const timestamp = new Date();
    agent.lastHeartbeat = timestamp;
    
    // Track activity count for provenance
    if (agent.provenance) {
      agent.provenance.lastActivity = timestamp.toISOString();
      agent.provenance.activityCount++;
    }
    
    // Track heartbeat history for provenance chain
    const history = this.heartbeatHistory.get(agentId);
    if (history) {
      history.push({ timestamp: timestamp.toISOString() });
    } else {
      this.heartbeatHistory.set(agentId, [{ timestamp: timestamp.toISOString() }]);
    }

    // Update metrics
    agentHeartbeats.inc();
    
    return true;
  }

  getStaleAgents(timeoutMs: number): RegisteredAgent[] {
    const now = Date.now();
    const stale: RegisteredAgent[] = [];

    for (const agent of this.agents.values()) {
      if (now - agent.lastHeartbeat.getTime() > timeoutMs) {
        stale.push(agent);
      }
    }

    // Update stale agents gauge
    staleAgents.set(stale.length);

    return stale;
  }

  // ============ Stats ============

  getStats(): {
    totalAgents: number;
    capabilities: string[];
    agentsByCapability: Map<string, number>;
  } {
    return {
      totalAgents: this.agents.size,
      capabilities: Array.from(this.capabilityIndex.keys()),
      agentsByCapability: new Map(
        Array.from(this.capabilityIndex.entries()).map(([cap, ids]) => [cap, ids.size])
      ),
    };
  }

  // ============ Provenance Queries ============

  /**
   * Extract activity type from a provenance record
   */
  private extractActivityType(record: { '@context'?: string[]; '@graph': unknown[] }): string {
    const graph = record['@graph'] as any[];
    const activity = graph.find(
      (e) => typeof e === 'object' && e !== null && ('prov:wasAssociatedWith' in e || 'prov:used' in e)
    );
    return activity?.['@type'] || 'unknown';
  }

  /**
   * Convert a provenance chain to a simplified query record
   */
  private toQueryRecord(record: { '@context'?: string[]; '@graph': unknown[] }, entityId: string): SimplifiedProvenanceRecord {
    const graph = record['@graph'] as any[];
    const ts = graph.find(
      (e) => typeof e === 'object' && e !== null && ('prov:startedAtTime' in e || 'prov:endedAtTime' in e)
    );
    return {
      entity: entityId,
      activity: this.extractActivityType(record),
      timestamp: (ts?.['prov:startedAtTime'] || ts?.['prov:endedAtTime'] || new Date().toISOString()) as string,
      agentId: entityId,
      metadata: {
        '@graph': record['@graph'],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get all provenance records for a specific agent
   */
  getAgentProvenance(agentId: string): SimplifiedProvenanceRecord[] {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.provenance) return [];

    const records: SimplifiedProvenanceRecord[] = [];

    // Add registration provenance
    records.push(this.toQueryRecord(agent.provenance.capabilities, agentId));

    // Add heartbeat provenance records
    const heartbeats = this.heartbeatHistory.get(agentId) || [];
    for (const hb of heartbeats) {
      records.push({
        entity: agentId,
        activity: 'dap:Heartbeat',
        timestamp: hb.timestamp,
        agentId: agentId,
        metadata: {},
        generatedAt: hb.timestamp,
      });
    }

    return records.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Get registration chain for an agent (registration + heartbeats)
   */
  getRegistrationChain(agentId: string): SimplifiedProvenanceRecord[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    const records: SimplifiedProvenanceRecord[] = [];

    // Add registration record
    if (agent.provenance?.registeredAt) {
      records.push({
        entity: agentId,
        activity: 'dap:AgentRegistration',
        timestamp: agent.provenance.registeredAt,
        agentId: agentId,
        metadata: {},
        generatedAt: agent.provenance.registeredAt,
      });
    }

    // Add heartbeat records
    const heartbeats = this.heartbeatHistory.get(agentId) || [];
    for (const hb of heartbeats) {
      records.push({
        entity: agentId,
        activity: 'dap:Heartbeat',
        timestamp: hb.timestamp,
        agentId: agentId,
        metadata: {},
        generatedAt: hb.timestamp,
      });
    }

    return records.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // ============ Serialization ============

  toJSON(): any[] {
    return this.getAll().map(agent => ({
      ...agent.agentInfo,
      last_seen: agent.lastHeartbeat.toISOString(),
      capabilities: Array.from(agent.capabilities.keys()),
    }));
  }
}
