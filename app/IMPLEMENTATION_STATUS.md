# AgeOS implementation status

Written 2026-10-18 from recorded evidence only. Paths are relative to the application root (`claude-code-chasis-v1/app/`). `<<E2E_PENDING>>` marks a browser or build result that has not been produced yet; the coordinator fills it after the certification run. Nothing marked pending is a pass.

## 1. Summary

AgeOS is a deterministic Next.js 16 / PostgreSQL 16 chassis (nine ERP modules, 42 skills) plus a scripted, no-model demo built on it. Boundaries are fixed: `AGEOS_DEMO_MODE=true`, `AGEOS_ASSISTANT_MODE=scripted`, `AGEOS_CONNECTOR_MODE=simulated`. No LLM, model SDK or provider call exists at runtime; data is synthetic.

| Area | State | Basis |
|---|---|---|
| **Chassis**: routes | 31/31 route patterns have a `page.tsx` (re-counted while writing this document) | file listing under `app/` |
| Chassis: persistence and isolation | Migrations 0000-0004 apply to a fresh DB; 94 `tenant_isolation` RLS policies | coordinator, 2026-10-18 |
| Chassis: calculators | 25/25 source calculators ported with parity tests; `approval_route` is implemented by kernel approval policies (D23) | coordinator; `DECISIONS.md` |
| Chassis: audit regressions | B02-B09, F02, F03/F04, F05, F07, F08 and A08 have passing Vitest regressions (see `docs/FINDINGS-TRACEABILITY.md`) | full suite below |
| **Demo**: 42 skills | 42/42 `scenario_verified` (positive 42/42, negative 42/42, replay 42/42, handlerVersion `chassis-2`) | `evidence/skill-verification.json`, generated 2026-10-18T16:14:54.732Z on `ageos_test_coord` |
| Demo: scripted assistant | 42/42 skill ids delegated through the orchestrator; A01-A18: 15 passed at driver layer, 3 `not_run` (A01, A13, A18) | `evidence/assistant-tool-coverage.json` (2026-10-18T16:15:10.174Z), `evidence/assistant-acceptance.md` |
| Demo: journeys J01-J10 | Catalog of 10 journeys / 110 steps in `lib/demo/journeys.ts`; service-level coverage in Vitest (section 4); browser run not executed | browser `<<E2E_PENDING>>` |
| Demo: Aurora figures | 45.0% -> 35.0% -> 43.5% (4348 bps), cash 20,000, 15 balanced journals asserted in Vitest | `tests/integration/kernel.test.ts`, `core3-aurora-finance.test.ts`, `assistant-acceptance.test.ts` |

### What is verified, and how

- Vitest (unit + integration) runs only against a dedicated test database; `tests/global-setup.ts` refuses to run when `TEST_DATABASE_URL_MIGRATIONS` equals the dev URL.
- Skill harness (`tests/integration/skills-acceptance.test.ts`): per skill, reset -> positive (fresh) -> positive (re-run) -> replay with the same key; reset -> negative (fresh) -> negative (re-run). A positive needs `succeeded`, every `repositoryOutputs` key, the fixture `verify`, a persisted `workflow_run` (+ steps, handler version, actor, tenant) and, for commands, correlated business events and an idempotency record. A negative needs the exact `expectCode`/`expectRule`, a non-empty message, no business event and an unchanged row count + content digest of every table (all tenants) except `workflow_run(_step)`, sessions and platform audit. `scenario_verified` is derived from that file only (D41, `server/capabilities/registry.ts`).
- Assistant coverage: "covered" means the scripted orchestrator ran the skill's scenario and persisted a tool call or delegation to exactly that skill id through the shared runner.

### What is not verified yet

Browser behavior (routes, journeys, assistant page/panel, EN/ES, 390/1440 px, keyboard, both themes), `pnpm build`, the 768 px breakpoint, A01/A13/A18, and the rehearsal of the two investor scripts. See section 7.

## 2. Gates

