import type { DependencyRecord, IssueRecord } from './contracts.js';

export interface IssueFilters {
  query?: string;
  statuses?: string[];
  types?: string[];
  priorities?: number[];
  labels?: string[];
}

export interface Hierarchy {
  issuesById: Map<string, IssueRecord>;
  childrenById: Map<string, string[]>;
  roots: string[];
  orphanIds: Set<string>;
  cycleIds: Set<string>;
}

export function buildHierarchy(issues: IssueRecord[]): Hierarchy {
  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const cycleIds = findCycleIds(issuesById);
  const orphanIds = new Set<string>();
  const childrenById = new Map<string, string[]>();
  const roots: string[] = [];

  for (const issue of issues) childrenById.set(issue.id, []);

  for (const issue of issues) {
    const parent = issue.parent;
    if (parent && !issuesById.has(parent)) orphanIds.add(issue.id);

    const canAttach =
      parent && issuesById.has(parent) && !cycleIds.has(issue.id) && !cycleIds.has(parent);
    if (canAttach) {
      childrenById.get(parent)?.push(issue.id);
    } else {
      roots.push(issue.id);
    }
  }

  const compare = (left: string, right: string) => {
    const a = issuesById.get(left)!;
    const b = issuesById.get(right)!;
    return (a.priority ?? 99) - (b.priority ?? 99) || a.title.localeCompare(b.title);
  };
  roots.sort(compare);
  for (const children of childrenById.values()) children.sort(compare);

  return { issuesById, childrenById, roots, orphanIds, cycleIds };
}

function findCycleIds(issuesById: Map<string, IssueRecord>): Set<string> {
  const resolved = new Set<string>();
  const cycleIds = new Set<string>();

  for (const startId of issuesById.keys()) {
    if (resolved.has(startId)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = startId;

    while (current && issuesById.has(current) && !resolved.has(current)) {
      const seenAt = positions.get(current);
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cycleIds.add(id);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = issuesById.get(current)?.parent;
    }
    for (const id of path) resolved.add(id);
  }

  return cycleIds;
}

export function visibleIssueIds(hierarchy: Hierarchy, filters: IssueFilters): Set<string> {
  const matches = new Set<string>();
  for (const issue of hierarchy.issuesById.values()) {
    if (matchesFilters(issue, filters)) matches.add(issue.id);
  }

  const visible = new Set(matches);
  for (const id of matches) {
    const visited = new Set<string>();
    let parent = hierarchy.issuesById.get(id)?.parent;
    while (parent && hierarchy.issuesById.has(parent) && !visited.has(parent)) {
      visible.add(parent);
      visited.add(parent);
      parent = hierarchy.issuesById.get(parent)?.parent;
    }
  }
  return visible;
}

export function matchesFilters(issue: IssueRecord, filters: IssueFilters): boolean {
  const query = filters.query?.trim().toLocaleLowerCase();
  if (query && !`${issue.id} ${issue.title}`.toLocaleLowerCase().includes(query)) return false;
  if (filters.statuses?.length && !filters.statuses.includes(issue.status ?? 'unknown'))
    return false;
  if (filters.types?.length && !filters.types.includes(issue.issue_type ?? 'unknown')) return false;
  if (filters.priorities?.length && !filters.priorities.includes(issue.priority ?? -1))
    return false;
  if (filters.labels?.length && !filters.labels.every((label) => issue.labels.includes(label))) {
    return false;
  }
  return true;
}

export function summarizeIssues(issues: IssueRecord[]) {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let blocked = 0;
  let ready = 0;

  for (const issue of issues) {
    const status = issue.status ?? 'unknown';
    const type = issue.issue_type ?? 'unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byType[type] = (byType[type] ?? 0) + 1;
    if (issue.is_blocked === true) blocked += 1;
    if (issue.is_ready === true) ready += 1;
  }

  return { total: issues.length, byStatus, byType, blocked, ready };
}

export interface IssueRelationship {
  key: string;
  label: string;
  target: string;
}

export function issueRelationships(issue: IssueRecord, hierarchy: Hierarchy): IssueRelationship[] {
  const relationships = new Map<string, IssueRelationship>();
  const add = (direction: 'out' | 'in', type: string, target: string | undefined) => {
    if (!target || target === issue.id || type === 'parent-child') return;
    const key = `${direction}:${type}:${target}`;
    relationships.set(key, {
      key,
      label: direction === 'out' ? type : `referenced by · ${type}`,
      target,
    });
  };

  for (const dependency of issue.dependencies) {
    add('out', dependencyType(dependency), dependencyTarget(dependency));
  }
  for (const dependent of issue.dependents) {
    add('in', dependencyType(dependent), dependentTarget(dependent, issue.id));
  }
  for (const candidate of hierarchy.issuesById.values()) {
    for (const dependency of candidate.dependencies) {
      if (dependencyTarget(dependency) === issue.id) {
        add('in', dependencyType(dependency), candidate.id);
      }
    }
  }

  return [...relationships.values()];
}

function dependencyType(dependency: DependencyRecord): string {
  return dependency.type ?? dependency.dependency_type ?? 'related';
}

function dependencyTarget(dependency: DependencyRecord): string | undefined {
  return dependency.depends_on_id ?? dependency.id;
}

function dependentTarget(dependency: DependencyRecord, currentIssueId: string): string | undefined {
  if (dependency.issue_id && dependency.issue_id !== currentIssueId) return dependency.issue_id;
  if (dependency.id && dependency.id !== currentIssueId) return dependency.id;
  if (dependency.depends_on_id && dependency.depends_on_id !== currentIssueId) {
    return dependency.depends_on_id;
  }
  return undefined;
}

export function ancestorIds(hierarchy: Hierarchy, id: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let parent = hierarchy.issuesById.get(id)?.parent;
  while (parent && hierarchy.issuesById.has(parent) && !visited.has(parent)) {
    result.unshift(parent);
    visited.add(parent);
    parent = hierarchy.issuesById.get(parent)?.parent;
  }
  return result;
}
