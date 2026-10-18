# Investor demo scripts: 90 seconds and 5 minutes

Adapted from `../05-guion-demo-inversionistas.md` to the routes, personas, controls and figures that exist in the app on 2026-10-18. Paths are relative to the application root (`claude-code-chasis-v1/app/`).

**Rehearsed: `<<E2E_PENDING>>`** (both scripts). Nothing below has been timed or run end to end by a person or by the browser specs yet. Expected results come from the journey catalog (`lib/demo/journeys.ts`), `../demo-fixtures.json`, the seed and passing Vitest assertions; confirm exact on-screen wording during the rehearsal and fix this file, not the data. Timings are narration pacing, not a speed claim: if an operation takes longer, wait for its real state.

## 1. Figures (confirmed in `../demo-fixtures.json`)

All amounts are USD, integer minor units in the data, `HALF_UP` display with one decimal for percentages. Agency: Rayo de Sol / app name Estudio Solar (`/a/rayo-de-sol`). Job: Aurora Spring Launch, `RDS-2027-001`, canonical number `AURSL7AF0001`, client Aurora Beverages.

| Checkpoint (`financial_checkpoints`) | Agency fee | Agency cost | Margin | Margin % | Client authority |
|---|---|---|---|---|---|
| `initial_plan` (100 h forecast) | 20,000 | 11,000 (labor 5,000 + vendor 5,500 + expense 500) | 9,000 | 45.0% (4500 bps) | 50,000 |
| `unpriced_scope_change` (+40 h x 50 = +2,000) | 20,000 | 13,000 | 7,000 | 35.0% (3500 bps), below the 40% floor | 50,000 |
| `approved_amendment` (+3,000 fee) | 23,000 | 13,000 | 10,000 | 43.48% (4348 bps), displayed **43.5%** | 53,000 |

Other figures:

| Item | Value |
|---|---|
| Managed media | 30,000, kept out of agency revenue and margin (`managed_media_treatment`: pass-through excluded) |
| Client authority | PO revision 1 50,000 -> revision 2 53,000 (`evidence_demo_po_r2`, seeded `received`, must be reviewed before it can back authority) |
| Supplier invoice | 6,000 against an accepted delivery of 5,500: held until corrected (difference 500) |
| Client invoice | 53,000 = fee 23,000 + media recovery 30,000 |
| Cash | opening 10,000 + first collection 40,000 - payments 43,000 (media 30,000 + production 5,500 + expense reimbursement 500 + payroll 7,000) + final collection 13,000 = **20,000**; no overdraft |
| Ledger | 15 balanced Demo-ledger journals; net agency profit 10,000 |

Order, delivery, invoice and payment are linked stages of one cost, never four costs. Assertions: `tests/integration/kernel.test.ts` (45.0%, 3500 bps, 4348 bps), `assistant-acceptance.test.ts` A02 (45.0% -> 35.0% -> 43.5% only after the approved amendment), `core3-aurora-finance.test.ts` (cash 20,000, 15 journals).

## 2. Setup before presenting (both scripts)

1. Load a clean checkpoint with a presenter session: `pnpm db:reset:demo` (default `ready_for_scope_review`) or `/demo/presenter` -> Reset (typed confirmation). Use `pnpm db:reset:demo:intake` / "Load checkpoint" -> From intake only for the build-from-zero variant. Never reset a database other people are using.
2. Sign in at `/sign-in` with the demo access code (from `.env.local`; do not show or print it). Keep English and the default dark theme.
3. Use separate browser contexts (or switch at `/demo/presenter` -> "Act as", which rotates the session and is audited) for: **Alex Rivera** (owner), **Sam Cruz** (account_manager), **Morgan Lee** (finance_approver); for the 5-minute script also **Casey Martin** (owner, Norte Studio), **Avery Park** (platform_operator) and **Jamie Torres** (platform_admin).
4. The discreet label "Demo · Scripted assistant · Simulated integrations" must be visible. The checkpoint has no 40 h scope change, no amendment, no orders, invoices or payments; they arise from the commands below. Do not jump a checkpoint past an approval the script has not executed.
5. Supported assistant inputs (scripted driver `erp-42@2.0.0`): "Explain Aurora margin" (also the suggestion chip), "Create a job", "Run demo: agency-fee-contracts" (or the label "Fee agreements"), any `Run demo: <skill id>` / `ERP-NN`. Other text gets an honest "outside this scripted demo" answer with the supported scenarios; do not improvise prompts.

## 3. 90-second walkthrough

Rehearsed: `<<E2E_PENDING>>`. Entry checkpoint: `ready_for_scope_review`. Story: configure -> activate -> a scope change drops the margin -> the right person approves with the client's updated authority -> the same numbers appear everywhere.

