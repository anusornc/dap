/**
 * DAP Provenance Module
 * Implements PROV-O compliant provenance tracking for DAP interactions
 * 
 * Maps DAP concepts to PROV-O:
 * - DAP Messages → prov:Entity
 * - DAP Jobs (activities) → prov:Activity
 * - DAP Agents → prov:Agent
 */

import { v4 as uuidv4 } from 'uuid';
import { ProvenanceGenerator } from '../provenance/index.js';
import { Job, JobStatus, JobConstraints } from '../protocol/types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, promises as fsPromises } from 'fs';
import { join } from 'path';
import {
  jobsSubmitted,
  jobsClaimed,
  jobsCompleted,
  jobsFailed,
  jobsCancelled,
  pendingJobs,
  claimedJobs,
  inProgressJobs,
  jobDuration,
} from '../utils/metrics.js';

// Shared provenance generator instance
const provenance = new ProvenanceGenerator();

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

export class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private typeIndex: Map<string, Set<string>> = new Map();
  private submitterIndex: Map<string, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private claimedByIndex: Map<string, Set<string>> = new Map();

  // Pending jobs tracking for faster lookups
  private pendingIndex: Set<string> = new Set();
  private pendingCapabilityIndex: Map<string, Set<string>> = new Map();

  private dataDir: string;
  private persistencePath: string;
  private saveDebounceTimer?: NodeJS.Timeout;
  private dirty: boolean = false;
  private isSaving: boolean = false;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.persistencePath = join(dataDir, 'jobs.json');
    this.load();
  }

  // ============ Persistence ============

  private load(): void {
    try {
      // Ensure data directory exists
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
        return;
      }

      if (!existsSync(this.persistencePath)) {
        return;
      }

      const data = readFileSync(this.persistencePath, 'utf-8');
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        for (const job of parsed) {
          this.jobs.set(job.job_id, job);
          this.indexJob(job);
        }
        console.log(`[JobQueue] Loaded ${this.jobs.size} jobs from disk`);
      }
    } catch (err) {
      console.error('[JobQueue] Failed to load jobs:', err);
      // Backup corrupted file
      try {
        const backupPath = this.persistencePath + '.backup.' + Date.now();
        const content = existsSync(this.persistencePath) ? readFileSync(this.persistencePath, 'utf-8') : '';
        if (content) {
          writeFileSync(backupPath, content);
          console.log(`[JobQueue] Backed up corrupted file to ${backupPath}`);
        }
      } catch {
        // Ignore backup errors
      }
    }
  }

  private scheduleSave(): void {
    this.dirty = true;

    // Debounce saves to avoid excessive disk writes
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000); // Save at most once per second
  }

  private async save(): Promise<void> {
    if (!this.dirty || this.isSaving) return;

    // Clear dirty flag synchronously before yielding to async ops
    // so new writes during save don't get lost
    this.dirty = false;
    this.isSaving = true;

    try {
      // Ensure data directory exists
      if (!existsSync(this.dataDir)) {
        await fsPromises.mkdir(this.dataDir, { recursive: true });
      }

      // Backup existing file
      if (existsSync(this.persistencePath)) {
        const backupPath = this.persistencePath + '.backup';
        await fsPromises.copyFile(this.persistencePath, backupPath);
      }

      // Write new file atomically
      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      const tempPath = this.persistencePath + '.tmp';
      await fsPromises.writeFile(tempPath, data);
      await fsPromises.rename(tempPath, this.persistencePath);

      console.log(`[JobQueue] Saved ${this.jobs.size} jobs to disk`);
    } catch (err) {
      console.error('[JobQueue] Failed to save jobs:', err);
    } finally {
      this.isSaving = false;
      // If queue became dirty again while we were saving, trigger another save
      if (this.dirty) {
        this.scheduleSave();
      }
    }
  }

  private indexJob(job: Job): void {
    // Index by type
    if (!this.typeIndex.has(job.type)) {
      this.typeIndex.set(job.type, new Set());
    }
    this.typeIndex.get(job.type)!.add(job.job_id);

    // Index by submitter
    if (!this.submitterIndex.has(job.submitter)) {
      this.submitterIndex.set(job.submitter, new Set());
    }
    this.submitterIndex.get(job.submitter)!.add(job.job_id);

    // Index by capability
    if (job.capability_required) {
      if (!this.capabilityIndex.has(job.capability_required)) {
        this.capabilityIndex.set(job.capability_required, new Set());
      }
      this.capabilityIndex.get(job.capability_required)!.add(job.job_id);
    }

    // Index by claimed_by
    if (job.claimed_by) {
      if (!this.claimedByIndex.has(job.claimed_by)) {
        this.claimedByIndex.set(job.claimed_by, new Set());
      }
      this.claimedByIndex.get(job.claimed_by)!.add(job.job_id);
    }

    if (job.status === JobStatus.PENDING) {
      this.pendingIndex.add(job.job_id);
      if (job.capability_required) {
        if (!this.pendingCapabilityIndex.has(job.capability_required)) {
          this.pendingCapabilityIndex.set(job.capability_required, new Set());
        }
        this.pendingCapabilityIndex.get(job.capability_required)!.add(job.job_id);
      }
    }
  }

  private removeFromPendingIndex(job: Job): void {
    this.pendingIndex.delete(job.job_id);
    if (job.capability_required) {
      this.pendingCapabilityIndex.get(job.capability_required)?.delete(job.job_id);
    }
  }

  // ============ Submission ============

  submit(
    submitter: string,
    type: string,
    priority: number,
    payload: Record<string, unknown>,
    capabilityRequired?: string,
    constraints?: JobConstraints,
    _timeoutSeconds: number = 300
  ): Job {
    const job: Job = {
      job_id: uuidv4(),
      type,
      priority,
      submitter,
      capability_required: capabilityRequired,
      payload,
      constraints,
      status: JobStatus.PENDING,
      created_at: new Date().toISOString(),
    };

    // Generate PROV-O provenance record for job submission
    job.provenance = {
      submission: provenance.createJobSubmissionRecord(
        job.job_id,
        submitter,
        type,
        payload,
        capabilityRequired
      ),
    };

    this.jobs.set(job.job_id, job);
    this.indexJob(job);
    this.scheduleSave();

    // Update metrics
    jobsSubmitted.inc({ type, priority: priority.toString() });
    pendingJobs.labels(type).inc();

    return job;
  }

  // ============ Claim ============

  claim(jobId: string, agentId: string): Job | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    if (job.status !== JobStatus.PENDING) {
      return null;
    }

    job.status = JobStatus.CLAIMED;
    this.removeFromPendingIndex(job);
    job.claimed_by = agentId;
    job.started_at = new Date().toISOString();

    // Update claimed_by index
    if (!this.claimedByIndex.has(agentId)) {
      this.claimedByIndex.set(agentId, new Set());
    }
    this.claimedByIndex.get(agentId)!.add(jobId);

    // Generate PROV-O provenance record for job claim
    if (job.provenance) {
      job.provenance.claim = provenance.createJobClaimRecord(
        jobId,
        agentId,
        job.submitter
      );
    } else {
      // Initialize provenance if not present (backward compatibility)
      job.provenance = {
        submission: provenance.createJobSubmissionRecord(jobId, job.submitter, job.type, job.payload),
        claim: provenance.createJobClaimRecord(jobId, agentId, job.submitter),
      };
    }

    this.scheduleSave();

    // Update metrics
    jobsClaimed.inc();
    pendingJobs.labels(job.type).dec();
    claimedJobs.inc();

    return job;
  }

  // ============ Progress ============

  start(jobId: string): Job | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.CLAIMED) return null;

    job.status = JobStatus.IN_PROGRESS;
    this.scheduleSave();

    // Update metrics
    claimedJobs.dec();
    inProgressJobs.inc();

    return job;
  }

  progress(jobId: string, message?: string): Job | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.IN_PROGRESS) return null;

    if (message) {
      (job as any)._progressMessage = message;
    }

    this.scheduleSave();

    return job;
  }

  // ============ Completion ============

  complete(jobId: string, result: unknown): Job | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.IN_PROGRESS) return null;

    job.status = JobStatus.COMPLETED;
    job.result = result;
    job.completed_at = new Date().toISOString();

    // Generate PROV-O provenance record for job completion
    if (job.provenance) {
      job.provenance.completion = provenance.createJobCompletionRecord(
        jobId,
        job.claimed_by || 'unknown',
        job.submitter,
        result,
        undefined,
        `${jobId}-input`
      );
    }

    this.scheduleSave();

    // Update metrics
    jobsCompleted.inc();
    inProgressJobs.dec();
    const durationSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;
    jobDuration.observe(durationSeconds);

    return job;
  }

  fail(jobId: string, error: string): Job | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.IN_PROGRESS) return null;

    job.status = JobStatus.FAILED;
    job.error = error;
    job.completed_at = new Date().toISOString();

    // Generate PROV-O provenance record for job failure
    if (job.provenance) {
      job.provenance.completion = provenance.createJobCompletionRecord(
        jobId,
        job.claimed_by || 'unknown',
        job.submitter,
        undefined,
        error,
        `${jobId}-input`
      );
    }

    this.scheduleSave();

    // Update metrics
    jobsFailed.inc();
    inProgressJobs.dec();
    const durationSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;
    jobDuration.observe(durationSeconds);

    return job;
  }

  // ============ Cancellation ============

  cancel(jobId: string, reason?: string): Job | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      return null;
    }

    // Track previous status for metrics
    const prevStatus = job.status;

    job.status = JobStatus.CANCELLED;
    this.removeFromPendingIndex(job);
    job.error = reason || 'Cancelled by submitter';
    job.completed_at = new Date().toISOString();
    this.scheduleSave();

    // Update metrics
    jobsCancelled.inc();
    if (prevStatus === JobStatus.PENDING) {
      pendingJobs.labels(job.type).dec();
    } else if (prevStatus === JobStatus.CLAIMED) {
      claimedJobs.dec();
    } else if (prevStatus === JobStatus.IN_PROGRESS) {
      inProgressJobs.dec();
    }

    return job;
  }

  // ============ Queries ============

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getBySubmitter(submitter: string): Job[] {
    const jobIds = this.submitterIndex.get(submitter);
    if (!jobIds) return [];

    return Array.from(jobIds)
      .map(id => this.jobs.get(id))
      .filter((j): j is Job => j !== undefined);
  }

  getByAgent(agentId: string): Job[] {
    const jobIds = this.claimedByIndex.get(agentId);
    if (!jobIds) return [];

    return Array.from(jobIds)
      .map(id => this.jobs.get(id))
      .filter((j): j is Job => j !== undefined);
  }

  findAvailable(capabilityRequired?: string, type?: string): Job | null {
    let best: Job | null = null;

    let candidateIds: Iterable<string> | undefined;

    if (capabilityRequired) {
      candidateIds = this.pendingCapabilityIndex.get(capabilityRequired);
    } else {
      candidateIds = this.pendingIndex;
    }

    if (!candidateIds) return null;

    for (const jobId of candidateIds) {
      const job = this.jobs.get(jobId);
      if (!job) continue;

      // Status check is theoretically redundant due to index, but good for safety
      if (job.status !== JobStatus.PENDING) continue;
      if (type && job.type !== type) continue;

      if (!best || job.priority < best.priority) {
        best = job;
      }
    }

    return best;
  }

  query(filter: JobFilter): Job[] {
    const results: Job[] = [];

    for (const job of this.jobs.values()) {
      if (filter.status && job.status !== filter.status) continue;
      if (filter.type && job.type !== filter.type) continue;
      if (filter.submitter && job.submitter !== filter.submitter) continue;
      if (filter.capabilityRequired && job.capability_required !== filter.capabilityRequired) continue;

      results.push(job);
    }

    results.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    if (filter.offset) {
      results.splice(0, filter.offset);
    }
    if (filter.limit) {
      results.splice(filter.limit);
    }

    return results;
  }

  // ============ Stats ============

  getStats(): {
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    totalJobs: number;
  } {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const job of this.jobs.values()) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
      byType[job.type] = (byType[job.type] || 0) + 1;
    }

    return {
      byStatus,
      byType,
      totalJobs: this.jobs.size,
    };
  }

  // ============ Provenance Queries ============

  /**
   * Extract agent ID from a provenance record
   */
  private extractAgentId(record: { '@context'?: string[]; '@graph': unknown[] }): string {
    const graph = record['@graph'] as any[];

    // First try to find an agent entity
    const agent = graph.find(
      (e) => typeof e === 'object' && e !== null && (e['@type'] === 'dap:AIAgent' || (Array.isArray(e['@type']) && e['@type'].includes('prov:Agent')))
    );
    if (agent?.['@id']) {
      return agent['@id'];
    }

    // Fallback: check activity's prov:wasAssociatedWith
    const activity = graph.find(
      (e) => typeof e === 'object' && e !== null && 'prov:wasAssociatedWith' in e
    );
    if (activity?.['prov:wasAssociatedWith']) {
      const associated = activity['prov:wasAssociatedWith'];
      return Array.isArray(associated) ? associated[0] : associated;
    }

    // Last fallback: check entities with prov:wasAttributedTo
    const attributedEntity = graph.find(
      (e) => typeof e === 'object' && e !== null && 'prov:wasAttributedTo' in e
    );
    if (attributedEntity?.['prov:wasAttributedTo']) {
      const attr = attributedEntity['prov:wasAttributedTo'];
      return Array.isArray(attr) ? attr[0] : attr;
    }

    return 'unknown';
  }

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
   * Extract timestamp from a provenance record
   */
  private extractTimestamp(record: { '@context'?: string[]; '@graph': unknown[] }): string {
    const graph = record['@graph'] as any[];
    const ts = graph.find(
      (e) => typeof e === 'object' && e !== null && ('prov:startedAtTime' in e || 'prov:endedAtTime' in e)
    );
    return (ts?.['prov:startedAtTime'] || ts?.['prov:endedAtTime'] || new Date().toISOString()) as string;
  }

  /**
   * Convert a provenance chain to a simplified query record
   */
  private toQueryRecord(record: { '@context'?: string[]; '@graph': unknown[] }, jobId: string): SimplifiedProvenanceRecord {
    return {
      entity: jobId,
      activity: this.extractActivityType(record),
      timestamp: this.extractTimestamp(record),
      agentId: this.extractAgentId(record),
      metadata: {
        '@graph': record['@graph'],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get all provenance records for a specific job
   */
  getProvenance(jobId: string): SimplifiedProvenanceRecord[] {
    const job = this.jobs.get(jobId);
    if (!job || !job.provenance) return [];

    const records: SimplifiedProvenanceRecord[] = [];

    if (job.provenance.submission) {
      records.push(this.toQueryRecord(job.provenance.submission, jobId));
    }
    if (job.provenance.claim) {
      records.push(this.toQueryRecord(job.provenance.claim, jobId));
    }
    if (job.provenance.execution) {
      records.push(this.toQueryRecord(job.provenance.execution, jobId));
    }
    if (job.provenance.completion) {
      records.push(this.toQueryRecord(job.provenance.completion, jobId));
    }

    return records.sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );
  }

  /**
   * Query provenance records by agent ID
   */
  queryByAgent(agentId: string, from?: Date, to?: Date): SimplifiedProvenanceRecord[] {
    const records: SimplifiedProvenanceRecord[] = [];

    const jobsToCheck = new Map<string, Job>();
    for (const job of this.getBySubmitter(agentId)) {
      jobsToCheck.set(job.job_id, job);
    }
    for (const job of this.getByAgent(agentId)) {
      jobsToCheck.set(job.job_id, job);
    }

    for (const job of jobsToCheck.values()) {
      if (!job.provenance) continue;

      const provRecords = [
        job.provenance.submission,
        job.provenance.claim,
        job.provenance.execution,
        job.provenance.completion,
      ].filter(Boolean);

      for (const record of provRecords) {
        const queryRecord = this.toQueryRecord(record as { '@context'?: string[]; '@graph': unknown[] }, job.job_id);
        if (queryRecord.agentId === agentId) {
          const recordDate = new Date(queryRecord.timestamp);
          if (from && recordDate < from) continue;
          if (to && recordDate > to) continue;
          records.push(queryRecord);
        }
      }
    }

    return records.sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );
  }

  /**
   * Query provenance records by activity type
   */
  queryByActivity(activity: string, from?: Date, to?: Date): SimplifiedProvenanceRecord[] {
    const records: SimplifiedProvenanceRecord[] = [];

    for (const job of this.jobs.values()) {
      if (!job.provenance) continue;

      const provRecords = [
        job.provenance.submission,
        job.provenance.claim,
        job.provenance.execution,
        job.provenance.completion,
      ].filter(Boolean);

      for (const record of provRecords) {
        const queryRecord = this.toQueryRecord(record as { '@context'?: string[]; '@graph': unknown[] }, job.job_id);
        if (queryRecord.activity === activity || queryRecord.activity.includes(activity)) {
          const recordDate = new Date(queryRecord.timestamp);
          if (from && recordDate < from) continue;
          if (to && recordDate > to) continue;
          records.push(queryRecord);
        }
      }
    }

    return records.sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );
  }

  /**
   * Get aggregate provenance statistics
   */
  getProvenanceStats(): {
    totalRecords: number;
    byActivity: Record<string, number>;
    byAgent: Record<string, number>;
    timeRange: { earliest: string | null; latest: string | null };
  } {
    const byActivity: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalRecords = 0;
    let earliest: string | null = null;
    let latest: string | null = null;

    for (const job of this.jobs.values()) {
      if (!job.provenance) continue;

      const provRecords = [
        job.provenance.submission,
        job.provenance.claim,
        job.provenance.execution,
        job.provenance.completion,
      ].filter(Boolean);

      for (const record of provRecords) {
        totalRecords++;
        const queryRecord = this.toQueryRecord(record as { '@context'?: string[]; '@graph': unknown[] }, job.job_id);

        // Count by activity
        byActivity[queryRecord.activity] = (byActivity[queryRecord.activity] || 0) + 1;

        // Count by agent
        byAgent[queryRecord.agentId] = (byAgent[queryRecord.agentId] || 0) + 1;

        // Track time range
        const ts = queryRecord.timestamp;
        if (!earliest || ts < earliest) earliest = ts;
        if (!latest || ts > latest) latest = ts;
      }
    }

    return { totalRecords, byActivity, byAgent, timeRange: { earliest, latest } };
  }

  // ============ Cleanup ============

  cleanStale(maxAgeMs: number): string[] {
    const cutoff = Date.now() - maxAgeMs;
    const removed: string[] = [];

    for (const [jobId, job] of this.jobs.entries()) {
      const created = new Date(job.created_at).getTime();

      if (job.status === JobStatus.PENDING && created < cutoff) {
        this.jobs.delete(jobId);
        removed.push(jobId);
      }

      if (
        (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) &&
        job.completed_at &&
        new Date(job.completed_at).getTime() < cutoff
      ) {
        this.jobs.delete(jobId);
        removed.push(jobId);
      }
    }

    if (removed.length > 0) {
      this.rebuildIndexes();
      this.scheduleSave();
    }

    return removed;
  }

  private rebuildIndexes(): void {
    this.typeIndex.clear();
    this.submitterIndex.clear();
    this.capabilityIndex.clear();
    this.claimedByIndex.clear();
    this.pendingIndex.clear();
    this.pendingCapabilityIndex.clear();

    for (const job of this.jobs.values()) {
      this.indexJob(job);
    }
  }

  // Force save (for testing)
  async forceSave(): Promise<void> {
    await this.save();
  }
}
