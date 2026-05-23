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
// ============ PROV-O Constants ============
export const PROV_NAMESPACE = 'http://www.w3.org/ns/prov#';
export const DAP_NAMESPACE = 'https://dap-protocol.org/ns#';
// ============ Type Definitions ============
/**
 * PROV-O Activity types for DAP-specific activities
 */
export const DAPActivityTypes = {
    AGENT_REGISTRATION: 'dap:AgentRegistration',
    JOB_SUBMISSION: 'dap:JobSubmission',
    JOB_CLAIM: 'dap:JobClaim',
    JOB_EXECUTION: 'dap:JobExecution',
    MESSAGE_ROUTING: 'dap:MessageRouting',
    MESSAGE_SEND: 'dap:MessageSend',
    MESSAGE_RECEIVE: 'dap:MessageReceive',
    DELEGATION: 'dap:Delegation',
};
/**
 * PROV-O Entity types for DAP-specific entities
 */
export const DAPEntityTypes = {
    DAP_MESSAGE: 'dap:Message',
    DAP_JOB: 'dap:Job',
    DAP_JOB_INPUT: 'dap:JobInput',
    DAP_JOB_RESULT: 'dap:JobResult',
    DAP_CAPABILITY: 'dap:Capability',
    DAP_AGENT_CARD: 'dap:AgentCard',
};
/**
 * PROV-O Agent types for DAP-specific agents
 */
export const DAPAgentTypes = {
    HUMAN_AGENT: 'prov:Person',
    SOFTWARE_AGENT: 'prov:SoftwareAgent',
    AI_AGENT: 'dap:AIAgent',
    RELAY_SERVER: 'dap:RelayServer',
};
/**
 * PROV Role types for agent participation in activities
 */
