import { describe, expect, it } from 'vitest';
import { readRoute, routePath } from '../../src/client/routes.js';

describe('viewer routes', () => {
  it('parses general and focused epic routes', () => {
    expect(readRoute('/')).toEqual({ kind: 'general' });
    expect(readRoute('/issues/repo-task')).toEqual({ kind: 'general', issueId: 'repo-task' });
    expect(readRoute('/epics/repo-epic')).toEqual({ kind: 'epic', epicId: 'repo-epic' });
    expect(readRoute('/epics/repo-epic/issues/repo-task')).toEqual({
      kind: 'epic',
      epicId: 'repo-epic',
      issueId: 'repo-task',
    });
  });

  it('encodes focused epic and child IDs', () => {
    expect(routePath({ kind: 'epic', epicId: 'epic one', issueId: 'task/two' })).toBe(
      '/epics/epic%20one/issues/task%2Ftwo',
    );
  });

  it('falls back safely for malformed routes', () => {
    expect(readRoute('/epics/%E0%A4%A')).toEqual({ kind: 'general' });
    expect(readRoute('/something/else')).toEqual({ kind: 'general' });
  });
});
