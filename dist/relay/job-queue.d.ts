/**
 * DAP Provenance Module
 * Implements PROV-O compliant provenance tracking for DAP interactions
 *
 * Maps DAP concepts to PROV-O:
 * - DAP Messages → prov:Entity
 * - DAP Jobs (activities) → prov:Activity
 * - DAP Agents → prov:Agent
 */
import { Job, JobStatus, JobConstraints } from '../protocol/types.js';
/**
 * Simplified ProvenanceRecord for query results
 */
export interface SimplifiedProvenanceRecord {
    entity: string;
    activity: string;
    timestamp: string;
    agentId: string;
    metadata: Record<string, unknown>;
    generatedAt: string;
}
export interface JobFilter {
    type?: string;
    capabilityRequired?: string;
    status?: JobStatus;
    submitter?: string;
    limit?: number;
    offset?: number;
}
export declare class JobQueue {
    private jobs;
    private typeIndex;
    private submitterIndex;
    private capabilityIndex;
    private claimedByIndex;
    private dataDir;
    private persistencePath;
    private saveDebounceTimer?;
    private dirty;
    constructor(dataDir?: string);
    private load;
    private scheduleSave;
    private save;
    private indexJob;
    submit(submitter: string, type: string, priority: number, payload: Record<string, unknown>, capabilityRequired?: string, constraints?: JobConstraints, _timeoutSeconds?: number): Job;
    claim(jobId: string, agentId: string): Job | null;
    start(jobId: string): Job | null;
    progress(jobId: string, message?: string): Job | null;
    complete(jobId: string, result: unknown): Job | null;
    fail(jobId: string, error: string): Job | null;
    cancel(jobId: string, reason?: string): Job | null;
    get(jobId: string): Job | undefined;
    getBySubmitter(submitter: string): Job[];
    getByAgent(agentId: string): Job[];
    findAvailable(capabilityRequired?: string, type?: string): Job | null;
    query(filter: JobFilter): Job[];
    getStats(): {
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        totalJobs: number;
    };
    /**
     * Extract agent ID from a provenance record
     */
    private extractAgentId;
    /**
     * Extract activity type from a provenance record
     */
    private extractActivityType;
    /**
     * Extract timestamp from a provenance record
     */
    private extractTimestamp;
    /**
     * Convert a provenance chain to a simplified query record
     */
    private toQueryRecord;
    /**
     * Get all provenance records for a specific job
     */
    getProvenance(jobId: string): SimplifiedProvenanceRecord[];
    /**
     * Query provenance records by agent ID
     */
    queryByAgent(agentId: string, from?: Date, to?: Date): SimplifiedProvenanceRecord[];
    /**
     * Query provenance records by activity type
     */
    queryByActivity(activity: string, from?: Date, to?: Date): SimplifiedProvenanceRecord[];
    /**
     * Get aggregate provenance statistics
     */
    getProvenanceStats(): {
        totalRecords: number;
        byActivity: Record<string, number>;
        byAgent: Record<string, number>;
        timeRange: {
            earliest: string | null;
            latest: string | null;
        };
    };
    cleanStale(maxAgeMs: number): string[];
    private rebuildIndexes;
    forceSave(): void;
}
//# sourceMappingURL=job-queue.d.ts.map