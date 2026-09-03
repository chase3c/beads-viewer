import { describe, expect, it } from 'vitest';
import type { IssueRecord } from '../../src/shared/contracts.js';
import {
  buildHierarchy,
  compareIssuesByExecution,
  epicBlockingDag,
  epicDependencyEdges,
  epicWorkItems,
  issueRelationships,
  summarizeIssues,
  visibleIssueIds,
} from '../../src/shared/model.js';

const issue = (id: string, parent?: string, title = id): IssueRecord => ({
  id,
  parent,
  title,
  labels: [],
  dependencies: [],
  dependents: [],
});

describe('hierarchy model', () => {
  it('sorts active execution value before priority and always puts closed work last', () => {
    const inProgress = { ...issue('in-progress'), status: 'in_progress', priority: 4 };
    const open = { ...issue('open'), status: 'open', priority: 3 };
    const blocked = { ...issue('blocked'), status: 'open', is_blocked: true, priority: 0 };
    const deferred = { ...issue('deferred'), status: 'deferred', priority: 0 };
    const closed = { ...issue('closed'), status: 'closed', priority: 0 };
    const hierarchy = buildHierarchy([closed, deferred, blocked, open, inProgress]);

    expect(hierarchy.roots).toEqual(['in-progress', 'open', 'blocked', 'deferred', 'closed']);
    expect(compareIssuesByExecution(open, closed)).toBeLessThan(0);
    expect(
      compareIssuesByExecution(
        { ...issue('alpha', undefined, 'Same title'), status: 'open', priority: 2 },
        { ...issue('beta', undefined, 'Same title'), status: 'open', priority: 2 },
      ),
    ).toBeLessThan(0);
  });

  it('supports deep non-epic trees and preserves matching ancestors', () => {
    const issues = [
      issue('epic'),
      issue('feature', 'epic'),
      issue('decision', 'feature'),
      issue('task', 'decision', 'Needle task'),
    ];
    const hierarchy = buildHierarchy(issues);
    expect(hierarchy.roots).toEqual(['epic']);
    expect(hierarchy.childrenById.get('decision')).toEqual(['task']);
    expect([...visibleIssueIds(hierarchy, { query: 'needle' })]).toEqual(
      expect.arrayContaining(['epic', 'feature', 'decision', 'task']),
    );
  });

  it('surfaces orphans and breaks parent cycles safely', () => {
    const hierarchy = buildHierarchy([
      issue('orphan', 'missing'),
      issue('a', 'b'),
      issue('b', 'a'),
      issue('child', 'a'),
    ]);
    expect(hierarchy.orphanIds.has('orphan')).toBe(true);
    expect(hierarchy.cycleIds).toEqual(new Set(['a', 'b']));
    expect(hierarchy.roots).toEqual(expect.arrayContaining(['orphan', 'a', 'b', 'child']));
  });

  it('counts derived blocked state separately from lifecycle status', () => {
    const lifecycleBlocked = issue('lifecycle-blocked');
    lifecycleBlocked.status = 'blocked';
    lifecycleBlocked.is_blocked = false;
    const derivedBlocked = issue('derived-blocked');
    derivedBlocked.status = 'open';
    derivedBlocked.is_blocked = true;

    expect(summarizeIssues([lifecycleBlocked, derivedBlocked])).toMatchObject({
      blocked: 1,
      byStatus: { blocked: 1, open: 1 },
    });
  });

  it('returns nested epic work in execution order with truthful relative depth', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const story = { ...issue('story', 'epic'), issue_type: 'story', status: 'in_progress' };
    const nestedTask = { ...issue('nested', 'story'), status: 'open' };
    const closedTask = { ...issue('closed', 'epic'), status: 'closed', priority: 0 };
    const hierarchy = buildHierarchy([epic, closedTask, nestedTask, story]);

    expect(epicWorkItems(hierarchy, 'epic').map(({ issue, depth }) => [issue.id, depth])).toEqual([
      ['story', 0],
      ['nested', 1],
      ['closed', 0],
    ]);
  });

  it('builds scoped directed epic dependencies using only official blocking types', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const first = issue('first', 'epic');
    const second = issue('second', 'epic');
    second.dependencies = [
      { issue_id: 'second', depends_on_id: 'first', type: 'blocks' },
      { issue_id: 'second', depends_on_id: 'first', type: 'blocks' },
      { issue_id: 'second', depends_on_id: 'epic', type: 'parent-child' },
      { issue_id: 'second', depends_on_id: 'external-target', type: 'waits-for' },
    ];
    const third = issue('third', 'epic');
    third.dependencies = [{ issue_id: 'third', depends_on_id: 'second', type: 'depends-on' }];
    const externalSource = issue('external-source');
    externalSource.dependencies = [
      { issue_id: 'external-source', depends_on_id: 'first', type: 'conditional-blocks' },
    ];
    first.dependents = [
      { issue_id: 'external-source', depends_on_id: 'first', type: 'conditional-blocks' },
    ];
    const externalTarget = issue('external-target');
    const hierarchy = buildHierarchy([epic, first, second, third, externalSource, externalTarget]);

    expect(
      epicDependencyEdges(hierarchy, 'epic').map(({ source, target, type, kind, scope }) => ({
        source: source.id,
        target: target.id,
        type,
        kind,
        scope,
      })),
    ).toEqual([
      {
        source: 'second',
        target: 'first',
        type: 'blocks',
        kind: 'blocking',
        scope: 'internal',
      },
      {
        source: 'third',
        target: 'second',
        type: 'depends-on',
        kind: 'nonblocking',
        scope: 'internal',
      },
      {
        source: 'external-source',
        target: 'first',
        type: 'conditional-blocks',
        kind: 'blocking',
        scope: 'inbound',
      },
      {
        source: 'second',
        target: 'external-target',
        type: 'waits-for',
        kind: 'blocking',
        scope: 'outbound',
      },
    ]);
  });

  it('layers blocking dependencies prerequisite-first and separates independent work', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const prerequisite = { ...issue('first', 'epic'), status: 'closed' };
    const dependent = { ...issue('second', 'epic'), status: 'open' };
    dependent.dependencies = [{ depends_on_id: 'first', type: 'blocks' }];
    const independent = { ...issue('independent', 'epic'), status: 'in_progress' };
    const hierarchy = buildHierarchy([epic, dependent, independent, prerequisite]);

    const dag = epicBlockingDag(hierarchy, 'epic');

    expect(dag.layers.map((layer) => layer.map((item) => item.id))).toEqual([
      ['first'],
      ['second'],
    ]);
    expect(dag.edges.map((edge) => [edge.prerequisite.id, edge.dependent.id])).toEqual([
      ['first', 'second'],
    ]);
    expect(dag.independent.map((item) => item.id)).toEqual(['independent']);
    expect(dag.hasCycle).toBe(false);
    expect(dag.cycleBlockedIssues).toEqual([]);
  });

  it('retains blocking edges that use the epic as an endpoint outside the descendant DAG', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const child = issue('child', 'epic');
    epic.dependencies = [{ depends_on_id: 'child', type: 'blocks' }];
    const hierarchy = buildHierarchy([epic, child]);

    const dependencies = epicDependencyEdges(hierarchy, 'epic');
    const dag = epicBlockingDag(hierarchy, 'epic');

    expect(dependencies.map((edge) => edge.key)).toContain('epic:blocks:child');
    expect(dag.edges).toEqual([]);
  });

  it('detects blocking cycles and returns a safe fallback set', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const first = issue('first', 'epic');
    const second = issue('second', 'epic');
    first.dependencies = [{ depends_on_id: 'second', type: 'blocks' }];
    second.dependencies = [{ depends_on_id: 'first', type: 'waits-for' }];

    const dag = epicBlockingDag(buildHierarchy([epic, first, second]), 'epic');

    expect(dag.hasCycle).toBe(true);
    expect(dag.layers).toEqual([]);
    expect(dag.cycleIssues.map((item) => item.id).sort()).toEqual(['first', 'second']);
    expect(dag.cycleBlockedIssues).toEqual([]);
  });

  it('preserves self-loops and distinguishes downstream unresolved work from cycle members', () => {
    const epic = { ...issue('epic'), issue_type: 'epic' };
    const loop = issue('loop', 'epic');
    loop.dependencies = [{ depends_on_id: 'loop', type: 'blocks' }];
    const downstream = issue('downstream', 'epic');
    downstream.dependencies = [{ depends_on_id: 'loop', type: 'waits-for' }];

    const dag = epicBlockingDag(buildHierarchy([epic, loop, downstream]), 'epic');

    expect(dag.edges.map((edge) => edge.key)).toEqual([
      'downstream:waits-for:loop',
      'loop:blocks:loop',
    ]);
    expect(dag.hasCycle).toBe(true);
    expect(dag.cycleIssues.map((item) => item.id)).toEqual(['loop']);
    expect(dag.cycleBlockedIssues.map((item) => item.id)).toEqual(['downstream']);
  });

  it('combines detail dependents with both inbound dependency projections without duplicates', () => {
    const target = issue('target');
    target.dependents = [
      { id: 'consumer', dependency_type: 'blocks' },
      { issue_id: 'consumer', depends_on_id: 'target', type: 'blocks' },
    ];
    const consumer = issue('consumer');
    consumer.dependencies = [
      { issue_id: 'consumer', depends_on_id: 'target', type: 'blocks' },
      { id: 'target', dependency_type: 'blocks' },
    ];
    const hierarchy = buildHierarchy([target, consumer]);

    expect(issueRelationships(target, hierarchy)).toEqual([
      {
        key: 'in:blocks:consumer',
        label: 'referenced by · blocks',
        target: 'consumer',
      },
    ]);
  });
});