| Gate | Command | Result | Source |
|---|---|---|---|
| typecheck | `pnpm typecheck` (`tsc --noEmit`) | 0 errors | coordinator, 2026-10-18 |
| lint | `pnpm lint` (`eslint`) | 0 problems | coordinator, 2026-10-18 |
| test | `vitest run` via `pnpm test` (unit + integration, fresh DB; the exact invocation is not recorded in the evidence files) | 38 files, 913/913 passed | coordinator, 2026-10-18 |
| test:e2e | `pnpm test:e2e` per `HANDOFF-INSTRUCCION-2.md` section 6 | `<<E2E_PENDING>>` | certification run |
| build | `pnpm build` | `<<E2E_PENDING>>` | certification run |
| migrations | `drizzle/` 0000-0004 applied to a fresh DB (`scripts/migrate.ts` prints the policy count) | all apply; 94 `tenant_isolation` policies | coordinator, 2026-10-18 |
| route patterns | count of `page.tsx` under `app/` vs `rutas-y-pantallas.json` | 31/31 | coordinator; re-counted here |
| skills | `evidence/skill-verification.json` | 42/42 positive, 42/42 negative, 42/42 replay, 0 pending, 0 failed | 2026-10-18T16:14:54.732Z |

History kept for traceability (not the current result):

- `evidence/test-results.md` records QA runs on `ageos_test_qa`: 769 tests (746 passed, 23 failed), 893 (889 passed, 4 failed), then 37 files / 903 passed. The 38 files / 913 run above supersedes the last one.
- The only browser run recorded so far (read-only specs on the shared dev server, 2026-10-18 16:04-16:11 UTC): 45 passed, 14 failed, 16 skipped. Its failures were: no `<h1>` on `/a/rayo-de-sol/assistant` and `/sign-in`; dark class applied after `<body>` starts (intermittent); header search dialog not returning focus on Escape; mobile navigation Sheet not closing on Escape; one transient dev build overlay. Whether these are fixed is `<<E2E_PENDING>>`. `docs/qa/coverage-matrix.md` "Last browser result" column comes from that run and is stale.

## 3. The 42 skills

Status is `registered` (contract only), `handler_implemented` (handler exists, not verified for the current `HANDLER_VERSION`) or `scenario_verified` (positive and negative passed at `chassis-2`). Counts: scenario_verified 42, handler_implemented 0, registered 0. Permission and approval policy per skill: `lib/capabilities/governance.ts`.

