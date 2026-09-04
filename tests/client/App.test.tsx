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
      dependencies: [
        {
          issue_id: 'repo-task',
          depends_on_id: 'repo-done',
          type: 'blocks',
        },
      ],
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
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      const body = issueId
        ? {
            issue: {
              ...index.issues.find((issue) => issue.id === issueId),
              description: 'Complete safe context',
            },
          }
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
    expect(screen.getByRole('treeitem', { name: /Completed sibling/ })).toHaveClass('is-closed');

    parent.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /Needle child task/ })).toHaveFocus();
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

  it('opens epics in a focused route with a DAG and no repository sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Viewer epic'));

    expect(window.location.pathname).toBe('/epics/repo-epic');
    const focusHeading = screen.getByRole('heading', { name: 'Viewer epic', level: 1 });
    await waitFor(() => expect(focusHeading).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Epic focus mode: Viewer epic');
    expect(screen.queryByRole('region', { name: 'Repository overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tree', { name: 'Issue hierarchy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to all work/ })).toBeInTheDocument();

    const overview = await screen.findByRole('region', { name: 'Epic execution overview' });
    expect(within(overview).getByText('Epic work breakdown')).toBeInTheDocument();
    expect(within(overview).getByText('Blocking dependency DAG')).toBeInTheDocument();
    expect(within(overview).getByText('Prerequisite → dependent')).toBeInTheDocument();
    expect(within(overview).getByText('Stage 1')).toBeInTheDocument();
    expect(within(overview).getByText('Stage 2')).toBeInTheDocument();
    expect(within(overview).getByText('Needs repo-done')).toBeInTheDocument();
    const dag = within(overview).getByRole('region', { name: 'Blocking dependency DAG' });
    expect(within(dag).getByText('Blocked')).toBeInTheDocument();
    expect(within(overview).getByText('Dependency paths (1)')).toBeInTheDocument();
    expect(within(overview).getByRole('progressbar', { name: 'Epic completion' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    const breakdown = within(overview).getByRole('list', {
      name: 'Epic descendant work items',
    });
    const workItems = within(breakdown).getAllByRole('listitem');
    expect(within(workItems[0]).getByText('Needle child task')).toBeInTheDocument();
    expect(within(workItems[1]).getByRole('button')).toHaveClass('is-closed');

    const opener = within(workItems[0]).getByRole('button', { name: /Needle child task/ });
    await user.click(opener);
    expect(window.location.pathname).toBe('/epics/repo-epic/issues/repo-task');
    const dialog = await screen.findByRole('dialog', { name: 'Needle child task' });
    expect(within(dialog).getByText('Complete safe context')).toBeInTheDocument();
    expect(
      screen.getByText('Epic work breakdown').closest('[data-focus-background]'),
    ).toHaveAttribute('inert');
    expect(document.querySelectorAll('#focus-epic-context')).toHaveLength(1);
    expect(document.querySelectorAll('#focus-child-context')).toHaveLength(1);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/epics/repo-epic');
    await waitFor(() => expect(opener).toHaveFocus());

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByRole('tree', { name: 'Issue hierarchy' })).toBeInTheDocument();
  });

  it('shows a clear epic dependency empty state', async () => {
    const noDependencies = {
      ...index,
      issues: index.issues.map((issue) => ({ ...issue, dependencies: [] })),
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      const body = issueId
        ? { issue: noDependencies.issues.find((issue) => issue.id === issueId) }
        : noDependencies;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Viewer epic'));

    const overview = await screen.findByRole('region', { name: 'Epic execution overview' });
    expect(within(overview).getByText('No internal blocking edges')).toBeInTheDocument();
    expect(
      within(overview).getByText('No additional dependency links connect to this epic.'),
    ).toBeInTheDocument();
  });

  it('counts only the overlapping derived blocked signal', async () => {
    const lifecycleBlocked = {
      ...index,
      issues: index.issues.map((issue) =>
        issue.id === 'repo-done' ? { ...issue, status: 'blocked', is_blocked: false } : issue,
      ),
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      const body = issueId
        ? { issue: lifecycleBlocked.issues.find((issue) => issue.id === issueId) }
        : lifecycleBlocked;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Viewer epic'));

    const overview = await screen.findByRole('region', { name: 'Epic execution overview' });
    expect(within(overview).getByText('Blocked signal').parentElement).toHaveTextContent(
      'Blocked signal1',
    );
    expect(
      within(overview).getByText(
        'Blocked signal is derived from active dependencies and can overlap lifecycle statuses.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps epic-endpoint blocking links visible when they are not represented in the DAG', async () => {
    const epicEndpoint = {
      ...index,
      issues: index.issues.map((issue) =>
        issue.id === 'repo-epic'
          ? { ...issue, dependencies: [{ depends_on_id: 'repo-task', type: 'blocks' }] }
          : issue,
      ),
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      return {
        ok: true,
        status: 200,
        json: async () =>
          issueId
            ? { issue: epicEndpoint.issues.find((issue) => issue.id === issueId) }
            : epicEndpoint,
      } as Response;
    });
    window.history.replaceState({}, '', '/epics/repo-epic');

    render(<App />);

    const links = await screen.findByRole('region', { name: 'Epic execution overview' });
    const otherLinks = within(links).getByRole('heading', { name: 'Other dependency links' })
      .parentElement?.parentElement;
    expect(otherLinks).toHaveTextContent('repo-epic');
    expect(otherLinks).toHaveTextContent('depends on');
    expect(otherLinks).toHaveTextContent('repo-task');
  });

  it('opens a nested epic as full details inside the originating epic focus context', async () => {
    const nestedEpic = {
      id: 'repo-nested',
      title: 'Nested delivery epic',
      parent: 'repo-epic',
      issue_type: 'epic',
      status: 'open',
      labels: ['ui'],
      dependencies: [],
      dependents: [],
    };
    const nestedIndex = { ...index, issues: [...index.issues, nestedEpic] };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      const found = nestedIndex.issues.find((issue) => issue.id === issueId);
      return {
        ok: true,
        status: 200,
        json: async () =>
          issueId ? { issue: { ...found, description: 'Nested epic full context' } } : nestedIndex,
      } as Response;
    });
    window.history.replaceState({}, '', '/epics/repo-epic');
    const user = userEvent.setup();
    render(<App />);
    const workList = await screen.findByRole('list', { name: 'Epic descendant work items' });

    await user.click(within(workList).getByRole('button', { name: /Nested delivery epic/ }));

    expect(window.location.pathname).toBe('/epics/repo-epic/issues/repo-nested');
    const dialog = await screen.findByRole('dialog', { name: 'Nested delivery epic' });
    expect(within(dialog).getByText('Nested epic full context')).toBeInTheDocument();
    expect(screen.queryByRole('tree', { name: 'Issue hierarchy' })).not.toBeInTheDocument();
  });

  it('supports direct focused child links and replaces them with the epic on close', async () => {
    window.history.replaceState({}, '', '/epics/repo-epic/issues/repo-task');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText('Epic work breakdown')).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', { name: 'Needle child task' });
    expect(within(dialog).getByText('Complete safe context')).toBeInTheDocument();
    expect(screen.queryByRole('tree', { name: 'Issue hierarchy' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close issue details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/epics/repo-epic');
    expect(replaceState).toHaveBeenCalled();
  });

  it('traverses to the filtered general entry and restores its epic control', async () => {
    window.history.replaceState({}, '', '/before-viewer');
    window.history.pushState({}, '', '/?q=Needle');
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const back = vi.spyOn(window.history, 'back');
    const user = userEvent.setup();
    render(<App />);
    const invokingControl = (await screen.findByText('Viewer epic')).closest('button')!;

    await user.click(invokingControl);

    expect(pushState).toHaveBeenCalledWith({}, '', '/epics/repo-epic?q=Needle');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Viewer epic', level: 1 })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: /Back to all work/ }));

    await waitFor(() => expect(window.location.href).toContain('/?q=Needle'));
    expect(back).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    const restoredControl = (await screen.findByText('Viewer epic')).closest('button')!;
    await waitFor(() => expect(restoredControl).toHaveFocus());

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/before-viewer'));
  });

  it('replaces a direct epic link with the filtered general fallback', async () => {
    window.history.replaceState({}, '', '/epics/repo-epic?q=Needle');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const back = vi.spyOn(window.history, 'back');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Viewer epic', level: 1 });

    await user.click(screen.getByRole('button', { name: /Back to all work/ }));

    expect(back).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith({}, '', '/?q=Needle');
    const tree = await screen.findByRole('tree', { name: 'Issue hierarchy' });
    await waitFor(() => expect(tree.closest('main')).toHaveFocus());
  });

  it('keeps an invalid child deep link in a named, immediately closeable dialog', async () => {
    window.history.replaceState({}, '', '/epics/repo-epic/issues/missing-child');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/issues/missing-child') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Child issue was not found' }),
        } as Response;
      }
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      return {
        ok: true,
        status: 200,
        json: async () =>
          issueId ? { issue: index.issues.find((issue) => issue.id === issueId) } : index,
      } as Response;
    });

    render(<App />);

    const dialog = await screen.findByRole('dialog', { name: 'Issue missing-child' });
    const close = within(dialog).getByRole('button', { name: 'Close issue details' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(await within(dialog).findByText('Child issue was not found')).toBeInTheDocument();
  });

  it('fails gracefully when a focused route points to a non-epic', async () => {
    window.history.replaceState({}, '', '/epics/repo-task');

    render(<App />);

    expect(await screen.findByText('Unable to open this epic')).toBeInTheDocument();
    expect(screen.getByText('repo-task is not an epic.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to all work/ })).toBeInTheDocument();
    expect(screen.queryByRole('tree', { name: 'Issue hierarchy' })).not.toBeInTheDocument();
  });

  it('fails gracefully when a focused epic is missing', async () => {
    window.history.replaceState({}, '', '/epics/missing-epic');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/issues/missing-epic') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Issue was not found' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => index } as Response;
    });

    render(<App />);

    expect(await screen.findByText('Unable to open this epic')).toBeInTheDocument();
    expect(screen.getByText('Issue was not found')).toBeInTheDocument();
  });

  it('warns and falls back when blocking dependencies contain a cycle', async () => {
    const cyclic = {
      ...index,
      issues: index.issues.map((issue) => {
        if (issue.id === 'repo-task') {
          return { ...issue, dependencies: [{ depends_on_id: 'repo-done', type: 'blocks' }] };
        }
        if (issue.id === 'repo-done') {
          return { ...issue, dependencies: [{ depends_on_id: 'repo-task', type: 'waits-for' }] };
        }
        return issue;
      }),
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const issueId = url.startsWith('/api/issues/')
        ? decodeURIComponent(url.slice('/api/issues/'.length))
        : undefined;
      return {
        ok: true,
        status: 200,
        json: async () =>
          issueId ? { issue: cyclic.issues.find((issue) => issue.id === issueId) } : cyclic,
      } as Response;
    });
    window.history.replaceState({}, '', '/epics/repo-epic');

    render(<App />);

    expect(await screen.findByText('Dependency cycle detected')).toBeInTheDocument();
    expect(screen.getByLabelText('Items in dependency cycles')).toBeInTheDocument();
    expect(screen.getByText('Dependency paths (2)')).toBeInTheDocument();
  });

  it('reacts to browser history navigation between focus and general routes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Viewer epic'));
    expect(window.location.pathname).toBe('/epics/repo-epic');

    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('tree', { name: 'Issue hierarchy' })).toBeInTheDocument();
  });

  it('keeps direct non-epic detail routes in the general repository view', async () => {
    window.history.replaceState({}, '', '/issues/repo-task');

    render(<App />);

    expect(await screen.findByRole('tree', { name: 'Issue hierarchy' })).toBeInTheDocument();
    expect(await screen.findByText('Complete safe context')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/issues/repo-task');
  });

  it('bypasses the server cache on every browser load, including focused epic routes', async () => {
    window.history.replaceState({}, '', '/epics/repo-epic');

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Viewer epic', level: 1 }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/index?refresh=1', expect.anything());
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });
});
