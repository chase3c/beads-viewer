import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import type { RepositoryReader } from '../../src/server/repository.js';

const index = {
  diagnostics: {
    repositoryRoot: '/repo',
    repositoryName: 'repo',
    bdVersion: '1.2.1',
    refreshedAt: '2026-01-01T00:00:00Z',
  },
  issues: [],
  counts: { total: 0, byStatus: {}, byType: {}, blocked: 0, ready: 0 },
};

function reader(): RepositoryReader {
  return {
    getIndex: vi.fn(async () => index),
    getIssue: vi.fn(async (id) => ({
      issue: { id, title: id, labels: [], dependencies: [], dependents: [] },
    })),
  };
}

describe('HTTP boundary', () => {
  it('allows loopback GET requests and applies security headers', async () => {
    const response = await request(createApp(reader()))
      .get('/api/index')
      .set('Host', '127.0.0.1:4444')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects DNS-rebinding hosts, foreign origins, mutation methods, and mixed-case API paths', async () => {
    const repository = reader();
    const app = createApp(repository);
    await request(app).get('/api/index').set('Host', 'evil.example').expect(403);
    await request(app)
      .get('/api/index')
      .set('Host', '127.0.0.1')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app).post('/api/index').set('Host', '127.0.0.1').expect(405);
    await request(app).get('/API/index').set('Host', '127.0.0.1').expect(404);
    await request(app).get('/api/Issues/repo-1').set('Host', '127.0.0.1').expect(404);
    expect(repository.getIndex).not.toHaveBeenCalled();
    expect(repository.getIssue).not.toHaveBeenCalled();
  });

  it('classifies invalid issue IDs as client errors', async () => {
    const repository = reader();
    const response = await request(createApp(repository))
      .get('/api/issues/bad~id')
      .set('Host', '127.0.0.1')
      .expect(400);
    expect(response.body.code).toBe('invalid_issue_id');
    expect(repository.getIssue).not.toHaveBeenCalled();
  });

  it('maps repository failures to a bounded JSON error', async () => {
    const broken: RepositoryReader = {
      getIndex: async () => {
        throw new Error('secret details');
      },
      getIssue: async () => {
        throw new Error('secret');
      },
    };
    const response = await request(createApp(broken))
      .get('/api/index')
      .set('Host', 'localhost')
      .expect(503);
    expect(response.body).toEqual({
      error: 'The Beads viewer is temporarily unavailable',
      code: 'viewer_unavailable',
    });
  });
});
