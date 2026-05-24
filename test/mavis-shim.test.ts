import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import { MavisShim } from '../src/shims/mavis';

// Mock the child_process module
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn()
}));

describe('MavisShim Security', () => {
  let shim: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Create shim with test config
    shim = new MavisShim({
      relayUrl: 'ws://localhost:3000/ws',
      agentId: 'test-agent',
      capabilities: [],
      mavisAgentName: 'test-mavis',
      mavisSessionId: 'test-session-123',
      timeoutMs: 1000
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should use execFile with an array of arguments to prevent command injection', async () => {
    // Setup execFile mock to instantly resolve
    const mockExecFile = vi.mocked(childProcess.execFile);
    mockExecFile.mockImplementation((file: string, args: any, options: any, callback: any) => {
      callback(null, 'mock stdout', '');
      return {} as any;
    });

    const maliciousDescription = 'do task"; rm -rf /; echo "hacked';

    // We access the private method for testing
    const result = await shim.executeViaMavis({
      taskId: 'test-task',
      type: 'test-type',
      description: maliciousDescription,
      context: {}
    });

    // Verify it succeeded
    expect(result.success).toBe(true);
    expect(result.data).toBe('mock stdout');

    // Verify execFile was called correctly
    expect(mockExecFile).toHaveBeenCalledTimes(1);

    const [file, args, options] = mockExecFile.mock.calls[0];

    // Check the executable
    expect(file).toBe('mavis');

    // Check the arguments array - crucial for security verification
    expect(args).toEqual([
      'communication',
      'send',
      '--to',
      'test-mavis',
      '--session',
      'test-session-123',
      '--command',
      'prompt',
      '--content',
      `Task from DAP relay: ${maliciousDescription}`
    ]);

    // The malicious string should be treated as a single literal argument,
    // not executable code, which proves command injection is prevented.
    const contentArg = args[args.length - 1];
    expect(contentArg).toContain('rm -rf /');
    expect(contentArg).toContain('echo "hacked');
  });
});
