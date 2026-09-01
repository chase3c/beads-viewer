import path from 'node:path';
import type { DetailResponse, IndexResponse, IssueRecord } from '../shared/contracts.js';
import {
  arrayFieldWasPresent,
  isObject,
  normalizeIssue,
  unwrapBdJson,
} from '../shared/contracts.js';
import { summarizeIssues } from '../shared/model.js';
import type { BdOperation } from './bd-runner.js';

export interface BdCommandRunner {
  run(operation: BdOperation): Promise<unknown>;
}

export interface RepositoryReader {
  getIndex(force?: boolean): Promise<IndexResponse>;
  getIssue(id: string): Promise<DetailResponse>;
}

export class RepositoryService implements RepositoryReader {
  private cache?: IndexResponse;
  private refreshPromise?: Promise<IndexResponse>;

  constructor(
    private readonly repositoryRoot: string,
    private readonly runner: BdCommandRunner,
    private readonly issueCap = 5_000,
  ) {}

  getIndex(force = false): Promise<IndexResponse> {
    if (!force && this.cache) return Promise.resolve(this.cache);
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadIndex().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  async getIssue(id: string): Promise<DetailResponse> {
    const raw = unwrapBdJson(await this.runner.run({ kind: 'show', id })).data;
    const candidates = Array.isArray(raw) ? raw : [raw];
    const detail = candidates.map(normalizeIssue).find((issue) => issue?.id === id);
    if (!detail) throw new RepositoryDataError('Issue was not found', 'not_found');

    const cached = this.cache?.issues.find((issue) => issue.id === id);
    return { issue: mergeIssue(cached, detail) };
  }

  private async loadIndex(): Promise<IndexResponse> {
    const versionResult = unwrapBdJson(await this.runner.run({ kind: 'version' }));
    const contextResult = unwrapBdJson(await this.runner.run({ kind: 'context' }));
    const listResult = unwrapBdJson(
      await this.runner.run({ kind: 'list', maxRows: this.issueCap }),
    );
    const listedIssues = normalizeIssueArray(listResult.data, 'list', this.issueCap);
    const blockedResult = unwrapBdJson(await this.runner.run({ kind: 'blocked' }));
    const blockedIssues = normalizeIssueArray(blockedResult.data, 'blocked', this.issueCap);
    const readyResult = unwrapBdJson(
      await this.runner.run({ kind: 'ready', maxRows: this.issueCap }),
    );
    const readyIssues = normalizeIssueArray(readyResult.data, 'ready', this.issueCap);
    const blockedIds = new Set(blockedIssues.map((issue) => issue.id));
    const readyIds = new Set(readyIssues.map((issue) => issue.id));
    const issues = listedIssues.map((issue) => ({
      ...issue,
      is_blocked: blockedIds.has(issue.id),
      is_ready: readyIds.has(issue.id),
    }));

    const versionData = isObject(versionResult.data) ? versionResult.data : {};
    const contextData = isObject(contextResult.data) ? contextResult.data : {};
    const resolvedRoot = stringValue(contextData.repo_root) ?? this.repositoryRoot;
    const backend = [stringValue(contextData.backend), stringValue(contextData.dolt_mode)]
      .filter(Boolean)
      .join(' / ');

    const result: IndexResponse = {
      diagnostics: {
        repositoryRoot: resolvedRoot,
        repositoryName: path.basename(resolvedRoot),
        beadsDirectory: stringValue(contextData.beads_dir),
        database: stringValue(contextData.database),
        backend: backend || undefined,
        bdVersion:
          stringValue(versionData.version) ?? stringValue(contextData.bd_version) ?? 'unknown',
        wireSchemaVersion:
          listResult.schemaVersion ?? contextResult.schemaVersion ?? versionResult.schemaVersion,
        refreshedAt: new Date().toISOString(),
      },
      issues,
      counts: summarizeIssues(issues),
    };
    this.cache = result;
    return result;
  }
}

export class RepositoryDataError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'unsupported_contract' | 'issue_limit',
  ) {
    super(message);
    this.name = 'RepositoryDataError';
  }
}

function mergeIssue(cached: IssueRecord | undefined, detail: IssueRecord): IssueRecord {
  if (!cached) return detail;
  return {
    ...cached,
    ...detail,
    labels: arrayFieldWasPresent(detail, 'labels') ? detail.labels : cached.labels,
    dependencies: arrayFieldWasPresent(detail, 'dependencies')
      ? detail.dependencies
      : cached.dependencies,
    dependents: arrayFieldWasPresent(detail, 'dependents') ? detail.dependents : cached.dependents,
    is_blocked: cached.is_blocked,
    is_ready: cached.is_ready,
  };
}

function normalizeIssueArray(value: unknown, operation: string, issueCap: number): IssueRecord[] {
  if (!Array.isArray(value)) {
    throw new RepositoryDataError(`Unsupported bd ${operation} response`, 'unsupported_contract');
  }
  if (value.length > issueCap) {
    throw new RepositoryDataError('Repository exceeds the configured issue limit', 'issue_limit');
  }
  const issues = value.map(normalizeIssue).filter((issue): issue is IssueRecord => !!issue);
  if (issues.length !== value.length) {
    throw new RepositoryDataError(
      `One or more ${operation} issues had an unsupported shape`,
      'unsupported_contract',
    );
  }
  return issues;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
