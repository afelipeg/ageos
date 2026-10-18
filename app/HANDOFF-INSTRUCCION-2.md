# Handoff: instruction 2 (AgeOS scripted demo)

Written 2026-10-18 from the repository state and recorded evidence. Paths are relative to the application root (`claude-code-chasis-v1/app/`). Current verified status and open work are in `IMPLEMENTATION_STATUS.md`; this file is how to run, operate and continue the build. `<<E2E_PENDING>>` marks a result the certification run has not produced yet.

## 1. What this is

A deterministic AgeOS chassis (Next.js 16.2.12, React 19.2.8, PostgreSQL 16, Drizzle, Base UI / ReUI, Tailwind 4) with nine ERP modules, 42 skills, 31 route patterns, a scripted assistant (`agency-orchestrator`) and simulated integrations. Demo boundaries are fixed: `AGEOS_DEMO_MODE=true`, `AGEOS_ASSISTANT_MODE=scripted`, `AGEOS_CONNECTOR_MODE=simulated`. No model SDK, model credential or business-provider call exists at runtime. The specification set is in the parent directory (start with `../CLAUDE.md`, `../08-instruccion-2-demo-e2e.md` and `../PROMPT-UNICO-AUDITORIA-AGENTES-E-INSTRUCCION-2.md`).

## 2. Prerequisites and environment

- Node.js >= 20.9; pnpm 10.28.0 (the pinned `packageManager`; `corepack enable`). If pnpm offers to reinstall or purge `node_modules` because of a version mismatch, do not accept it while another process is working; fix the pnpm version instead.
- PostgreSQL 16 with two roles: `ageos_owner` (schema owner: migrations, seed, demo reset) and `ageos_app` (runtime, `NOSUPERUSER NOBYPASSRLS`, RLS enforced).
- `cp .env.example .env.local` and fill it locally. `.env.local` is git-ignored; never commit or print it.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | runtime | `ageos_app` role |
| `DATABASE_URL_MIGRATIONS` | migrate, seed, presenter reset | `ageos_owner`; the running app uses it only for demo reset/checkpoint, only with `AGEOS_DEMO_MODE=true` (D16) |
| `TEST_DATABASE_URL`, `TEST_DATABASE_URL_MIGRATIONS` | Vitest | must be a separate database whose name starts with `ageos_test`; `tests/global-setup.ts` refuses the dev URL |
| `AGEOS_SESSION_SECRET` | sessions | at least 32 random characters (`openssl rand -hex 32`) |
| `AGEOS_DEMO_ACCESS_CODE` | protected demo sign-in | at least 6 characters; shared with the presenter out of band, never written in docs or reports |
| `AGEOS_DEMO_MODE`, `AGEOS_ASSISTANT_MODE`, `AGEOS_CONNECTOR_MODE`, `AGEOS_DEPLOYMENT_PROFILE` | boundaries | `true` / `scripted` / `simulated` / `local` (`preview` also accepted by `server/env.ts`) |
| `AGEOS_STORAGE_DIR` | private file storage | default `.data/private-files`, outside `public/` |
| `AGEOS_ASSISTANT_MAX_STEPS`, `AGEOS_ASSISTANT_MAX_REQUESTS_PER_MINUTE` | optional limits | defaults 24 and 30 (`server/env.ts`); not in `.env.example` |
| `REUI_LICENSE_KEY` | shadcn CLI only | only to add premium ReUI blocks; keep in the shell, never in source |
| `E2E_BASE_URL`, `E2E_DATABASE_URL_MIGRATIONS`, `E2E_STORAGE_DIR`, `E2E_WORKERS`, `E2E_EVIDENCE`, `E2E_RESET` | Playwright | see section 6 |

## 3. Commands (from `package.json`)

