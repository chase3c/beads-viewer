export interface DependencyRecord {
  issue_id?: string;
  depends_on_id?: string;
  id?: string;
  title?: string;
  type?: string;
  dependency_type?: string;
  status?: string;
  [key: string]: unknown;
}

export interface IssueRecord {
  id: string;
  title: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  owner?: string;
  assignee?: string;
  parent?: string;
  labels: string[];
  dependencies: DependencyRecord[];
  dependents: DependencyRecord[];
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  closed_at?: string;
  due_at?: string;
  defer_until?: string;
  close_reason?: string;
  external_ref?: string;
  spec_id?: string;
  estimated_minutes?: number;
  is_blocked?: boolean;
  is_ready?: boolean;
  [key: string]: unknown;
}

export interface ViewerDiagnostics {
  repositoryRoot: string;
  repositoryName: string;
  beadsDirectory?: string;
  database?: string;
  backend?: string;
  bdVersion: string;
  wireSchemaVersion?: number;
  refreshedAt: string;
}

export interface IndexResponse {
  diagnostics: ViewerDiagnostics;
  issues: IssueRecord[];
  counts: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    blocked: number;
    ready: number;
  };
}

export interface DetailResponse {
  issue: IssueRecord;
}

export interface ApiErrorBody {
  error: string;
  code: string;
}

const ARRAY_FIELDS_PRESENT = Symbol('beads-viewer-array-fields-present');
type IssueArrayField = 'labels' | 'dependencies' | 'dependents';
type IssueWithPresence = IssueRecord & { [ARRAY_FIELDS_PRESENT]?: Set<IssueArrayField> };

const STRING_FIELDS = [
  'description',
  'design',
  'acceptance_criteria',
  'notes',
  'status',
  'issue_type',
  'owner',
  'assignee',
  'parent',
  'created_at',
  'updated_at',
  'started_at',
  'closed_at',
  'due_at',
  'defer_until',
  'close_reason',
  'external_ref',
  'spec_id',
] as const;
const NUMBER_FIELDS = [
  'priority',
  'dependency_count',
  'dependent_count',
  'comment_count',
  'estimated_minutes',
] as const;
const BOOLEAN_FIELDS = ['is_blocked', 'is_ready'] as const;
const DEPENDENCY_STRING_FIELDS = [
  'issue_id',
  'depends_on_id',
  'id',
  'title',
  'type',
  'dependency_type',
  'status',
] as const;

export function unwrapBdJson(value: unknown): { data: unknown; schemaVersion?: number } {
  if (isObject(value) && 'data' in value && typeof value.schema_version === 'number') {
    return { data: value.data, schemaVersion: value.schema_version };
  }
  if (isObject(value) && typeof value.schema_version === 'number') {
    const { schema_version: schemaVersion, ...data } = value;
    return { data, schemaVersion };
  }
  return { data: value };
}

export function normalizeIssue(value: unknown): IssueRecord | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    return null;
  }

  const result = { ...value } as IssueWithPresence;
  result.id = value.id;
  result.title = value.title;
  for (const field of STRING_FIELDS) normalizeOptionalString(result, value, field);
  for (const field of NUMBER_FIELDS) normalizeOptionalNumber(result, value, field);
  for (const field of BOOLEAN_FIELDS) normalizeOptionalBoolean(result, value, field);

  result.labels = Array.isArray(value.labels)
    ? value.labels.filter((label): label is string => typeof label === 'string')
    : [];
  result.dependencies = normalizeDependencies(value.dependencies);
  result.dependents = normalizeDependencies(value.dependents);

  const present = new Set<IssueArrayField>();
  for (const field of ['labels', 'dependencies', 'dependents'] as const) {
    if (Object.hasOwn(value, field)) present.add(field);
  }
  Object.defineProperty(result, ARRAY_FIELDS_PRESENT, { value: present, enumerable: false });

  if (!result.parent) {
    const parentEdge = result.dependencies.find(
      (dependency) =>
        (dependency.type === 'parent-child' || dependency.dependency_type === 'parent-child') &&
        typeof dependency.depends_on_id === 'string',
    );
    if (parentEdge?.depends_on_id) result.parent = parentEdge.depends_on_id;
  }

  return result;
}

export function arrayFieldWasPresent(issue: IssueRecord, field: IssueArrayField): boolean {
  return (issue as IssueWithPresence)[ARRAY_FIELDS_PRESENT]?.has(field) ?? false;
}

function normalizeDependencies(value: unknown): DependencyRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((dependency) => {
    const result: DependencyRecord = { ...dependency };
    for (const field of DEPENDENCY_STRING_FIELDS)
      normalizeOptionalString(result, dependency, field);
    return result;
  });
}

function normalizeOptionalString(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  field: string,
) {
  if (typeof source[field] === 'string') target[field] = source[field];
  else delete target[field];
}

function normalizeOptionalNumber(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  field: string,
) {
  const value = source[field];
  if (typeof value === 'number' && Number.isFinite(value)) target[field] = value;
  else delete target[field];
}

function normalizeOptionalBoolean(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  field: string,
) {
  if (typeof source[field] === 'boolean') target[field] = source[field];
  else delete target[field];
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
