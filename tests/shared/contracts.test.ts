import { describe, expect, it } from 'vitest';
import { normalizeIssue } from '../../src/shared/contracts.js';

describe('normalizeIssue', () => {
  it('retains additive unknown keys while normalizing every rendered field', () => {
    const issue = normalizeIssue({
      id: 'repo-1',
      title: 'Safe title',
      description: { hostile: true },
      design: ['not', 'markdown'],
      acceptance_criteria: 42,
      notes: false,
      status: { value: 'open' },
      priority: '0',
      issue_type: ['task'],
      owner: 7,
      assignee: {},
      parent: 3,
      labels: ['safe', 4, null],
      dependencies: [
        { id: 'repo-2', type: 'blocks', title: ['bad'], extra_edge: { retained: true } },
        'bad',
      ],
      dependents: { wrong: true },
      created_at: [],
      estimated_minutes: Number.POSITIVE_INFINITY,
      is_blocked: 'yes',
      unknown_extension: { retained: true },
    });

    expect(issue).not.toBeNull();
    expect(issue).toMatchObject({
      id: 'repo-1',
      title: 'Safe title',
      labels: ['safe'],
      dependencies: [{ id: 'repo-2', type: 'blocks', extra_edge: { retained: true } }],
      dependents: [],
      unknown_extension: { retained: true },
    });
    expect(issue?.description).toBeUndefined();
    expect(issue?.priority).toBeUndefined();
    expect(issue?.dependencies[0].title).toBeUndefined();
    expect(issue?.estimated_minutes).toBeUndefined();
    expect(issue?.is_blocked).toBeUndefined();
  });
});
