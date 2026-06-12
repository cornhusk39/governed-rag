# Contributing

Thanks for taking a look. This is a small, self-contained TypeScript monorepo;
everything runs locally with no API keys.

## Layout

pnpm workspace with three packages:

- `packages/core` — the governed pipeline: ingest, retrieval, generation,
  verification, audit, and OTel instrumentation. No framework or UI code.
- `packages/cli` — `ingest`, `query`, and `export` commands that drive core.
- `packages/web` — Next.js App Router app: the query UI and the audit log
  explorer, read-only over an exported snapshot.

Eval assets (the AgentProbe suite, cassettes, baseline, config) live under
`eval/`. The demo snapshot builder is `scripts/build-demo.ts`.

## Working commands

```bash
pnpm install
pnpm test        # Vitest across all packages, no network or keys
pnpm -r typecheck
pnpm lint
pnpm build
```

## Conventions

- Comments explain why, not what, in plain language.
- Conventional commits, one logical change per commit.
- Tests ride along with each change; the suite stays green and never depends on
  the network or live API keys (fixtures and recorded cassettes cover those
  paths).
- Secrets live in environment variables only. Update `.env.example` whenever a
  new variable is introduced.
- Retrieved document text is untrusted input everywhere it flows, and audit
  writes are append-only.

## Before opening a PR

Run the full local gate:

```bash
pnpm -r typecheck && pnpm lint && pnpm test && pnpm build
```

`./publish-gate.sh` runs the same checks plus full-history secret scans; it must
exit clean before any release.
