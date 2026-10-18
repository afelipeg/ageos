# Test results (QA)

All runs below were executed by the QA agent on 2026-10-18 (UTC). Failures are quoted as reported. Nothing here is a projection.

## 1. Vitest — full suite on the isolated QA database

Command (from `app/`): `pnpm test:agent qa` → database `ageos_test_qa` rebuilt from committed migrations + WIP migration, RLS/grants, then `vitest run`.

| Run (UTC) | Files | Tests | Result |
|---|---|---|---|
| 2026-10-18 15:06–15:07 | 31 | 769 | 746 passed, 23 failed (Core-3 skills ×5 in the harness, core3-fixtures ×9, core2 J02 ×1) |
| 2026-10-18 15:30–15:37 | 36 | 893 | 889 passed, 4 failed: A08 (stale proposal confirmed — product defect, since fixed by coordinator), 2 × assistant-driver.test.ts (Assistant), kernel runner case (stale governance assumption, test fixed) |
| **2026-10-18 16:01:58–16:03:19** | **37** | **903** | **903 passed, 0 failed** |

Static checks (same tree, 2026-10-18 ~16:12): `pnpm exec tsc --noEmit -p .` → exit 0, 0 errors · `pnpm exec eslint tests playwright.config.ts` → exit 0.

### Acceptance harness — `tests/integration/skills-acceptance.test.ts` → `evidence/skill-verification.json`

Last run 2026-10-18T16:02:21Z on `ageos_test_qa`, handler version as recorded in the file:
**positive 42/42 · negative 42/42 · replay 42/42 · pending 0 · failed 0.**
Each skill: reset → positive (fresh) → positive (re-run) → replay same key; reset → negative (fresh) → negative (re-run). Positive requires `succeeded`, every `repositoryOutputs` key, fixture `verify`, persisted `workflow_run` (+steps, handler version, actor, tenant) and, for commands, correlated business events + idempotency record. Negative requires the exact `expectCode`/`expectRule`, a non-empty message, no business event and an unchanged row count + content digest of every table (all tenants) except `workflow_run(_step)`/sessions/platform audit.

### Assistant — `tests/integration/assistant-acceptance.test.ts` → `evidence/assistant-acceptance.{json,md}`, `evidence/assistant-tool-coverage.json`

Last run 2026-10-18T16:02:29Z: A02 A03 A04 A05 A06 A07 A08 A09 A10 A11 A12 A14 A15 A16 A17 passed (driver layer). Tool coverage: **42/42 skill ids delegated through the scripted orchestrator** (tool call or delegation persisted for exactly that skill id; clarifications answered with the offered option/example; confirmations confirmed). A01, A13, A18 are browser or not-yet-covered cases (see §3).

### Audit regressions (all green in the 16:01 run)