| ERP | Skill id | Module | Handler (file · function) | Status | Positive | Negative | Replay | Assistant scenario / run |
|---|---|---|---|---|---|---|---|---|
| ERP-01 | `agency-orchestrator` | setup | `handlers/setup.ts` · `recordReadinessCheckpoint` (command) | scenario_verified | passed | passed | passed | ERP-01 (covered) / completed |
| ERP-02 | `agency-integrations` | setup | `handlers/setup.ts` · `configureDemoConnection` (command) | scenario_verified | passed | passed | passed | ERP-02 (covered) / completed |
| ERP-03 | `agency-access-governance` | setup | `handlers/setup.ts` · `proposeAccessChange` (command) | scenario_verified | passed | passed | passed | ERP-03 (covered) / completed |
| ERP-04 | `agency-master-data` | setup | `handlers/setup.ts` · `upsertMasterRecord` (command) | scenario_verified | passed | passed | passed | ERP-04 (covered) / completed |
| ERP-05 | `agency-onboarding` | clients-contracts | `handlers/clients-contracts.ts` · `createClientIntake` (command) | scenario_verified | passed | passed | passed | ERP-05 (covered) / completed |
| ERP-06 | `agency-job-lifecycle` | clients-contracts | `handlers/clients-contracts.ts` · `openOrCloseJob` (command) | scenario_verified | passed | passed | passed | S-JOB-CREATE (covered) / completed |
| ERP-07 | `agency-contract-po` | clients-contracts | `handlers/clients-contracts.ts` · `recordClientAuthority` (command) | scenario_verified | passed | passed | passed | ERP-07 (covered) / completed |
| ERP-08 | `agency-budget-control` | clients-contracts | `handlers/clients-contracts.ts` · `reserveBudget` (command) | scenario_verified | passed | passed | passed | ERP-08 (covered) / completed |
| ERP-09 | `agency-fee-contracts` | clients-contracts | `handlers/clients-contracts.ts` · `proposeFeeAmendment` (command) | scenario_verified | passed | passed | passed | ERP-09 (covered) / completed |
| ERP-10 | `agency-billing-requirements` | clients-contracts | `handlers/clients-contracts.ts` · `evaluateBillingReadiness` (command) | scenario_verified | passed | passed | passed | ERP-10 (covered) / completed |
| ERP-11 | `agency-tasks-timesheets` | work-production | `handlers/work-production.ts` · `submitTimesheet` (command) | scenario_verified | passed | passed | passed | ERP-11 (covered) / completed |
| ERP-12 | `agency-production-estimating` | work-production | `handlers/work-production.ts` · `createProductionEstimate` (command) | scenario_verified | passed | passed | passed | ERP-12 (covered) / completed |
| ERP-13 | `agency-production` | work-production | `handlers/work-production.ts` · `reviewProductionDelivery` (command) | scenario_verified | passed | passed | passed | ERP-13 (covered) / completed |
| ERP-14 | `agency-media-ranking` | media-planning | `handlers/media-planning.ts` · `rankMediaOptions` (query) | scenario_verified | passed | passed | passed | ERP-14 (covered) / completed |
| ERP-15 | `agency-media-planning` | media-planning | `handlers/media-planning.ts` · `saveMediaPlanRevision` (command) | scenario_verified | passed | passed | passed | ERP-15 (covered) / completed |
| ERP-16 | `agency-tv-radio-planning` | media-planning | `handlers/media-planning.ts` · `buildBroadcastSchedule` (command) | scenario_verified | passed | passed | passed | ERP-16 (covered) / completed |
| ERP-17 | `agency-ooh-planning` | media-planning | `handlers/media-planning.ts` · `proposeOOHPlan` (command) | scenario_verified | passed | passed | passed | ERP-17 (covered) / completed |
| ERP-18 | `agency-digital-planning` | media-planning | `handlers/media-planning.ts` · `validateDigitalPlan` (query) | scenario_verified | passed | passed | passed | ERP-18 (covered) / completed |
| ERP-19 | `agency-plan-changes` | media-planning | `handlers/media-planning.ts` · `proposePlanRevisionChange` (command) | scenario_verified | passed | passed | passed | ERP-19 (covered) / completed |
| ERP-20 | `agency-rate-cards-contracts` | media-buying | `handlers/media-buying.ts` · `saveRateCardAgreement` (command) | scenario_verified | passed | passed | passed | ERP-20 (covered) / completed |
| ERP-21 | `agency-media-buying` | media-buying | `handlers/media-buying.ts` · `issueMediaOrder` (command) | scenario_verified | passed | passed | passed | ERP-21 (covered) / completed |
| ERP-22 | `agency-campaign-activation` | media-buying | `handlers/media-buying.ts` · `activateDemoCampaign` (command) | scenario_verified | passed | passed | passed | ERP-22 (covered) / completed |
| ERP-23 | `agency-campaign-optimization` | media-buying | `handlers/media-buying.ts` · `proposeCampaignOptimization` (command) | scenario_verified | passed | passed | passed | ERP-23 (covered) / completed |
| ERP-24 | `agency-transmission-control` | media-buying | `handlers/media-buying.ts` · `reconcileBroadcastDelivery` (command) | scenario_verified | passed | passed | passed | ERP-24 (covered) / completed |
| ERP-25 | `agency-ooh-inventory` | media-buying | `handlers/media-buying.ts` · `reserveOOHFace` (command) | scenario_verified | passed | passed | passed | ERP-25 (covered) / completed |
| ERP-26 | `agency-delivery-reconciliation` | suppliers-payments | `handlers/suppliers-payments.ts` · `reconcileDeliveryInvoice` (command) | scenario_verified | passed | passed | passed | ERP-26 (covered) / completed |
| ERP-27 | `agency-payables` | suppliers-payments | `handlers/suppliers-payments.ts` · `approveSupplierInvoice` (command) | scenario_verified | passed | passed | passed | ERP-27 (covered) / completed |
| ERP-28 | `agency-payment-run` | suppliers-payments | `handlers/suppliers-payments.ts` · `proposePaymentBatch` (command) | scenario_verified | passed | passed | passed | ERP-28 (covered) / blocked |
| ERP-29 | `agency-cash-settlement` | suppliers-payments | `handlers/suppliers-payments.ts` · `reconcileBankStatement` (command) | scenario_verified | passed | passed | passed | ERP-29 (covered) / blocked |
| ERP-30 | `agency-expenses` | suppliers-payments | `handlers/suppliers-payments.ts` · `submitExpense` (command) | scenario_verified | passed | passed | passed | ERP-30 (covered) / completed |
| ERP-31 | `agency-client-billing` | billing-collections | `handlers/billing-collections.ts` · `issueDemoClientInvoice` (command) | scenario_verified | passed | passed | passed | ERP-31 (covered) / blocked |
| ERP-32 | `agency-collections` | billing-collections | `handlers/billing-collections.ts` · `allocateCollection` (command) | scenario_verified | passed | passed | passed | ERP-32 (covered) / blocked |
| ERP-33 | `agency-rebates` | billing-collections | `handlers/billing-collections.ts` · `calculateRebateSettlement` (command) | scenario_verified | passed | passed | passed | ERP-33 (covered) / completed |
| ERP-34 | `agency-tax-compliance` | billing-collections | `handlers/billing-collections.ts` · `validateDemoTaxProfile` (query) | scenario_verified | passed | passed | passed | ERP-34 (covered) / completed |
| ERP-35 | `agency-general-ledger` | accounting-close | `handlers/accounting-close.ts` · `postDemoJournal` (command) | scenario_verified | passed | passed | passed | ERP-35 (covered) / completed |
| ERP-36 | `agency-accruals-revaluation` | accounting-close | `handlers/accounting-close.ts` · `proposeAccrualOrFx` (command) | scenario_verified | passed | passed | passed | ERP-36 (covered) / completed |
| ERP-37 | `agency-fixed-assets` | accounting-close | `handlers/accounting-close.ts` · `calculateAssetDepreciation` (command) | scenario_verified | passed | passed | passed | ERP-37 (covered) / completed |
| ERP-38 | `agency-period-close` | accounting-close | `handlers/accounting-close.ts` · `closeAccountingPeriod` (command) | scenario_verified | passed | passed | passed | ERP-38 (covered) / completed |
| ERP-39 | `agency-profitability` | profitability | `handlers/profitability.ts` · `calculateJobProfitability` (query) | scenario_verified | passed | passed | passed | ERP-39 (covered) / completed |
| ERP-40 | `agency-revenue-budget` | profitability | `handlers/profitability.ts` · `saveRevenueBudgetScenario` (command) | scenario_verified | passed | passed | passed | ERP-40 (covered) / completed |
| ERP-41 | `agency-cash-forecast` | profitability | `handlers/profitability.ts` · `calculateCashScenario` (query) | scenario_verified | passed | passed | passed | ERP-41 (covered) / completed |
| ERP-42 | `agency-management-reporting` | profitability | `handlers/profitability.ts` · `generateManagementSnapshot` (command) | scenario_verified | passed | passed | passed | ERP-42 (covered) / completed |

