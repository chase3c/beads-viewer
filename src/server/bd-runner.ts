import { spawn } from 'node:child_process';

export type BdOperation =
  | { kind: 'version' }
  | { kind: 'context' }
  | { kind: 'list'; maxRows: number }
  | { kind: 'blocked' }
  | { kind: 'ready'; maxRows: number }
  | { kind: 'show'; id: string };

export interface BdRunnerOptions {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxQueueSize?: number;
  terminationGraceMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class BdRunnerError extends Error {
  constructor(
    message: string,
    public readonly code:
      'spawn' | 'exit' | 'timeout' | 'oversized' | 'malformed' | 'busy' | 'invalid',
  ) {
    super(message);
    this.name = 'BdRunnerError';
  }
}

const ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isValidIssueId(id: string): boolean {
  return ISSUE_ID.test(id);
}

function assertMaxRows(maxRows: number) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new BdRunnerError('maxRows must be a positive integer', 'invalid');
  }
}

export function argsForOperation(operation: BdOperation): string[] {
  const prefix = ['--readonly', '--json'];
  switch (operation.kind) {
    case 'version':
      return [...prefix, 'version'];
    case 'context':
      return [...prefix, 'context'];
    case 'list': {
      assertMaxRows(operation.maxRows);
      return [
        ...prefix,
        'list',
        '--all',
        '--brief',
        '--flat',
        '--limit',
        '0',
        '--max-rows',
        String(operation.maxRows),
      ];
    }
    case 'blocked':
      return [...prefix, 'blocked'];
    case 'ready':
      assertMaxRows(operation.maxRows);
      return [
        ...prefix,
        'ready',
        '--brief',
        '--limit',
        '0',
        '--max-rows',
        String(operation.maxRows),
      ];
    case 'show':
      if (!isValidIssueId(operation.id)) throw new BdRunnerError('Invalid issue ID', 'invalid');
      return [...prefix, 'show', `--id=${operation.id}`, '--brief-deps'];
  }
}

interface Execution {
  result: Promise<unknown>;
  drained: Promise<void>;
}

export class BdRunner {
  private queue: Promise<void> = Promise.resolve();
  private pendingCount = 0;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly maxQueueSize: number;
  private readonly terminationGraceMs: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly repositoryRoot: string,
    options: BdRunnerOptions = {},
  ) {
    this.executable = options.executable ?? 'bd';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 12 * 1024 * 1024;
    this.maxQueueSize = options.maxQueueSize ?? 32;
    this.terminationGraceMs = options.terminationGraceMs ?? 500;
    if (!Number.isSafeInteger(this.maxQueueSize) || this.maxQueueSize < 1) {
      throw new Error('maxQueueSize must be a positive integer');
    }
    this.env = { ...process.env, ...options.env, BD_JSON_ENVELOPE: '1' };
    delete this.env.BEADS_DB;
  }

  run(operation: BdOperation): Promise<unknown> {
    if (this.pendingCount >= this.maxQueueSize) {
      return Promise.reject(new BdRunnerError('Beads command queue is full', 'busy'));
    }
    this.pendingCount += 1;

    let resolveResult!: (value: unknown) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<unknown>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const scheduled = this.queue.then(async () => {
      let execution: Execution;
      try {
        execution = this.execute(operation);
      } catch (error) {
        rejectResult(error);
        return;
      }
      execution.result.then(resolveResult, rejectResult);
      await execution.drained;
    });
    const drained = scheduled.finally(() => {
      this.pendingCount -= 1;
    });
    this.queue = drained.catch(() => undefined);
    return result;
  }

  private execute(operation: BdOperation): Execution {
    const args = argsForOperation(operation);
    let child: ReturnType<typeof spawn>;
    let resolveResult!: (value: unknown) => void;
    let rejectResult!: (reason: unknown) => void;
    let resolveDrained!: () => void;
    const result = new Promise<unknown>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const drained = new Promise<void>((resolve) => {
      resolveDrained = resolve;
    });

    try {
      child = spawn(this.executable, args, {
        cwd: this.repositoryRoot,
        env: this.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      rejectResult(new BdRunnerError('Unable to start the bd executable', 'spawn'));
      resolveDrained();
      return { result, drained };
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let resultSettled = false;
    let drainSettled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      fail(new BdRunnerError('Beads command timed out', 'timeout'));
    }, this.timeoutMs);
    timeoutTimer.unref();

    const finishDrain = () => {
      if (drainSettled) return;
      drainSettled = true;
      if (killTimer) clearTimeout(killTimer);
      if (drainTimer) clearTimeout(drainTimer);
      resolveDrained();
    };

    const terminate = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), this.terminationGraceMs);
      killTimer.unref();
      drainTimer = setTimeout(
        () => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finishDrain();
        },
        this.terminationGraceMs * 2 + 250,
      );
      drainTimer.unref();
    };

    const fail = (error: BdRunnerError) => {
      if (resultSettled) return;
      resultSettled = true;
      clearTimeout(timeoutTimer);
      rejectResult(error);
      terminate();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (resultSettled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > this.maxOutputBytes) {
        fail(new BdRunnerError('Beads output exceeded the configured limit', 'oversized'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 64 * 1024) return;
      const remaining = 64 * 1024 - stderrBytes;
      const retained = chunk.subarray(0, remaining);
      stderrBytes += retained.length;
      stderr.push(retained);
    });
    child.on('error', () => {
      if (!resultSettled) {
        resultSettled = true;
        clearTimeout(timeoutTimer);
        rejectResult(new BdRunnerError('Unable to start the bd executable', 'spawn'));
      }
      finishDrain();
    });
    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (!resultSettled) {
        resultSettled = true;
        if (code !== 0) {
          const summary = Buffer.concat(stderr).toString('utf8').trim().split('\n')[0];
          rejectResult(
            new BdRunnerError(
              summary
                ? `bd exited unsuccessfully: ${summary.slice(0, 240)}`
                : 'bd exited unsuccessfully',
              'exit',
            ),
          );
        } else {
          try {
            resolveResult(JSON.parse(Buffer.concat(stdout).toString('utf8')));
          } catch {
            rejectResult(new BdRunnerError('bd returned malformed JSON', 'malformed'));
          }
        }
      }
      finishDrain();
    });

    return { result, drained };
  }
}
