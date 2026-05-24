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

interface WorkerConfig {
  taskRoot: string;
  workdir: string;
  codexBin: string;
  pollIntervalMs: number;
  once: boolean;
  sandbox: string;
  approval: string;
  model?: string;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function parseArgs(args: string[]): WorkerConfig {
  const config: WorkerConfig = {
    taskRoot: join(homedir(), '.codex', 'tasks'),
    workdir: process.cwd(),
    codexBin: process.env.CODEX_BIN || 'codex',
    pollIntervalMs: 1000,
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

async function runCodex(config: WorkerConfig, task: Task): Promise<CommandResult> {
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

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: err.message,
      });
    });

    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function ensureDirs(config: WorkerConfig): Promise<void> {
  await mkdir(join(config.taskRoot, 'incoming'), { recursive: true });
  await mkdir(join(config.taskRoot, 'processing'), { recursive: true });
  await mkdir(join(config.taskRoot, 'results'), { recursive: true });
}

async function processOne(config: WorkerConfig): Promise<boolean> {
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

  const result = await runCodex(config, task);
  const success = result.exitCode === 0 && !result.error;

  await writeFile(resultPath, JSON.stringify({
    success,
    data: {
      stdout: result.stdout,
      exitCode: result.exitCode,
    },
    error: success ? undefined : result.error || result.stderr || `Codex exited with ${result.exitCode}`,
    executionTimeMs: undefined,
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
