# AgeOS app

The AgeOS deterministic chassis: a Next.js (App Router) application with real
PostgreSQL persistence and business rules, 9 ERP modules and 42 skills
(capabilities), a scripted assistant, and simulated external integrations. It
is the investor-demo build described by the specification documents in the
parent directory (start with `../CLAUDE.md`).

Boundaries of this build: `AGEOS_DEMO_MODE=true`, `AGEOS_ASSISTANT_MODE=scripted`,
`AGEOS_CONNECTOR_MODE=simulated`. No LLM, model SDK or business-provider call
is made at runtime. Data is synthetic. Integrations are simulated and labelled.

Built on the licensed Verve/ReUI template (Next.js 16, React 19, Tailwind 4,
Base UI, Drizzle ORM). The template's terms are in
[LICENSE-VERVE.md](LICENSE-VERVE.md); they forbid publishing it to a public
repository.

## Prerequisites

- Node.js >= 20.9
- pnpm 10.28.0 (pinned in `packageManager`; run `corepack enable`)
- PostgreSQL 16 with two roles: `ageos_owner` (schema owner; migrations and
  seed) and `ageos_app` (runtime, `NOSUPERUSER NOBYPASSRLS`)

## Environment

```bash
cp .env.example .env.local
```

Fill in `.env.local` locally; it is git-ignored and must never be committed.
Set the database URLs for both roles, `AGEOS_SESSION_SECRET` (at least 32
random characters, for example `openssl rand -hex 32`) and
`AGEOS_DEMO_ACCESS_CODE` (at least 6 characters). Test URLs must point at a
separate database whose name starts with `ageos_test`. `REUI_LICENSE_KEY` is
only needed to add premium ReUI blocks with the shadcn CLI and belongs in the
shell environment, not in source.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server (http://localhost:3000) |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm test:e2e` | Playwright against a running server (`E2E_BASE_URL`, default `http://localhost:3100`) |
| `pnpm test:agent <name>` | Vitest on an isolated per-agent test database (`core1`, `core2`, `core3`, `platform`, `assistant`, `screens`, `qa`, `coord`) |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:migrate` / `pnpm db:migrate:test` | Apply migrations and the security baseline (dev / test database) |
| `pnpm db:seed:demo` | Seed the demo tenants |
| `pnpm db:reset:demo` | Re-seed the demo tenants (`--reset`) |
| `pnpm db:reset:demo:intake` | Re-seed from intake (`--reset --mode=from_intake`) |

First run: `pnpm install`, `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm dev`.

## Architecture pointers

- `server/kernel/` — command bus (`commands.ts`), approvals (`approvals.ts`)
  and errors. Mutations go through validated commands with actor, tenant,
  expected revision and audit.
- `server/capabilities/` — capability registry (`registry.ts`) over the 42
  catalog skills; per-module handlers in `handlers/`; `runner.ts` executes
  them. The contracts come from `lib/capabilities/`.
- `server/domain/` — business logic (jobs, billing, collections, payables,
  media planning/buying, close, profitability and so on).
- `server/assistant/` — the scripted assistant driver (`driver.ts`) and its
  scenarios, thread store and views. It calls the same registry and commands as
  the UI.
- `server/db/`, `drizzle/` — schema, client and SQL migrations. Tenant
  isolation uses row-level security keyed on `app.tenant_id`, set per
  transaction by `withTenant` (`server/db/tenant.ts`); `drizzle/0001_security.sql`
  defines the grants and policies.
- `components/openui/` — OpenUI renderer for assistant-composed views.
- `app/` — routes (App Router); `components/` — UI, including ReUI/shadcn
  primitives in `components/ui/` and `components/reui/`.
- `tests/` — `unit/`, `integration/` (Vitest) and `e2e/` (Playwright).
  `evidence/` holds recorded acceptance output.

## Docs

- [DECISIONS.md](DECISIONS.md) — implementation decisions and their reasons.
- [docs/COORDINATION.md](docs/COORDINATION.md) — build coordination rules and
  file ownership.
- [docs/qa/coverage-matrix.md](docs/qa/coverage-matrix.md) — QA coverage
  matrix.

## License

Proprietary, all rights reserved. See [../LICENSE](../LICENSE) and
[../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). Private repository: do
not make it public or share it outside the organisation.
