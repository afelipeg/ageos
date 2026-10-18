# QA coverage matrix

Generated 2026-10-18T15:23:31.311Z by `tests/support/write-coverage-matrix.ts` from the contracts and recorded evidence: harness 2026-10-18T15:20:18.647Z, assistant coverage 2026-10-18T15:22:27.413Z, browser E2E 2026-10-18T15:16:56.828Z (database: shared dev server, read-only specs).

## Routes (31 patterns)

| Route | Path | Screen family | Primary actions | Data / services | Authorization | Tests | Last browser result |
|---|---|---|---|---|---|---|---|
| landing | `/` | landing | start_demo_setup, explore_authorized_fixture |  | public | e2e routes.spec | not run |
| sign-in | `/sign-in` | settings-form | authenticate_demo_session |  | public | e2e routes.spec<br>e2e shell.spec sign-in gate<br>e2e global-setup (real access-code login) | not run |
| control-agencies | `/control/agencies` | control-list | create_agency_draft, resume_setup, open_workspace | tenant_memberships, activation_runs | control_member | e2e routes.spec<br>e2e journeys J01.1 | not run |
| control-agency | `/control/agencies/:agencyId` | record-detail | open_workspace, review_configuration | tenant_memberships, tenant_configuration, activation_runs | control_member | e2e routes.spec (discovered)<br>e2e journeys J01.8 | not run |
| setup-wizard | `/control/setup/:draftId/:step` | setup-wizard | save_draft, continue_valid_step, back, review_configuration, deploy_demo_agency | agency_draft, tenant_configuration, connection_bindings | control_member | e2e routes.spec (discovered)<br>e2e journeys J01.2–J01.6 | not run |
| activation | `/control/activations/:runId` | run-detail | retry_safe_step, resolve_blocker, open_workspace | activation_runs, run_steps, tenant_configuration | control_member | e2e routes.spec (discovered)<br>e2e journeys J01.7 | not run |
| workspace-home | `/a/:agencySlug` | workspace-home | open_attention_item, open_job, create_job | jobs, approvals, named_metric_queries, run_events | tenant_member | e2e routes.spec<br>e2e shell.spec<br>e2e visual.spec | not run |
| assistant | `/a/:agencySlug/assistant` | assistant-conversation | submit_supported_preset_or_alias, new_conversation, open_authorized_thread, attach_authorized_file, review_proposed_command, request_required_approval, return_to_work_with_panel | assistant_conversation, assistant_message, action_proposal, assistant_run, approval_request | tenant_member | e2e routes.spec<br>e2e assistant.spec A01/A03/A16 @mutating<br>vitest assistant-acceptance A02–A17<br>vitest audit-assistant-* | not run |
| inbox | `/a/:agencySlug/inbox` | module-desk | open_item, assign_item, snooze_item, resolve_verified_item | attention_items, approvals, blockers | tenant_member | e2e routes.spec | not run |
| jobs | `/a/:agencySlug/jobs` | module-desk | create_job, open_job, preview_import, apply_valid_import | jobs, clients, job_metric_views | tenant_member | e2e routes.spec | not run |
| job-dossier | `/a/:agencySlug/jobs/:jobId` | record-detail | propose_change, request_approval, log_time, open_plan, open_invoice, upload_file, open_run | jobs, contracts, budgets, tasks, timesheets, media_plans, orders, deliveries, bills, invoices, receipts, journals, files, audit_events | tenant_member | e2e routes.spec (Aurora, demo-lab)<br>e2e routes.spec cross-tenant 404<br>vitest isolation-governance (getJobDossier)<br>e2e journeys J02/J04/J07 | not run |
| client-detail | `/a/:agencySlug/clients/:clientId` | record-detail | edit_client, create_job, open_contract, open_invoice | clients, client_contacts, jobs, contracts, invoices, files | tenant_member | e2e routes.spec<br>e2e cross-tenant 404<br>vitest isolation-governance (getClientDetail) | not run |
| module-desk | `/a/:agencySlug/modules/:moduleKey` | module-desk | open_record, create_record_if_allowed, open_workflow, filter_saved_view | authorized_module_view | tenant_member | e2e routes.spec (all 9)<br>e2e shell.spec sidebar | not run |
| workflow-workbench | `/a/:agencySlug/modules/:moduleKey/workflows/:skillId` | workflow-workbench | save_draft, validate_inputs, calculate_or_prepare, request_approval_if_required, execute_approved_action_if_allowed, download_output | workflow_contract, authorized_context, workflow_runs, output_artifacts, approvals | tenant_member | e2e routes.spec (all 42)<br>e2e journeys J02–J06, J10 (Run)<br>vitest skills-acceptance (42 × positive/negative/replay) | not run |
| business-record | `/a/:agencySlug/records/:recordType/:recordId` | record-detail | edit_draft, open_source, compare_revision, request_approval, open_job, download_allowed_artifact | authorized_record, record_revisions, record_links, files, audit_events | tenant_member | e2e routes.spec | not run |
| capabilities | `/a/:agencySlug/capabilities` | module-desk | filter_by_module, open_workflow, review_activation_change | catalog_42, tenant_configuration, capability_dependencies | tenant_member | e2e routes.spec | not run |
| approvals | `/a/:agencySlug/approvals` | module-desk | open_approval, filter_status | approvals | tenant_member | e2e routes.spec<br>e2e journeys J07.4<br>vitest isolation-governance (listApprovals) | not run |
| approval-detail | `/a/:agencySlug/approvals/:approvalId` | approval-detail | approve_exact_payload, request_changes, reject_with_reason, open_evidence | approval_payload, record_revisions, approval_policy, files, audit_events | tenant_member | e2e routes.spec (discovered id)<br>e2e journeys J04.6<br>vitest kernel/audit-deferred-approval<br>vitest isolation-governance (Norte cannot open) | not run |
| runs | `/a/:agencySlug/runs` | module-desk | open_run, filter_status | workflow_runs, run_steps | tenant_member | e2e routes.spec | not run |
| run-detail | `/a/:agencySlug/runs/:runId` | run-detail | open_step_output, open_approval, retry_safe_step, reconcile_unknown_result, open_record | workflow_runs, run_steps, output_artifacts, approvals, audit_events | tenant_member | e2e routes.spec (discovered id)<br>vitest isolation-governance (runs invisible cross-tenant) | not run |
| connections | `/a/:agencySlug/connections` | module-desk | search_catalog, configure_demo_connection, start_file_workflow | connection_catalog, connection_bindings | tenant_member | e2e routes.spec | not run |
| connection-detail | `/a/:agencySlug/connections/:connectionId` | settings-form | test_simulated_connection, review_scope_change, disconnect_after_impact_review | connection_binding, account_binding, scopes, dependent_workflows, sync_events | tenant_member | e2e routes.spec (discovered id)<br>e2e journeys J08.3/J08.7<br>vitest isolation-governance (revoke/restore) | not run |
| library | `/a/:agencySlug/library` | file-library | upload_private_file, preview_file, preview_import, filter_job, download_authorized_file | file_metadata, file_versions, extraction_status, job_links | tenant_member | e2e routes.spec<br>e2e journeys J08.1 (upload) | not run |
| file-detail | `/a/:agencySlug/library/:fileId` | record-detail | preview_authorized_file, download_authorized_file, link_to_job, review_extraction, open_source_job | file_metadata, file_versions, extraction_artifacts, job_links, audit_events | tenant_member | e2e routes.spec (brief)<br>e2e cross-tenant 404<br>vitest isolation-governance (download route 200/404)<br>e2e journeys J08.2 | not run |
| settings | `/a/:agencySlug/settings/:section` | settings-form | save_configuration_draft, preview_change, publish_approved_configuration, copy_demo_invitation, review_demo_plan_change | tenant_configuration, branding, memberships, policy, domain_simulations, demo_entitlements, usage_counters | tenant_member | e2e routes.spec | not run |
| explore | `/a/:agencySlug/explore` | report | choose_named_question, set_parameters, run_readonly_query, open_source_record, export_authorized_report | named_readonly_queries, metric_definitions, source_freshness | tenant_member | e2e routes.spec | not run |
| report | `/a/:agencySlug/reports/:reportId` | report | change_authorized_filters, open_source_record, download_report | report_version, metric_definitions, source_manifest, data_cutoff | tenant_member | e2e routes.spec | not run |
| platform-home | `/ops` | platform-ops | open_incident, filter_health | redacted_tenant_health, platform_incidents | platform_operator_or_admin | e2e routes.spec (owner → 404)<br>e2e journeys J09.1 | not run |
| platform-incident | `/ops/incidents/:incidentId` | run-detail | inspect_evidence, prepare_reviewable_change | platform_incident, redacted_traces, investigation_steps | platform_operator_or_admin | e2e routes.spec (owner → 404)<br>e2e journeys J09.2/J09.3 | not run |
| platform-change | `/ops/changes/:changeId` | approval-detail | approve_exact_configuration_change, reject_change, apply_approved_local_change, verify_local_result | platform_change_payload, platform_approval, verification_results | platform_operator_or_admin | e2e routes.spec (owner → 404)<br>e2e journeys J09.4–J09.6 | not run |
| presenter-controls | `/demo/presenter` | settings-form | load_authorized_demo_scenario, reset_owned_demo_tenant, open_authorized_actor_session | owned_demo_fixture, demo_session_roles | demo_presenter | e2e routes.spec | not run |

