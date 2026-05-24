/**
 * Codex Task Worker
 * Watches Codex shim task files, runs Codex non-interactively, and writes results.
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { Task } from './codex.js';

export interface WorkerConfig {
  taskRoot: string;
  workdir: string;
  codexBin: string;
  pollIntervalMs: number;
  timeoutMs: number;
  killGraceMs: number;
  outputLimitBytes: number;
  allowedTypes: string[];
  once: boolean;
  sandbox: string;
  approval: string;
  model?: string;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export function parseArgs(args: string[]): WorkerConfig {
  const config: WorkerConfig = {
    taskRoot: join(homedir(), '.codex', 'tasks'),
    workdir: process.cwd(),
    codexBin: process.env.CODEX_BIN || 'codex',
    pollIntervalMs: 1000,
    timeoutMs: Number(process.env.CODEX_WORKER_TIMEOUT_MS || 300000),
    killGraceMs: Number(process.env.CODEX_WORKER_KILL_GRACE_MS || 5000),
    outputLimitBytes: Number(process.env.CODEX_WORKER_OUTPUT_LIMIT_BYTES || 200000),
    allowedTypes: (process.env.CODEX_WORKER_ALLOWED_TYPES || '')
      .split(',')
      .map(type => type.trim())
      .filter(Boolean),
    once: false,
    sandbox: 'workspace-write',
    approval: 'never',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--task-dir':
        config.taskRoot = args[++i];
        break;
      case '--workdir':
        config.workdir = args[++i];
        break;
      case '--codex-bin':
        config.codexBin = args[++i];
        break;
      case '--poll-interval':
        config.pollIntervalMs = Number(args[++i]);
        break;
      case '--timeout-ms':
        config.timeoutMs = Number(args[++i]);
        break;
      case '--kill-grace-ms':
        config.killGraceMs = Number(args[++i]);
        break;
      case '--output-limit':
        config.outputLimitBytes = Number(args[++i]);
        break;
      case '--allow-type':
        config.allowedTypes.push(...args[++i].split(',').map(type => type.trim()).filter(Boolean));
        break;
      case '--sandbox':
        config.sandbox = args[++i];
        break;
      case '--approval':
        config.approval = args[++i];
        break;
      case '--model':
        config.model = args[++i];
        break;
      case '--once':
        config.once = true;
        break;
    }
  }

  return config;
}

function buildPrompt(task: Task): string {
  return [
    'You are a Codex worker processing a Distributed Agent Protocol task.',
    '',
    `Task ID: ${task.taskId}`,
    `Type: ${task.type}`,
    `Priority: ${task.priority ?? 'normal'}`,
    '',
    'Description:',
    task.description,
    '',
    'Context JSON:',
    JSON.stringify(task.context ?? {}, null, 2),
    '',
    'Complete the task in the configured working directory. Return a concise final result.',
  ].join('\n');
}

function appendLimited(current: string, chunk: string, limit: number): string {
  if (limit <= 0) return '';
  const marker = '\n...[truncated]';
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= limit) return next;

  const markerBytes = Buffer.byteLength(marker, 'utf8');
  if (limit <= markerBytes) {
    return Buffer.from(marker, 'utf8').subarray(0, limit).toString('utf8');
  }

  const prefixLimit = limit - markerBytes;
  let prefix = '';
  for (const char of next) {
    if (Buffer.byteLength(prefix + char, 'utf8') > prefixLimit) break;
    prefix += char;
  }

  return prefix + marker;
}

export async function runCodex(config: WorkerConfig, task: Task): Promise<CommandResult> {
  const args = [
    'exec',
    '--cd',
    config.workdir,
    '--sandbox',
    config.sandbox,
    '--ask-for-approval',
    config.approval,
  ];

  if (config.model) {
    args.push('--model', config.model);
  }

  args.push(buildPrompt(task));

  return new Promise((resolve) => {
    const child = spawn(config.codexBin, args, {
      cwd: config.workdir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, config.killGraceMs);
    }, config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString(), config.outputLimitBytes);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString(), config.outputLimitBytes);
    });

    child.on('error', (err) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        error: err.message,
      });
    });

    child.on('close', (exitCode) => {
      if (timedOut) {
        finish({
          exitCode: null,
          stdout,
          stderr,
          error: `Codex timed out after ${config.timeoutMs}ms`,
        });
        return;
      }

      finish({ exitCode, stdout, stderr });
    });
  });
}

export async function ensureDirs(config: WorkerConfig): Promise<void> {
  await mkdir(join(config.taskRoot, 'incoming'), { recursive: true });
  await mkdir(join(config.taskRoot, 'processing'), { recursive: true });
  await mkdir(join(config.taskRoot, 'results'), { recursive: true });
}

export async function recoverStaleProcessing(config: WorkerConfig): Promise<void> {
  const incomingDir = join(config.taskRoot, 'incoming');
  const processingDir = join(config.taskRoot, 'processing');
  const files = (await readdir(processingDir))
    .filter(file => file.endsWith('.json'))
    .sort();

  for (const file of files) {
    const incomingPath = join(incomingDir, file);
    if (existsSync(incomingPath)) continue;
    await rename(join(processingDir, file), incomingPath).catch(() => {});
  }
}

export async function processOne(config: WorkerConfig): Promise<boolean> {
  const incomingDir = join(config.taskRoot, 'incoming');
  const processingDir = join(config.taskRoot, 'processing');
  const resultsDir = join(config.taskRoot, 'results');
  const files = (await readdir(incomingDir))
    .filter(file => file.endsWith('.json'))
    .sort();

  const file = files[0];
  if (!file) return false;

  const incomingPath = join(incomingDir, file);
  const processingPath = join(processingDir, file);
  const resultPath = join(resultsDir, file);

  try {
    await rename(incomingPath, processingPath);
  } catch {
    return false;
  }

  const raw = await readFile(processingPath, 'utf-8');
  const task = JSON.parse(raw) as Task;

  console.log(`[Codex Worker] Running task ${task.taskId}: ${task.type}`);

  const startTime = Date.now();
  if (config.allowedTypes.length > 0 && !config.allowedTypes.includes(task.type)) {
    await writeFile(resultPath, JSON.stringify({
      success: false,
      data: { exitCode: null },
      error: `Task type not allowed: ${task.type}`,
      executionTimeMs: Date.now() - startTime,
    }, null, 2));

    await unlink(processingPath).catch(() => {});
    console.log(`[Codex Worker] Rejected task ${task.taskId}: ${task.type}`);
    return true;
  }

  const result = await runCodex(config, task);
  const success = result.exitCode === 0 && !result.error;

  await writeFile(resultPath, JSON.stringify({
    success,
    data: {
      stdout: result.stdout,
      exitCode: result.exitCode,
    },
    error: success ? undefined : result.error || result.stderr || `Codex exited with ${result.exitCode}`,
    executionTimeMs: Date.now() - startTime,
  }, null, 2));

  await unlink(processingPath).catch(() => {});
  console.log(`[Codex Worker] Wrote result for ${task.taskId}`);
  return true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function runCodexWorker(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  if (!existsSync(config.workdir)) {
    throw new Error(`Working directory does not exist: ${config.workdir}`);
  }

  await ensureDirs(config);
  await recoverStaleProcessing(config);

  console.log(`[Codex Worker] Watching ${join(config.taskRoot, 'incoming')}`);
  console.log(`[Codex Worker] Workdir ${config.workdir}`);

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });

  do {
    const processed = await processOne(config);
    if (config.once) break;
    if (!processed) await sleep(config.pollIntervalMs);
  } while (!stopping);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexWorker().catch((err) => {
    console.error('[Codex Worker] Fatal:', err);
    process.exit(1);
  });
}