Note on the last column: the rule counts a skill as covered when a tool call or delegation was persisted for exactly that skill id, whatever the outcome. In the sweep ERP-28, ERP-29, ERP-31 and ERP-32 end with run status `blocked` (the server returned a blocked outcome for the scripted request); their positive cases still pass in the harness (Positive column). ERP-06 is served by the featured scenario `S-JOB-CREATE`.

## 4. Journeys J01-J10

Steps, personas and entry checkpoints come from `lib/demo/journeys.ts` (the same catalog the presenter launcher shows and the browser spec drives). "Integration coverage" lists Vitest files that exercise the same services; it is not a browser walk-through, and J02 has no single end-to-end test.

| ID | Title | Personas (by step) | Steps | Entry checkpoint | Continues | Integration coverage (Vitest) | Browser (`tests/e2e/journeys.spec.ts`) |
|---|---|---|---|---|---|---|---|
| J01 | Build and activate an agency | Alex Rivera (owner); Sam Cruz (account_manager) | 11 | any | - | `tests/integration/platform-configuration.test.ts` (J01 build and activate an agency; activation failure, waiting and resume; capability change on an existing agency) | `<<E2E_PENDING>>` |
| J02 | Client to production | Sam Cruz (account_manager); Taylor Chen (producer) | 8 | from_intake | - | partial: `tests/integration/core1-skills.test.ts` (ERP-05, ERP-08, ERP-10), `tests/integration/core2-scenarios.test.ts` (J02 hours). No single test walks J02.1-J02.8 | `<<E2E_PENDING>>` |
| J03 | Media plan to campaign | Sam Cruz (account_manager) | 10 | ready_for_scope_review | - | `tests/integration/core2-scenarios.test.ts` (J03 Aurora: plan revision, simulated orders, delivery, activation); J03.1-J03.4 per skill in `tests/integration/skills-acceptance.test.ts` | `<<E2E_PENDING>>` |
| J04 | Scope change protects margin | Sam Cruz (account_manager); Morgan Lee (finance_approver) | 7 | ready_for_scope_review | - | `tests/integration/core1-skills.test.ts` (ERP-09 Aurora scope change, J04 path), `tests/integration/kernel.test.ts` (Aurora margin; exact-payload approvals and client authority), `tests/integration/assistant-driver.test.ts` (S-MARGIN-EXPLAIN) | `<<E2E_PENDING>>` |
| J05 | Supplier reconciliation and payment | Morgan Lee (finance_approver) | 8 | ready_for_scope_review | J04 | `tests/integration/core3-aurora-finance.test.ts` (Aurora finance sequence J05 to J06), `tests/integration/core2-scenarios.test.ts` (J05 production order and delivery, Lumen 5,500) | `<<E2E_PENDING>>` |
| J06 | Accounting close and reporting | Morgan Lee (finance_approver) | 5 | ready_for_scope_review | J04, J05 | `tests/integration/core3-aurora-finance.test.ts` (15 expected journals; trial balance; J06 demo-lab recognition and close 2027-03) | `<<E2E_PENDING>>` |
| J07 | Assistant page and right panel | Sam Cruz (account_manager); Morgan Lee (finance_approver) | 5 | ready_for_scope_review | - | `tests/integration/assistant-driver.test.ts` (S-MARGIN-EXPLAIN, J07), `tests/integration/assistant-acceptance.test.ts` (A02-A17 at driver layer), `tests/integration/audit-assistant-*.test.ts` | `<<E2E_PENDING>>` |
| J08 | Files, connections and isolation | Sam Cruz (account_manager); Alex Rivera (owner); Casey Martin (owner, Norte Studio) | 7 | ready_for_scope_review | - | `tests/integration/isolation-governance.test.ts` (isolation, revoked scope), `tests/integration/screens-queries.test.ts` (private library) | `<<E2E_PENDING>>` |
| J09 | Operate the platform | Avery Park (platform_operator); Jamie Torres (platform_admin) | 6 | any | - | `tests/integration/platform-ops.test.ts` (J09 ops_csv_delimiter_mismatch circuit) | `<<E2E_PENDING>>` |
| J10 | All capabilities and guarded failures | Alex Rivera (owner) | 43 | ready_for_scope_review | - | `tests/integration/skills-acceptance.test.ts` (42 positive / negative / replay), `tests/integration/platform-journeys.test.ts` (J10 walks all 42 capabilities once; links resolve) | `<<E2E_PENDING>>` |

