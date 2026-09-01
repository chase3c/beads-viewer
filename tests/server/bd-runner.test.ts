import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argsForOperation, BdRunner } from '../../src/server/bd-runner.js';

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('bd command policy', () => {
  it('constructs only fixed read-only JSON commands', () => {
    expect(argsForOperation({ kind: 'version' })).toEqual(['--readonly', '--json', 'version']);
    expect(argsForOperation({ kind: 'context' })).toEqual(['--readonly', '--json', 'context']);
    expect(argsForOperation({ kind: 'list', maxRows: 5000 })).toEqual([
      '--readonly',
      '--json',
      'list',
      '--all',
      '--brief',
      '--flat',
      '--limit',
      '0',
      '--max-rows',
      '5000',
    ]);
    expect(argsForOperation({ kind: 'blocked' })).toEqual(['--readonly', '--json', 'blocked']);
    expect(argsForOperation({ kind: 'ready', maxRows: 5000 })).toEqual([
      '--readonly',
      '--json',
      'ready',
      '--brief',
      '--limit',
      '0',
      '--max-rows',
      '5000',
    ]);
    expect(argsForOperation({ kind: 'show', id: 'agents-31q.2' })).toEqual([
      '--readonly',
      '--json',
      'show',
      '--id=agents-31q.2',
      '--brief-deps',
    ]);
    expect(() => argsForOperation({ kind: 'show', id: 'x; rm -rf /' })).toThrow('Invalid issue ID');
  });
});

describe('BdRunner', () => {
  it('serializes subprocesses and removes BEADS_DB', async () => {
    const { directory, executable } = await fakeBd();
    const log = path.join(directory, 'calls.log');
    const runner = new BdRunner(directory, {
      executable,
      env: { TEST_MODE: 'delay', TEST_LOG: log, BEADS_DB: 'must-not-leak' },
    });
    await Promise.all([runner.run({ kind: 'context' }), runner.run({ kind: 'version' })]);
    expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
      'start',
      'end',
      'start',
      'end',
    ]);
  });

  it('fails malformed, oversized, and timed-out commands predictably', async () => {
    const { directory, executable } = await fakeBd();
    await expect(
      new BdRunner(directory, { executable, env: { TEST_MODE: 'malformed' } }).run({
        kind: 'context',
      }),
    ).rejects.toMatchObject({ code: 'malformed' });

    const oversized = new BdRunner(directory, {
      executable,
      maxOutputBytes: 30,
      timeoutMs: 200,
      terminationGraceMs: 25,
      env: { TEST_MODE: 'oversized_stall' },
    });
    await expect(oversized.run({ kind: 'context' })).rejects.toMatchObject({ code: 'oversized' });

    const timeout = new BdRunner(directory, {
      executable,
      timeoutMs: 20,
      terminationGraceMs: 100,
      env: { TEST_MODE: 'timeout_stall' },
    });
    const startedAt = Date.now();
    await expect(timeout.run({ kind: 'context' })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(90);
  });

  it('bounds queued work with backpressure', async () => {
    const { directory, executable } = await fakeBd();
    const runner = new BdRunner(directory, {
      executable,
      maxQueueSize: 1,
      env: { TEST_MODE: 'delay', TEST_LOG: path.join(directory, 'queue.log') },
    });
    const first = runner.run({ kind: 'context' });
    await expect(runner.run({ kind: 'version' })).rejects.toMatchObject({ code: 'busy' });
    await expect(first).resolves.toEqual({});
  });
});

async function fakeBd() {
  const directory = await mkdtemp(path.join(tmpdir(), 'beads-viewer-test-'));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, 'bd-fake');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const mode = process.env.TEST_MODE;
if (process.env.BEADS_DB) { process.stderr.write('BEADS_DB leaked'); process.exit(9); }
if (mode === 'malformed') process.stdout.write('not json');
else if (mode === 'oversized_stall') {
  process.on('SIGTERM', () => {});
  process.stdout.write(JSON.stringify({data:'x'.repeat(500)}));
  setInterval(() => {}, 1000);
}
else if (mode === 'timeout_stall') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
else if (mode === 'delay') {
  fs.appendFileSync(process.env.TEST_LOG, 'start\\n');
  setTimeout(() => { fs.appendFileSync(process.env.TEST_LOG, 'end\\n'); process.stdout.write('{}'); }, 35);
} else process.stdout.write('{}');
`,
  );
  await chmod(executable, 0o755);
  return { directory, executable };
}