| Command | Purpose |
|---|---|
| `pnpm dev` | `next dev` (port 3000 unless `-p` is given; the team used 3100, which is also the Playwright default) |
| `pnpm build` / `pnpm start` | `next build` / `next start` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `eslint` |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` / `pnpm test:watch` | `vitest run` / `vitest` (jsdom; integration files opt into node and use the test DB) |
| `pnpm test:e2e` | `playwright test` against an already running server |
| `pnpm test:agent <name> [vitest args]` | Vitest on an isolated database `ageos_test_<name>` (`core1`, `core2`, `core3`, `platform`, `assistant`, `screens`, `qa`, `coord`); rebuilds it from the committed migrations plus one generated WIP migration, then RLS (`scripts/test-agent.ts`) |
| `pnpm db:generate` | `drizzle-kit generate` |
| `pnpm db:migrate` / `pnpm db:migrate:test` | apply `drizzle/` migrations and `ageos_apply_security()` (grants, append-only audit, RLS) to the dev / test database; prints the RLS policy count |
| `pnpm db:seed:demo` | seed the demo tenants (idempotent: reports "already seeded") |
| `pnpm db:reset:demo` | `--reset`: rebuild the demo tenants at `ready_for_scope_review` |
| `pnpm db:reset:demo:intake` | `--reset --mode=from_intake` |

First run: `pnpm install`, `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm dev`, sign in at `/sign-in` with the access code.

## 4. Databases and safety

- Three databases, never mixed: dev (`DATABASE_URL*`), test (`TEST_DATABASE_URL*`, name `ageos_test*`) and the dedicated E2E database (`ageos_test_e2e`, section 6). Do not run `db:reset:demo`, `db:migrate` or a seed against a database other people are using.
- Reset and checkpoint loads rebuild only the demo run (Rayo de Sol, Norte Studio and agencies created during the run). Other tenants and the platform audit stream are untouched (D16). They need a presenter session, `AGEOS_DEMO_MODE=true` and a typed confirmation in `/demo/presenter`.
- Mutations are commands (`server/kernel/commands.ts`): permission -> capability enabled -> idempotency key -> strict Zod -> tenant transaction -> handler -> event + audit (D12). Money is `bigint` minor units with an explicit currency (D11).
- The demo business date is server state (`demo_run.business_date`, default 2027-03-15); the presenter can advance it (audited, bounded); domain code reads `getBusinessDate()`, never the browser clock (D17).

## 5. Demo data, checkpoints and personas

Two reproducible checkpoints (`server/seed/demo-seed.ts`, `demo-fixtures.json` `seed_modes`). Each seed opens a new `demo_run` and ends the previous one.

| Checkpoint | Command | State |
|---|---|---|
| `ready_for_scope_review` (default) | `pnpm db:reset:demo` or `/demo/presenter` -> Reset | Configured Rayo de Sol / Estudio Solar, masters, Aurora job open with approved initial authority (USD 50,000), approved budget and plan, 100 h forecast: fee 20,000, cost 11,000, margin 9,000 / 45.0%. The 40 h scope change, amendment, orders, invoices, payments and journals are **not** seeded; they arise from commands. Includes Norte Studio, the `demo-lab` exercises and the platform incident. PO revision 2 evidence is seeded as `received` (unreviewed). A Rayo configuration draft r2 is parked at Review. |
| `from_intake` | `pnpm db:reset:demo:intake` or `/demo/presenter` -> Load checkpoint | Configured agency and masters only; the Aurora client, brief, job, authority, budget, estimate and plan arise through user commands. Norte and `demo-lab` are seeded in both modes. |

Personas are synthetic (names and roles only; sign-in is by the shared access code, then switched at `/demo/presenter` -> "Act as", which rotates the session cookie and is audited):

| Persona | Role | Agency |
|---|---|---|
| Alex Rivera (`user_demo_owner`) | owner | Rayo de Sol |
| Sam Cruz (`user_demo_operator`) | account_manager | Rayo de Sol |
| Morgan Lee (`user_demo_finance`) | finance_approver | Rayo de Sol |
| Taylor Chen (`user_demo_producer`) | producer | Rayo de Sol |
| Jordan Kim (`user_demo_viewer`) | viewer | Rayo de Sol |
| Casey Martin (`user_demo_norte_owner`) | owner | Norte Studio (isolation tenant) |
| Avery Park (`user_demo_platform_operator`) | platform_operator | AgeOS platform (`/ops`) |
| Jamie Torres (`user_demo_platform_admin`) | platform_admin | AgeOS platform (`/ops`) |

Role -> permission matrix: `lib/policy.ts`. Agency identities never hold platform roles and platform identities have no agency access (`/ops` is 404 for agency sessions and `/a/...` is 404 for platform sessions). Aurora figures, cash timeline and expected journals: `../demo-fixtures.json`. Investor scripts: `docs/DEMO-SCRIPTS.md`.

## 6. Browser E2E certification

Playwright runs against an **already running** server (`E2E_BASE_URL`, default `http://localhost:3100`); it never starts one. It uses the system Google Chrome (`channel: "chrome"`, no browser download). Projects: `desktop` (1440, EN, dark), `desktop-light` and `desktop-es` (`@visual`), `mobile` (390; `@mobile|@screens|@visual`), `mobile-light-es` (`@visual`).

