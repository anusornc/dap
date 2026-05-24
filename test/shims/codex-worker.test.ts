import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ensureDirs,
  parseArgs,
  processOne,
  recoverStaleProcessing,
  runCodex,
  WorkerConfig,
} from '../../src/shims/codex-worker.js';

describe('Codex worker', () => {
  let taskRoot: string;
  let workdir: string;

  beforeEach(async () => {
    taskRoot = await mkdtemp(join(tmpdir(), 'dap-codex-worker-'));
    workdir = await mkdtemp(join(tmpdir(), 'dap-codex-workdir-'));
  });

  afterEach(() => {
    // Temporary directories live under /tmp and are unique per test.
  });

  function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
    return {
      taskRoot,
      workdir,
      codexBin: 'codex',
      pollIntervalMs: 1000,
      timeoutMs: 1000,
      killGraceMs: 1000,
      outputLimitBytes: 200000,
      allowedTypes: [],
      once: true,
      sandbox: 'workspace-write',
      approval: 'never',
      ...overrides,
    };
  }

  async function writeTask(type = 'allowed-task'): Promise<string> {
    await ensureDirs(config());
    const taskId = crypto.randomUUID();
    await writeFile(join(taskRoot, 'incoming', `${taskId}.json`), JSON.stringify({
      taskId,
      description: 'do work',
      type,
      priority: 1,
      context: { source: 'test' },
    }, null, 2));
    return taskId;
  }

  async function writeExecutable(name: string, source: string): Promise<string> {
    const path = join(workdir, name);
    await writeFile(path, `#!/usr/bin/env node\n${source}`);
    await chmod(path, 0o755);
    return path;
  }

  it('parses worker hardening options', () => {
    const parsed = parseArgs([
      '--timeout-ms', '50',
      '--kill-grace-ms', '25',
      '--output-limit', '10',
      '--allow-type', 'a,b',
      '--allow-type', 'c',
    ]);

    expect(parsed.timeoutMs).toBe(50);
    expect(parsed.killGraceMs).toBe(25);
    expect(parsed.outputLimitBytes).toBe(10);
    expect(parsed.allowedTypes).toEqual(['a', 'b', 'c']);
  });

  it('rejects tasks outside the allowlist without running Codex', async () => {
    const taskId = await writeTask('blocked-task');

    const processed = await processOne(config({
      allowedTypes: ['allowed-task'],
    }));

    expect(processed).toBe(true);
    const result = JSON.parse(await readFile(join(taskRoot, 'results', `${taskId}.json`), 'utf8'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task type not allowed: blocked-task');
    expect(existsSync(join(taskRoot, 'processing', `${taskId}.json`))).toBe(false);
  });

  it('limits captured Codex output', async () => {
    const taskId = await writeTask();
    const codexBin = await writeExecutable('fake-codex-output.js', "process.stdout.write('abcdefghijklmnopqrstuvwxyz');");

    const processed = await processOne(config({
      codexBin,
      outputLimitBytes: 25,
    }));

    expect(processed).toBe(true);
    const result = JSON.parse(await readFile(join(taskRoot, 'results', `${taskId}.json`), 'utf8'));
    expect(result.success).toBe(true);
    expect(result.data.stdout).toContain('...[truncated]');
    expect(result.data.stdout.startsWith('abcdefgh')).toBe(true);
    expect(Buffer.byteLength(result.data.stdout, 'utf8')).toBeLessThanOrEqual(25);
  });

  it('applies output limits as a byte cap for multi-byte output', async () => {
    const taskId = await writeTask();
    const codexBin = await writeExecutable('fake-codex-multibyte.js', "process.stdout.write('คคคคคคคคคค');");

    const processed = await processOne(config({
      codexBin,
      outputLimitBytes: 20,
    }));

    expect(processed).toBe(true);
    const result = JSON.parse(await readFile(join(taskRoot, 'results', `${taskId}.json`), 'utf8'));
    expect(Buffer.byteLength(result.data.stdout, 'utf8')).toBeLessThanOrEqual(20);
  });

  it('passes approval policy through current Codex exec config', async () => {
    const codexBin = await writeExecutable(
      'fake-codex-args.js',
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));'
    );

    const result = await runCodex(config({ codexBin }), {
      taskId: 'args-task',
      description: 'inspect args',
      type: 'allowed-task',
    });

    expect(result.exitCode).toBe(0);
    const args = JSON.parse(result.stdout);
    expect(args).toContain('--config');
    expect(args).toContain('approval_policy="never"');
    expect(args).not.toContain('--ask-for-approval');
  });

  it('times out long-running Codex executions', async () => {
    const codexBin = await writeExecutable('fake-codex-timeout.js', 'setTimeout(() => {}, 5000);');

    const result = await runCodex(config({
      codexBin,
      timeoutMs: 20,
    }), {
      taskId: 'timeout-task',
      description: 'hang',
      type: 'allowed-task',
    });

    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('Codex timed out after 20ms');
  });

  it('waits for stubborn Codex processes to be killed before resolving timeout', async () => {
    const marker = join(workdir, 'sigkill-marker');
    const codexBin = await writeExecutable('fake-codex-ignore-term.js', [
      "const fs = require('fs');",
      "process.on('SIGTERM', () => {});",
      `process.on('exit', () => fs.writeFileSync(${JSON.stringify(marker)}, 'closed'));`,
      'setTimeout(() => {}, 5000);',
    ].join('\n'));
    const start = Date.now();

    const result = await runCodex(config({
      codexBin,
      timeoutMs: 20,
      killGraceMs: 20,
    }), {
      taskId: 'timeout-task',
      description: 'hang',
      type: 'allowed-task',
    });

    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('Codex timed out after 20ms');
    expect(existsSync(marker)).toBe(false);
  });

  it('recovers stale processing tasks back to incoming', async () => {
    await ensureDirs(config());
    await mkdir(join(taskRoot, 'processing'), { recursive: true });
    await writeFile(join(taskRoot, 'processing', 'stale-task.json'), JSON.stringify({
      taskId: 'stale-task',
      description: 'resume',
      type: 'allowed-task',
    }));

    await recoverStaleProcessing(config());

    expect(existsSync(join(taskRoot, 'incoming', 'stale-task.json'))).toBe(true);
    expect(existsSync(join(taskRoot, 'processing', 'stale-task.json'))).toBe(false);
  });
});
