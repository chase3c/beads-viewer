#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { parseArgs } from './cli-args.js';
import { startViewer } from './server/start.js';

const usage = `beads-viewer [repository] [options]

A focused, read-only local viewer for Beads breakdowns.

Options:
  --port <number>  Use a specific loopback port (default: an available port)
  --no-open        Start without opening your default browser
  -h, --help       Show this help
`;

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage);
    return;
  }

  const staticDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
  const result = await startViewer({
    repositoryPath: parsed.repositoryPath,
    port: parsed.port,
    staticDirectory,
  });

  console.log(`Beads Viewer: ${result.url}`);
  console.log(`Repository: ${result.repositoryRoot}`);
  console.log('Read-only command policy active. Press Ctrl+C to stop.');
  if (parsed.open) await open(result.url);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => result.server.close(() => process.exit(0)));
  }
}

main().catch((error: unknown) => {
  console.error(`beads-viewer: ${error instanceof Error ? error.message : 'unexpected failure'}`);
  process.exitCode = 1;
});
