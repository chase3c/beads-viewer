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

export interface EpicWorkItem {
  issue: IssueRecord;
  depth: number;
}

export interface EpicDependencyEdge {
  key: string;
  source: IssueRecord;
  target: IssueRecord;
  type: string;
  kind: 'blocking' | 'nonblocking';
  scope: 'internal' | 'inbound' | 'outbound';
}

export interface EpicDagEdge {
  key: string;
  prerequisite: IssueRecord;
  dependent: IssueRecord;
  type: string;
}

export interface EpicDagModel {
  layers: IssueRecord[][];
  independent: IssueRecord[];
  edges: EpicDagEdge[];
  hasCycle: boolean;
  cycleIssues: IssueRecord[];
  cycleBlockedIssues: IssueRecord[];
}

const BLOCKING_DEPENDENCY_TYPES = new Set(['blocks', 'conditional-blocks', 'waits-for']);

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

  const compare = (left: string, right: string) =>
    compareIssuesByExecution(issuesById.get(left)!, issuesById.get(right)!);
  roots.sort(compare);
  for (const children of childrenById.values()) children.sort(compare);

  return { issuesById, childrenById, roots, orphanIds, cycleIds };
}

export function executionRank(issue: IssueRecord): number {
  const status = issue.status ?? 'unknown';
  if (status === 'closed') return 5;
  if (status === 'deferred') return 4;
  if (status === 'in_progress') return 0;
  if (issue.is_blocked === true || status === 'blocked') return 3;
  if (status === 'open' || status === 'todo' || issue.is_ready === true) return 1;
  return 2;
}

export function compareIssuesByExecution(left: IssueRecord, right: IssueRecord): number {
  return (
    executionRank(left) - executionRank(right) ||
    (left.priority ?? 99) - (right.priority ?? 99) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
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

export function epicWorkItems(hierarchy: Hierarchy, epicId: string): EpicWorkItem[] {
  const result: EpicWorkItem[] = [];
  const roots = hierarchy.childrenById.get(epicId) ?? [];
  const stack = roots.map((id) => ({ id, depth: 0 })).reverse();
  const visited = new Set<string>([epicId]);

  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    const issue = hierarchy.issuesById.get(current.id);
    if (!issue) continue;
    result.push({ issue, depth: current.depth });
    const children = hierarchy.childrenById.get(current.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ id: children[index], depth: current.depth + 1 });
    }
  }

  return result;
}

export function epicDependencyEdges(hierarchy: Hierarchy, epicId: string): EpicDependencyEdge[] {
  const workItems = epicWorkItems(hierarchy, epicId);
  const scopedIds = new Set([epicId, ...workItems.map(({ issue }) => issue.id)]);
  const edges = new Map<string, EpicDependencyEdge>();

  const add = (source: IssueRecord, target: IssueRecord, type: string) => {
    if (type === 'parent-child') return;
    if (source.id === target.id && !BLOCKING_DEPENDENCY_TYPES.has(type)) return;
    const sourceInside = scopedIds.has(source.id);
    const targetInside = scopedIds.has(target.id);
    if (!sourceInside && !targetInside) return;
    const scope = sourceInside ? (targetInside ? 'internal' : 'outbound') : 'inbound';
    const key = `${source.id}:${type}:${target.id}`;
    edges.set(key, {
      key,
      source,
      target,
      type,
      kind: BLOCKING_DEPENDENCY_TYPES.has(type) ? 'blocking' : 'nonblocking',
      scope,
    });
  };

  for (const source of hierarchy.issuesById.values()) {
    for (const dependency of source.dependencies) {
      const targetId = dependencyTarget(dependency);
      const target = targetId ? hierarchy.issuesById.get(targetId) : undefined;
      if (target) add(source, target, dependencyType(dependency));
    }
  }

  for (const targetId of scopedIds) {
    const target = hierarchy.issuesById.get(targetId);
    if (!target) continue;
    for (const dependent of target.dependents) {
      const sourceId = dependentTarget(dependent, target.id);
      const source = sourceId ? hierarchy.issuesById.get(sourceId) : undefined;
      if (source) add(source, target, dependencyType(dependent));
    }
  }

  const scopeRank = { internal: 0, inbound: 1, outbound: 2 };
  return [...edges.values()].sort(
    (left, right) =>
      scopeRank[left.scope] - scopeRank[right.scope] ||
      compareIssuesByExecution(left.source, right.source) ||
      compareIssuesByExecution(left.target, right.target) ||
      left.type.localeCompare(right.type),
  );
}

