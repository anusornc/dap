import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import {
  register,
  jobsSubmitted,
  jobsClaimed,
  jobsCompleted,
  jobsFailed,
  jobsCancelled,
  pendingJobs,
  claimedJobs,
  inProgressJobs,
  jobDuration,
  activeAgents,
  agentsRegistered,
  agentHeartbeats,
  staleAgents,
  wsConnections,
  messagesTotal,
  messageSize,
  requestsTotal,
  requestDuration,
  errorsTotal,
  rateLimited,
  connectedAgents,
  uptimeSeconds
} from '../src/utils/metrics.js';

describe('Metrics', () => {
  it('should export a Registry instance', () => {
    expect(register).toBeInstanceOf(Registry);
  });

  it('should correctly initialize Job Metrics', async () => {
    expect(jobsSubmitted).toBeInstanceOf(Counter);
    expect((await jobsSubmitted.get()).name).toBe('dap_jobs_submitted_total');

    expect(jobsClaimed).toBeInstanceOf(Counter);
    expect(jobsCompleted).toBeInstanceOf(Counter);
    expect(jobsFailed).toBeInstanceOf(Counter);
    expect(jobsCancelled).toBeInstanceOf(Counter);

    expect(pendingJobs).toBeInstanceOf(Gauge);
    expect(claimedJobs).toBeInstanceOf(Gauge);
    expect(inProgressJobs).toBeInstanceOf(Gauge);

    expect(jobDuration).toBeInstanceOf(Histogram);
  });

  it('should correctly initialize Agent Metrics', () => {
    expect(activeAgents).toBeInstanceOf(Gauge);
    expect(agentsRegistered).toBeInstanceOf(Counter);
    expect(agentHeartbeats).toBeInstanceOf(Counter);
    expect(staleAgents).toBeInstanceOf(Gauge);
    expect(wsConnections).toBeInstanceOf(Gauge);
  });

  it('should correctly initialize Message Metrics', () => {
    expect(messagesTotal).toBeInstanceOf(Counter);
    expect(messageSize).toBeInstanceOf(Histogram);
  });

  it('should correctly initialize System Metrics', () => {
    expect(requestsTotal).toBeInstanceOf(Counter);
    expect(requestDuration).toBeInstanceOf(Histogram);
    expect(errorsTotal).toBeInstanceOf(Counter);
    expect(rateLimited).toBeInstanceOf(Counter);
  });

  it('should correctly initialize Legacy Metric Aliases', () => {
    expect(connectedAgents).toBeInstanceOf(Gauge);
    expect(uptimeSeconds).toBeInstanceOf(Gauge);
  });

  describe('uptimeSeconds update interval', () => {
    beforeEach(() => {
      // Don't use system time as it will mess with node's Date.now() inside the metrics.ts interval
      // which has already been initialized before this test block.
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should update uptimeSeconds periodically', async () => {
      // Wait real time instead of fake timers since the module has already set its interval
      // using the real `setInterval` when imported at the top of the file.
      const initialValue = (await uptimeSeconds.get()).values[0].value;

      await new Promise(resolve => setTimeout(resolve, 1500)); // wait 1.5s for interval to trigger

      const updatedValue = (await uptimeSeconds.get()).values[0].value;

      expect(updatedValue).toBeGreaterThan(initialValue);
    });
  });
});