Read-only specs against any server (does not mutate data):

```
pnpm exec playwright test --grep-invert @mutating
```

Certification (dedicated database, coordinator). The header of `playwright.config.ts` gives:

```
E2E_BASE_URL=http://localhost:3200 \
E2E_DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e \
E2E_STORAGE_DIR=<same AGEOS_STORAGE_DIR as the server> \
pnpm exec playwright test
```

The server under test is a production build started on that database (from `evidence/test-results.md` section 4):

```
# server under test (coordinator): next build && next start on ageos_test_e2e
DATABASE_URL=<app role url>/ageos_test_e2e DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e \
AGEOS_STORAGE_DIR=.data/e2e-files PORT=3200 pnpm start
# E2E (one worker; resets checkpoints between journeys)
E2E_EVIDENCE=1 E2E_BASE_URL=http://localhost:3200 \
E2E_DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e E2E_STORAGE_DIR=.data/e2e-files \
pnpm exec playwright test
```

Rules: specs tagged `@mutating` (journeys, assistant, locale) skip unless `E2E_DATABASE_URL_MIGRATIONS` names a dedicated E2E database; with it, workers default to 1 and `tests/e2e/global-setup.ts` resets to `ready_for_scope_review` (skip with `E2E_RESET=0`) and mints one session per persona. Do not pass `--reporter` on the command line (it replaces the evidence reporter that writes `evidence/demo-e2e-results.json` and `demo-e2e-report.md`). `AGEOS_SESSION_SECRET` and the access code must be the server's (read from `.env.local`; never print them). Artifacts go to `.data/e2e-output/` (git-ignored). Result: `<<E2E_PENDING>>`.

## 7. Architecture map

