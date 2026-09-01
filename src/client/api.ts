import type { DetailResponse, IndexResponse } from '../shared/contracts.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok)
    throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}

export function getIndex(refresh = false): Promise<IndexResponse> {
  return getJson<IndexResponse>(refresh ? '/api/index?refresh=1' : '/api/index');
}

export function getIssue(id: string): Promise<DetailResponse> {
  return getJson<DetailResponse>(`/api/issues/${encodeURIComponent(id)}`);
}
