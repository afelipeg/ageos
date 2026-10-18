# AgeOS build coordination (multi-agent)

Coordinator/integrator: main session. Source of truth for ownership, shared
contracts and process rules. Read this before editing anything.

## Hard rules (all agents)

1. **One owner per file.** Edit only files you own (table below). Need a change
   elsewhere? Write it in your report as a request to the coordinator/owner.
   Exception: `lib/capabilities/input-fields.ts` — Core agents may edit only the
   entries of *their own* skills, with targeted Edit calls (never rewrite the file).
2. **Never** edit `package.json`, `pnpm-lock.yaml`, `drizzle/**`, `drizzle.config.ts`,
   `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`,
   `lib/i18n/messages/index.ts`, `server/db/schema/index.ts`,
   `server/capabilities/registry.ts`, `server/capabilities/types.ts`. Ask the coordinator.
3. **Do not generate migrations** into `drizzle/`. Core agents add tables in their
   own schema file; `pnpm test:agent <name>` rebuilds your private test DB on every
   run (committed migrations + one migration generated into
   `.data/drizzle-wip/<name>` for in-progress schema, then RLS) and wipes its data,
   so tests must seed their own preconditions. The coordinator generates and
   applies the real migration at integration.
4. **Databases:** never touch `ageos_dev` directly; never run `pnpm db:reset:demo`
   or `db:migrate` (coordinator only). Tests: `pnpm test:agent <core1|core2|core3|platform|assistant|screens|qa|coord> [vitest args]`
   (isolated DB `ageos_test_<name>`). Plain `pnpm test` belongs to the coordinator.
   Shared dev server: create a new module before importing it from an existing
   file, so :3100 never compiles a broken intermediate state.
5. **Servers:** a dev server already runs at **http://localhost:3100** (dev DB,
   HMR). Do not start another `next dev` and never run `next build` (shared
   `.next`). Sign-in needs the demo access code from `.env.local`
   (`AGEOS_DEMO_ACCESS_CODE`) — read it from the file, never print it in reports.
6. **Run commands** with the pinned pnpm:
   `export PATH=/private/tmp/claude-501/-Users-andresgutierrez-Documents-Proyectos-ai-AgencyOS---ERP-Agentico/b569e6c9-94bb-4ecc-84e8-1e9245caf0d0/scratchpad/bin:$PATH`
   then `pnpm exec tsc --noEmit`, `pnpm exec eslint <your files>`, `pnpm test:agent ...`.
   Whole-project tsc may show errors from other agents' in-progress files: your
   own files must be error-free; report others' errors, don't fix them.
7. **No fake success.** No timers that declare success, no hardcoded figures that
   differ from the server, no localStorage business state, no SQL from the
   browser, no model/LLM calls, no real provider calls (all external effects go
   through `server/adapters/simulated-provider.ts` with persisted `sim_*` receipts).
8. **Money:** bigint minor units + explicit currency (`lib/money.ts`). Never floats,
   never sum mixed currencies. HALF_UP. Calculators are pure and ported from
   `../referencias/agency-erp-all-skills.zip` → `scripts/agency_tools.py`
   (extract under the scratchpad, `python3 -I`, parity tests vs Python).
9. **i18n:** EN + ES for every visible string, in your own namespace files
   (`lib/i18n/messages/{en,es}/<ns>.ts`; ES is typed against EN).
10. **ReUI:** reuse installed components (`components/reui`, `components/ui`, Base UI
    `render` prop, never `asChild`). One container family per region (never Card
    inside Frame or Frame inside Card). Staged sources of every selected block:
    `/private/tmp/claude-501/-Users-andresgutierrez-Documents-Proyectos-ai-AgencyOS---ERP-Agentico/b569e6c9-94bb-4ecc-84e8-1e9245caf0d0/scratchpad/reui-staging/components/blocks/<block>`
    (read and adapt; do not run the shadcn CLI in app/).
