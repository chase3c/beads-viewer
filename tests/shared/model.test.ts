import { describe, expect, it } from 'vitest';
import type { IssueRecord } from '../../src/shared/contracts.js';
import {
  buildHierarchy,
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
