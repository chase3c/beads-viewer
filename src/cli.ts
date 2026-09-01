#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { startViewer } from './server/start.js';

const usage = `beads-viewer [repository] [options]

A focused, read-only local viewer for Beads breakdowns.

Options:
  --port <number>  Use a specific loopback port (default: an available port)
  --open           Open the viewer in your default browser
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

interface ParsedArgs {
  repositoryPath: string;
  port?: number;
  open: boolean;
  help: boolean;
}

export function parseArgs(args: string[]): ParsedArgs {
  let repositoryPath: string | undefined;
  let port: number | undefined;
  let shouldOpen = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--open') shouldOpen = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--port') {
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
        throw new Error('--port must be an integer between 0 and 65535');
      }
      port = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (repositoryPath) {
      throw new Error('Only one repository path may be supplied');
    } else {
      repositoryPath = arg;
    }
  }

  return { repositoryPath: repositoryPath ?? process.cwd(), port, open: shouldOpen, help };
}

main().catch((error: unknown) => {
  console.error(`beads-viewer: ${error instanceof Error ? error.message : 'unexpected failure'}`);
  process.exitCode = 1;
});
