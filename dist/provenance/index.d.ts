/**
 * DAP Provenance Module
 * Implements PROV-O compliant provenance tracking for DAP interactions
 *
 * Maps DAP concepts to PROV-O:
 * - DAP Messages → prov:Entity
 * - DAP Jobs (activities) → prov:Activity
 * - DAP Agents → prov:Agent
 */
export declare const PROV_NAMESPACE = "http://www.w3.org/ns/prov#";
export declare const DAP_NAMESPACE = "https://dap-protocol.org/ns#";
/**
 * PROV-O Activity types for DAP-specific activities
 */
export declare const DAPActivityTypes: {
    readonly AGENT_REGISTRATION: "dap:AgentRegistration";
    readonly JOB_SUBMISSION: "dap:JobSubmission";
    readonly JOB_CLAIM: "dap:JobClaim";
    readonly JOB_EXECUTION: "dap:JobExecution";
    readonly MESSAGE_ROUTING: "dap:MessageRouting";
    readonly MESSAGE_SEND: "dap:MessageSend";
    readonly MESSAGE_RECEIVE: "dap:MessageReceive";
    readonly DELEGATION: "dap:Delegation";
};
/**
 * PROV-O Entity types for DAP-specific entities
 */
export declare const DAPEntityTypes: {
    readonly DAP_MESSAGE: "dap:Message";
    readonly DAP_JOB: "dap:Job";
    readonly DAP_JOB_INPUT: "dap:JobInput";
    readonly DAP_JOB_RESULT: "dap:JobResult";
    readonly DAP_CAPABILITY: "dap:Capability";
    readonly DAP_AGENT_CARD: "dap:AgentCard";
};
/**
 * PROV-O Agent types for DAP-specific agents
 */
export declare const DAPAgentTypes: {
    readonly HUMAN_AGENT: "prov:Person";
    readonly SOFTWARE_AGENT: "prov:SoftwareAgent";
    readonly AI_AGENT: "dap:AIAgent";
    readonly RELAY_SERVER: "dap:RelayServer";
};
/**
 * PROV Role types for agent participation in activities
 */
export declare const DAPRoles: {
    readonly SUBMITTER: "dap:submitter";
    readonly WORKER: "dap:worker";
    readonly COORDINATOR: "dap:coordinator";
    readonly DELEGATOR: "dap:delegator";
    readonly DELEGATEE: "dap:delegatee";
    readonly SENDER: "dap:sender";
    readonly RECEIVER: "dap:receiver";
    readonly RELAY: "dap:relay";
};
export interface ProvenanceEntity {
    '@id': string;
    '@type': string | string[];
    'prov:label'?: string;
    'prov:value'?: unknown;
    'prov:wasAttributedTo'?: string | string[];
    'prov:wasGeneratedBy'?: string | string[];
    'prov:wasDerivedFrom'?: string | string[];
    'prov:location'?: string;
    'prov:qualifiedUsage'?: ProvenanceQualifiedInfluence[];
    [key: string]: unknown;
}
export interface ProvenanceActivity {
    '@id': string;
    '@type': string;
    'prov:label'?: string;
    'prov:startedAtTime'?: string;
    'prov:endedAtTime'?: string;
    'prov:wasAssociatedWith'?: string | string[];
    'prov:wasInformedBy'?: string | string[];
    'prov:used'?: (string | ProvenanceEntity)[];
    'prov:generated'?: (string | ProvenanceEntity)[];
    'prov:qualifiedAssociation'?: ProvenanceQualifiedAssociation[];
    [key: string]: unknown;
}
export interface ProvenanceAgent {
    '@id': string;
    '@type': string | string[];
    'prov:label'?: string;
    'prov:actedOnBehalfOf'?: {
        '@type': 'prov:Delegation';
        'prov:agent': string;
        'prov:hadRole'?: string;
    };
    'prov:wasAttributedTo'?: string | string[];
    [key: string]: unknown;
}
export interface ProvenanceQualifiedInfluence {
    '@type': string;
    'prov:entity'?: string;
    'prov:activity'?: string;
    'prov:agent'?: string;
    'prov:hadRole'?: string;
    'prov:hadPlan'?: string;
    'prov:atLocation'?: string;
    [key: string]: unknown;
}
export interface ProvenanceQualifiedAssociation {
    '@type': 'prov:Association';
    'prov:agent': string;
    'prov:hadRole'?: string;
    'prov:hadPlan'?: string;
}
export interface ProvenanceChain {
    '@context'?: string[];
    '@graph': unknown[];
}
export declare class ProvenanceGenerator {
    private prefix;
    constructor(prefix?: string);
    /**
     * Generate a unique URI for a provenance entity
     */
    private generateId;
    /**
     * Create a prov:Agent record for a DAP agent
     */
    createAgentRecord(agentId: string, agentType?: string, label?: string): ProvenanceAgent;
    /**
     * Create a prov:Entity record for a DAP message
     */
    createMessageEntity(messageId: string, action: string, payload?: unknown): ProvenanceEntity;
    /**
     * Create a prov:Activity record for job lifecycle
     */
    createJobActivity(jobId: string, activityType: string, options?: {
        startedAtTime?: string;
        endedAtTime?: string;
        associatedAgent?: string;
        usedEntities?: string[];
        generatedEntities?: string[];
        hadRole?: string;
    }): ProvenanceActivity;
    /**
     * Create agent registration provenance record
     */
    createAgentRegistrationRecord(agentId: string, capabilities: string[], os?: string, version?: string): ProvenanceChain;
    /**
     * Create job submission provenance record
     */
    createJobSubmissionRecord(jobId: string, submitterId: string, jobType: string, payload: unknown, capabilityRequired?: string): ProvenanceChain;
    /**
     * Create job claim provenance record
     */
    createJobClaimRecord(jobId: string, claimerId: string, _submitterId: string): ProvenanceChain;
    /**
     * Create job completion provenance record
     */
    createJobCompletionRecord(jobId: string, workerId: string, _submitterId: string, result: unknown, error?: string, usedInputId?: string): ProvenanceChain;
    /**
     * Create delegation provenance record
     */
    createDelegationRecord(delegatorId: string, delegateeId: string, _capability: string, contextJobId?: string): ProvenanceChain;
    /**
     * Merge multiple provenance chains into a single chain
     */
    mergeChains(...chains: ProvenanceChain[]): ProvenanceChain;
}
export interface TraceStep {
    step: number;
    timestamp: string;
    activity: string;
    description: string;
    agentId: string;
    details?: Record<string, unknown>;
}
export interface TimelineEvent {
    timestamp: string;
    event: string;
    description: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
}
export interface DateRange {
    from: Date;
    to: Date;
}
export declare class ProvenanceQuery {
    private jobQueue;
    private agentRegistry;
    constructor(jobQueue: any, agentRegistry: any);
    /**
     * Rebuild full execution timeline from provenance chain
     */
    trace(jobId: string): TraceStep[];
    /**
     * Find root cause of a failed job
     */
    findRootCause(jobId: string): string;
    /**
     * Get activity timeline for an agent within a date range
     */
    getActivityTimeline(agentId: string, range?: DateRange): TimelineEvent[];
    /**
     * Format trace as human-readable timeline
     */
    formatTraceTimeline(trace: TraceStep[]): string;
}
export declare const provenanceGenerator: ProvenanceGenerator;
export default ProvenanceGenerator;
//# sourceMappingURL=index.d.ts.map