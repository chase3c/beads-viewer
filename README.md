# Beads Viewer

A focused, local, read-only web interface for reviewing [Beads](https://github.com/gastownhall/beads) breakdowns.

Beads Viewer is built for the review moment: open an epic, understand its nested stories and tasks, inspect the full description/design/acceptance criteria/notes, and see status and dependency context without an editing surface competing for attention.

> This project is intentionally narrower than full Beads clients such as [`mantoni/beads-ui`](https://github.com/mantoni/beads-ui). It is not a board, issue editor, or multi-workspace manager. One repository is fixed when the process starts, and the browser receives no mutation API.

## What it provides

- Epic and work-item overview with status counts
- Arbitrary-depth parent/child trees—not assumptions about `epic → story → task`
- Expand/collapse plus cycle and orphan safeguards
- Search and status/type/priority/label filters persisted in the URL
- Matching descendants retain their ancestors for context
- Deep-linked detail views with breadcrumbs
- Description, design, acceptance criteria, notes, labels, lifecycle metadata, and relationships
- Responsive light/dark interface with accessible tree keyboard navigation, a focus-managed mobile detail dialog, and error/empty/loading states
- Manual refresh against the live local Beads workspace

## Requirements

- Node.js 20 or newer
- pnpm 10
- An installed `bd` executable available on `PATH`
- A repository initialized for Beads

Beads Viewer uses the installed `bd`; it does not download, pin, upgrade, or downgrade Beads. The current compatibility target includes the repository owner's installed `bd 1.2.1`, while response parsing accepts both legacy raw JSON and the versioned JSON envelope.

## Install as a local command

Clone the repository once, then link the checkout into your local Node installation. This does not publish or download an npm package:

```sh
git clone https://github.com/chase3c/beads-viewer.git
cd beads-viewer
pnpm install
pnpm install:local
```

After that, open a terminal in any Beads repository and run one command:

```sh
beads-viewer
```

The repository defaults to the current directory. You can also point it at another repository directly:

```sh
beads-viewer /path/to/a/beads/repository
```

Choose a port when needed:

```sh
beads-viewer --port 4177
```

The browser opens automatically. Use `beads-viewer --no-open` when you only want to start the service and print its URL.

The server always binds to `127.0.0.1`. With no `--port`, it selects an available port and prints the URL. Because the command is symlinked to this checkout, rebuilding after pulling updates is enough; you do not need to link it again.

## Development

Point the development server at a Beads repository and start Vite plus the API:

```sh
pnpm install
BEADS_REPO=/path/to/a/beads/repository pnpm dev
```

Open <http://127.0.0.1:5173>. The API listens on `127.0.0.1:4300` and Vite proxies `/api` during development.

Quality gates:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

## Read-only design and security boundary

The service has a deliberately small boundary:

- The repository path is accepted only as a startup argument, canonicalized once, and used as the `cwd` for `bd`.
- The browser cannot submit a filesystem path, command, subcommand, executable, or arbitrary flags.
- The adapter has six fixed operations: version, context, complete brief list, derived blocked and ready views, and one issue detail.
- Every operation is constructed internally with `bd --readonly --json` and `BD_JSON_ENVELOPE=1`.
- `BEADS_DB` is removed from child environments so it cannot override normal workspace discovery.
- Commands use argument arrays with `shell: false`, execute serially, and have queue/time/output/issue limits.
- The case-sensitive HTTP API exposes only GET/HEAD, validates API-like paths plus Host and Origin, does not enable CORS, and returns no-store responses with restrictive security headers.
- User-authored Markdown is rendered without raw HTML and unsafe link protocols are removed.
- The process binds only to IPv4 loopback and provides no remote-serving option.

### Important limitation

“Read-only” here means **the viewer exposes no mutation actions and every Beads issue-data command passes `--readonly`**. It is not an operating-system filesystem sandbox. Behavior inside `bd` is controlled by the installed upstream version; some released Beads versions may perform startup maintenance, metadata updates, or schema migrations even around otherwise read-only commands. If filesystem-level immutability is required, use an isolated snapshot/copy or enforce write restrictions outside this process and verify that the installed Beads/Dolt version can open successfully under those restrictions.

The viewer fails closed on malformed/unsupported output. It never falls back to direct Dolt/SQL reads or an editable HTTP server.

## Architecture

```text
browser (React/Vite)
  └── fixed GET API (Express, loopback only)
       └── serialized command adapter
            └── bd --readonly --json <allowlisted operation>
                 cwd = canonical startup repository
```

The index uses `list --all --brief --flat` so closed children remain visible without loading large prose fields, then annotates those records by ID from the fixed `blocked` and `ready` views so derived work state is accurate. Full issue context is fetched lazily with `show --brief-deps`.

## License

MIT
