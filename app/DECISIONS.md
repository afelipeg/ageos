# AgeOS — implementation decisions

Decisions taken while building the deterministic chassis and the scripted E2E
demo, with the reason and where they apply. Spec references point to the
documents in `../` (`03-chasis-deterministico.md`, `04A-…`, the audit prompt).

## Platform and template

| # | Decision | Reason |
|---|---|---|
| D01 | Built on the licensed Verve template (Next.js 16 App Router, React 19, Base UI `base-nova`, Tailwind 4, lucide-react, pnpm 10.28 lockfile). Verve's CRM routes and mock data layer were removed; its shell, components and conventions are kept. | CLAUDE.md: preserve the supplied template's framework, component base, icons and lockfile. |
| D02 | Theme: the official tweakcn **Vercel** theme (`https://tweakcn.com/r/themes/vercel.json`) replaces Verve's palette, **dark by default** with a Light/Dark toggle (next-themes). Verve structure and components are unchanged. | Audit prompt supersedes the earlier "keep Verve colors" decision. |
| D03 | ReUI components upgraded in place where the 04A map required newer APIs (data-grid on TanStack Table v9 `useTable({ features })`, Frame, Badge `-light` variants, filters, stepper, timeline, number-field, message/bubble/message-scroller). Premium blocks were staged outside `app/` and adapted, not installed with the CLI into the app. | Avoid CLI overwrites of Verve files; keep one source of truth per component. |
| D04 | Verve ships no `Command`/`CommandDialog`; global search reuses Verve's search dialog pattern instead of adding a second command palette. | Reuse over hand-rolled duplicates. |
| D05 | `compose_page` suggestions were used as input only; when they conflicted with `04A-direccion-producto-y-mapa-ui.md`, 04A wins. | 04A is the approved product/UI map. |

## Persistence and kernel

| # | Decision | Reason |
|---|---|---|
| D10 | PostgreSQL 16 + Drizzle (postgres-js). Two roles: `ageos_owner` (migrations, seed) and `ageos_app` (runtime, `NOBYPASSRLS`). Every tenant table has the `tenant_isolation` RLS policy keyed on `app.tenant_id`, set per transaction by `withTenant`. | Isolation cannot depend on application code alone. |
| D11 | Money is `bigint` minor units with an explicit ISO currency; no floats; mixed currencies are never summed. Decimal inputs are strings parsed by `parseDecimalToMinor`. | 03 §6. |
| D12 | Every mutation is a command (`defineCommand` → `executeCommand`): permission → capability enabled → idempotency key → strict Zod → tenant transaction → idempotency record (tenant, command, key, payload digest) → handler → business event + audit → JSON-safe result. A repeated key with the same digest replays; a different digest is rejected. | Retries must not duplicate effects. |
| D13 | Approvals bind an exact payload digest (`python-json-sorted-v1` canonical JSON + SHA-256, parity vectors from the source) and the aggregate revision. A material change invalidates pending approvals; a stale approval decides as `stale`; execution consumes the approval once. | 03 approvals contract. |
| D14 | External effects (ads, payments, accounting, OAuth, DNS) go only through `server/adapters/simulated-provider.ts`, which persists the operation and a `sim_*` receipt. `timeout_after_effect` yields `outcome_unknown` and is resolved by reconcile, never by retry. | Demo boundary: no real providers. |
| D15 | Order backbone (`purchase_order`, `delivery`) is a coordinator-owned shared schema: production writes it, finance reads it for three-way match, payables, payments and accounting. Order, delivery, invoice and payment are linked stages of one cost. | CLAUDE.md: never count the four stages as separate costs. |
| D16 | Demo reset and checkpoint loads are the only runtime paths that use the owner connection (`DATABASE_URL_MIGRATIONS`), only with `AGEOS_DEMO_MODE=true`, only for a presenter session, with typed confirmation, and they rebuild the whole demo run (Rayo, Norte and agencies created during the run). Non-demo tenants and the audit stream are untouched. `platform_audit_event.tenant_id` has no FK to `agency` so audit rows survive a reset. | The seed builds the demo tenants together; RLS-bound `ageos_app` cannot rebuild them. |
| D17 | The demo business date is server state (`demo_run.business_date`, default 2027-03-15). The presenter can advance it (audited, bounded); domain logic reads `getBusinessDate()`, never the browser clock. | Deterministic, rehearsable scenarios (aging, expiry). |
| D18 | Capability changes on an active agency are proposals: an account manager or owner proposes, a different owner approves the exact digest. A new agency's initial configuration is approved by its creating owner at deploy. | 03 §separation: owner approves configuration; no self-approval. |
| D19 | Detail routes with a `loading.tsx` stream: a missing or foreign record calls `notFound()`, which renders the not-found screen with a noindex meta but HTTP 200 (Next.js streaming status codes). Isolation is enforced server-side before any data is read; no foreign data is rendered. `jobs/[jobId]` has no loading state and returns 404. Real 404s would require duplicating each lookup in a per-segment layout; not worth it for the demo. E2E accepts and annotates `soft-404`. | Keep loading skeletons required by `global_states`; no duplicated lookups. |
| D24 | Journeys follow the single Aurora sequence of `demo-fixtures.json` (`scenario.steps`): J04 → J03 → J05 → J06 run chained on one demo run from `ready_for_scope_review`; J02 runs from `from_intake` and must end equivalent to `ready_for_scope_review`; J01, J07–J10 reset independently. Workbench steps declare their inputs (`lib/demo/journeys.ts`), passed as `f.<field>` prefill params that the server validates against the tenant's reference options; commands validate everything again. | No per-journey checkpoints in the spec; one continuous financial story keeps cash and margin assertions exact. |