| # | Time | Route | Persona | Action | Expected on-screen result |
|---|---|---|---|---|---|
| 1 | 0-12 s | `/control/agencies` -> `/control/setup/<draftId>/review` | Alex Rivera (owner) | Open the parked Rayo de Sol draft with "Resume - Review" | Review step lists exactly what will be published (Rayo de Sol / Estudio Solar, 9 modules, 42 capabilities) with revision number and digest; "Deploy demo agency" is enabled |
| 2 | 12-25 s | `/control/activations/<runId>` -> `/a/rayo-de-sol` | Alex Rivera | Click "Deploy demo agency", watch the persisted steps, then "Open workspace" | Eight steps validate -> workspace -> roles -> publish -> storage -> capabilities -> access -> ready; survives refresh; the existing workspace opens with the published name and the demo label. Say: this activates a logical demo workspace, not infrastructure or domains |
| 3 | 25-38 s | `/a/rayo-de-sol/jobs/<auroraJobId>` (open Aurora Spring Launch from `/a/rayo-de-sol/jobs`) | Sam Cruz (account_manager) | Open the dossier; click "Open AgeOS Assistant panel"; send "Explain Aurora margin" | Dossier shows Projected margin, labelled "Forecast - not a recognized accounting result": fee 20,000, cost 11,000, margin 9,000, 45.0%, managed media 30,000 shown separately. The panel answers with a margin card, the job and the sources, labelled as scripted demo |
| 4 | 38-48 s | `/a/rayo-de-sol/modules/work-production/workflows/agency-production-estimating` | Sam Cruz | Introduce the scope change: job Aurora, labor 8400 min (140 h), hourly cost 50.00, vendor 5500.00, expense 500.00, reason "Estimate updated after the creative scope change."; "Run capability" | Server validation passes; cost 13,000, margin 7,000, **35.0%**, below the 40% floor (the figures follow the checkpoint; repeating "Explain Aurora margin" now answers 35.0%) |
| 5 | 48-58 s | assistant panel on the Aurora dossier | Sam Cruz | Send "Run demo: agency-fee-contracts"; answer its questions (new agency fee 23000.00); "Confirm exact proposal" | An exact fee-amendment proposal (+3,000) is shown; confirming creates an approval request and changes nothing financial: margin stays 35.0%. Confirmation is not approval |
| 6 | 58-76 s | `/a/rayo-de-sol/records/evidence/<poR2EvidenceId>` -> `/a/rayo-de-sol/modules/clients-contracts/workflows/agency-contract-po` -> `/a/rayo-de-sol/approvals` -> `/a/rayo-de-sol/approvals/<approvalId>` | Morgan Lee (finance_approver), then Sam Cruz for the PO record | Finance reviews the PO r2 evidence ("Mark reviewed"); Sam records client authority (PO-AUR-2027-01, 53000.00); Morgan opens each pending approval, "Approve exact change", then "Apply approved change" | The requester cannot approve their own request; the approval is bound to the exact payload and revision; the fee amendment stays held until the client authority covers 53,000 (two approvals: authority first, then the amendment). Client authority 50,000 -> 53,000 is shown as a separate fact from internal approval. Pre-stage the evidence review and PO record before the audience if time is short |
| 7 | 76-90 s | `/a/rayo-de-sol/jobs/<auroraJobId>` then `/a/rayo-de-sol/capabilities` | Sam Cruz | Reload the dossier, then open the catalog | Fee **23,000**, cost 13,000, margin **10,000 / 43.5%** (43.48%), managed media 30,000 still separate; assistant answer after reload also 43.5%. Catalog: 9 modules, 42 capabilities |

Close (no invented speed claim): "Build your agency with AgeOS. Configure once, then operate from one connected system."

Questions and verified answers: why did margin fall -> 40 h x 50 = 2,000 more cost, fee unchanged; why did it rise -> fee 20,000 to 23,000, cost stays 13,000; is 53,000 agency revenue -> no, it is fee 23,000 plus 30,000 managed media; is it realized margin -> projected (forecast), recognition needs approved hours, accepted deliveries and matched costs; is the AI deciding -> no model is called, the driver is scripted and the ERP enforces calculations, permissions and approvals.

## 4. Five-minute walkthrough

Rehearsed: `<<E2E_PENDING>>`. Entry checkpoint: `ready_for_scope_review` (the same run as the 90-second script, continued). Sections follow `../05-guion-demo-inversionistas.md`; the finance sequence of journeys J05-J06 is optional and only valid after the scope change of section 2.

