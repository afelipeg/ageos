# Assistant acceptance — A01–A18 (scripted driver)

Generated 2026-10-18T16:53:21.806Z from recorded test results (Vitest 2026-10-18T16:53:21.806Z). Driver: scripted · catalog erp-42@2.1.0. No model or provider is called; every case below is a test that ran, or is marked not run.

| ID | Case | Result | Layer · test | Detail |
|---|---|---|---|---|
| A01 | Sidebar → page; header → panel; expand/return keep one thread and orchestrator, no duplicate run | **not_run** | — |  |
| A02 | “Explain Aurora margin” (+ES): 45% → 35% after extra hours → 43.5% only after the amendment; sources and checkpoint | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — margin follows the checkpoint: 45.0% → 35.0% after 40h → 43.5% only after the approved amendment (EN and ES alias) |  |
| A03 | Create a job with a missing parameter: asks, validates, proposes, confirms, saves one job | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — create a job: asks for the missing client and name, proposes, confirms once and saves one job |  |
| A04 | Media plan USD 30,000: computed lines and approval before activation | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — media plan via orchestrator (completed) | parts: user_text,proposal,text,delegation,capability_result,approval_request,openui_view |
| A05 | Meta campaign from the plan: plan revision/demo account, controls and sim_* receipt | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — campaign activation via orchestrator → approval → simulated effect (completed) | approved by finance_approver; executed=true; sim receipts=1 |
| A06 | Catalog and specialist delegation cover the 42 IDs; a delegation runs a real audited command | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — 42/42 skills delegated through the orchestrator |  |
| A07 | Viewer asks for a payment; self-approval: server-side block, no effect, no forbidden data | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — a viewer asking for a payment run is blocked server-side with no effect |  |
| A08 | Revision changes after confirm/approve: blocked, new revision required | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — a material change after the proposal makes its confirmation stale; nothing executes |  |
| A09 | Agency/role change; foreign conversation URL: no leak of messages, sources, files or events | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — a conversation id from another agency or another member resolves to not_found |  |
| A10 | Navigate after starting “this job”: original snapshot, action target unchanged | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — the run's context snapshot keeps the job it started on, whatever the later page context is |  |
| A11 | Double submit / reconnect / retry: one run, one command, one effect | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — the same client message id sent twice is one user message and one run |  |
| A12 | Reload, close panel, Stop and resume: persisted state; no repeated steps; committed effects visible | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — Stop on a waiting run cancels it and its pending proposal; the view after reload shows it stopped |  |
| A13 | Timeout after a simulated effect: outcome unknown and reconciliation of the existing operation | **not_run** | — |  |
| A14 | Malicious file / unknown fixture: untrusted data, allowed parser or scope notice, no elevation | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — instructions inside user text are data: an injection attempt runs nothing and changes nothing |  |
| A15 | Revoked access to a saved source: history restricted to current authorization | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — revoking reports.view restricts the saved margin answer and its sources on read |  |
| A16 | Unknown alias, ambiguous case or out-of-checkpoint: offers available cases, changes nothing | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — unknown text offers the supported scenarios and creates no run or business effect |  |
| A17 | Tampering with history / tool output / approval from the browser: server rejects | **passed** | domain/driver (vitest): `tests/integration/assistant-acceptance.test.ts` — a forged digest or another user's proposal cannot be confirmed |  |
| A18 | 390/768/1440 px, keyboard, EN/ES and theme: accessible controls, context kept, demo visible | **not_run** | — |  |

`not_run` means no executed test covers the case yet in the recorded runs; it is not a pass.
