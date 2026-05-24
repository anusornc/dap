import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, RequestLogger, generateRequestId, metricsCollector, logInvalidKeyAttempt } from '../src/utils/logger.js';

describe('Logger Utility', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Logger', () => {
    it('should log messages with default INFO level', () => {
      const logger = new Logger('test-service');
      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logEntry.level).toBe('INFO');
      expect(logEntry.service).toBe('test-service');
      expect(logEntry.message).toBe('test message');
      expect(typeof logEntry.timestamp).toBe('string');
    });

    it('should threshold logs based on minLevel', () => {
      const logger = new Logger('test-service', LogLevel.WARN);

      logger.debug('debug msg');
      logger.info('info msg');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      logger.warn('warn msg');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);

      logger.error('error msg');
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should include additional context in logs', () => {
      const logger = new Logger('test-service');
      logger.info('user login', { userId: '123', ip: '127.0.0.1' });

      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.userId).toBe('123');
      expect(logEntry.ip).toBe('127.0.0.1');
      expect(logEntry.message).toBe('user login');
    });

    it('should create a child logger with appended service name', () => {
      const logger = new Logger('parent-service');
      const childLogger = logger.child('child-module');

      childLogger.info('child message');

      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.service).toBe('parent-service:child-module');
    });

    it('should generate a RequestLogger', () => {
      const logger = new Logger('test-service');
      const reqLogger = logger.withRequestId('req_abc');

      expect(reqLogger).toBeInstanceOf(RequestLogger);
    });
  });

  describe('RequestLogger', () => {
    it('should include request_id in all logs', () => {
      const parentLogger = new Logger('api');
      const reqLogger = new RequestLogger(parentLogger, 'req_123');

      reqLogger.info('api call');
      reqLogger.warn('slow response', { ms: 500 });
      reqLogger.error('db error');
      reqLogger.debug('verbose details');

      // debug is thresholded by default parent INFO level
      expect(consoleLogSpy).toHaveBeenCalledTimes(3);

      const infoEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(infoEntry.request_id).toBe('req_123');
      expect(infoEntry.level).toBe('INFO');

      const warnEntry = JSON.parse(consoleLogSpy.mock.calls[1][0]);
      expect(warnEntry.request_id).toBe('req_123');
      expect(warnEntry.level).toBe('WARN');
      expect(warnEntry.ms).toBe(500);

      const errorEntry = JSON.parse(consoleLogSpy.mock.calls[2][0]);
      expect(errorEntry.request_id).toBe('req_123');
      expect(errorEntry.level).toBe('ERROR');
    });
  });

  describe('generateRequestId', () => {
    it('should generate a valid request ID starting with req_', () => {
      const reqId = generateRequestId();
      expect(typeof reqId).toBe('string');
      expect(reqId.startsWith('req_')).toBe(true);

      const reqId2 = generateRequestId();
      expect(reqId).not.toBe(reqId2); // Ensure uniqueness
    });
  });

  describe('MetricsCollector', () => {
    it('should aggregate metrics and request durations correctly', () => {
      metricsCollector.recordMessage('actionA');
      metricsCollector.recordMessage('actionA');
      metricsCollector.recordMessage('actionB');

      metricsCollector.recordRequest(10);
      metricsCollector.recordRequest(50);
      metricsCollector.recordRequest(100);

      const metrics = metricsCollector.getMetrics({}, 5);

      expect(metrics.connectedAgents).toBe(5);
      expect(metrics.messagesProcessed).toEqual({ actionA: 2, actionB: 1 });
      expect(metrics.requestsTotal).toBeGreaterThanOrEqual(3); // might include data from other tests if singleton isn't reset, but we check presence

      // Histogram check for new requests
      expect(metrics.requestHistogram[10]).toBeGreaterThanOrEqual(1);
      expect(metrics.requestHistogram[50]).toBeGreaterThanOrEqual(2);
      expect(metrics.requestHistogram[100]).toBeGreaterThanOrEqual(3);
    });

    it('should record and reset errors correctly', () => {
      // Use fake timers specifically for this test since MetricsCollector relies heavily on Date.now()
      vi.useFakeTimers();

      // Setting fake time directly
      vi.setSystemTime(new Date(Date.now()));

      const initialErrors = metricsCollector.getRecentErrorCount();
      metricsCollector.recordError();
      metricsCollector.recordError();
      expect(metricsCollector.getRecentErrorCount()).toBe(initialErrors + 2);

      // Advance time by 6 minutes (> 5 min threshold)
      vi.advanceTimersByTime(6 * 60 * 1000);

      metricsCollector.recordError();

      // Should have reset before the new error, so count is 1
      expect(metricsCollector.getRecentErrorCount()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('logInvalidKeyAttempt', () => {
    it('should log attempt and record an error', () => {
      const initialErrors = metricsCollector.getRecentErrorCount();

      logInvalidKeyAttempt('test-api-key-123', '192.168.1.1', '/api/v1/resource', 'GET');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logEntry.level).toBe('WARN');
      expect(logEntry.service).toBe('relay:rest');
      expect(logEntry.message).toBe('Invalid API key attempt');
      expect(logEntry.maskedKey).toBe('test...');
      expect(logEntry.ip).toBe('192.168.1.1');
      expect(logEntry.path).toBe('/api/v1/resource');
      expect(logEntry.method).toBe('GET');

      expect(metricsCollector.getRecentErrorCount()).toBe(initialErrors + 1);
    });

    it('should handle undefined api keys safely', () => {
      logInvalidKeyAttempt(undefined, '192.168.1.2', '/api/v1/data', 'POST');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logEntry.maskedKey).toBe('none');
    });
  });
});