| Layer | Where | Notes |
|---|---|---|
| Command bus | `server/kernel/commands.ts` | `defineCommand` / `executeCommand`: idempotency (tenant, command, key, payload digest), strict Zod, tenant transaction, event + audit |
| Approvals | `server/kernel/approvals.ts`, `server/domain/approvals.ts` | exact payload digest (`python-json-sorted-v1` + SHA-256) and aggregate revision; separation of duties; `checkApprovalExecutable` gate before consumption (D13) |
| Capabilities registry | `lib/capabilities/` (`catalog.generated.ts`, `governance.ts`, `input-fields.ts`), `server/capabilities/registry.ts`, `runner.ts`, `handlers/*.ts` | 42 contracts, 42 handlers (one file per module); `runner.ts` claims runs atomically and binds a request digest; status derives from `evidence/skill-verification.json` |
| Domain modules | `server/domain/*.ts` | jobs, budget, clients, evidence, governance, production, timesheets, media planning/buying, campaigns, payables, payments, cash, billing, collections, rebates, tax, ledger, accruals, assets, close, profitability, reporting, configuration, activation, ops, presenter, attention, overview |
| Calculators | `server/calculators/` (`shared.ts`, `clients.ts`, `planning.ts`, `finance.ts`) | pure functions ported from the source `agency_tools.py`, parity tests against Python vectors (D20-D22) |
| Persistence | `server/db/schema/*`, `drizzle/0000`-`0004`, `server/db/tenant.ts` | RLS `tenant_isolation` keyed on `app.tenant_id`, set per transaction by `withTenant` (D10) |
| Auth | `server/auth/` (`request.ts`, `session.ts`, `context.ts`), `proxy.ts` | opaque sessions; `requireAgency` / `requireControlSession` / `requirePlatformSession` / `requirePresenter` |
| Screens | `app/` (31 patterns), `components/{workbench,jobs,modules,catalog,approvals,inbox,runs,connections,library,settings,control,ops,presenter,records,clients,explore,reports}`, `server/queries/*`, `server/actions/*` | pages call domain services or `runCapabilityAction` / `decideApprovalAction` / `executeApprovedAction`; see `docs/ROUTE-MATRIX.md` |
| Assistant driver | `server/assistant/` (`driver.ts`, `scenarios.ts`, `skill-scenarios.ts`, `store.ts`, `view.ts`), `app/api/a/[agencySlug]/assistant/*`, `components/assistant/`, `lib/assistant/` | `ScriptedAssistantDriver`; per-step checkpoints, lease, Stop and authenticated resume; history re-authorized on read; one runtime for page and panel (D30, D31) |
| OpenUI renderer | `components/openui/`, `lib/assistant/openui-*.ts` | `@openuidev/react-lang` 0.3.0, closed library (MetricCard, BarChart, LineChart, RecordTable, Dashboard), server-authorized data, no tool provider (D32) |
| Simulated adapters | `server/adapters/simulated-provider.ts`, `ads.ts`, `payments.ts` | persisted `sim_*` receipts; `timeout_after_effect` -> `outcome_unknown`, resolved by reconcile, never by retry (D14) |
| Demo catalog | `lib/demo/journeys.ts`, `server/seed/` | J01-J10, checkpoints, fixtures (`lib/fixture-ids.ts` -> `fixtureUuid`) |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e`, `tests/support` | evidence writers: `tests/support/write-coverage-matrix.ts`, `tests/e2e/evidence-reporter.ts` |

## 8. Ownership and coordination

The build used one owner per file and isolated test databases; the rules and the ownership map are in `docs/COORDINATION.md` and the decisions D01-D41 in `DECISIONS.md`. After handoff the coordinator role is a single owner: edit `package.json`, the lockfile, `drizzle/**` and configs only deliberately, and keep one migration per schema change (`pnpm db:generate`). `docs/RESUME-CHECKPOINT.md` is the last mid-build snapshot (its agent table is historical).

## 9. What a next engineer should do first

1. Read `IMPLEMENTATION_STATUS.md` (gates, 42-skill table, limitations) and `DECISIONS.md`.
2. Provision the dev and test databases and roles, fill `.env.local`, run `pnpm db:migrate:test` then `pnpm test`. Expect 38 files / 913 tests passing and `pnpm typecheck` / `pnpm lint` clean (coordinator result, 2026-10-18). Investigate anything else before changing code.
3. Run the certification (section 6) and replace each `<<E2E_PENDING>>` (search for it in `IMPLEMENTATION_STATUS.md`, this file and `docs/`). Start with the 14 failures from the earlier read-only run listed in `IMPLEMENTATION_STATUS.md` section 2.
4. Run `pnpm build` and the production-build check of the `next-themes` dev warning (limitation L4).
5. Rehearse `docs/DEMO-SCRIPTS.md` and record the measured times; fix the scripts, not the data.
6. Decide the three unwired contract actions and the doc inconsistencies in `IMPLEMENTATION_STATUS.md` section 7 (items 6-8).
7. Never mark `scenario_verified` by hand: rerun `tests/integration/skills-acceptance.test.ts` so `evidence/skill-verification.json` is rewritten for the current `HANDLER_VERSION` (`server/capabilities/registry.ts`).
