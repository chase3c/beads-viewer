import { realpath, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { BdRunner } from './bd-runner.js';
import { createApp } from './app.js';
import { RepositoryService } from './repository.js';

export interface StartOptions {
  repositoryPath: string;
  port?: number;
  staticDirectory?: string;
}

export async function startViewer(options: StartOptions): Promise<{
  server: Server;
  url: string;
  repositoryRoot: string;
}> {
  const repositoryRoot = await realpath(options.repositoryPath);
  if (!(await stat(repositoryRoot)).isDirectory())
    throw new Error('Repository path is not a directory');

  const runner = new BdRunner(repositoryRoot);
  const repository = new RepositoryService(repositoryRoot, runner);
  await repository.getIndex();
  const app = createApp(repository, options.staticDirectory);

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(options.port ?? 0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not determine listening port');
  return { server, url: `http://127.0.0.1:${address.port}`, repositoryRoot };
}