## 5. Assistant acceptance (A01-A18, driver layer)

Passed at driver layer in `tests/integration/assistant-acceptance.test.ts`: A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A14, A15, A16, A17. `not_run`: A01 (sidebar -> page, header -> panel, one thread; browser), A13 (timeout after a simulated effect through the assistant; the adapter behavior is covered by `kernel.test.ts` "simulated provider adapter"), A18 (390/768/1440 px, keyboard, EN/ES, theme). Browser specs `tests/e2e/assistant.spec.ts` (A01/A02, A03, A16, EN-ES): `<<E2E_PENDING>>`.

## 6. Known limitations

| # | Limitation | Source |
|---|---|---|
| L1 | The assistant context pins jobs only; client pages open the panel without a pinned client. | coordinator |
| L2 | Drafts survive page <-> panel and close/reopen but not a hard reload. | coordinator |
| L3 | A non-domain error after a saved user turn leaves that turn without a reply. | coordinator |
| L4 | `next-themes` 0.4.6 prints a dev-only "script tag" warning on client remount (Fast Refresh/error recovery); a fresh load is clean. Re-check on a production build. | `docs/RESUME-CHECKPOINT.md` |
| L5 | Light-mode input border contrast is 1.16:1; it is the value of the official tweakcn Vercel theme (D02), flagged by the Design System owner. | `docs/RESUME-CHECKPOINT.md` |
| L6 | Global search returns jobs and clients only. | coordinator |
| L7 | The production Gantt timeline is not built; production uses the timesheet and deliverable tables. | coordinator |
| L8 | `margin_bps` uses HALF_UP (10,000 / 23,000 -> 4348) where the source calculator floors (4347); the displayed 43.5% is identical. | D21 |
| L9 | `approval_route` has no source formula in the pinned `agency_tools.py`; it lives in kernel approval policies. | D23 |
| L10 | The assistant is a scripted driver (`erp-42@2.0.0`): supported inputs are "Explain Aurora margin", "Create a job", `Run demo: <skill id or label>`, `ERP-NN`, plus the EN/ES aliases in `server/assistant/`. Other text gets an honest "outside this scripted demo" reply. | D30; `tests/e2e/assistant.spec.ts` A16 |
| L11 | All external effects (ads, payments, accounting, OAuth, DNS) are simulated and persisted as `sim_*` receipts; a custom domain only walks Requested -> Pending DNS -> Verifying -> Simulated ready. | D14, J01 |
| L12 | Cross-tenant deep links to a Norte client or file under Rayo render the not-found UI with HTTP 200 (streamed segment) instead of 404; no Norte data appears. The spec accepts this as a soft 404. | `evidence/test-results.md` section 2 |
| L13 | Only 390 px and 1440 px are in the browser matrix; 768-900 px is not covered. | `evidence/test-results.md` section 3 |
| L14 | `getOverview` (the `/a/:agencySlug` data) has no service-level Vitest; it is exercised through the browser specs only. | test grep |