## Skills (ERP-01..ERP-42)

Positive/negative/replay come from `tests/integration/skills-acceptance.test.ts` (fresh seed + re-run, every repositoryOutputs key, persisted run + events, negative blocked by the named rule with a whole-database no-side-effect check). Assistant = `tests/integration/assistant-acceptance.test.ts` sweep. Browser = J10 step in `tests/e2e/journeys.spec.ts`.

| ERP | Skill | Module | View → execute permission | Approval | Positive | Negative | Replay | Assistant | Browser J10 |
|---|---|---|---|---|---|---|---|---|---|
| ERP-01 | agency-orchestrator | setup | workspace.view → jobs.manage | none | passed | passed | passed | covered (completed) | not_run |
| ERP-02 | agency-integrations | setup | workspace.view → connections.manage | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-03 | agency-access-governance | setup | workspace.view → access.request | approval (owner) | passed | passed | passed | covered (completed) | not_run |
| ERP-04 | agency-master-data | setup | workspace.view → clients.manage | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-05 | agency-onboarding | clients-contracts | workspace.view → clients.manage | none | passed | passed | passed | covered (completed) | not_run |
| ERP-06 | agency-job-lifecycle | clients-contracts | workspace.view → jobs.manage | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-07 | agency-contract-po | clients-contracts | workspace.view → budget.propose | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-08 | agency-budget-control | clients-contracts | workspace.view → budget.propose | none | passed | passed | passed | covered (completed) | not_run |
| ERP-09 | agency-fee-contracts | clients-contracts | workspace.view → budget.propose | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-10 | agency-billing-requirements | clients-contracts | workspace.view → billing.manage | none | passed | passed | passed | covered (completed) | not_run |
| ERP-11 | agency-tasks-timesheets | work-production | workspace.view → time.log | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-12 | agency-production-estimating | work-production | workspace.view → production.manage | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-13 | agency-production | work-production | workspace.view → production.manage | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-14 | agency-media-ranking | media-planning | workspace.view → media.plan | none | passed | passed | passed | covered (completed) | not_run |
| ERP-15 | agency-media-planning | media-planning | workspace.view → media.plan | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-16 | agency-tv-radio-planning | media-planning | workspace.view → media.plan | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-17 | agency-ooh-planning | media-planning | workspace.view → media.plan | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-18 | agency-digital-planning | media-planning | workspace.view → media.plan | none | passed | passed | passed | covered (completed) | not_run |
| ERP-19 | agency-plan-changes | media-planning | workspace.view → media.plan | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-20 | agency-rate-cards-contracts | media-buying | workspace.view → media.buy | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-21 | agency-media-buying | media-buying | workspace.view → media.buy | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-22 | agency-campaign-activation | media-buying | workspace.view → media.buy | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-23 | agency-campaign-optimization | media-buying | workspace.view → media.buy | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-24 | agency-transmission-control | media-buying | workspace.view → media.buy | confirmation | passed | passed | passed | covered (completed) | not_run |
| ERP-25 | agency-ooh-inventory | media-buying | workspace.view → media.buy | none | passed | passed | passed | covered (completed) | not_run |
| ERP-26 | agency-delivery-reconciliation | suppliers-payments | workspace.view → payables.manage | none | passed | passed | passed | covered (completed) | not_run |
| ERP-27 | agency-payables | suppliers-payments | workspace.view → payables.manage | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-28 | agency-payment-run | suppliers-payments | workspace.view → payments.execute | approval (finance_approver) | passed | passed | passed | covered (blocked) | not_run |
| ERP-29 | agency-cash-settlement | suppliers-payments | workspace.view → payables.manage | none | passed | passed | passed | covered (blocked) | not_run |
| ERP-30 | agency-expenses | suppliers-payments | workspace.view → time.log | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-31 | agency-client-billing | billing-collections | workspace.view → billing.manage | approval (finance_approver) | passed | passed | passed | covered (blocked) | not_run |
| ERP-32 | agency-collections | billing-collections | workspace.view → billing.manage | none | passed | passed | passed | covered (blocked) | not_run |
| ERP-33 | agency-rebates | billing-collections | workspace.view → billing.manage | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-34 | agency-tax-compliance | billing-collections | workspace.view → billing.manage | none | passed | passed | passed | covered (completed) | not_run |
| ERP-35 | agency-general-ledger | accounting-close | reports.view → ledger.post | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-36 | agency-accruals-revaluation | accounting-close | reports.view → ledger.post | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-37 | agency-fixed-assets | accounting-close | reports.view → ledger.post | approval (finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-38 | agency-period-close | accounting-close | reports.view → period.close | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-39 | agency-profitability | profitability | reports.view → reports.view | none | passed | passed | passed | covered (completed) | not_run |
| ERP-40 | agency-revenue-budget | profitability | reports.view → budget.propose | approval (owner/finance_approver) | passed | passed | passed | covered (completed) | not_run |
| ERP-41 | agency-cash-forecast | profitability | reports.view → reports.view | none | passed | passed | passed | covered (completed) | not_run |
| ERP-42 | agency-management-reporting | profitability | reports.view → reports.view | none | passed | passed | passed | covered (completed) | not_run |

## Cross-cutting suites

| Concern | Test file | What it asserts |
|---|---|---|
| Audit B02/B03 | tests/integration/audit-runner-idempotency.test.ts | replay = same request only; conflict on other payload/revision; replay re-checks permission; concurrent double submit = 1 run, 1 effect, no SQL error |
| Audit B04/B05 | tests/integration/audit-assistant-cancel-resume.test.ts | Stop/interrupt honored mid-step; crash after commit → retry/resume never duplicates; lease blocks a second worker; foreign resume = not_found |
| Audit B06 | tests/integration/audit-po-evidence.test.ts | PO evidence must exist, be own-tenant, reviewed, client PO kind, same job, unchanged hash; blocked attempts leave no rows |
| Audit B07 | tests/integration/audit-deferred-approval.test.ts | held approval re-checked at execution: expiry, disabled capability, lost permission, material change |
| Audit B08 | tests/integration/audit-assistant-history.test.ts | revoked reports.view hides persisted margin + sources (restricted marker); restore shows again; owner-scoped thread |
| Audit B09 | tests/integration/audit-job-reference-race.test.ts | concurrent opens for two clients → unique display references |
| Audit F05/F07 | tests/unit/audit-f05-money-sort.test.tsx, tests/unit/format.test.tsx | exact money sort by currency then minor units; invalid → —; agency-zone timestamps with label; business dates never shift |
| Isolation & governance | tests/integration/isolation-governance.test.ts | Rayo vs Norte via domain + real route handlers (search, download, assistant routes, approvals, runs); viewer writes; self-approval; stale revision; revoked scope; insufficient budget; duplicates; strict body; cross-origin |
| Kernel | tests/integration/kernel.test.ts | RLS, margin figures, exact-payload approvals, SoD, client authority, concurrency, runner, simulated provider |
| Browser | tests/e2e/*.spec.ts | see evidence/test-results.md |