export function epicBlockingDag(hierarchy: Hierarchy, epicId: string): EpicDagModel {
  const workItems = epicWorkItems(hierarchy, epicId).map(({ issue }) => issue);
  const workIds = new Set(workItems.map((issue) => issue.id));
  const edges = epicDependencyEdges(hierarchy, epicId)
    .filter(
      (edge) =>
        edge.kind === 'blocking' &&
        edge.scope === 'internal' &&
        workIds.has(edge.source.id) &&
        workIds.has(edge.target.id),
    )
    .map((edge) => ({
      key: edge.key,
      prerequisite: edge.target,
      dependent: edge.source,
      type: edge.type,
    }));

  const connectedIds = new Set<string>();
  const outgoing = new Map<string, EpicDagEdge[]>();
  const indegree = new Map(workItems.map((issue) => [issue.id, 0]));
  for (const edge of edges) {
    connectedIds.add(edge.prerequisite.id);
    connectedIds.add(edge.dependent.id);
    const current = outgoing.get(edge.prerequisite.id) ?? [];
    current.push(edge);
    outgoing.set(edge.prerequisite.id, current);
    indegree.set(edge.dependent.id, (indegree.get(edge.dependent.id) ?? 0) + 1);
  }

  const issuesById = new Map(workItems.map((issue) => [issue.id, issue]));
  const queue = workItems
    .filter((issue) => connectedIds.has(issue.id) && indegree.get(issue.id) === 0)
    .sort(compareIssuesByExecution);
  const layerById = new Map<string, number>();
  const processed = new Set<string>();

  while (queue.length) {
    const issue = queue.shift()!;
    if (processed.has(issue.id)) continue;
    processed.add(issue.id);
    const layer = layerById.get(issue.id) ?? 0;
    for (const edge of outgoing.get(issue.id) ?? []) {
      layerById.set(edge.dependent.id, Math.max(layerById.get(edge.dependent.id) ?? 0, layer + 1));
      const nextDegree = (indegree.get(edge.dependent.id) ?? 0) - 1;
      indegree.set(edge.dependent.id, nextDegree);
      if (nextDegree === 0) {
        const dependent = issuesById.get(edge.dependent.id);
        if (dependent) {
          queue.push(dependent);
          queue.sort(compareIssuesByExecution);
        }
      }
    }
  }

  const unresolvedIds = new Set(
    workItems
      .filter((issue) => connectedIds.has(issue.id) && !processed.has(issue.id))
      .map((issue) => issue.id),
  );
  const cycleIds = findDirectedCycleIds(unresolvedIds, edges);
  const cycleIssues = workItems
    .filter((issue) => cycleIds.has(issue.id))
    .sort(compareIssuesByExecution);
  const cycleBlockedIssues = workItems
    .filter((issue) => unresolvedIds.has(issue.id) && !cycleIds.has(issue.id))
    .sort(compareIssuesByExecution);
  const layers: IssueRecord[][] = [];
  for (const issue of workItems.filter((item) => processed.has(item.id))) {
    const layer = layerById.get(issue.id) ?? 0;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(issue);
  }
  for (const layer of layers) layer.sort(compareIssuesByExecution);

  return {
    layers,
    independent: workItems
      .filter((issue) => !connectedIds.has(issue.id))
      .sort(compareIssuesByExecution),
    edges,
    hasCycle: cycleIssues.length > 0,
    cycleIssues,
    cycleBlockedIssues,
  };
}

function findDirectedCycleIds(nodeIds: Set<string>, edges: EpicDagEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    if (nodeIds.has(edge.prerequisite.id) && nodeIds.has(edge.dependent.id)) {
      adjacency.get(edge.prerequisite.id)?.push(edge.dependent.id);
    }
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycleIds = new Set<string>();

  const visit = (id: string) => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const adjacentId of adjacency.get(id) ?? []) {
      if (!indices.has(adjacentId)) {
        visit(adjacentId);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(adjacentId)!));
      } else if (onStack.has(adjacentId)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(adjacentId)!));
      }
    }

    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);

    const hasSelfLoop = component.some((memberId) =>
      (adjacency.get(memberId) ?? []).includes(memberId),
    );
    if (component.length > 1 || hasSelfLoop) {
      component.forEach((memberId) => cycleIds.add(memberId));
    }
  };

  for (const id of nodeIds) {
    if (!indices.has(id)) visit(id);
  }
  return cycleIds;
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
