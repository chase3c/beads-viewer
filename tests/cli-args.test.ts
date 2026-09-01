import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('opens the current repository by default', () => {
    expect(parseArgs([], '/repo')).toEqual({
      repositoryPath: '/repo',
      port: undefined,
      open: true,
      help: false,
    });
  });

  it('allows browser opening to be disabled explicitly', () => {
    expect(parseArgs(['/other-repo', '--no-open'], '/repo')).toMatchObject({
      repositoryPath: '/other-repo',
      open: false,
    });
  });
});
