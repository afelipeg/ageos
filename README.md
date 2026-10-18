# AgeOS

Proprietary software. Private repository. Not open source.

AgeOS is a configurable ERP for agencies. This repository holds the product
specification and the deterministic investor-demo application ("chassis").

- **Scope:** 9 ERP modules and 42 skills (capabilities), UI in English with
  Spanish available.
- **Deterministic investor demo:** data, permissions, calculations and
  approvals are real and persisted in PostgreSQL. Demo data is synthetic.
- **Scripted assistant:** the assistant is the existing `agency-orchestrator`
  driven by a versioned, scripted scenario driver over the same command and
  capability registry as the screens. It makes no LLM calls and no model or
  business-provider calls at runtime, and is labelled "Scripted demo".
- **Simulated integrations:** ads, payments, accounting, OAuth and DNS adapters
  are simulated and labelled as such. Nothing real is purchased, transferred or
  registered.

## Repository layout

| Path | Contents |
|---|---|
| `00-LEEME.md` … `08-instruccion-2-demo-e2e.md`, `04A-…` | Specification documents (in Spanish): brief, screens and flows, deterministic chassis, ReUI selection, investor script, acceptance, global assistant, E2E instruction. Start with `CLAUDE.md`, which gives the reading order. |
| `*.json` (root) | Contracts: `rutas-y-pantallas.json`, `cobertura-42-skills.json`, `demo-fixtures.json`, `demo-scenarios-v1.json`, `asistente-global-v1.json`, `reui-*.json`, `VALIDACION-PAQUETE.json`. |
| `referencias/` | Target-architecture reference material (skills matrix, connection catalog, architecture). The skills archive `agency-erp-all-skills.zip` is not versioned. |
| `configuracion/` | Example MCP configuration files (placeholders only, no credentials). |
| `inputs/` | Local inputs. The licensed Verve template archive under `inputs/reui/verve/` is never versioned. |
| `app/` | The Next.js application. See [app/README.md](app/README.md). |

## Quick start (`app/`)

Prerequisites: Node.js >= 20.9, corepack (pnpm 10.28.0 is pinned in
`packageManager`), PostgreSQL 16.

1. Create a PostgreSQL database and two roles, as a PostgreSQL admin (this is
   not scripted in the repository): `ageos_owner` (owns the schema; used for
   migrations and the demo seed) and `ageos_app` (runtime role, least
   privilege, `NOSUPERUSER NOBYPASSRLS`). Row-level security is enforced for
   `ageos_app`.
2. Configure the environment:

   ```bash
   cd app
   cp .env.example .env.local   # then fill in values locally; never commit it
   ```

   Variables (see `app/.env.example`): `DATABASE_URL` (as `ageos_app`),
   `DATABASE_URL_MIGRATIONS` (as `ageos_owner`), `TEST_DATABASE_URL` and
   `TEST_DATABASE_URL_MIGRATIONS` (a separate database whose name starts with
   `ageos_test`), `AGEOS_SESSION_SECRET` (at least 32 random characters, for
   example `openssl rand -hex 32`), `AGEOS_DEMO_ACCESS_CODE` (at least 6
   characters), `AGEOS_DEMO_MODE=true`, `AGEOS_ASSISTANT_MODE=scripted`,
   `AGEOS_CONNECTOR_MODE=simulated`, `AGEOS_DEPLOYMENT_PROFILE=local`,
   `AGEOS_STORAGE_DIR` (private evidence uploads, default `.data/private-files`)
   and `REUI_LICENSE_KEY` (only needed to add premium ReUI blocks with the
   shadcn CLI; keep it in the shell environment).
3. Install, migrate, seed and run:

   ```bash
   corepack enable
   pnpm install
   pnpm db:migrate
   pnpm db:seed:demo
   pnpm dev
   ```

   Open http://localhost:3000 and sign in with the access code you set.

Quality commands (run in `app/`):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

`pnpm test:e2e` runs Playwright (system Google Chrome) against an
already-running server (`E2E_BASE_URL`, default `http://localhost:3100`); it does
not start one. Specs that mutate data run only when
`E2E_DATABASE_URL_MIGRATIONS` points at a dedicated database whose name
contains `e2e`.

`pnpm test:agent <name>` runs Vitest against an isolated per-agent test
database that is rebuilt on every run (`name` is one of `core1`, `core2`,
`core3`, `platform`, `assistant`, `screens`, `qa`, `coord`). It requires the
`TEST_DATABASE_URL*` variables.

## Status

Work in progress — Instruction 2 (full E2E demo) certification pending. See
app/IMPLEMENTATION_STATUS.md once published.

## License

Copyright (c) 2026 Andrés Felipe Gutiérrez Henao. Proprietary, all rights
reserved. See [LICENSE](LICENSE) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Confidentiality

This is a private repository. Do not add collaborators outside the
organisation and do not make it public: the application is built on the
licensed Verve/ReUI template, whose license forbids publishing it to a public
repository or sharing it outside the organisation (see
[app/LICENSE-VERVE.md](app/LICENSE-VERVE.md)).
