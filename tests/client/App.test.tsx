import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import type { IndexResponse } from '../../src/shared/contracts.js';

const index: IndexResponse = {
  diagnostics: {
    repositoryRoot: '/work/repo',
    repositoryName: 'repo',
    bdVersion: '1.2.1',
    backend: 'dolt / embedded',
    refreshedAt: '2026-01-01T00:00:00Z',
  },
  counts: {
    total: 3,
    byStatus: { open: 2, closed: 1 },
    byType: { epic: 1, task: 2 },
    blocked: 1,
    ready: 1,
  },
  issues: [
    {
      id: 'repo-epic',
      title: 'Viewer epic',
      issue_type: 'epic',
      status: 'open',
      labels: ['ui'],
      dependencies: [],
      dependents: [],
    },
    {
      id: 'repo-task',
      title: 'Needle child task',
      parent: 'repo-epic',
      issue_type: 'task',
      status: 'open',
      is_blocked: true,
      labels: ['ui'],
      dependencies: [],
      dependents: [],
    },
    {
      id: 'repo-done',
      title: 'Completed sibling',
      parent: 'repo-epic',
      issue_type: 'task',
      status: 'closed',
      labels: ['backend'],
      dependencies: [],
      dependents: [],
    },
  ],
};

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith('/api/issues/')
        ? { issue: { ...index.issues[1], description: 'Complete safe context' } }
        : index;
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('filters by title while retaining ancestors, truthful progress, and match count', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Viewer epic')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search title or ID…'), 'Needle');
    expect(screen.getByText('Viewer epic')).toBeInTheDocument();
    expect(screen.getByText('Needle child task')).toBeInTheDocument();
    expect(
      within(screen.getByRole('treeitem', { name: /Needle child task/ })).getByText('Blocked'),
    ).toBeInTheDocument();
    expect(screen.getByTitle('1 of 2 direct children closed')).toHaveTextContent('1/2');
    expect(screen.getByText('1 matches')).toBeInTheDocument();
    expect(window.location.search).toContain('q=Needle');
    await user.click(screen.getByText('Needle child task'));
    expect(window.location.pathname).toBe('/issues/repo-task');
    expect(await screen.findByText('Complete safe context')).toBeInTheDocument();
  });

  it('reports all matches when collapsed and implements tree keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    const parent = await screen.findByRole('treeitem', { name: /Viewer epic/ });
    expect(parent).toHaveAttribute('aria-level', '1');
    expect(parent).toHaveAttribute('aria-posinset', '1');
    expect(parent).toHaveAttribute('aria-setsize', '1');
    expect(screen.getByText('3 matches')).toBeInTheDocument();

    parent.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /Completed sibling/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(parent).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('3 matches')).toBeInTheDocument();
  });

  it('makes the mobile detail inert, escape-closeable, and focus restoring', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(max-width: 920px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const user = userEvent.setup();
    render(<App />);
    const openerText = await screen.findByText('Needle child task');
    const opener = openerText.closest('button')!;
    await user.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Needle child task' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close issue details' })).toHaveFocus(),
    );
    expect(document.querySelector('.browser-pane')).toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
    expect(replaceState).toHaveBeenCalled();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('refreshes through the fixed refresh endpoint', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Viewer epic');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/index?refresh=1', expect.anything()),
    );
  });
});
