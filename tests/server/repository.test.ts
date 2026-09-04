import { describe, expect, it, vi } from 'vitest';
import type { BdOperation } from '../../src/server/bd-runner.js';
import { RepositoryService } from '../../src/server/repository.js';

class FakeRunner {
  run = vi.fn(async (operation: BdOperation): Promise<unknown> => {
    if (operation.kind === 'version') return { schema_version: 1, data: { version: '1.2.2' } };
    if (operation.kind === 'context') {
      return {
        schema_version: 1,
        data: { repo_root: '/repo', backend: 'dolt', dolt_mode: 'embedded' },
      };
    }
    if (operation.kind === 'list') {
      return {
        schema_version: 1,
        data: [
          { id: 'x-1', title: 'Blocked epic', issue_type: 'epic', labels: [] },
          { id: 'x-2', title: 'Ready task', issue_type: 'task', labels: [] },
        ],
      };
    }
    if (operation.kind === 'blocked') {
      return { schema_version: 1, data: [{ id: 'x-1', title: 'Blocked epic' }] };
    }
    if (operation.kind === 'ready') {
      return { schema_version: 1, data: [{ id: 'x-2', title: 'Ready task' }] };
    }
    return { schema_version: 1, data: [{ id: operation.id, title: 'Epic', description: 'Full' }] };
  });
}

describe('RepositoryService', () => {
  it('coalesces refreshes and annotates derived blocked/ready state before counting', async () => {
    const runner = new FakeRunner();
    const repository = new RepositoryService('/repo', runner);
    const [left, right] = await Promise.all([repository.getIndex(true), repository.getIndex(true)]);
    expect(left).toBe(right);
    expect(left.diagnostics.bdVersion).toBe('1.2.2');
    expect(runner.run).toHaveBeenCalledWith({ kind: 'list', maxRows: 5_001 });
    expect(runner.run).toHaveBeenCalledWith({ kind: 'ready', maxRows: 5_001 });
    expect(left.issues).toEqual([
      expect.objectContaining({ id: 'x-1', is_blocked: true, is_ready: false }),
      expect.objectContaining({ id: 'x-2', is_blocked: false, is_ready: true }),
    ]);
    expect(left.counts).toMatchObject({ blocked: 1, ready: 1 });
    expect(runner.run).toHaveBeenCalledTimes(5);
  });

  it('rejects a capped list when one extra issue proves the repository exceeds the limit', async () => {
    const runner = new FakeRunner();
    const repository = new RepositoryService('/repo', runner, 1);

    await expect(repository.getIndex()).rejects.toMatchObject({ code: 'issue_limit' });
    expect(runner.run).toHaveBeenCalledWith({ kind: 'list', maxRows: 2 });
  });

  it('lets explicit empty detail arrays clear stale cached arrays', async () => {
    const runner = new FakeRunner();
    runner.run.mockImplementation(async (operation: BdOperation) => {
      if (operation.kind === 'version') return { data: { version: '1.2.1' }, schema_version: 1 };
      if (operation.kind === 'context') return { data: { repo_root: '/repo' }, schema_version: 1 };
      if (operation.kind === 'list') {
        return {
          data: [
            {
              id: 'x-1',
              title: 'Epic',
              labels: ['stale'],
              dependencies: [{ depends_on_id: 'x-2', type: 'blocks' }],
              dependents: [{ id: 'x-3', dependency_type: 'blocks' }],
            },
          ],
          schema_version: 1,
        };
      }
      if (operation.kind === 'blocked' || operation.kind === 'ready') {
        return { data: [], schema_version: 1 };
      }
      return {
        data: [
          {
            id: 'x-1',
            title: 'Epic',
            labels: [],
            dependencies: [],
            dependents: [],
            is_blocked: true,
            is_ready: true,
          },
        ],
        schema_version: 1,
      };
    });
    const repository = new RepositoryService('/repo', runner);
    await repository.getIndex();
    const detail = await repository.getIssue('x-1');
    expect(detail.issue.labels).toEqual([]);
    expect(detail.issue.dependencies).toEqual([]);
    expect(detail.issue.dependents).toEqual([]);
    expect(detail.issue.is_blocked).toBe(false);
    expect(detail.issue.is_ready).toBe(false);
  });

  it.each(['list', 'blocked', 'ready'] as const)(
    'rejects malformed %s command responses rather than silently miscounting',
    async (malformedOperation) => {
      const runner = new FakeRunner();
      const normalRun = runner.run.getMockImplementation()!;
      runner.run.mockImplementation(async (operation: BdOperation) =>
        operation.kind === malformedOperation
          ? { data: { wrong: true }, schema_version: 1 }
          : normalRun(operation),
      );
      await expect(new RepositoryService('/repo', runner).getIndex()).rejects.toMatchObject({
        code: 'unsupported_contract',
      });
    },
  );
});
