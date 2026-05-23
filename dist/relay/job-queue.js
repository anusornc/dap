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
import { JobStatus } from '../protocol/types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { jobsSubmitted, jobsClaimed, jobsCompleted, jobsFailed, jobsCancelled, pendingJobs, claimedJobs, inProgressJobs, jobDuration, } from '../utils/metrics.js';
// Shared provenance generator instance
const provenance = new ProvenanceGenerator();
export class JobQueue {
    jobs = new Map();
    typeIndex = new Map();
    submitterIndex = new Map();
    capabilityIndex = new Map();
    dataDir;
    persistencePath;
    saveDebounceTimer;
    dirty = false;
    constructor(dataDir = './data') {
        this.dataDir = dataDir;
        this.persistencePath = join(dataDir, 'jobs.json');
        this.load();
    }
    // ============ Persistence ============
    load() {
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
        }
        catch (err) {
            console.error('[JobQueue] Failed to load jobs:', err);
            // Backup corrupted file
            try {
                const backupPath = this.persistencePath + '.backup.' + Date.now();
                const content = existsSync(this.persistencePath) ? readFileSync(this.persistencePath, 'utf-8') : '';
                if (content) {
                    writeFileSync(backupPath, content);
                    console.log(`[JobQueue] Backed up corrupted file to ${backupPath}`);
                }
            }
            catch {
                // Ignore backup errors
            }
        }
    }
    scheduleSave() {
        this.dirty = true;
        // Debounce saves to avoid excessive disk writes
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.save();
        }, 1000); // Save at most once per second
    }
    save() {
        if (!this.dirty)
            return;
        try {
            // Ensure data directory exists
            if (!existsSync(this.dataDir)) {
                mkdirSync(this.dataDir, { recursive: true });
            }
            // Backup existing file
            if (existsSync(this.persistencePath)) {
                const backupPath = this.persistencePath + '.backup';
                const content = readFileSync(this.persistencePath, 'utf-8');
                writeFileSync(backupPath, content);
            }
            // Write new file atomically
            const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
            const tempPath = this.persistencePath + '.tmp';
            writeFileSync(tempPath, data);
            writeFileSync(this.persistencePath, data);
            // Clean up temp file
            try {
                const { unlinkSync } = require('fs');
                unlinkSync(tempPath);
            }
            catch {
                // Ignore
            }
            this.dirty = false;
            console.log(`[JobQueue] Saved ${this.jobs.size} jobs to disk`);
        }
        catch (err) {
            console.error('[JobQueue] Failed to save jobs:', err);
        }
    }
    indexJob(job) {
        // Index by type
        if (!this.typeIndex.has(job.type)) {
            this.typeIndex.set(job.type, new Set());
        }
        this.typeIndex.get(job.type).add(job.job_id);
        // Index by submitter
        if (!this.submitterIndex.has(job.submitter)) {
            this.submitterIndex.set(job.submitter, new Set());
        }
        this.submitterIndex.get(job.submitter).add(job.job_id);
        // Index by capability
        if (job.capability_required) {
            if (!this.capabilityIndex.has(job.capability_required)) {
                this.capabilityIndex.set(job.capability_required, new Set());
            }
            this.capabilityIndex.get(job.capability_required).add(job.job_id);
        }
    }
    // ============ Submission ============
    submit(submitter, type, priority, payload, capabilityRequired, constraints, _timeoutSeconds = 300) {
        const job = {
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
            submission: provenance.createJobSubmissionRecord(job.job_id, submitter, type, payload, capabilityRequired),
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
    claim(jobId, agentId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return null;
        if (job.status !== JobStatus.PENDING) {
            return null;
        }
        job.status = JobStatus.CLAIMED;
        job.claimed_by = agentId;
        job.started_at = new Date().toISOString();
        // Generate PROV-O provenance record for job claim
        if (job.provenance) {
            job.provenance.claim = provenance.createJobClaimRecord(jobId, agentId, job.submitter);
        }
        else {
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
    start(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== JobStatus.CLAIMED)
            return null;
        job.status = JobStatus.IN_PROGRESS;
        this.scheduleSave();
        // Update metrics
        claimedJobs.dec();
        inProgressJobs.inc();
        return job;
    }
    progress(jobId, message) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== JobStatus.IN_PROGRESS)
            return null;
        if (message) {
            job._progressMessage = message;
        }
        this.scheduleSave();
        return job;
    }
    // ============ Completion ============
    complete(jobId, result) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== JobStatus.IN_PROGRESS)
            return null;
        job.status = JobStatus.COMPLETED;
        job.result = result;
        job.completed_at = new Date().toISOString();
        // Generate PROV-O provenance record for job completion
        if (job.provenance) {
            job.provenance.completion = provenance.createJobCompletionRecord(jobId, job.claimed_by || 'unknown', job.submitter, result, undefined, `${jobId}-input`);
        }
        this.scheduleSave();
        // Update metrics
        jobsCompleted.inc();
        inProgressJobs.dec();
        const durationSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;
        jobDuration.observe(durationSeconds);
        return job;
    }
    fail(jobId, error) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== JobStatus.IN_PROGRESS)
            return null;
        job.status = JobStatus.FAILED;
        job.error = error;
        job.completed_at = new Date().toISOString();
        // Generate PROV-O provenance record for job failure
        if (job.provenance) {
            job.provenance.completion = provenance.createJobCompletionRecord(jobId, job.claimed_by || 'unknown', job.submitter, undefined, error, `${jobId}-input`);
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
    cancel(jobId, reason) {
        const job = this.jobs.get(jobId);
        if (!job)
            return null;
        if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
            return null;
        }
        // Track previous status for metrics
        const prevStatus = job.status;
        job.status = JobStatus.CANCELLED;
        job.error = reason || 'Cancelled by submitter';
        job.completed_at = new Date().toISOString();
        this.scheduleSave();
        // Update metrics
        jobsCancelled.inc();
        if (prevStatus === JobStatus.PENDING) {
            pendingJobs.labels(job.type).dec();
        }
        else if (prevStatus === JobStatus.CLAIMED) {
            claimedJobs.dec();
        }
        else if (prevStatus === JobStatus.IN_PROGRESS) {
            inProgressJobs.dec();
        }
        return job;
    }
    // ============ Queries ============
    get(jobId) {
        return this.jobs.get(jobId);
    }
    getBySubmitter(submitter) {
        const jobIds = this.submitterIndex.get(submitter);
        if (!jobIds)
            return [];
        return Array.from(jobIds)
            .map(id => this.jobs.get(id))
            .filter((j) => j !== undefined);
    }
    getByAgent(agentId) {
        const results = [];
        for (const job of this.jobs.values()) {
            if (job.claimed_by === agentId) {
                results.push(job);
            }
        }
        return results;
    }
    findAvailable(capabilityRequired, type) {
        let best = null;
        for (const job of this.jobs.values()) {
            if (job.status !== JobStatus.PENDING)
                continue;
            if (capabilityRequired && job.capability_required !== capabilityRequired)
                continue;
            if (type && job.type !== type)
                continue;
            if (!best || job.priority < best.priority) {
                best = job;
            }
        }
        return best;
    }
    query(filter) {
        const results = [];
        for (const job of this.jobs.values()) {
            if (filter.status && job.status !== filter.status)
                continue;
            if (filter.type && job.type !== filter.type)
                continue;
            if (filter.submitter && job.submitter !== filter.submitter)
                continue;
            if (filter.capabilityRequired && job.capability_required !== filter.capabilityRequired)
                continue;
            results.push(job);
        }
        results.sort((a, b) => {
            if (a.priority !== b.priority)
                return a.priority - b.priority;
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
    getStats() {
        const byStatus = {};
        const byType = {};
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
    extractAgentId(record) {
        const graph = record['@graph'];
        // First try to find an agent entity
        const agent = graph.find((e) => typeof e === 'object' && e !== null && (e['@type'] === 'dap:AIAgent' || (Array.isArray(e['@type']) && e['@type'].includes('prov:Agent'))));
        if (agent?.['@id']) {
            return agent['@id'];
        }
        // Fallback: check activity's prov:wasAssociatedWith
        const activity = graph.find((e) => typeof e === 'object' && e !== null && 'prov:wasAssociatedWith' in e);
        if (activity?.['prov:wasAssociatedWith']) {
            const associated = activity['prov:wasAssociatedWith'];
            return Array.isArray(associated) ? associated[0] : associated;
        }
        // Last fallback: check entities with prov:wasAttributedTo
        const attributedEntity = graph.find((e) => typeof e === 'object' && e !== null && 'prov:wasAttributedTo' in e);
        if (attributedEntity?.['prov:wasAttributedTo']) {
            const attr = attributedEntity['prov:wasAttributedTo'];
            return Array.isArray(attr) ? attr[0] : attr;
        }
        return 'unknown';
    }
    /**
     * Extract activity type from a provenance record
     */
    extractActivityType(record) {
        const graph = record['@graph'];
        const activity = graph.find((e) => typeof e === 'object' && e !== null && ('prov:wasAssociatedWith' in e || 'prov:used' in e));
        return activity?.['@type'] || 'unknown';
    }
    /**
     * Extract timestamp from a provenance record
     */
    extractTimestamp(record) {
        const graph = record['@graph'];
        const ts = graph.find((e) => typeof e === 'object' && e !== null && ('prov:startedAtTime' in e || 'prov:endedAtTime' in e));
        return (ts?.['prov:startedAtTime'] || ts?.['prov:endedAtTime'] || new Date().toISOString());
    }
    /**
     * Convert a provenance chain to a simplified query record
     */
    toQueryRecord(record, jobId) {
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
    getProvenance(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || !job.provenance)
            return [];
        const records = [];
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
        return records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    /**
     * Query provenance records by agent ID
     */
    queryByAgent(agentId, from, to) {
        const records = [];
        for (const job of this.jobs.values()) {
            if (!job.provenance)
                continue;
            const provRecords = [
                job.provenance.submission,
                job.provenance.claim,
                job.provenance.execution,
                job.provenance.completion,
            ].filter(Boolean);
            for (const record of provRecords) {
                const queryRecord = this.toQueryRecord(record, job.job_id);
                if (queryRecord.agentId === agentId) {
                    const recordDate = new Date(queryRecord.timestamp);
                    if (from && recordDate < from)
                        continue;
                    if (to && recordDate > to)
                        continue;
                    records.push(queryRecord);
                }
            }
        }
        return records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    /**
     * Query provenance records by activity type
     */
    queryByActivity(activity, from, to) {
        const records = [];
        for (const job of this.jobs.values()) {
            if (!job.provenance)
                continue;
            const provRecords = [
                job.provenance.submission,
                job.provenance.claim,
                job.provenance.execution,
                job.provenance.completion,
            ].filter(Boolean);
            for (const record of provRecords) {
                const queryRecord = this.toQueryRecord(record, job.job_id);
                if (queryRecord.activity === activity || queryRecord.activity.includes(activity)) {
                    const recordDate = new Date(queryRecord.timestamp);
                    if (from && recordDate < from)
                        continue;
                    if (to && recordDate > to)
                        continue;
                    records.push(queryRecord);
                }
            }
        }
        return records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    /**
     * Get aggregate provenance statistics
     */
    getProvenanceStats() {
        const byActivity = {};
        const byAgent = {};
        let totalRecords = 0;
        let earliest = null;
        let latest = null;
        for (const job of this.jobs.values()) {
            if (!job.provenance)
                continue;
            const provRecords = [
                job.provenance.submission,
                job.provenance.claim,
                job.provenance.execution,
                job.provenance.completion,
            ].filter(Boolean);
            for (const record of provRecords) {
                totalRecords++;
                const queryRecord = this.toQueryRecord(record, job.job_id);
                // Count by activity
                byActivity[queryRecord.activity] = (byActivity[queryRecord.activity] || 0) + 1;
                // Count by agent
                byAgent[queryRecord.agentId] = (byAgent[queryRecord.agentId] || 0) + 1;
                // Track time range
                const ts = queryRecord.timestamp;
                if (!earliest || ts < earliest)
                    earliest = ts;
                if (!latest || ts > latest)
                    latest = ts;
            }
        }
        return { totalRecords, byActivity, byAgent, timeRange: { earliest, latest } };
    }
    // ============ Cleanup ============
    cleanStale(maxAgeMs) {
        const cutoff = Date.now() - maxAgeMs;
        const removed = [];
        for (const [jobId, job] of this.jobs.entries()) {
            const created = new Date(job.created_at).getTime();
            if (job.status === JobStatus.PENDING && created < cutoff) {
                this.jobs.delete(jobId);
                removed.push(jobId);
            }
            if ((job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) &&
                job.completed_at &&
                new Date(job.completed_at).getTime() < cutoff) {
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
    rebuildIndexes() {
        this.typeIndex.clear();
        this.submitterIndex.clear();
        this.capabilityIndex.clear();
        for (const job of this.jobs.values()) {
            this.indexJob(job);
        }
    }
    // Force save (for testing)
    forceSave() {
        this.save();
    }
}
//# sourceMappingURL=job-queue.js.map