11. **Report** at the end: files touched, decisions, commands actually run with
    results, open requests to other owners, pending items. Never claim tests you
    did not run.

## Ownership map

| Owner | Files |
|---|---|
| Coordinator | package/lock, drizzle/**, configs, `lib/i18n/messages/index.ts`, `server/db/schema/index.ts`, `server/db/schema/operations.ts`, `server/capabilities/{registry,types}.ts`, `server/seed/extensions/types.ts`, `scripts/**`, docs (`README.md`, `IMPLEMENTATION_STATUS.md`, `HANDOFF-INSTRUCCION-2.md`, `DECISIONS.md`, `docs/**`), `.env.example` |
| DS (Design System & Shell) | `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/sign-in/**`, `app/a/[agencySlug]/layout.tsx`, `components/theme-provider.tsx`, `components/top-progress-bar.tsx`, `components/shell/**`, `components/auth/**`, `components/app/**`, `components/i18n/**`, `components/ui/**`, `components/reui/**`, `hooks/**`, `lib/format.ts`, `lib/i18n/messages/{en,es}/core.ts` |
| Screens (Navigation & screens) | every `page.tsx`/`layout.tsx` under `app/a/[agencySlug]/**` **except** `assistant/` and the agency `layout.tsx`; `app/control/**`, `app/ops/**`, `app/demo/**`, `app/api/a/[agencySlug]/search/**`, `app/api/a/[agencySlug]/files/**` (+ new upload route), `components/{workbench,jobs,modules,catalog,approvals,inbox,runs,connections,library,settings,control,ops,presenter,records,clients,explore,reports}/**`, `server/queries/**` (new, read-only projections over domain services), `server/actions/capabilities.ts`, `server/actions/ui/**` (new), i18n namespaces `overview jobs dossier clients modules workbench catalog approvals inbox runs connections library settings explore records control ops presenter` |
| Core-1 (kernel, governance, setup & clients) | `server/kernel/**`, `server/capabilities/runner.ts`, `server/capabilities/handlers/{setup,clients-contracts}.ts`, `server/domain/{jobs,budget,clients,connections,orchestrator,approvals,attention,overview,references}.ts`, new `server/domain/{governance,master-data,billing-requirements,evidence}.ts`, `server/db/schema/{commercial,control,governance}.ts`, `server/seed/extensions/core1.ts`, `lib/capabilities/{governance,types}.ts`, `lib/policy.ts` |
| Platform (control plane, ops, presenter, sessions, seed modes) | `server/auth/**`, `server/actions/session.ts`, `server/env.ts`, new `server/domain/{configuration,activation,ops,presenter}.ts`, `server/db/schema/{platform,configuration,files}.ts`, `server/seed/demo-seed.ts`, `server/seed/extensions/platform.ts`, `server/storage/**`, `lib/csv.ts`, `lib/demo.ts`, `lib/demo/**` (new: journeys J01–J10 / checkpoints catalog) |
| Core-2 (production & media) | `server/capabilities/handlers/{work-production,media-planning,media-buying}.ts`, new `server/domain/{production,timesheets,media-planning,media-buying,campaigns,broadcast,ooh}.ts`, `server/db/schema/planning.ts`, `server/calculators/planning.ts` (new), `server/adapters/ads.ts` (new, on top of simulated-provider), `server/seed/extensions/core2.ts` |
| Core-3 (finance, accounting, profitability) | `server/capabilities/handlers/{suppliers-payments,billing-collections,accounting-close,profitability}.ts`, `server/domain/profitability.ts`, new `server/domain/{payables,payments,cash,billing,collections,rebates,tax,ledger,accruals,assets,close,revenue-budget,cash-forecast,reporting}.ts`, `server/db/schema/finance.ts`, `server/calculators/finance.ts` (new), `server/adapters/simulated-provider.ts`, `server/adapters/payments.ts` (new), `server/seed/extensions/core3.ts` |
| Assistant & OpenUI | `server/assistant/**`, `app/api/a/[agencySlug]/assistant/**`, `app/a/[agencySlug]/assistant/**`, `components/assistant/**`, `components/openui/**` (new), `lib/assistant/**`, i18n namespace `assistant` |
| QA | `tests/**` (except files listed above as fixtures), `playwright.config.ts` (new), `evidence/**` (generated), `docs/qa/**` |

`server/calculators/index.ts` is shared read; new calculators go in
`planning.ts`/`finance.ts` and the coordinator re-exports them.

## Shared contracts

### Capability handlers and fixtures (`server/capabilities/types.ts`)

Each module file `server/capabilities/handlers/<module>.ts` exports
`capabilities: ModuleCapabilities = { handlers, fixtures }`.
- A handler is a `defineCommand` (`server/kernel/commands.ts`) or a query
  (`{ kind: "query", input: zodSchema, run }`). Command inputs are **strict Zod
  objects whose keys equal `lib/capabilities/input-fields.ts`** for that skill.
  Money inputs are decimal strings parsed with `parseDecimalToMinor`.
- Mutations go through `executeCommand` (idempotency, events/audit, tenant
  transaction, permission, enabled capability). Approval-gated actions use
  `server/kernel/approvals.ts` (proposal + digest + approval request + SoD) and
  an `ApprovalExecutor` declared in your module file under
  `capabilities.executors["<actionType>"] = { permission, skillId, run(tx, ctx, payload, "check"|"apply") }`.
  The registry merges executors; `server/domain/approvals.ts` (Core-1) runs them
  for decide/execute (see `handlers/clients-contracts.ts` for the two existing ones).
- External effects only via the simulated adapter with idempotency keys derived
  from the approved action id.
- `fixtures[skillId] = { positive, negative }` (see type). Positive must succeed
  and persist; negative must be blocked by the named rule (`expectCode`,
  optional `expectRule` matched against `error.details.rule`) **without side
  effects**. Fixtures may prepare preconditions only through domain commands.
  Fixtures must work on a freshly seeded tenant AND be re-runnable (use unique
  idempotency keys / names per run). The QA harness runs all 42 and writes
  `evidence/skill-verification.json`; the registry derives `scenario_verified`
  from that file only.
- Each handler output must include the contract's `repositoryOutputs` keys
  (`lib/capabilities/catalog.generated.ts`) — empty with an explicit reason when
  not applicable, never invented prose.

### Demo data

Seed = checkpoint `ready_for_scope_review` (`server/seed/demo-seed.ts`). Each Core
agent extends it only in `server/seed/extensions/core{1,2,3}.ts` / `platform.ts` (Platform owns the base seed file and its modes). Secondary
exercises live on the `job_demo_lab` job / `client_demo_lab` (reporting group
`demo-lab`) so Aurora KPIs stay clean. Stable ids: `fixtureUuid(key)`
(`lib/fixture-ids.ts`). Aurora numbers: `../demo-fixtures.json`.

### Order backbone (`server/db/schema/operations.ts`, coordinator)

`purchase_order` (production | media) and `delivery`. Core-2 writes them; Core-3
reads them for three-way match, payables, payments and accounting. Ask the
coordinator for column additions.

### Assistant (`lib/assistant/types.ts`)

`MessagePart` is a closed typed union; the Assistant agent owns it and may add
versioned parts (e.g. OpenUI visual). The driver contract `AssistantDriver`
(`server/assistant/driver.ts`) is the single runtime for page and panel.

### Screens data access

Pages call domain services (read) and `runCapabilityAction` /
`decideApprovalAction` / `executeApprovedAction` (`server/actions/capabilities.ts`)
or new actions in `server/actions/ui/**` that call domain commands. Read-only
projections that combine domain reads go in `server/queries/**`. Never compute
money or authorization in components.