export const DAPRoles = {
    SUBMITTER: 'dap:submitter',
    WORKER: 'dap:worker',
    COORDINATOR: 'dap:coordinator',
    DELEGATOR: 'dap:delegator',
    DELEGATEE: 'dap:delegatee',
    SENDER: 'dap:sender',
    RECEIVER: 'dap:receiver',
    RELAY: 'dap:relay',
};
// ============ Provenance Generator ============
export class ProvenanceGenerator {
    prefix;
    constructor(prefix = 'dap') {
        this.prefix = prefix;
    }
    /**
     * Generate a unique URI for a provenance entity
     */
    generateId(type) {
        const id = uuidv4().replace(/-/g, '').substring(0, 12);
        return `${this.prefix}:${type}-${id}`;
    }
    /**
     * Create a prov:Agent record for a DAP agent
     */
    createAgentRecord(agentId, agentType = DAPAgentTypes.AI_AGENT, label) {
        return {
            '@id': agentId,
            '@type': [agentType],
            'prov:label': label || agentId,
        };
    }
    /**
     * Create a prov:Entity record for a DAP message
     */
    createMessageEntity(messageId, action, payload) {
        return {
            '@id': messageId,
            '@type': DAPEntityTypes.DAP_MESSAGE,
            'prov:label': `Message: ${action}`,
            'prov:value': payload,
        };
    }
    /**
     * Create a prov:Activity record for job lifecycle
     */
    createJobActivity(jobId, activityType, options = {}) {
        const activity = {
            '@id': this.generateId('activity'),
            '@type': activityType,
            'prov:label': `${activityType.split(':')[1] || activityType} for job ${jobId}`,
            'dap:jobId': jobId,
        };
        if (options.startedAtTime) {
            activity['prov:startedAtTime'] = options.startedAtTime;
        }
        if (options.endedAtTime) {
            activity['prov:endedAtTime'] = options.endedAtTime;
        }
        if (options.associatedAgent) {
            activity['prov:wasAssociatedWith'] = options.associatedAgent;
        }
        if (options.usedEntities && options.usedEntities.length > 0) {
            activity['prov:used'] = options.usedEntities;
        }
        if (options.generatedEntities && options.generatedEntities.length > 0) {
            activity['prov:generated'] = options.generatedEntities;
        }
        if (options.hadRole) {
            activity['prov:qualifiedAssociation'] = [{
                    '@type': 'prov:Association',
                    'prov:agent': options.associatedAgent || '',
                    'prov:hadRole': options.hadRole,
                }];
        }
        return activity;
    }
    /**
     * Create agent registration provenance record
     */
    createAgentRegistrationRecord(agentId, capabilities, os, version) {
        const timestamp = new Date().toISOString();
        // Create agent entity
        const agent = this.createAgentRecord(agentId, DAPAgentTypes.AI_AGENT);
        // Add capability entities
        const capabilityEntities = capabilities.map(cap => ({
            '@id': `${agentId}/capability/${cap}`,
            '@type': DAPEntityTypes.DAP_CAPABILITY,
            'prov:label': `Capability: ${cap}`,
            'prov:wasAttributedTo': agentId,
        }));
        // Create registration activity
        const registration = this.createJobActivity(agentId, DAPActivityTypes.AGENT_REGISTRATION, {
            startedAtTime: timestamp,
            endedAtTime: timestamp,
            associatedAgent: agentId,
            generatedEntities: [agentId, ...capabilityEntities.map(e => e['@id'])],
            hadRole: DAPRoles.COORDINATOR,
        });
        // Add metadata to agent
        if (os || version) {
            agent['prov:location'] = os;
            agent['dap:version'] = version;
        }
        return {
            '@context': [
                'https://www.w3.org/ns/prov',
                'https://dap-protocol.org/ns',
            ],
            '@graph': [
                agent,
                registration,
                ...capabilityEntities,
            ],
        };
    }
    /**
     * Create job submission provenance record
     */
    createJobSubmissionRecord(jobId, submitterId, jobType, payload, capabilityRequired) {
        const timestamp = new Date().toISOString();
        // Create job input entity (the payload)
        const jobInput = {
            '@id': `${jobId}-input`,
            '@type': DAPEntityTypes.DAP_JOB_INPUT,
            'prov:label': `Job input for ${jobType}`,
            'prov:value': payload,
            'prov:wasAttributedTo': submitterId,
        };
        // Create job entity
        const jobEntity = {
            '@id': jobId,
            '@type': DAPEntityTypes.DAP_JOB,
            'prov:label': `Job: ${jobType}`,
            'prov:wasAttributedTo': submitterId,
        };
        // Create submission activity
        const submission = this.createJobActivity(jobId, DAPActivityTypes.JOB_SUBMISSION, {
            startedAtTime: timestamp,
            endedAtTime: timestamp,
            associatedAgent: submitterId,
            usedEntities: [jobInput['@id']],
            generatedEntities: [jobId],
            hadRole: DAPRoles.SUBMITTER,
        });
        // Add capability requirement if specified
        if (capabilityRequired) {
            jobEntity['dap:capabilityRequired'] = capabilityRequired;
        }
        return {
            '@context': [
                'https://www.w3.org/ns/prov',
                'https://dap-protocol.org/ns',
            ],
            '@graph': [jobInput, jobEntity, submission],
        };
    }
    /**
     * Create job claim provenance record
     */
    createJobClaimRecord(jobId, claimerId, _submitterId) {
        const timestamp = new Date().toISOString();
        // Create claimer agent
        const claimer = this.createAgentRecord(claimerId, DAPAgentTypes.AI_AGENT);
        // Create claim activity
        const claim = this.createJobActivity(jobId, DAPActivityTypes.JOB_CLAIM, {
            startedAtTime: timestamp,
            endedAtTime: timestamp,
            associatedAgent: claimerId,
            hadRole: DAPRoles.WORKER,
        });
        return {
            '@context': [
                'https://www.w3.org/ns/prov',
                'https://dap-protocol.org/ns',
            ],
            '@graph': [claimer, claim],
        };
    }
    /**
     * Create job completion provenance record
     */
    createJobCompletionRecord(jobId, workerId, _submitterId, result, error, usedInputId) {
        const timestamp = new Date().toISOString();
        // Create result entity
        const jobResult = error ? {
            '@id': `${jobId}-error`,
            '@type': 'prov:Entity',
            'prov:label': `Job error: ${error}`,
            'prov:value': error,
            'prov:wasAttributedTo': workerId,
        } : {
            '@id': `${jobId}-result`,
            '@type': DAPEntityTypes.DAP_JOB_RESULT,
            'prov:label': 'Job result',
            'prov:value': result,
            'prov:wasAttributedTo': workerId,
        };
        // Create job entity for derivation
        const jobEntity = {
            '@id': jobId,
            '@type': DAPEntityTypes.DAP_JOB,
        };
        // If we have the input, record derivation
        if (usedInputId) {
            jobResult['prov:wasDerivedFrom'] = usedInputId;
        }
        // Create execution activity
        const execution = this.createJobActivity(jobId, DAPActivityTypes.JOB_EXECUTION, {
            startedAtTime: timestamp,
            endedAtTime: timestamp,
            associatedAgent: workerId,
            usedEntities: usedInputId ? [usedInputId] : [],
            generatedEntities: [jobResult['@id']],
            hadRole: DAPRoles.WORKER,
        });
        return {
            '@context': [
                'https://www.w3.org/ns/prov',
                'https://dap-protocol.org/ns',
            ],
            '@graph': [jobEntity, jobResult, execution],
        };
    }
    /**
     * Create delegation provenance record
     */
    createDelegationRecord(delegatorId, delegateeId, _capability, contextJobId) {
        const timestamp = new Date().toISOString();
        // Create delegator agent
        const delegator = this.createAgentRecord(delegatorId, DAPAgentTypes.AI_AGENT);
        // Create delegatee agent with delegation relationship
        const delegatee = {
            '@id': delegateeId,
            '@type': [DAPAgentTypes.AI_AGENT],
            'prov:label': delegateeId,
            'prov:actedOnBehalfOf': {
                '@type': 'prov:Delegation',
                'prov:agent': delegatorId,
                'prov:hadRole': DAPRoles.DELEGATOR,
            },
        };
        // Create delegation activity
        const delegation = {
            '@id': this.generateId('delegation'),
            '@type': DAPActivityTypes.DELEGATION,
            'prov:label': `Delegation: ${delegatorId} → ${delegateeId}`,
            'prov:startedAtTime': timestamp,
            'prov:endedAtTime': timestamp,
            'prov:wasAssociatedWith': delegatorId,
            'prov:qualifiedAssociation': [
                {
                    '@type': 'prov:Association',
                    'prov:agent': delegatorId,
                    'prov:hadRole': DAPRoles.DELEGATOR,
                },
                {
                    '@type': 'prov:Association',
                    'prov:agent': delegateeId,
                    'prov:hadRole': DAPRoles.DELEGATEE,
                },
            ],
        };
        if (contextJobId) {
            delegation['dap:jobId'] = contextJobId;
        }
        return {
            '@context': [
                'https://www.w3.org/ns/prov',
                'https://dap-protocol.org/ns',
            ],
            '@graph': [delegator, delegatee, delegation],
        };
    }
    /**
     * Merge multiple provenance chains into a single chain
     */
    mergeChains(...chains) {
        const allGraphs = [];
        const contexts = new Set(['https://www.w3.org/ns/prov']);
        for (const chain of chains) {
            if (chain['@context']) {
                chain['@context'].forEach(c => contexts.add(c));
            }
            if (chain['@graph']) {
                allGraphs.push(...chain['@graph']);
            }
        }
        return {
            '@context': Array.from(contexts),
            '@graph': allGraphs,
        };
    }
}
export class ProvenanceQuery {
    jobQueue;
    agentRegistry;
    constructor(jobQueue, agentRegistry) {
        this.jobQueue = jobQueue;
        this.agentRegistry = agentRegistry;
    }
    /**
     * Rebuild full execution timeline from provenance chain
     */
    trace(jobId) {
        const job = this.jobQueue.get(jobId);
        if (!job)
            return [];
        const steps = [];
        let stepNum = 1;
        if (!job.provenance)
            return [];
        // Submission step
        if (job.provenance.submission) {
            const graph = job.provenance.submission['@graph'];
            const activity = graph.find((e) => e['@type']?.includes('Submission'));
            const agent = graph.find((e) => e['prov:wasAttributedTo']);
            steps.push({
                step: stepNum++,
                timestamp: activity?.['prov:startedAtTime'] || job.created_at,
                activity: 'JOB_SUBMISSION',
                description: `Job submitted by ${agent?.['prov:wasAttributedTo'] || 'unknown'}`,
                agentId: agent?.['prov:wasAttributedTo'] || 'unknown',
                details: { jobType: job.type, priority: job.priority },
            });
        }
        // Claim step
        if (job.provenance.claim) {
            const graph = job.provenance.claim['@graph'];
            const activity = graph.find((e) => e['@type']?.includes('Claim'));
            const agent = graph.find((e) => e['prov:wasAttributedTo']);
            steps.push({
                step: stepNum++,
                timestamp: activity?.['prov:startedAtTime'] || job.started_at || new Date().toISOString(),
                activity: 'JOB_CLAIM',
                description: `Job claimed by ${agent?.['prov:wasAttributedTo'] || 'unknown'}`,
                agentId: agent?.['prov:wasAttributedTo'] || 'unknown',
                details: { claimedBy: job.claimed_by },
            });
        }
        // Execution step
        if (job.provenance.execution) {
            const graph = job.provenance.execution['@graph'];
            const activity = graph.find((e) => e['@type']?.includes('Execution'));
            steps.push({
                step: stepNum++,
                timestamp: activity?.['prov:startedAtTime'] || job.started_at || new Date().toISOString(),
                activity: 'JOB_EXECUTION',
                description: `Job execution started`,
                agentId: job.claimed_by || 'unknown',
            });
        }
        // Completion step
        if (job.provenance.completion) {
            const graph = job.provenance.completion['@graph'];
            const activity = graph.find((e) => e['@type']?.includes('Execution') || e['@type'] === 'prov:Entity');
            const isError = graph.some((e) => e['@id']?.includes('error'));
            steps.push({
                step: stepNum++,
                timestamp: activity?.['prov:startedAtTime'] || job.completed_at || new Date().toISOString(),
                activity: isError ? 'JOB_FAILED' : 'JOB_COMPLETED',
                description: isError
                    ? `Job failed: ${job.error || 'Unknown error'}`
                    : `Job completed successfully`,
                agentId: job.claimed_by || 'unknown',
                details: isError ? { error: job.error } : { result: job.result },
            });
        }
        // If no completion record but job has a status, add current status
        if (steps.length > 0 && !job.provenance.completion) {
            if (job.status === 'in-progress') {
                steps.push({
                    step: stepNum++,
                    timestamp: new Date().toISOString(),
                    activity: 'JOB_IN_PROGRESS',
                    description: `Job is currently in progress`,
                    agentId: job.claimed_by || 'unknown',
                });
            }
        }
        return steps;
    }
    /**
     * Find root cause of a failed job
     */
    findRootCause(jobId) {
        const job = this.jobQueue.get(jobId);
        if (!job)
            return 'Job not found';
        if (job.status !== 'failed') {
            return 'Job did not fail';
        }
        if (!job.provenance?.completion) {
            return 'Unable to determine root cause: no completion record';
        }
        // Check for specific error types in the provenance
        const graph = job.provenance.completion['@graph'];
        const errorEntity = graph.find((e) => e['@id']?.includes('error') || e['prov:value']?.includes('error'));
        if (errorEntity?.['prov:value']) {
            return `Error: ${errorEntity['prov:value']}`;
        }
        if (job.error) {
            return `Error: ${job.error}`;
        }
        // Check trace for the failure point
        const trace = this.trace(jobId);
        const failedStep = trace.find(s => s.activity === 'JOB_FAILED');
        if (failedStep) {
            return failedStep.description;
        }
        return 'Unknown error';
    }
    /**
     * Get activity timeline for an agent within a date range
     */
    getActivityTimeline(agentId, range) {
        const events = [];
        // Get jobs claimed/executed by this agent
        const agentJobs = this.jobQueue.getByAgent(agentId);
        for (const job of agentJobs) {
            if (!job.provenance)
                continue;
            // Filter by date range if provided
            const jobDate = new Date(job.created_at);
            if (range) {
                if (jobDate < range.from || jobDate > range.to)
                    continue;
            }
            // Add job events
            if (job.provenance.submission) {
                events.push({
                    timestamp: job.created_at,
                    event: 'JOB_SUBMITTED',
                    description: `Job ${job.job_id} submitted (type: ${job.type})`,
                    metadata: { jobId: job.job_id, type: job.type },
                });
            }
            if (job.provenance.claim) {
                events.push({
                    timestamp: job.started_at || job.created_at,
                    event: 'JOB_CLAIMED',
                    description: `Job ${job.job_id} claimed by ${agentId}`,
                    agentId,
                    metadata: { jobId: job.job_id },
                });
            }
            if (job.provenance.completion) {
                const isError = job.status === 'failed';
                events.push({
                    timestamp: job.completed_at || new Date().toISOString(),
                    event: isError ? 'JOB_FAILED' : 'JOB_COMPLETED',
                    description: isError
                        ? `Job ${job.job_id} failed: ${job.error}`
                        : `Job ${job.job_id} completed`,
                    agentId,
                    metadata: { jobId: job.job_id, error: job.error, result: job.result },
                });
            }
        }
        // Get agent registration events
        const agent = this.agentRegistry.get(agentId);
        if (agent?.provenance?.registeredAt) {
            events.push({
                timestamp: agent.provenance.registeredAt,
                event: 'AGENT_REGISTERED',
                description: `Agent ${agentId} registered`,
                agentId,
            });
        }
        // Sort by timestamp
        return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    /**
     * Format trace as human-readable timeline
     */
    formatTraceTimeline(trace) {
        if (trace.length === 0)
            return 'No trace available';
        const lines = [];
        lines.push('='.repeat(60));
        lines.push('JOB EXECUTION TRACE');
        lines.push('='.repeat(60));
        lines.push('');
        for (const step of trace) {
            const time = new Date(step.timestamp).toLocaleString();
            lines.push(`[Step ${step.step}] ${time}`);
            lines.push(`  Activity: ${step.activity}`);
            lines.push(`  Description: ${step.description}`);
            lines.push(`  Agent: ${step.agentId}`);
            if (step.details) {
                lines.push(`  Details: ${JSON.stringify(step.details, null, 2)
                    .split('\n')
                    .map(l => '    ' + l)
                    .join('\n')}`);
            }
            lines.push('-'.repeat(40));
        }
        return lines.join('\n');
    }
}
// ============ Default Export ============
export const provenanceGenerator = new ProvenanceGenerator();
export default ProvenanceGenerator;
//# sourceMappingURL=index.js.map