import { startViewer } from './start.js';

const result = await startViewer({
  repositoryPath: process.env.BEADS_REPO ?? process.cwd(),
  port: 4300,
});
console.log(`Beads Viewer API: ${result.url}`);
console.log(`Repository: ${result.repositoryRoot}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => result.server.close(() => process.exit(0)));
}
