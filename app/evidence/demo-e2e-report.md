# AgeOS demo E2E report

Generated 2026-10-18T16:10:53.656Z · server http://localhost:3100 · database not a dedicated e2e database (mutating specs skipped) · Playwright overall: **failed**

Totals: skipped 16 · passed 45 · failed 14

## Journeys J01–J10

| Journey | Result | Steps passed | First failures |
|---|---|---|---|
| J01 Build and activate an agency | **not_run** | 0/11 |  |
| J02 Client to production | **not_run** | 0/8 |  |
| J03 Media plan to campaign | **not_run** | 0/10 |  |
| J04 Scope change protects margin | **not_run** | 0/7 |  |
| J05 Supplier reconciliation and payment | **not_run** | 0/8 |  |
| J06 Accounting close and reporting | **not_run** | 0/5 |  |
| J07 Assistant page and right panel | **not_run** | 0/5 |  |
| J08 Files, connections and isolation | **not_run** | 0/7 |  |
| J09 Operate the platform | **not_run** | 0/6 |  |
| J10 All capabilities and guarded failures | **not_run** | 0/43 |  |

## ERP-01..ERP-42

Harness (Vitest, isolated DB): positive passed 42/42 · negative passed 42/42 · browser J10 run passed 0/42.

| ERP | Skill | Positive | Negative | Replay | Browser (J10) |
|---|---|---|---|---|---|
| ERP-01 | agency-orchestrator | passed | passed | passed | not_run |
| ERP-02 | agency-integrations | passed | passed | passed | not_run |
| ERP-03 | agency-access-governance | passed | passed | passed | not_run |
| ERP-04 | agency-master-data | passed | passed | passed | not_run |
| ERP-05 | agency-onboarding | passed | passed | passed | not_run |
| ERP-06 | agency-job-lifecycle | passed | passed | passed | not_run |
| ERP-07 | agency-contract-po | passed | passed | passed | not_run |
| ERP-08 | agency-budget-control | passed | passed | passed | not_run |
| ERP-09 | agency-fee-contracts | passed | passed | passed | not_run |
| ERP-10 | agency-billing-requirements | passed | passed | passed | not_run |
| ERP-11 | agency-tasks-timesheets | passed | passed | passed | not_run |
| ERP-12 | agency-production-estimating | passed | passed | passed | not_run |
| ERP-13 | agency-production | passed | passed | passed | not_run |
| ERP-14 | agency-media-ranking | passed | passed | passed | not_run |
| ERP-15 | agency-media-planning | passed | passed | passed | not_run |
| ERP-16 | agency-tv-radio-planning | passed | passed | passed | not_run |
| ERP-17 | agency-ooh-planning | passed | passed | passed | not_run |
| ERP-18 | agency-digital-planning | passed | passed | passed | not_run |
| ERP-19 | agency-plan-changes | passed | passed | passed | not_run |
| ERP-20 | agency-rate-cards-contracts | passed | passed | passed | not_run |
| ERP-21 | agency-media-buying | passed | passed | passed | not_run |
| ERP-22 | agency-campaign-activation | passed | passed | passed | not_run |
| ERP-23 | agency-campaign-optimization | passed | passed | passed | not_run |
| ERP-24 | agency-transmission-control | passed | passed | passed | not_run |
| ERP-25 | agency-ooh-inventory | passed | passed | passed | not_run |
| ERP-26 | agency-delivery-reconciliation | passed | passed | passed | not_run |
| ERP-27 | agency-payables | passed | passed | passed | not_run |
| ERP-28 | agency-payment-run | passed | passed | passed | not_run |
| ERP-29 | agency-cash-settlement | passed | passed | passed | not_run |
| ERP-30 | agency-expenses | passed | passed | passed | not_run |
| ERP-31 | agency-client-billing | passed | passed | passed | not_run |
| ERP-32 | agency-collections | passed | passed | passed | not_run |
| ERP-33 | agency-rebates | passed | passed | passed | not_run |
| ERP-34 | agency-tax-compliance | passed | passed | passed | not_run |
| ERP-35 | agency-general-ledger | passed | passed | passed | not_run |
| ERP-36 | agency-accruals-revaluation | passed | passed | passed | not_run |
| ERP-37 | agency-fixed-assets | passed | passed | passed | not_run |
| ERP-38 | agency-period-close | passed | passed | passed | not_run |
| ERP-39 | agency-profitability | passed | passed | passed | not_run |
| ERP-40 | agency-revenue-budget | passed | passed | passed | not_run |
| ERP-41 | agency-cash-forecast | passed | passed | passed | not_run |
| ERP-42 | agency-management-reporting | passed | passed | passed | not_run |

## Routes, visual matrix, assistant

Routes: 30 passed / 37 (skipped 4).
Visual (screen × project): 39/42 passed; screenshots under evidence/screenshots/<project>/.
Assistant browser cases: 7/23 passed (see assistant-acceptance.md).

Limitations: results describe this run only. `not_run`/`skipped` are not passes. Mutating specs run only against a dedicated e2e database.