## 7. Remaining work

1. Run the certification (`HANDOFF-INSTRUCCION-2.md` section 6) on a dedicated database and replace every `<<E2E_PENDING>>` in this file, `docs/ROUTE-MATRIX.md`, `docs/FINDINGS-TRACEABILITY.md` and `docs/DEMO-SCRIPTS.md`.
2. Run `pnpm build`; stop any dev server that shares `.next` first.
3. Re-verify the 14 browser failures listed in section 2 and the soft-404 behavior (L12).
4. Cover A01, A13 and A18; add 768 px to the browser matrix.
5. Rehearse both scripts in `docs/DEMO-SCRIPTS.md` and record the measured times.
6. Contract actions with no code found (checked by search; confirm or implement):
   - assistant `attach_authorized_file` (no attach control in `components/assistant`, `server/assistant`, `lib/assistant` or the assistant API routes);
   - jobs `apply_valid_import` (only the CSV preview at library upload exists; the library copy says applying an import is a separate validated step);
   - settings `copy_demo_invitation` (invitations render as "Simulated invite" with no copy action).
7. `05-guion-demo-inversionistas.md` mentions a "Load sample scope request" tool and the prompts "What needs attention on this job?" and "Explain the margin change and prepare the fee adjustment for review". None exists as written: the 40 h change is created through the production-estimating workbench (J04.2) and the supported prompts are listed in L10. `docs/DEMO-SCRIPTS.md` uses the real controls.
8. Documentation inconsistency: `DECISIONS.md` D20 says "26 source calculators" while D23 and the coordinator count 25 in the pinned registry (26 contract names including `approval_route`).

## 8. Evidence index

| File | Content |
|---|---|
| `evidence/skill-verification.json` | 42-skill harness result (positive / negative / replay) |
| `evidence/assistant-tool-coverage.json` | 42 skill ids delegated through the scripted orchestrator |
| `evidence/assistant-acceptance.{md,json}` | A01-A18 |
| `evidence/test-results.md` | QA run log (earlier counts, browser failures) |
| `evidence/demo-e2e-results.json`, `evidence/demo-e2e-report.md` | Output of the earlier read-only browser run; journeys all `not_run` |
| `evidence/screenshots/` | Captures from that run |
| `docs/qa/coverage-matrix.md` | QA matrix (browser column stale, see section 2) |
| `DECISIONS.md`, `docs/COORDINATION.md`, `docs/RESUME-CHECKPOINT.md` | Decisions D01-D41, ownership and process, last resume checkpoint |
