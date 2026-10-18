# Resume checkpoint — 2026-10-17 ~22:30 (session limit reached)

Master task: `../PROMPT-UNICO-AUDITORIA-AGENTES-E-INSTRUCCION-2.md`. Rules: `docs/COORDINATION.md`.
Not complete. Do not declare completeness.

## Agents (background, same session)
| Agent | id | State |
|---|---|---|
| DS & Shell | a644dbfc238adb29c | DONE. Vercel theme, dark default, toggle, F05, F07. Verified by coordinator (tokens vs vercel.json; vendored lint clean). |
| Platform | a0a1677367fd22cac | DONE. Wizard/activation/ops/presenter services, demo_run, seed modes. Coordinator rerun: 30/30. |
| Core-1 | a057d84df1e369d2a | DONE (+ follow-up). B02 B03 B06 B07 B09 fixed, 10 skills. Coordinator rerun: 118/119 (1 stale kernel test → QA). |
| Core-2 | a1a25584ff648d56e | DONE, resumed for follow-ups (kernel resolvers rate_card/timesheet, actionTypes filter, persist notes/decision_reason/audience, drop supplier copy-back in production.ts). Coordinator rerun before follow-up: 115/115. |
| Core-3 | aab2ac1c5e54a43bf | RUNNING (ERP-26..42). Pending asks: tsc TS2783 billing.ts:206/payments.ts:268, deterministic contract pick in loadJobFinancials, seed evidence links in core3.ts, jobCloseFinanceChecks export, getBusinessDate. |
| Assistant & OpenUI | ad28e893f9c3ef122 | RUNNING. Asks: assistant-driver.test.ts:384 PO keys {job, reference:"PO-AUR-2027-01", amount, evidenceId}, "evidence" FieldType, getBusinessDate. |
| Screens | af71d332aa5941d95 | RUNNING. Asks: platform services, Core-2 extra commands, evidence review J04, approval_expired/capability_disabled copy, ThemeToggle in /control /ops, timeZone. |
| QA | ab6cbbf22fb4c3b3d | RUNNING. Asks: kernel.test.ts stale "pending handlers" test; format/theme tests from DS. |

If an agent stopped mid-task: resume with SendMessage to its id (resumes from transcript), or re-brief.

## Coordinator done
- `server/calculators/shared.ts` (allocate, installmentSchedule, creditExposure) + parity tests 9/9.
- `scripts/test-agent.ts` rebuilt: per run drops schemas, committed migrations + generated WIP migration (`.data/drizzle-wip/<agent>`), RLS, vitest. Old push silently failed.
- Seed modes wired; `db:reset:demo:intake` script; `SeedIds.mode`.
- eslint vendored rules (gantt); `.gitignore` `.data/` + playwright; `.env.example`; `DECISIONS.md` D01–D41.

## Coordinator next (in order)
1. Wait for Core-2 follow-up, Core-3, Assistant, Screens, QA; rerun each agent's suites with `pnpm test:agent coord <files>`.
2. Backbone typed columns only if Core-3 asks (purchase_order.commitment_id/action_id/submission_state, delivery.delivered_units).
3. `pnpm db:generate` → one migration (0004) for all new schema; verify on fresh `ageos_test_coord`; `pnpm db:migrate` dev; `pnpm db:reset:demo` (demo tenants only).
4. Full gates: typecheck, lint, test, build (stop dev server first), `next start` + Playwright E2E on a dedicated E2E DB.
5. QA final: evidence/skill-verification.json (42 × positive/negative), demo-e2e-results.json, reports, screenshots.
6. Docs: README (replace Verve README), IMPLEMENTATION_STATUS.md, HANDOFF-INSTRUCCION-2.md, route matrix, findings traceability, 90s/5min scripts.

## Known open items
- next-themes 0.4.6 dev-only "script tag" console warning on client remount (Fast Refresh/error recovery); fresh load clean. Recheck on production build.
- Light-mode input border contrast 1.16:1 (official theme value), flagged by DS.
- Dev DB lacks new schema until step 3; pages using new tables fail on :3100 meanwhile.
