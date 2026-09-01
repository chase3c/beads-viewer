import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IndexResponse, IssueRecord } from '../shared/contracts.js';
import {
  ancestorIds,
  buildHierarchy,
  issueRelationships,
  matchesFilters,
  visibleIssueIds,
  type Hierarchy,
  type IssueFilters,
} from '../shared/model.js';
import { getIndex, getIssue } from './api.js';

interface FilterState {
  query: string;
  status: string;
  type: string;
  priority: string;
  label: string;
}

const EMPTY_FILTERS: FilterState = { query: '', status: '', type: '', priority: '', label: '' };

export function App() {
  const [index, setIndex] = useState<IndexResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState(readFilters);
  const [selectedId, setSelectedId] = useState(readSelectedId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string>();
  const isMobile = useMediaQuery('(max-width: 920px)');
  const appRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement>();
  const hadSelectionRef = useRef(Boolean(selectedId));

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(undefined);
    try {
      const result = await getIndex(refresh);
      setIndex(result);
      setExpanded((current) =>
        current.size
          ? current
          : new Set(result.issues.filter((issue) => !issue.parent).map((issue) => issue.id)),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Beads data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setFilters(readFilters());
      setSelectedId(readSelectedId());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const hierarchy = useMemo(() => buildHierarchy(index?.issues ?? []), [index]);
  const modelFilters = useMemo(() => toModelFilters(filters), [filters]);
  const visible = useMemo(
    () => visibleIssueIds(hierarchy, modelFilters),
    [hierarchy, modelFilters],
  );
  const filterActive = Object.values(filters).some(Boolean);
  const rows = useMemo(
    () => flattenHierarchy(hierarchy, visible, expanded, filterActive),
    [hierarchy, visible, expanded, filterActive],
  );
  const selected = selectedId ? hierarchy.issuesById.get(selectedId) : undefined;
  const matchCount = useMemo(
    () => (index?.issues ?? []).filter((issue) => matchesFilters(issue, modelFilters)).length,
    [index, modelFilters],
  );

  useEffect(() => {
    if (rows.length && !rows.some((row) => row.issue.id === focusedId)) {
      setFocusedId(rows[0].issue.id);
    }
  }, [focusedId, rows]);

  const updateFilters = (next: FilterState) => {
    setFilters(next);
    writeUrl(selectedId, next, false);
  };
  const selectIssue = useCallback(
    (id: string) => {
      if (!selectedId && document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }
      setSelectedId(id);
      writeUrl(id, filters, true);
    },
    [filters, selectedId],
  );
  const closeIssue = useCallback(() => {
    setSelectedId(undefined);
    writeUrl(undefined, filters, false);
  }, [filters]);

  useEffect(() => {
    if (hadSelectionRef.current && !selectedId) {
      queueMicrotask(() => previousFocusRef.current?.focus());
    }
    hadSelectionRef.current = Boolean(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!isMobile || !selectedId) return;
    const backgrounds = appRef.current?.querySelectorAll<HTMLElement>('[data-modal-background]');
    backgrounds?.forEach((element) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    requestAnimationFrame(() => {
      detailRef.current?.querySelector<HTMLElement>('.close-button')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeIssue();
        return;
      }
      if (event.key !== 'Tab' || !detailRef.current) return;
      const focusable = getFocusableElements(detailRef.current);
      if (!focusable.length) {
        event.preventDefault();
        detailRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      backgrounds?.forEach((element) => {
        element.removeAttribute('inert');
        element.removeAttribute('aria-hidden');
      });
    };
  }, [closeIssue, isMobile, selectedId]);

  const setIssueExpanded = (id: string, shouldExpand: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (shouldExpand) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const focusRow = (index: number) => {
    document.querySelector<HTMLElement>(`[data-tree-index="${index}"]`)?.focus();
  };
  const onTreeKeyDown = (event: ReactKeyboardEvent, row: FlatRow, rowIndex: number) => {
    const isExpanded = expanded.has(row.issue.id) || filterActive;
    if (event.key === 'ArrowDown') focusRow(Math.min(rowIndex + 1, rows.length - 1));
    else if (event.key === 'ArrowUp') focusRow(Math.max(rowIndex - 1, 0));
    else if (event.key === 'Home') focusRow(0);
    else if (event.key === 'End') focusRow(rows.length - 1);
    else if (event.key === 'ArrowRight') {
      if (row.visibleChildCount && !isExpanded) setIssueExpanded(row.issue.id, true);
      else if (rows[rowIndex + 1]?.depth === row.depth + 1) focusRow(rowIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      if (row.visibleChildCount && isExpanded && !filterActive)
        setIssueExpanded(row.issue.id, false);
      else {
        for (let index = rowIndex - 1; index >= 0; index -= 1) {
          if (rows[index].depth < row.depth) {
            focusRow(index);
            break;
          }
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      selectIssue(row.issue.id);
    } else return;
    event.preventDefault();
  };

  if (loading) return <LoadingScreen />;
  if (!index && error) return <FatalError message={error} retry={() => void load()} />;
  if (!index) return null;

  return (
    <div className="app-shell" ref={appRef}>
      <header className="topbar" data-modal-background>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            ◆
          </div>
          <div>
            <p className="eyebrow">Read-only breakdown review</p>
            <h1>{index.diagnostics.repositoryName}</h1>
            <p className="repo-path" title={index.diagnostics.repositoryRoot}>
              {index.diagnostics.repositoryRoot}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <span className="safety-pill" title="Every issue-data command includes bd --readonly">
            <span aria-hidden="true">◉</span> Read-only commands
          </span>
          <button className="button" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <main>
        {error && (
          <div className="inline-error" role="alert" data-modal-background>
            {error}
          </div>
        )}
        <section className="overview" aria-label="Repository overview" data-modal-background>
          <StatCard label="All work" value={index.counts.total} />
          <StatCard label="Epics" value={index.counts.byType.epic ?? 0} />
          <StatCard label="Open" value={index.counts.byStatus.open ?? 0} tone="blue" />
          <StatCard
            label="In progress"
            value={index.counts.byStatus.in_progress ?? 0}
            tone="amber"
          />
          <StatCard label="Closed" value={index.counts.byStatus.closed ?? 0} tone="green" />
          <StatCard label="Blocked" value={index.counts.blocked} tone="rose" />
        </section>

        <section className="workspace">
          <div className="browser-pane" data-modal-background>
            <FilterBar
              filters={filters}
              issues={index.issues}
              resultCount={matchCount}
              onChange={updateFilters}
            />
            <div className="tree-heading">
              <div>
                <p className="eyebrow">Breakdown</p>
                <h2>Epics & work items</h2>
              </div>
              <span>{rows.length} visible</span>
            </div>
            <div className="tree-list" role="tree" aria-label="Issue hierarchy">
              {rows.length === 0 ? (
                <EmptyState title="No matching work" body="Try clearing or changing the filters." />
              ) : (
                rows.map((row, rowIndex) => (
                  <TreeRow
                    key={row.issue.id}
                    row={row}
                    rowIndex={rowIndex}
                    selected={row.issue.id === selectedId}
                    expanded={expanded.has(row.issue.id) || filterActive}
                    tabStop={row.issue.id === focusedId || (!focusedId && rowIndex === 0)}
                    onFocus={() => setFocusedId(row.issue.id)}
                    onKeyDown={(event) => onTreeKeyDown(event, row, rowIndex)}
                    onToggle={() =>
                      setIssueExpanded(row.issue.id, !(expanded.has(row.issue.id) || filterActive))
                    }
                    onSelect={() => selectIssue(row.issue.id)}
                  />
                ))
              )}
            </div>
          </div>

          <aside
            ref={detailRef}
            className={`detail-pane ${selectedId ? 'is-open' : ''}`}
            aria-label="Issue details"
            aria-labelledby={selectedId ? 'issue-detail-title' : undefined}
            aria-modal={isMobile && selectedId ? true : undefined}
            role={isMobile && selectedId ? 'dialog' : undefined}
            tabIndex={isMobile && selectedId ? -1 : undefined}
          >
            {selectedId ? (
              <IssueDetail
                id={selectedId}
                fallback={selected}
                hierarchy={hierarchy}
                onClose={closeIssue}
                onNavigate={selectIssue}
              />
            ) : (
              <div className="detail-placeholder">
                <div className="placeholder-glyph" aria-hidden="true">
                  ◇
                </div>
                <h2>Select a work item</h2>
                <p>Open any epic, story, task, or decision to review its complete context.</p>
              </div>
            )}
          </aside>
        </section>
      </main>

      <footer data-modal-background>
        <span>bd {index.diagnostics.bdVersion}</span>
        <span>
          {index.diagnostics.backend ?? 'Beads'} ·{' '}
          {index.diagnostics.database ?? 'default database'}
        </span>
        <span>Updated {formatDate(index.diagnostics.refreshedAt)}</span>
      </footer>
    </div>
  );
}

function FilterBar({
  filters,
  issues,
  resultCount,
  onChange,
}: {
  filters: FilterState;
  issues: IssueRecord[];
  resultCount: number;
  onChange: (filters: FilterState) => void;
}) {
  const statuses = unique(issues.map((issue) => issue.status));
  const types = unique(issues.map((issue) => issue.issue_type));
  const priorities = [
    ...new Set(
      issues.map((issue) => issue.priority).filter((value): value is number => value !== undefined),
    ),
  ].sort();
  const labels = unique(issues.flatMap((issue) => issue.labels));
  const set = (key: keyof FilterState, value: string) => onChange({ ...filters, [key]: value });
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="filters" aria-label="Issue filters">
      <label className="search-field">
        <span className="sr-only">Search title or ID</span>
        <span aria-hidden="true">⌕</span>
        <input
          value={filters.query}
          onChange={(event) => set('query', event.target.value)}
          placeholder="Search title or ID…"
        />
      </label>
      <div className="select-row">
        <FilterSelect
          label="Status"
          value={filters.status}
          values={statuses}
          onChange={(value) => set('status', value)}
        />
        <FilterSelect
          label="Type"
          value={filters.type}
          values={types}
          onChange={(value) => set('type', value)}
        />
        <FilterSelect
          label="Priority"
          value={filters.priority}
          values={priorities.map(String)}
          prefix="P"
          onChange={(value) => set('priority', value)}
        />
        <FilterSelect
          label="Label"
          value={filters.label}
          values={labels}
          onChange={(value) => set('label', value)}
        />
        {active && (
          <button className="clear-button" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear
          </button>
        )}
        <span className="result-count">{resultCount} matches</span>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  values,
  prefix = '',
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  prefix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-select">
      <span className="sr-only">Filter by {label.toLowerCase()}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}: All</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {prefix}
            {humanize(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

interface FlatRow {
  issue: IssueRecord;
  depth: number;
  childCount: number;
  visibleChildCount: number;
  closedChildCount: number;
  posInSet: number;
  setSize: number;
  orphan: boolean;
  cycle: boolean;
}

function TreeRow({
  row,
  rowIndex,
  selected,
  expanded,
  tabStop,
  onFocus,
  onKeyDown,
  onToggle,
  onSelect,
}: {
  row: FlatRow;
  rowIndex: number;
  selected: boolean;
  expanded: boolean;
  tabStop: boolean;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
  onToggle: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={`tree-row ${selected ? 'selected' : ''}`}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={row.visibleChildCount ? expanded : undefined}
      aria-level={row.depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      data-tree-index={rowIndex}
      tabIndex={tabStop ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      title={
        row.depth > 8
          ? `Hierarchy level ${row.depth + 1}; visual indentation is capped after level 9`
          : undefined
      }
    >
      <div className={`tree-indent depth-${Math.min(row.depth, 8)}`} aria-hidden="true" />
      <button
        className="expand-button"
        onClick={onToggle}
        disabled={!row.visibleChildCount}
        aria-label={expanded ? 'Collapse children' : 'Expand children'}
        tabIndex={-1}
      >
        {row.visibleChildCount ? (expanded ? '⌄' : '›') : '·'}
      </button>
      <button className="issue-summary" onClick={onSelect} tabIndex={-1}>
        <span className="issue-topline">
          <TypeBadge type={row.issue.issue_type} />
          <span className="issue-id">{row.issue.id}</span>
          {row.issue.is_blocked && (
            <span className="blocked-badge" title="Derived: this issue has an active blocker">
              Blocked
            </span>
          )}
          {row.orphan && <span className="warning-badge">orphan</span>}
          {row.cycle && <span className="warning-badge">cycle</span>}
        </span>
        <span className="issue-title">{row.issue.title}</span>
      </button>
      <div className="row-meta">
        {row.childCount > 0 && (
          <span title={`${row.closedChildCount} of ${row.childCount} direct children closed`}>
            {row.closedChildCount}/{row.childCount}
          </span>
        )}
        {row.issue.priority !== undefined && <span>P{row.issue.priority}</span>}
        <StatusBadge status={row.issue.status} />
      </div>
    </div>
  );
}

function IssueDetail({
  id,
  fallback,
  hierarchy,
  onClose,
  onNavigate,
}: {
  id: string;
  fallback?: IssueRecord;
  hierarchy: Hierarchy;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [issue, setIssue] = useState<IssueRecord | undefined>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setIssue(fallback);
    setLoading(true);
    setError(undefined);
    getIssue(id)
      .then((result) => active && setIssue(result.issue))
      .catch(
        (loadError) =>
          active &&
          setError(loadError instanceof Error ? loadError.message : 'Unable to load issue'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, fallback]);

  const crumbs = ancestorIds(hierarchy, id)
    .map((ancestorId) => hierarchy.issuesById.get(ancestorId))
    .filter(Boolean) as IssueRecord[];
  if (!issue && loading) return <div className="detail-loading">Loading complete context…</div>;
  if (!issue)
    return (
      <FatalError message={error ?? 'Issue not found'} retry={() => onClose()} retryLabel="Close" />
    );

  const relationships = issueRelationships(issue, hierarchy);

  return (
    <div className="detail-content">
      <div className="detail-toolbar">
        <nav className="breadcrumbs" aria-label="Issue ancestry">
          {crumbs.map((crumb) => (
            <button key={crumb.id} onClick={() => onNavigate(crumb.id)}>
              {crumb.id}
            </button>
          ))}
          <span>{issue.id}</span>
        </nav>
        <button className="close-button" onClick={onClose} aria-label="Close issue details">
          ×
        </button>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          Showing indexed data: {error}
        </div>
      )}
      <div className="detail-title-row">
        <div>
          <div className="detail-badges">
            <TypeBadge type={issue.issue_type} />
            <StatusBadge status={issue.status} />
            {issue.priority !== undefined && (
              <span className="priority-badge">P{issue.priority}</span>
            )}
          </div>
          <p className="issue-id detail-id">{issue.id}</p>
          <h2 id="issue-detail-title">{issue.title}</h2>
        </div>
        {loading && <span className="loading-dot" aria-label="Loading full issue" />}
      </div>
      {issue.labels.length > 0 && (
        <div className="label-list">
          {issue.labels.map((label) => (
            <span key={label}>#{label}</span>
          ))}
        </div>
      )}

      <ContentSection title="Description" content={issue.description} />
      <ContentSection title="Design & context" content={issue.design} />
      <ContentSection title="Acceptance criteria" content={issue.acceptance_criteria} />
      <ContentSection title="Notes & checkpoints" content={issue.notes} />

      {relationships.length > 0 && (
        <section className="detail-section relationships">
          <h3>Relationships</h3>
          {relationships.map((relationship) => (
            <Relationship
              key={relationship.key}
              label={relationship.label}
              target={relationship.target}
              hierarchy={hierarchy}
              onNavigate={onNavigate}
            />
          ))}
        </section>
      )}

      <section className="detail-section metadata-grid" aria-label="Lifecycle metadata">
        <Metadata label="Owner" value={issue.owner ?? issue.assignee} />
        <Metadata label="Created" value={formatDate(issue.created_at)} />
        <Metadata label="Updated" value={formatDate(issue.updated_at)} />
        <Metadata label="Started" value={formatDate(issue.started_at)} />
        <Metadata label="Closed" value={formatDate(issue.closed_at)} />
        <Metadata label="Due" value={formatDate(issue.due_at)} />
        <Metadata label="Deferred until" value={formatDate(issue.defer_until)} />
        <Metadata
          label="Estimate"
          value={issue.estimated_minutes ? `${issue.estimated_minutes} min` : undefined}
        />
        <Metadata label="Close reason" value={issue.close_reason} wide />
        <Metadata label="External reference" value={issue.external_ref} wide />
        <Metadata label="Specification" value={issue.spec_id} wide />
      </section>
    </div>
  );
}

function ContentSection({ title, content }: { title: string; content?: string }) {
  if (!content?.trim()) return null;
  return (
    <section className="detail-section prose-section">
      <h3>{title}</h3>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </section>
  );
}

function Relationship({
  label,
  target,
  hierarchy,
  onNavigate,
}: {
  label: string;
  target?: string;
  hierarchy: Hierarchy;
  onNavigate: (id: string) => void;
}) {
  const known = target ? hierarchy.issuesById.get(target) : undefined;
  return (
    <div className="relationship-row">
      <span>{humanize(label)}</span>
      {known ? (
        <button onClick={() => onNavigate(known.id)}>
          <strong>{known.id}</strong> {known.title}
        </button>
      ) : (
        <strong>{target ?? 'Unknown issue'}</strong>
      )}
    </div>
  );
}

function Metadata({
  label,
  value,
  wide = false,
}: {
  label: string;
  value?: string;
  wide?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={wide ? 'wide' : ''}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function TypeBadge({ type }: { type?: string }) {
  return <span className="type-badge">{humanize(type ?? 'work')}</span>;
}
function StatusBadge({ status }: { status?: string }) {
  return (
    <span className={`status-badge status-${status ?? 'unknown'}`}>
      <i />
      {humanize(status ?? 'unknown')}
    </span>
  );
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <div aria-hidden="true">◇</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-mark pulse">◆</div>
      <p>Opening Beads breakdown…</p>
    </div>
  );
}
function FatalError({
  message,
  retry,
  retryLabel = 'Try again',
}: {
  message: string;
  retry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="fatal-error" role="alert">
      <div aria-hidden="true">!</div>
      <h2>Viewer unavailable</h2>
      <p>{message}</p>
      <button className="button" onClick={retry}>
        {retryLabel}
      </button>
    </div>
  );
}

function flattenHierarchy(
  hierarchy: Hierarchy,
  visible: Set<string>,
  expanded: Set<string>,
  forceExpand: boolean,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const visibleRoots = hierarchy.roots.filter((id) => visible.has(id));
  const stack = visibleRoots
    .map((id, index) => ({
      id,
      depth: 0,
      posInSet: index + 1,
      setSize: visibleRoots.length,
    }))
    .reverse();
  while (stack.length) {
    const current = stack.pop()!;
    const issue = hierarchy.issuesById.get(current.id);
    if (!issue) continue;
    const allChildren = hierarchy.childrenById.get(current.id) ?? [];
    const visibleChildren = allChildren.filter((id) => visible.has(id));
    rows.push({
      issue,
      depth: current.depth,
      childCount: allChildren.length,
      visibleChildCount: visibleChildren.length,
      closedChildCount: allChildren.filter(
        (id) => hierarchy.issuesById.get(id)?.status === 'closed',
      ).length,
      posInSet: current.posInSet,
      setSize: current.setSize,
      orphan: hierarchy.orphanIds.has(issue.id),
      cycle: hierarchy.cycleIds.has(issue.id),
    });
    if (forceExpand || expanded.has(current.id)) {
      for (let index = visibleChildren.length - 1; index >= 0; index -= 1) {
        stack.push({
          id: visibleChildren[index],
          depth: current.depth + 1,
          posInSet: index + 1,
          setSize: visibleChildren.length,
        });
      }
    }
  }
  return rows;
}

function readFilters(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get('q') ?? '',
    status: params.get('status') ?? '',
    type: params.get('type') ?? '',
    priority: params.get('priority') ?? '',
    label: params.get('label') ?? '',
  };
}
function readSelectedId(): string | undefined {
  const match = window.location.pathname.match(/^\/issues\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
function writeUrl(selectedId: string | undefined, filters: FilterState, push: boolean) {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.label) params.set('label', filters.label);
  const path = selectedId ? `/issues/${encodeURIComponent(selectedId)}` : '/';
  const url = `${path}${params.size ? `?${params}` : ''}`;
  window.history[push ? 'pushState' : 'replaceState']({}, '', url);
}
function toModelFilters(filters: FilterState): IssueFilters {
  return {
    query: filters.query || undefined,
    statuses: filters.status ? [filters.status] : undefined,
    types: filters.type ? [filters.type] : undefined,
    priorities: filters.priority ? [Number(filters.priority)] : undefined,
    labels: filters.label ? [filters.label] : undefined,
  };
}
function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort();
}
function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('inert'));
}
