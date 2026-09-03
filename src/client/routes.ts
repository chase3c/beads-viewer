export interface GeneralRoute {
  kind: 'general';
  issueId?: string;
}

export interface EpicRoute {
  kind: 'epic';
  epicId: string;
  issueId?: string;
}

export type ViewerRoute = GeneralRoute | EpicRoute;

export function readRoute(pathname = window.location.pathname): ViewerRoute {
  const epicChild = pathname.match(/^\/epics\/([^/]+)\/issues\/([^/]+)$/);
  if (epicChild) {
    const epicId = decodeSegment(epicChild[1]);
    const issueId = decodeSegment(epicChild[2]);
    if (epicId && issueId) return { kind: 'epic', epicId, issueId };
  }
  const epic = pathname.match(/^\/epics\/([^/]+)$/);
  if (epic) {
    const epicId = decodeSegment(epic[1]);
    if (epicId) return { kind: 'epic', epicId };
  }
  const issue = pathname.match(/^\/issues\/([^/]+)$/);
  if (issue) {
    const issueId = decodeSegment(issue[1]);
    if (issueId) return { kind: 'general', issueId };
  }
  return { kind: 'general' };
}

export function routePath(route: ViewerRoute): string {
  if (route.kind === 'epic') {
    const epic = encodeURIComponent(route.epicId);
    return route.issueId
      ? `/epics/${epic}/issues/${encodeURIComponent(route.issueId)}`
      : `/epics/${epic}`;
  }
  return route.issueId ? `/issues/${encodeURIComponent(route.issueId)}` : '/';
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
