import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import path from 'node:path';
import { BdRunnerError, isValidIssueId } from './bd-runner.js';
import { RepositoryDataError, type RepositoryReader } from './repository.js';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function createApp(reader: RepositoryReader, staticDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);

  app.use((request, response, next) => {
    applySecurityHeaders(response);
    const normalizedPath = request.path.toLowerCase();
    const isApiLike = normalizedPath === '/api' || normalizedPath.startsWith('/api/');
    if (!isApiLike) return next();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
    }
    const host = parseHostname(request.get('host'));
    if (!host || !ALLOWED_HOSTS.has(host)) {
      return response.status(403).json({ error: 'Host is not allowed', code: 'invalid_host' });
    }
    const origin = request.get('origin');
    if (origin && !isAllowedOrigin(origin)) {
      return response.status(403).json({ error: 'Origin is not allowed', code: 'invalid_origin' });
    }
    if (request.path !== normalizedPath) {
      return response.status(404).json({ error: 'API route not found', code: 'not_found' });
    }
    next();
  });

  app.get('/api/index', async (request, response, next) => {
    try {
      response.json(await reader.getIndex(request.query.refresh === '1'));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/issues/:id', async (request, response, next) => {
    try {
      if (!isValidIssueId(request.params.id)) {
        return response.status(400).json({ error: 'Invalid issue ID', code: 'invalid_issue_id' });
      }
      response.json(await reader.getIssue(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found', code: 'not_found' });
  });

  if (staticDirectory) {
    app.use(express.static(staticDirectory, { index: false, etag: false, maxAge: 0 }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      response.sendFile(path.join(staticDirectory, 'index.html'));
    });
  }

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next;
    const status =
      error instanceof RepositoryDataError && error.code === 'not_found'
        ? 404
        : error instanceof BdRunnerError && error.code === 'invalid'
          ? 400
          : error instanceof BdRunnerError && error.code === 'busy'
            ? 429
            : 503;
    const code =
      error instanceof RepositoryDataError || error instanceof BdRunnerError
        ? error.code
        : 'viewer_unavailable';
    const message =
      error instanceof RepositoryDataError || error instanceof BdRunnerError
        ? error.message
        : 'The Beads viewer is temporarily unavailable';
    response.status(status).json({ error: message, code });
  });

  return app;
}

function applySecurityHeaders(response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function parseHostname(host: string | undefined): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
