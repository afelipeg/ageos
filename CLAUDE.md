# AgeOS deterministic chassis

Build a working investor demonstration of AgeOS. The latest approved scope is deterministic and scripted: real persistence and business rules, a fixture-driven assistant, simulated external ERP integrations, and English UI with Spanish available. All nine ERP modules and all 42 skills remain in scope. The assistant represents the existing `agency-orchestrator` coordinating ERP subagents and capabilities; it is not a new module or skill 43. Its versioned demo driver may use prewritten replies and prescribed branches, explicitly labeled as demo. The application runtime makes no model or external business-provider calls. Development tools such as ReUI MCP and the configured database remain usable. Future live AI is a separate stage.

## Read in order

1. `01-brief-y-plan-de-construccion.md` — product promise, scope and implementation order.
2. `02-pantallas-y-flujos.md` and `rutas-y-pantallas.json` — screens, navigation and interactions.
3. `03-chasis-deterministico.md`, `cobertura-42-skills.json`, `demo-fixtures.json` — executable contracts, rules and expected results.
4. `04A-direccion-producto-y-mapa-ui.md` — concrete screen/block/component/icon decisions; then `04-reui-seleccion-e-instalacion.md` and `reui-inventario-verificado.json` for verified sources and installation.
5. `06-aceptacion-y-evidencias.md` — delivery gates.
6. `05-guion-demo-inversionistas.md` — short and extended product walkthroughs.
7. `07-asistente-global-erp.md` and `asistente-global-v1.json` — required orchestrator runtime, shared full-page/right-panel chat, semantic tools and acceptance. `REFERENCIA-COMMERCE-ASSISTANT.md` provides source-backed reference patterns.
8. `08-instruccion-2-demo-e2e.md`, `PROMPT-2-DEMO-E2E.txt` and `demo-scenarios-v1.json` — follow-up instruction after the chassis: program and verify the complete scripted E2E demo across all 42 capabilities and the three product pillars.

Read detailed references when needed, rather than loading every file at once. The main implementation instructions in this folder define the present demo scope; `referencias/` describes the broader target architecture. Never silently reduce the nine-module/42-skill coverage.

## Workspace

- Build the application in `app/`. Keep the specification and original references intact.
- The owner supplies the licensed Verve archive/source under `inputs/reui/verve/`. Inspect it before choosing paths or installing dependencies.
- Preserve a supplied template's compatible framework, component base, style, icon library and lockfile. Default to Next.js App Router, TypeScript and PostgreSQL. Do not merge several full applications or switch frameworks.
- Read repository instructions in the template. Resolve routine implementation details autonomously; request input only for a material missing dependency or a genuinely unresolved product decision.
- If premium source is missing, continue schema, commands, seeds and tests. Record the missing UI source clearly; do not invent a licensed download or claim template fidelity.

## ReUI is the UI system

- Use the connected ReUI MCP. First call `get_agent_skill` and `get_project_context`.
- Before a screen, use `compose_page`; before choosing an item use `search`, `get_block` or `get_example`; read `get_component` and a worked `get_examples` composition before using props.
- Get the exact install command. Templates are downloads, not registry item names. Do not guess `@reui/` names.
- Preserve installed components and their styling. Follow the installed Base UI/Radix API; do not mix `asChild` with a Base UI composition.
- Use the template's icon library consistently. Default to its Lucide icons; optional Motion Icons require verified items and are not needed to finish.
- Operational screens are dense, Frame-led where compatible with the verified block. Flow screens use the prescribed Card/Dialog composition. Do not nest a Card inside a Frame or the reverse.
- Keep semantic tokens, status variants, typography and motion as supplied. No invented gradients, generic card walls, fake table controls, tiny text or row entrance animations.
- Every data region has loading, empty, error and success states. Every visible action works or clearly explains a real precondition.
- Use `validate_usage` and `get_audit_checklist`; complete the current ReUI quality checks, keyboard checks, typecheck and lint.
- Assistant content uses verified `ai-chat-6`; use `app-shell-18` only as the docking/composition reference, preserving Verve's existing shell and styling. Agent Activity is execution evidence, not a chat replacement.

## Deterministic business kernel