## Calculators

| # | Decision | Reason |
|---|---|---|
| D20 | The 25 calculators of the pinned source registry (`agency_tools.py`) are ported as pure TypeScript functions with strict inputs and parity tests against vectors produced by the Python source (`python3 -I`). | Reuse source calculation contracts. |
| D21 | **Deviation:** `margin_bps` uses HALF_UP (`10,000 / 23,000` → 4348) where the source floors (4347). Display (43.5%) is identical. | Contract 03 §6.9 and `demo-fixtures.json` specify HALF_UP. |
| D22 | `allocate` (largest remainder, ties by index), `installment_schedule` (advance rounded half away from zero, remainder on the last installment) and `credit_exposure` live in `server/calculators/shared.ts` because several modules use them. | One implementation per rule. |
| D23 | `approval_route` is referenced by three catalog contracts but is absent from the pinned `agency_tools.py` registry (25 tools). It is implemented by kernel approval policies: eligible roles, a policy-declared decide permission, and excluded deciders (requester, proposal creator, and per policy author/worker). | No source formula to port; routing must live where approvals are enforced. |

## Assistant

| # | Decision | Reason |
|---|---|---|
| D30 | The assistant is the existing `agency-orchestrator` (coordinator) running a versioned `ScriptedAssistantDriver`: prewritten replies, prescribed branches, figures interpolated from authorized server data. Labeled "Demo · Scripted assistant · Simulated integrations". No model SDK or credential is present. | Approved demo scope. |
| D31 | One runtime and thread store for the full page `/a/:agencySlug/assistant` and the right panel; the panel is hidden on the full page. | 07 §shared runtime. |
| D32 | OpenUI: `@openuidev/react-lang` **0.3.0** renderer only, with a closed component library (MetricCard, BarChart, LineChart, RecordTable, Dashboard) fed by scripted, server-authorized data. No `create` scaffold, no open tool provider, no browser MCP, no SQL, no `eval`. | Audit OpenUI recommendation. |

## Process

| # | Decision | Reason |
|---|---|---|
| D40 | Multi-agent build with one owner per file (`docs/COORDINATION.md`), isolated test databases per agent (`pnpm test:agent <name>`), and a single coordinator for package/lockfile, migrations, registry and docs. | Avoid overwrites; reproducible integration. |
| D41 | `scenario_verified` is derived only from `evidence/skill-verification.json` written by the acceptance harness for the current `HANDLER_VERSION`; it is never set by hand. | No fake success. |