| Finding | Test | Result |
|---|---|---|
| B02 replay compares request; re-checks permission | tests/integration/audit-runner-idempotency.test.ts | passed (red state not observed: the first clean run came after Core-1's runner fix) |
| B03 concurrent double submit | same file | passed (red state not observed, same reason) |
| B04 Stop / interrupt mid-step | tests/integration/audit-assistant-cancel-resume.test.ts | passed (red state not observed: the driver was mid-rewrite during earlier runs) |
| B05 crash after commit → retry / lease / resume | same file (driver `hooks.afterStep` + injected clock) | passed |
| B06 PO evidence random/foreign/file-id/brief/other-job/unreviewed/tampered | tests/integration/audit-po-evidence.test.ts | passed (observed red 2026-10-17: random UUID raised a raw FK insert error; brief / other-job / unreviewed evidence were accepted) |
| B07 deferred approval: expiry, disabled capability, lost permission, material change | tests/integration/audit-deferred-approval.test.ts | passed (red state not observed: earlier runs were blocked by the schema push issue, then Core-1's fix landed) |
| B08 revoked permission hides persisted answer + sources | tests/integration/audit-assistant-history.test.ts | passed |
| B09 concurrent job opens, two clients | tests/integration/audit-job-reference-race.test.ts | passed (observed red 2026-10-17: `Failed query: insert into "job" …` duplicate display reference `RDS-2027-005`) |
| F05 exact money sort | tests/unit/audit-f05-money-sort.test.tsx, tests/unit/format.test.tsx | passed (DS fix landed before the test first ran; red state not observed) |
| F07 timestamps / business dates | tests/unit/format.test.tsx | passed; invalid wire value case was red (`Cannot convert 12.50 to a BigInt`) until the coordinator fixed `fmtMoney` |

## 2. Playwright — read-only specs against the shared dev server (:3100)

Command: `E2E_EVIDENCE=1 pnpm exec playwright test --grep-invert @mutating` (system Chrome, headless; projects desktop 1440 EN dark, desktop-light, desktop-es, mobile 390, mobile-light-es). Run 2026-10-18 16:04–16:11 UTC: **45 passed, 14 failed, 16 skipped**. `evidence/demo-e2e-results.json` / `demo-e2e-report.md` are from this run. Mutating specs (journeys J01–J10, assistant, locale) were **not run** (no dedicated E2E server yet).

Failures, grouped by cause (verbatim first lines):

| Cause (owner) | Failing tests | Error |
|---|---|---|
| `/a/rayo-de-sol/assistant` has no `<h1>` (Assistant) | crawl assistant; sidebar 17 (at /assistant); visual ×3 (desktop, desktop-light, mobile); mobile overflow /assistant; screenshots ×2 | `Error: /a/rayo-de-sol/assistant has no visible h1` |
| `/sign-in` has no `<h1>` (DS) | crawl sign-in | `Error: /sign-in: /sign-in has no visible h1` |
| Dark default applied after `<body>` starts (DS) | theme FOUC guard; theme first-frame probe (intermittent: 3/6 repeats failed) | `/sign-in: <html> has no server "dark" class and the theme script runs after <body> starts (index 3491 vs body 2779) — a frame can paint light first` / `html.dark missing at first frame` |
| Header search dialog does not return focus on Escape (DS) | keyboard search | `Expect "toBeFocused" getByRole('button', { name: /^(Search|Buscar)/ }).first() … unexpected value "inactive"` |
| Mobile navigation Sheet does not close on Escape (DS) | mobile Sheet | `Expect "toBeHidden" getByRole('dialog', { name: /Main navigation…/ }) … unexpected value "visible"` (focus was inside the dialog on a link) |
| Transient dev Build Error while another agent edited `components/settings/brand-form.tsx` | crawl workflow-workbench (agency-campaign-optimization) | `shows a Next.js error overlay` — page returned 200 right after; not a product finding |

Skipped (not passed): 9 `@mobile` tests on the desktop project (by design), mobile-only screenshot on desktop, ES visual ×2 (need the dedicated DB: switching language writes the presenter preference), platform-persona crawl (needs persona sessions on the dedicated DB), and three discovered-id routes with no link at this checkpoint: `/control/activations/:runId`, `/a/:agencySlug/approvals/:approvalId`, `/a/:agencySlug/records/:recordType/:recordId` (the dossier exposes no `/records/` link).

Also observed: Norte client/file deep links under Rayo render the not-found UI with **HTTP 200** (streamed segment) instead of 404; no Norte data appears. The spec accepts this as a soft 404 and annotates it (`soft-404`).

## 3. Not verified yet

- J01–J10 browser journeys, A01/A03/A16 browser assistant flows, EN↔ES switch, ES visual matrix, platform persona crawl: written, need the dedicated E2E server (§4).
- A13 (timeout after a simulated effect, through the assistant): no assistant test; the adapter behavior is covered by kernel.test.ts “simulated provider adapter”.
- 768 px breakpoint (only 390 and 1440 are in the matrix).

## 4. Certification command (dedicated database, coordinator)

```
# server under test (coordinator): next build && next start on ageos_test_e2e
DATABASE_URL=<app role url>/ageos_test_e2e DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e \
AGEOS_STORAGE_DIR=.data/e2e-files PORT=3200 pnpm start
# E2E (one worker; resets checkpoints between journeys via scripts/seed-demo.ts on that DB)
E2E_EVIDENCE=1 E2E_BASE_URL=http://localhost:3200 \
E2E_DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e E2E_STORAGE_DIR=.data/e2e-files \
pnpm exec playwright test
```

Do not pass `--reporter` on the command line (it replaces the evidence reporter). `AGEOS_SESSION_SECRET` must be the server's (read from `.env.local` if not exported). Artifacts go to `.data/e2e-output/` (gitignored).