- The database is the operational source of truth. Browser state may hold UI preferences and unsaved drafts, not the authoritative ERP.
- All mutations use server-side commands with validated input, authenticated actor, tenant scope, expected revision, permissions and audit events.
- UI, the current orchestrator and its subagents invoke the same services. Never put financial or authorization rules only in components, a prompt or a mock connector.
- Use transactions and concurrency control for business state. Retries must not duplicate commands, invoices or simulated transfers.
- Use exact decimal/money representations and explicit currency, rounding and metric definitions. Never aggregate mixed currencies implicitly.
- Order, delivery, invoice and payment are linked stages; do not count them as four separate costs. Cash settlement is distinct from expense recognition.
- Approval belongs to an exact payload and revision. A change invalidates prior approval. Governance, isolation and audit cannot be disabled.
- The job dossier connects contract, estimates, production, media, suppliers, billing, collections and margin.
- Query known metrics and permitted records. Do not add arbitrary user/model SQL or a database-admin endpoint.
- Reuse the source ERP's calculation contracts after checking the pinned source. Each of the 42 skills requires a concrete deterministic procedure, persisted output and acceptance evidence.

## Demo boundaries

- `AGEOS_DEMO_MODE=true`; `AGEOS_CONNECTOR_MODE=simulated` for this build.
- External ads, payments, accounting, OAuth and DNS actions are simulated adapters. No real purchase, transfer, campaign or domain registration.
- Real database writes, approvals, calculations, files and reports must survive refresh/restart. A template's in-memory handlers do not satisfy this.
- Show a compact persistent demo indicator. Simulated integration states and documents say so. Run traces show actual procedure events, not invented model reasoning or token usage.
- Implement a deterministic scripted assistant driver over the shared tool/command registry. Prewritten replies, suggested prompts, hardcoded scenario fixtures and explicit transitions are allowed and expected. Label the experience `Scripted demo`; interpolate dynamic figures and record references from authorized server data. Do not imply general language understanding or autonomous AI.
- All demo scenarios run without an LLM credential, model SDK invocation or business-provider call. Unsupported prompts get a clear demo-scope explanation and relevant supported scenarios. The full scripted E2E coverage, not live-model inference, is the acceptance gate. Keep future Eve/AI SDK integration behind a documented adapter boundary without activating it now.
- Sidebar Assistant opens `/a/:agencySlug/assistant` with a real Next.js `page.tsx`. A global header action opens the right panel from other authorized screens. Both share one runtime, thread store, permissions and components. On the full assistant page, avoid a duplicate right-hand chat.
- Keep thread state across route changes; isolate it by agency and authorized user. Revalidate page/entity context on the server. All writes, approvals, cancellation and resume obey the same command and outcome contracts as the rest of the ERP.
- Logical activation creates a tenant configuration in the shared app. It is not a new Vercel deployment per agency.
- Use synthetic business data only. No customer secrets, real personal data or license keys in source, logs or the browser bundle.
- Public previews require authentication/protection. The presenter may use authorized test personas; arbitrary visitors cannot select admin roles or reset shared data.
- Reset only the dedicated demo workspace, server-authorized and audited. Never reset a whole database or unrelated tenant.

## Delivery

- Implement in complete vertical slices while preserving full final coverage. Maintain `IMPLEMENTATION_STATUS.md` with verified state and remaining work.
- Record actual commands/results; do not invent test evidence or mark an unimplemented module complete.
- Establish scripts equivalent to `typecheck`, `lint`, `test`, `test:e2e`, `build`, `db:migrate`, and `db:seed:demo` in the application.
- Verify the 42-skill acceptance map, isolation, financial results, stale approvals, retries, refresh persistence, EN/ES, light/dark and responsive layouts. Also verify scripted assistant scenarios, server-backed figures, prescribed specialist handoffs, full-page/panel continuity, cancel/resume and exact-payload approval without model/provider calls. Instruction 2 must complete and verify every required E2E scenario; the short investor walkthrough is not the coverage limit.
- Use a real browser for the built app and record screenshots. If access is blocked, report the exact unverified checks rather than bypassing the restriction.
- The product demo and founder application video are separate deliverables. No invented customers, traction, savings or setup-time promises.
- Prepare a protected Vercel preview when requested and configured. Publishing to production or changing live customer systems is outside this implementation brief.