| # | Time | Route | Persona | Action | Expected on-screen result |
|---|---|---|---|---|---|
| 1 | 0:00-0:45 Build | `/control/agencies` -> `/control/setup/<draftId>/review`; `/a/rayo-de-sol/capabilities` | Alex Rivera | Show the parked Rayo draft; optionally walk `agency`, `operations`, `connections`, `brand-access` (or "New agency" -> "Use a sample agency" -> "Continue"); open the catalog | Each step is saved on the server and validated; the catalog lists 9 modules / 42 capabilities with mandatory controls and dependencies enforced; reloading keeps the draft revision |
| 2 | 0:45-1:15 Activate | `/control/activations/<runId>` -> `/a/rayo-de-sol`; `/control/agencies/<agencyId>` | Alex Rivera | "Deploy demo agency", then "Open workspace"; show the simulated domain on the agency page | Eight persisted steps to ready; workspace with its name, accent and capabilities; domain walks Requested -> Pending DNS -> Verifying -> Simulated ready, labelled simulated (no DNS, no purchase) |
| 3 | 1:15-2:35 Operate | `/a/rayo-de-sol/jobs/<auroraJobId>` (tabs Overview, Scope & budget, Production, Media, Finance, Files, Activity); assistant panel; workbenches and `/a/rayo-de-sol/approvals/<approvalId>` as in the 90-second steps 3-6; `/a/rayo-de-sol/modules/profitability` | Sam Cruz, Morgan Lee | Ask "Explain Aurora margin" in the panel; walk the tabs keeping the same thread; record the 40 h change; prepare the +3,000 amendment; finance reviews PO r2 (53,000) and approves; open the Profitability desk | Every cost and commitment links to the Aurora job; managed media 30,000 is not added to agency revenue; 45.0% -> 35.0% -> 43.5% from stored records (not a card that always says 35%); the Profitability desk ("Projected margin by job from approved fee and current cost estimate; managed media kept separate") must show the same totals: fee 23,000 / cost 13,000 / margin 10,000 (spec requirement; confirm the exact layout in the rehearsal) |
| 4 | 2:35-3:25 Control | `/a/rayo-de-sol/approvals/<approvalId>`, `/a/rayo-de-sol/runs`, `/a/rayo-de-sol/runs/<runId>`; `/a/rayo-de-sol/assistant` | Sam Cruz, Morgan Lee | Sam tries to approve his own proposal (he is the requester and his role lacks `approvals.decide`); show finance's approval held until client authority covers 53,000; open the audit trail of a run; ask for a write in the assistant and use its exact proposal card; open Assistant from the sidebar, then "Return to work" | Requester cannot approve (server-side block, no effect); the held amendment applies only after authority; runs show steps, actor and idempotency; confirmation in chat is not approval; the same thread appears on the full page and returning to work restores the dossier tab. Optional if J05 was run: invoice 6,000 vs delivery 5,500 is held, and paying 43,000 before collecting is blocked for insufficient funds (cash 10,000) |
| 5 | 3:25-4:10 Connections and files | `/a/rayo-de-sol/connections` -> `/a/rayo-de-sol/connections/<connectionId>`; `/a/rayo-de-sol/library` -> `/a/rayo-de-sol/library/<fileId>` | Alex Rivera (connections), Sam Cruz (files); Casey Martin for isolation | Review impact and revoke the simulated Meta account, try the dependent campaign activation, restore it; upload a small synthetic CSV and link it to the job; as Casey Martin open a Rayo job URL | Revoking blocks only dependent actions (`connection_revoked`) and is recorded; restoring needs a new verification; the file is stored privately with hash and version ("Stored" is not "Analyzed"), downloads are authorized; the Rayo URL is not found for Norte and shows no Rayo data |
| 6 | 4:10-4:40 Platform | `/ops` -> `/ops/incidents/<incidentId>` -> `/ops/changes/<changeId>` | Avery Park (platform_operator), then Jamie Torres (platform_admin) | Open `ops_csv_delimiter_mismatch`, "Investigate", "Prepare reviewable change" (`,` -> `;` for the demo import profile); the admin opens the change, "Approve exact configuration change", "Apply approved local change", "Verify local result" | The real parser returns 1 column where 6 are expected; the requester cannot approve; after apply the profile is revision 2; verification re-parses the same file: 6 named columns and 1 data row; incident resolved and audited; no order is imported and nothing is spent |
| 7 | 4:40-5:00 Close | `/a/rayo-de-sol/capabilities` | Alex Rivera | Open the catalog and the status of each capability | 9 modules / 42 capabilities, each with its registry status (`scenario_verified` for all 42 when `evidence/skill-verification.json` matches `HANDLER_VERSION` `chassis-2`); coverage is derived from test results, not from row counts |

Positioning line (use as written; add no data-network, ML or savings claims): "AgeOS lets an agency build and run its own operation on a reusable agentic ERP foundation. We aim to make setup and day-to-day execution simpler, while every completed job adds structured operational context for that agency."

## 5. If something fails live

Show the real diagnosis; do not replay an animation that announces success. Keep a reset path (`pnpm db:reset:demo`), a clean fixture, a backup recording and the short list of what is still simulated: ads, payments, accounting, OAuth, DNS and tax documents are demo states with `sim_*` receipts; the assistant is scripted; data is synthetic. Do not present the demo as proof of customers, revenue, activation speed or integration coverage.

## 6. Differences from `../05-guion-demo-inversionistas.md`

| Spec says | App today |
|---|---|
| "Load sample scope request" in the demo tools | No such control. The 40 h change is a normal command on the production-estimating workbench (J04.2) |
| "What needs attention on this job?" / "Explain the margin change and prepare the fee adjustment for review" | Not scripted aliases. Use "Explain Aurora margin" and "Run demo: agency-fee-contracts" |
| Coverage shown as "9/42" | 42/42 capabilities are `scenario_verified` per the harness |
| Importing orders from a CSV (duplicate import blocked) | Not shown: the jobs import has a CSV preview at upload but no apply step (`IMPLEMENTATION_STATUS.md` section 7) |
