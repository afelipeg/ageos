# AgeOS — contrato del chasis determinístico para Claude Code

Estado: especificación para construir; no aplicación implementada. Fecha: 2026-10-17.

## 1. Resultado obligatorio

Construir una demo ejecutable de AgeOS con persistencia PostgreSQL, reglas de negocio y permisos reales. Sus nueve módulos y 42 skills deben tener un flujo básico funcional y comprobable. Las acciones contra plataformas externas son simuladas, identificadas como tales y registradas en un proveedor de prueba persistente. La interfaz arranca en inglés y permite español; guardar la preferencia. No confundir esta demo con producto certificado fiscalmente, integración bancaria activa o operación publicitaria real.

El propósito es demostrar: configurar una agencia → activar una instancia lógica → operar un trabajo → detectar un desvío → aprobar una corrección → obtener un resultado calculado y trazable. El catálogo completo existe desde el inicio, aunque el guion principal recorra solo un caso. El resto se prueba mediante casos secundarios de aceptación.

La UI y el **asistente global de AgeOS** usan los mismos servicios de consulta y comandos. La ampliación de alcance de 2026-10-17 exige que el chat sea la interfaz del **orquestador ERP existente**, correspondiente a `agency-orchestrator`, que delega a los subagentes especializados. Tiene dos superficies sincronizadas: página chat `/a/:agencySlug/assistant` desde sidebar y panel lateral derecho desde todas las pantallas autenticadas de agencia. Comparten runtime, hilo, contexto y permisos; no se crea otro agente genérico ni una skill adicional. Por decisión explícita del usuario, esta entrega es una demo hardcodeada y determinista: el asistente utiliza casos precargados, alias soportados y parámetros validados, sin modelo ni inferencia real. Sus pasos ejecutan las mismas consultas y comandos persistentes del ERP. Consultar `07-asistente-global-erp.md`, `asistente-global-v1.json` y, después de construir el chasis, `08-instruccion-2-demo-e2e.md` y `PROMPT-2-DEMO-E2E.txt` para programar y recorrer todos los casos de extremo a extremo.

Eve y AI SDK son arquitectura futura, fuera de la ejecución requerida de esta demo. Implementar `ScriptedAssistantDriver` con escenarios versionados y un único dueño de cada ejecución. Los MCP de proveedores, LLM y Vercel Sandbox no son dependencias del runtime. Rotular **Scripted demo / Demo guionada** y distinguir resultados del ERP calculados de textos/decisiones de conversación preprogramados; no fingir comprensión natural general, razonamiento ni consumo de IA.

Leer junto con `cobertura-42-skills.json`, `demo-fixtures.json`, los contratos de arquitectura bajo `referencias/` y las especificaciones de pantallas y diseño de este paquete. Construir el código futuro en `app/`; los archivos de este paquete son instrucciones, no un scaffold ya implementado. No reducir alcance a tarjetas decorativas, botones vacíos o una colección de chats.

## 2. Decisiones de implementación

- Aplicación única Next.js/TypeScript, preparada para Vercel. La activación crea una agencia/configuración en la misma aplicación; no despliega una copia de código por cliente.
- PostgreSQL administrado por Neon en preview/demo. Desarrollo puede usar PostgreSQL local con el mismo esquema y migraciones. No usar SQLite o localStorage como sustituto de persistencia del dominio. localStorage queda para preferencias no sensibles.
- Elegir un solo acceso tipado a datos, preferentemente Drizzle, y validar entradas con Zod. Revisar versiones actuales al implementar; fijar dependencias y lockfile. Migraciones versionadas y reversibilidad de configuración.
- Servidor: repositorios por dominio, consultas parametrizadas, comandos transaccionales, políticas compartidas, registro de eventos, adaptadores y outbox. No hace falta CQRS distribuido, microservicios, Kafka ni un motor SQL propio.
- Dinero y reglas viven en módulos puros de TypeScript, probados. La UI formatea; nunca es autoridad de cálculo, autorización o estado.
- PostgreSQL persiste entidades, revisiones, aprobaciones, idempotencia, eventos y trabajos en cola. Una recarga o reinicio del proceso no cambia los resultados.
- Para documentos, usar almacenamiento privado con autorización por agencia. Un adaptador de disco fuera de la carpeta pública es aceptable solo en desarrollo local; Vercel requiere almacenamiento persistente externo. Nada importante se conserva únicamente en `/tmp`.
- El executor de jobs consume una outbox persistida. En demo local un worker acotado y el botón **Process demo queue** pueden dispararlo. En preview usar una invocación autenticada a un handler server-side; no depender de tareas en memoria después de responder HTTP. Persistir leases, intentos y próxima ejecución.
- No admitir SQL libre generado por un modelo. El asistente consulta el esquema semántico autorizado de los nueve módulos mediante consultas tipadas y vistas permitidas; no recibe credenciales de base de datos ni el esquema físico completo. Sus acciones pasan por los mismos comandos que las pantallas.

Variables propuestas: `AGEOS_DEMO_MODE=true`, `AGEOS_CONNECTOR_MODE=simulated`, `AGEOS_DEPLOYMENT_PROFILE=local|preview`, `DATABASE_URL` y una clave de sesión por entorno. El asistente usa `AGEOS_ASSISTANT_MODE=scripted` por defecto, sin modelo ni credencial de inferencia; ver límites de ejecución y configuración en 07. Ninguna variable pública del navegador concede permisos. No se requieren claves reales de proveedores ERP o modelos. Comandos de entrega: `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` y `pnpm build`; implementarlos en el paquete de la aplicación. No declarar que pasaron antes de ejecutarlos.

Rutas canónicas: aplicación `/a/:agencySlug`; nueve módulos `/a/:agencySlug/modules/:moduleKey`; cada capacidad `/a/:agencySlug/modules/:moduleKey/workflows/:skillId`; expediente `/a/:agencySlug/jobs/:jobId?tab=overview|scope|production|media|finance|files|activity`. Las claves de módulos y sus 42 rutas están en `cobertura-42-skills.json`. La carpeta fuente `app/` no implica prefijo URL `/app`.

## 3. Identidad, agencias y permisos

La versión inicial incorpora identidades de demostración en el servidor: owner, account manager, finance approver, producer y viewer. Una sesión firmada en cookie `HttpOnly`, `Secure` fuera de localhost y `SameSite` contiene un identificador opaco; las membresías y permisos se resuelven en servidor. No aceptar `tenant_id`, rol o actor enviados por el navegador como prueba de autorización. Un selector de personas solo funciona en modo demo y el servidor lo limita a usuarios ficticios permitidos para esa sesión.

En un despliegue accesible por Internet, poner una barrera real de acceso —autenticación de invitados o protección de deployment— antes del selector demo. Deshabilitar el selector por configuración fuera del entorno demo. No desplegar un endpoint público que permita asumir libremente cualquier rol. No pedir claves reales de plataformas ERP o modelos ni datos personales reales para ejecutar esta demo.

Todas las tablas del dominio llevan `tenant_id NOT NULL`, salvo catálogos globales de solo lectura. Las relaciones compuestas incluyen tenant: un `job_id` de otra agencia no puede vincularse por un simple ID válido. Cada consulta comprueba sesión, membresía, permiso y ámbito del registro. Complementar con RLS para la identidad de aplicación; las migraciones usan otro rol. Si se usa contexto por transacción, no dejar variables de tenant persistentes en conexiones reutilizadas. No usar un rol con bypass de RLS para solicitudes normales.

Separación mínima: account manager prepara contratos/planes; producer presenta horas/entregables; finance aprueba pagos y asientos; owner aprueba configuración y puede resolver asignaciones. El creador no aprueba su propio pago, asiento o aumento de presupuesto. El owner no es una excepción implícita. Los usuarios ficticios pueden cambiarse explícitamente durante el guion y la bitácora debe registrar quién realizó cada acción.

En Aurora, `user_demo_owner` aprueba la autoridad inicial interna; `user_demo_operator` propone la enmienda de USD3,000 y `user_demo_finance` la aprueba internamente, además de aprobar pagos y asientos preparados por otro actor. La enmienda requiere por separado evidencia ficticia revisada de aceptación del cliente y su PO revisión2 de USD53,000. Una aprobación interna no representa aceptación del cliente ni sustituye esa evidencia. La UI debe mostrar ambos controles y sus actores/orígenes.

El segundo tenant, Norte Studio, tiene registros y archivos distintos. Debe ser imposible leerlos, exportarlos, modificarlos o aprobarlos desde la sesión Rayo de Sol usando URL, búsqueda, API o identificador manipulado.

## 4. Modelo de datos mínimo

Usar IDs internos UUID/ULID al crear datos reales. Los identificadores legibles de `demo-fixtures.json` son claves estables de seed: el importador puede mapearlos a IDs internos y debe conservar `fixture_key`. No usar el número de factura ni el nombre del cliente como clave primaria. Todas las tablas mutables incluyen `revision`, timestamps y actor; snapshots aprobados son inmutables.

| Familia | Entidades y campos obligatorios |
|---|---|
| Plataforma | `agency(id, slug, name, app_name, status, base_currency, timezone, locale)`, `legal_entity(tenant_id, country, currency, fiscal_profile_id)`, `membership(user_id, tenant_id, role, active)` |
| Configuración | `configuration_revision(tenant_id, number, state, enabled_capabilities, schema_version, approval_policy, branding, limits)`, `capability_definition(skill_id, module, dependencies, handler_version)`, `custom_field_definition(type, constraints, applicable_entity)` |
| Conexiones | `connection(tenant_id, provider, mode, account_alias, scopes, state, last_synced_at)`, `external_mapping(tenant_id, provider, account_id, entity_type, external_id, internal_id)` |
| Cliente | `client`, `brand`, `contact`, `brief`, `client_billing_profile`, `contract`, `client_po`, `fee_schedule`, `billing_requirement`; todos vinculados a entidad legal y propietario |
| Trabajo | `job(client_id, brand_id, job_number, display_reference, state, owner_id, period)`, `job_document_link`, `job_checkpoint`, `budget_revision`, `budget_line`, `budget_reservation` |
| Producción | `task`, `timesheet(minutes, employee_rate_revision, state)`, `production_estimate_revision`, `supplier_quote`, `production_order`, `creative_asset`, `asset_revision`, `asset_qc_result`, `rights_record` |
| Medios | `audience_source(version, as_of, geography, methodology, license_status)`, `placement_spec(version, source)`, `rate_card`, `media_plan_revision`, `media_plan_line`, `media_order`, `campaign`, `campaign_metric_day`, `spot_schedule`, `emission`, `ooh_site`, `ooh_reservation` |
| Costos | `cost_item(id, job_id, cost_type, recognition_policy, agency_or_passthrough)`, `delivery`, `supplier_invoice`, `supplier_invoice_line(cost_item_id)`, `expense`, `payment_batch`, `payment`, `bank_transaction`, `settlement_allocation` |
| Ingresos | `revenue_item(job_id, treatment, amount, recognition_policy)`, `client_invoice`, `invoice_line(revenue_item_id or passthrough_recovery_id)`, `collection`, `collection_allocation`, `credit_note`, `rebate_agreement` |
| Contabilidad | `account`, `journal_entry`, `journal_line`, `accounting_period`, `accrual`, `fx_rate`, `fixed_asset`, `depreciation_entry`, `external_posting_reference` |
| Control | `action_proposal`, `approval_request`, `approval_decision`, `evidence`, `business_event`, `idempotency_record`, `outbox_message`, `adapter_operation`, `demo_provider_effect`, `report_snapshot` |
| Asistente | `assistant_conversation(tenant_id, owner_user_id, scope, title, state)`, `assistant_message(conversation_id, role, parts, sequence, schema_version)`, `assistant_run(status, scenario_id, scenario_version, current_step, cancel_requested_at)`, `assistant_delegation(parent_run_id, child_run_id, subagent_key, effective_scope, state)`, `assistant_context_snapshot`, `assistant_tool_call`, `assistant_source_reference`, `assistant_run_event`; tenant y propietario comprobados también en carga, reanudación y adjuntos |

Usar JSONB para configuración/extensiones tipadas, no para esconder todas las relaciones financieras en un documento sin restricciones. Referencias esenciales, importes, moneda, estados, periodos y revisiones son columnas tipadas. Un campo personalizado no puede sobrescribir `tenant_id`, importe, estado aprobado, permisos o numeración.

Cada dato externo conserva proveedor/cuenta/ID externo, fecha de sincronización, fecha efectiva, moneda, revisión y estado de conciliación. AgeOS gobierna planes y aprobaciones. En demo el libro es **Demo ledger**; una referencia simulada nunca se convierte en evidencia de posteo real en QuickBooks, SAP u otro sistema.

## 5. Estados y transiciones

Cada transición se ejecuta en servidor y emite un evento de negocio. Ningún `PATCH status=approved` genérico.

| Agregado | Transiciones y condiciones |
|---|---|
| Configuración | `draft → validating → awaiting_approval → approved → provisioning → ready`; error a `blocked`; reintento reanuda pasos completados. El dominio personalizado tiene estado independiente. |
| Trabajo | `draft → open → in_progress → ready_to_close → closed`; cierre bloqueado con órdenes/compromisos, horas sin resolver, facturas o conciliaciones pendientes. Reapertura requiere motivo y permiso. |
| Contrato/presupuesto/plan | `draft → submitted → approved → superseded`; rechazo devuelve a nueva revisión draft. Editar una revisión aprobada genera otra y anula aprobaciones pendientes del payload anterior. |
| Propuesta | `draft → awaiting_approval → approved → queued → executing → succeeded`; alternativos `rejected`, `expired`, `cancelled`, `blocked`, `failed`, `outcome_unknown`. `outcome_unknown` solo pasa por conciliación antes de reejecutar. |
| Orden | `draft → approved → submitted → acknowledged → partially_delivered → delivered → reconciled`; envío externo de demo muestra `Simulated acknowledged`. Cancelación/variación conserva el historial y libera únicamente el saldo no consumido. |
| Horas | `draft → submitted → approved → locked`; corregir horas aprobadas mediante ajuste/revisión, no borrado. |
| Factura proveedor | `received → validation_hold/matched → approved → payable → partially_paid → paid`; duplicados quedan en hold. Un conflicto no se resuelve marcando pagada la factura. |
| Factura cliente | `draft → requirements_checked → approved → issued_demo → partially_collected → collected`; nota de crédito para ajustes tras emisión. Sin emisión fiscal real. |
| Periodo | `open → closing → closed`; cierre requiere checklist, saldos y conciliaciones; reapertura autorizada deja evento. |

La activación de agencia crea registros y recursos lógicos reales; el paso que dice “domain provisioned” debe rotularse simulado si no hubo llamada DNS/TLS. Una URL interna de preview puede funcionar realmente y debe distinguirse del dominio solicitado.

## 6. Dinero, periodos y no duplicación

1. Almacenar importes monetarios como enteros de unidad menor (`BIGINT`) y exponente de moneda configurado. Serializar bigint como cadena en APIs cuando corresponda. No usar floats binarios para dinero. Tasas y cantidades usan decimal exacto; porcentajes básicos en bps. Los fixtures usan enteros seguros en JSON, todos USD con exponente 2 salvo casos explícitos.
2. Cada cálculo declara moneda, periodo, fecha de corte y base: `forecast`, `incurred`, `posted` o `posted_plus_pending`. No sumar dos bases como si fueran dos costos distintos. UI distingue **Forecast / Realized / Posted**.
3. Conservar ingreso neto de agencia separado del gasto de medios administrado. En el caso Aurora se aplica una política demo de medios como pass-through: USD 30,000 no incrementan el ingreso neto usado para margen. La política principal/agente real debe acordarse por entidad; este caso no establece una conclusión contable universal.
4. `available = authorized − spent − open_commitments − uncommitted_reservations`. Los tres grupos son disjuntos y cada saldo declara `budget_scope` y `valuation_basis`. Separar autoridad comercial del cliente (50,000 y después 53,000), techo de inversión en medios (30,000) y presupuesto interno de costo de agencia (11,000 y después 13,000). No restar nómina o pagos de proveedor de la PO del cliente como si fueran facturación; cada documento consume el control que corresponda. Aprobar reserva mueve saldo a reservation; emitir orden lo mueve a commitment; reconocer entrega/costo consume commitment dentro del mismo ámbito. No sumar reserva + orden + entrega + factura como cuatro gastos.
5. Un `cost_item` sigue el ciclo de orden a entrega, factura y pago. La entrega aprobada reconoce costo/accrual según política; una factura coincidente reclasifica obligación y no duplica costo; una diferencia autorizada genera ajuste; el pago liquida pasivo y afecta caja. Se modela aparte el gasto de medios trasladado al cliente.
6. Horas aprobadas valorizadas se vinculan a costo de trabajo. Su pago de nómina no vuelve a crear gasto. Lo mismo aplica a reembolsos de gastos ya reconocidos.
7. Los ingresos de contrato, facturación y cobro no se suman entre sí. Un contrato es autoridad comercial; la política de reconocimiento determina ingreso; factura mueve cuentas por cobrar; cobro mueve caja.
8. Conversión de moneda exige fecha, fuente, tasa y precisión. Nunca sumar USD/CAD/MXN por importe nominal. Para demo financiera usar una sola moneda en el caso principal y fixtures separados para FX.
9. Rounding: HALF_UP para operaciones definidas por calculadora; asignaciones usan mayor resto y desempate estable por ID. Totales de cuotas/asignaciones deben recuperar exactamente el total fuente. Guardar monto sin redondear cuando el contrato del cálculo lo necesite.
10. Moneda/importe/neto/impuesto/bruto se validan explícitamente. Perfil fiscal principal `DEMO_NO_TAX`: el 0% es una simplificación sintética, no una afirmación de exención de US/LATAM/CAN. El módulo fiscal debe poder calcular un ejemplo sintético con tasa configurable y bloquear un país sin perfil habilitado.

## 7. Comandos, consultas y aprobaciones

Envelope de comando: `command_id`, `command_type`, `aggregate_id`, `expected_revision`, `idempotency_key`, `payload`, `reason`. Resolver actor, tenant, sesión y permisos en servidor; ignorar valores de identidad enviados en payload. Validar esquema y buscar todos los registros dentro del tenant.

Secuencia: autenticar → autorizar → validar estado/revisión → validar dominio y periodo → comprobar aprobación cuando corresponda → transacción de negocio → evento/outbox → respuesta persistida. Para reservas concurrentes bloquear la fila de saldo o usar actualización condicional serializable; un resultado positivo de calculadora no reserva dinero por sí solo.

Una aprobación contiene tipo de acción, IDs, revisión exacta, digest canónico del payload, moneda/importe, cuenta/proveedor destino, política/revisión, aprobador elegible, vencimiento y condición de consumo. Cambiar cualquier dato material requiere otra aprobación. El digest confirma igualdad, no autorización. Registrar decisión y motivo. Comprobar separación de funciones y aprobación en backend incluso si el botón está oculto.

Idempotencia: clave única `(tenant_id, command_type, idempotency_key)`. Mismo payload devuelve el resultado anterior; diferente payload con misma clave devuelve conflicto. Clave de ejecución externa deriva del ID estable de acción aprobada. Múltiples workers usan lease y comparación de revisión; la UI reintenta con la misma clave ante desconexión. Los webhooks/eventos de proveedor se deduplican por proveedor/cuenta/ID.

Tesorería: no hay sobregiro ni línea de crédito implícita en el demo. `available_cash = confirmed_cash − active_payment_holds`. Antes de ejecutar, validar y reservar fondos atómicamente por agencia/entidad/cuenta/moneda; una aprobación no garantiza fondos actuales. Facturas por cobrar y pronósticos no cuentan como caja. Si el resultado es incierto, mantener la reserva hasta conciliar y aplicar una sola liquidación. La recepción de cobros tiene unicidad por proveedor/cuenta/recibo y referencia fuente; la asignación a factura se vincula al cobro y nunca excede su saldo ni el de cartera. Repetir el recibo o la solicitud no vuelve a aumentar caja.

Para mutaciones locales, transacción atómica de estado + auditoría + outbox. Para efecto externo, ninguna transacción distribuida ficticia: persistir intención, ejecutar, persistir recibo, conciliar incertidumbre. No prometer “exactly once” sin condiciones del proveedor.

Consultas mínimas: `getAgencyReadiness`, `getJobDossier`, `getAttentionQueue`, `getApprovalInbox`, `getBudgetAvailability`, `getPlanRevisionDiff`, `getThreeWayMatch`, `getJobProfitability`, `getReceivablesAging`, `getCashForecast`, `getCloseReadiness`, `getSourceEvidence`. Todas retornan `as_of`, `basis`, `currency`, permisos de acción y referencias de evidencia. Datos de gráfica derivan de estos resultados.

Los comandos específicos de las 42 skills están listados en `cobertura-42-skills.json`. El catálogo es un contrato de alcance, no un dispatcher que acepte ejecutar código arbitrario por nombre.

El asistente global es una interfaz transversal de esas 42 skills; no añade una skill43. El registro compartido define consultas y acciones permitidas por skill, esquemas de entrada/salida, permisos, efecto y regla de aprobación. El driver de escenarios puede consultar, preparar borradores y solicitar confirmación; no puede otorgarse una aprobación, modificar políticas ni ejecutar código/SQL arbitrario. Cada tool call revalida sesión, tenant, rol, habilitación de capacidad, revisión y política actuales. La confirmación de guardar un borrador no equivale a la aprobación financiera para ejecutar su contenido. La ejecución solo consume acciones canónicas confirmadas y aprobadas según las reglas existentes.

## 8. Adaptador externo simulado

Contrato común: `capabilities()`, `validateConnection()`, `preview(action)`, `execute(approvedAction, idempotencyKey)`, `getOperation(operationId)`, `reconcile(operationId)`. `execute` recibe contexto resuelto por servidor y exactamente el payload aprobado. La interfaz admite implementaciones futuras Eve/Connect, Composio, API/OpenAPI o MCP; el demo solo selecciona `SimulatedProviderAdapter`.

Persistir el estado del proveedor ficticio en tablas separadas de operaciones: una orden o transferencia simulada tiene ID/recibo `sim_*`, nunca un ID que parezca comprobante bancario real. No hacer requests salientes a cuentas publicitarias, pagos, correo, OAuth ni MCP del ERP durante el demo. Tampoco llamar a un modelo: el asistente de esta entrega está guionado y no tiene excepciones de inferencia real. Los botones dicen **Simulate activation**, **Simulate payment** y **Demo invoice** donde aplican; en español equivalentes. La conectividad “Connected · Demo” no significa OAuth verificado.

Modos de prueba por operación, activados por control del presentador y auditados:

- `success`: efecto simulado y recibo persistidos una vez.
- `validation_error`: sin efecto; se corrige payload y solicita aprobación nueva si cambia.
- `permission_revoked`: conexión pasa a revoked y solo bloquea capacidades dependientes.
- `rate_limited`: sin efecto; reintento acotado respeta fecha sugerida.
- `timeout_before_effect`: ningún efecto; reintento con la misma clave permitido tras clasificación.
- `timeout_after_effect`: proveedor ficticio registra efecto pero la aplicación no recibe confirmación; estado `outcome_unknown`; reconciliar devuelve el recibo existente. No duplicar pago/campaña.
- `permanent_failure`: sin reintentos automáticos infinitos; tarea visible con próximo paso.

Reloj de negocio inyectable para fixtures; timestamps de auditoría reales separados de `business_effective_at`. No usar sleeps largos o azar para fingir inteligencia. Un estado pending puede avanzar mediante job real, rápido y observable. Cada recibo incluye `simulation=true`, versión de adaptador, ID de acción, digest y cuenta ficticia.

## 9. Las 26 calculadoras

Implementar/adaptar los contratos puros del repositorio para: `aging`, `allocate`, `approval_route`, `audience_metrics`, `budget_check`, `cash_projection`, `credit_exposure`, `depreciation_schedule`, `discount_cascade`, `estimate_totals`, `flat_rebate`, `fx_revaluation`, `hourly_fee_settlement`, `installment_schedule`, `invoice_check`, `job_number`, `journal_check`, `margin`, `media_line_cost`, `payload_digest`, `payment_terms`, `plan_diff`, `reconcile`, `spot_match`, `tiered_commission`, `withholding`.

Fuente de referencia del proyecto: `referencias/agency-erp-matriz-42-skills.json`, repo `afelipeg/agentic-advertising-agency-erp` commit `d73539e62ec27060347763f0ec40115c36be6f16`. El paquete portable incluye `referencias/agency-erp-all-skills.zip`; contiene ZIP anidados por skill. Extraer únicamente bajo una carpeta de trabajo controlada, rechazar rutas absolutas o `..`, y leer `scripts/agency_tools.py`, `references/tool-contracts.json` y `references/tool-outputs.json`. El ZIP proviene del archivo local aportado por el usuario: no asumir igualdad con el commit. Comparar con ese commit cuando sea accesible y documentar diferencias al portar. La carpeta original `../agency-erp-skills/` es opcional; no depender de ella ni de una ruta absoluta del autor.

El contrato local de `job_number` compone códigos como `AURSL7AF0001`; el número amigable `RDS-2027-001` es un alias separado. Conservar la semántica y probar ambos. El contrato local `payload_digest` especifica canonicalización `python-json-sorted-v1`; una implementación TS debe demostrar paridad de Unicode, claves, números y serialización con vectores compartidos, o migrar explícitamente a otra versión sin comparar hashes incompatibles.

No sustituir calculadoras con respuestas de LLM. Ejecutar tests de paridad y casos borde: cero/negativo permitido, divisor cero, moneda distinta, redondeo, último día hábil, fin de mes, duplicate IDs, suma de asignaciones, periodos cerrados y reversión. La calculadora `approval_route` propone ruta; no concede permiso. `budget_check` calcula; el command handler reserva transaccionalmente.

## 10. Archivos, audiencias y especificaciones

Biblioteca privada por agencia y expediente. Aceptar en V1 de demo PDF, DOCX, XLSX y CSV con límites explícitos, validación de firma/formato y descarga autorizada. Un archivo cargado persiste y puede vincularse a un documento. Para importaciones estructuradas implementar CSV/XLSX con preview, mapeo, errores por fila, deduplicación y confirmación transaccional. Originales/versiones no se sobrescriben silenciosamente.

Para PDF/DOCX, extracción local solo si efectivamente se implementa y prueba; si se usa el fixture ya interpretado, etiquetar **Prepared demo extraction** y permitir revisión manual. No afirmar OCR o comprensión universal. No ejecutar macros, código ni instrucciones embebidas en archivos. Credenciales no entran a documentos ni a sandbox.

Los tres perfiles de sandbox del diseño —documentos, datos/reportes y piezas publicitarias— quedan como contratos de capacidades y límites. Para esta demo no es necesario aprovisionar Vercel Sandbox. Una pantalla de settings puede mostrar **Planned runtime profile**; no dibujar una ejecución inexistente. Cálculos pequeños corren en servidor de forma determinística. Si se implementa un procesamiento real, sus pasos deben corresponder a eventos reales.

Audiencias y ad specs del demo son datos sintéticos versionados. Mostrar canal, país, fecha, fuente demo y método. Comparar formatos/dimensiones/duración con esas reglas. No presentar alcance deduplicado entre plataformas sin metodología: sumar impresiones es válido bajo corte consistente, sumar personas únicas no.

## 11. Escenario principal y anexos funcionales

`demo-fixtures.json` define el escenario Aurora con importes exactos. Seed inicial: Rayo de Sol, aplicación Estudio Solar, todas las capacidades disponibles, trabajo con presupuesto aprobado y forecast inicial. Tres incidencias reproducibles: sobrecosto de horas, factura proveedor distinta a entrega, resultado externo incierto después del efecto simulado.

Secuencia de caja obligatoria: apertura USD10,000; factura demo USD53,000; primer cobro USD40,000 eleva caja a USD50,000 y deja cartera de USD13,000; después se aprueban/reservan/liquidan pagos por USD43,000 y queda caja USD7,000; el último cobro USD13,000 deja caja USD20,000 y cartera cero. Antes del primer cobro, intentar pagar USD43,000 se bloquea por fondos insuficientes. Los quince asientos de `expected_final_demo_journals` siguen este orden y todos balancean. La incidencia de producción consume un solo pago de USD5,500 tras conciliar, sin duplicar la salida de caja. `cash_timeline` describe los saldos intermedios; no limitar la prueba a sumar el saldo final.

Locale inicial `en-US`, con alternativa española según especificación UX. Dominio solicitado de ejemplo: `estudio.rayodesol.example`, claramente pendiente/simulado; la URL interna real del demo es `/a/rayo-de-sol`.

El presenter puede abrir un estado preparado `ready_for_scope_review` o iniciar `from_intake`. Los estados preparados se materializan en base de datos mediante comandos/seed coherente y tienen etiquetas visibles; no son pantallas con números desconectados. Cada checkpoint tiene validaciones. Reanudar conserva datos reales de la sesión.

Las 42 skills no requieren 42 pantallas separadas. Cada una necesita inputs, una acción/consulta de dominio útil, salida persistente o reproducible, acceso desde una ruta y un caso de aceptación. Ver matriz para rutas y controles. Los casos de TV/radio, OOH, rebates, activos, FX e impuestos pueden ser registros secundarios identificados en fixtures; no deben contaminar el margen Aurora.

### Circuito obligatorio de operación de la plataforma

Implementar además `ops_csv_delimiter_mismatch`, dentro del plano administrativo de AgeOS; no agrega un módulo ERP ni una skill43. El CSV ficticio incluido tiene seis columnas separadas por `;`. El perfil `import_profile_demo_media_orders`, revisión1, utiliza erróneamente `,`: el parser real devuelve una sola columna y produce un incidente con evidencia. `user_demo_platform_operator` propone el cambio tipado de delimiter a `;`. `user_demo_platform_admin`, actor independiente, aprueba el payload/perfil/revisión exactos. El handler autorizado cambia únicamente ese perfil de importación del entorno demo y tenant Rayo, persiste revisión2 y vuelve a analizar los mismos bytes. La verificación real devuelve seis columnas y una fila de datos, y resuelve el incidente con antes/después y bitácora.

Estados: `detected → investigating → proposed → awaiting_approval → approved → applying → verifying → resolved`; error conserva incidente abierto. No fingir una reparación con un temporizador. La propuesta es una regla determinística basada en un formato reconocido; el operador revisa y el administrador aprueba. Limitar el comando a una enumeración de delimitadores y perfiles demo permitidos. No admitir edición arbitraria de configuración global, credenciales, código, infraestructura o la política de pagos. Aplicar la corrección del parser no importa órdenes ni genera gastos; solo habilita el preview correcto de la importación. No hay PR, despliegue ni API externa real en este circuito.

La sesión administrativa se autentica de verdad igual que la sesión de agencia y tiene permisos separados. El usuario de un ERP no hereda permisos de operador de plataforma. Probar rechazo sin aprobación, autoaprobación, revisión obsoleta y perfil ajeno; aplicar dos veces con la misma clave debe conservar un solo cambio. El fixture especifica actores, CSV exacto y resultados esperados.

Reset: comando solo para presentador autorizado en modo demo, con confirmación, `tenant_id` resuelto y `demo_seed_version`. Elimina/recrea exclusivamente registros demo de la agencia objetivo o crea un nuevo run aislado; no toca otros tenants, uploads ajenos ni auditoría real. Conservar un evento de reset fuera del conjunto reinicializado. En concurrencia impedir reset mientras otra sesión ejecuta una acción, o invalidar las revisiones y explicar el reinicio. No poner “reset all database” en la interfaz.

## 12. Criterios de entrega verificables

1. Desde una base vacía: migrar, crear sesiones demo y seed, iniciar app; README con comandos y variables sin secretos. Todas las pruebas del ERP y del asistente guionado funcionan sin credenciales de modelo o plataformas externas. Verificar cada caso precargado y alias explícito; una entrada no soportada debe explicar el alcance de la demo.
2. Los nueve módulos son navegables; las 42 filas de cobertura apuntan a acciones reales. No contar un enlace, una explicación o un modal sin guardar como implementación.
3. Configurar nombre, marca, responsables y capacidades; validar dependencias; activar; recargar y conservar configuración. La URL lógica abre la agencia correcta. Cambiar idioma conserva datos.
4. Crear/editar registros de cada módulo y confirmar persistencia después de recarga y nueva sesión. Navegación por teclado y errores accionables.
5. El margen Aurora resulta del modelo: 45.0% inicial, 35.0% con sobrecosto no facturado y 43.5% tras fee adicional aprobado. Mostrar forecast y realizado por separado; el saldo actual no salta al estado final antes de ejecutar pasos.
6. La factura proveedor de 6,000 frente a entrega/orden de 5,500 queda retenida; corregir no duplica costo ni factura. El importe correcto se liquida una vez.
7. Cambiar importe/cuenta/revisión tras aprobación invalida ejecución. Una aprobación de otro tenant o actor no sirve. No hay autoaprobación silenciosa.
8. Dos reservas compitiendo por el mismo saldo producen un éxito y un bloqueo cuando el total excede autorización. Repetir command idempotente devuelve el mismo resultado. Probar de verdad con solicitudes concurrentes.
9. Un timeout después del efecto se concilia y no crea un segundo pago. Fondos insuficientes bloquean ejecución, dos reservas simultáneas no gastan la misma caja y recibir el mismo cobro dos veces no aumenta caja ni baja cartera dos veces. Revocar conexión bloquea la acción dependiente y mantiene acceso a documentos locales.
10. El cierre bloquea pendientes reales; después de resolverlos, bloquea nuevas escrituras del periodo. Asientos balanceados; ajustes trazables.
11. Aislamiento entre Rayo de Sol y Norte Studio probado en rutas, API, descargas, búsquedas, aprobación y exportación; datos de sesión nunca bastan para cambiar tenant.
12. Exportar reporte legible con periodo, moneda, base, fecha y fuentes; cifras coinciden con consulta. Nunca presentar un reporte financiero sin aclarar que sus datos son ficticios.
13. Todos los efectos externos rotulados como simulados. Ni compra de dominio, gasto publicitario, transferencia, envío de correo ni emisión fiscal real.
14. Pruebas unitarias de invariantes/cálculos, integración con PostgreSQL y E2E del caso principal + negativos críticos. Un snapshot visual no reemplaza esas pruebas. Recoger evidencias y listar limitaciones restantes con precisión.
15. Asistente global/orquestador: abrir página chat desde sidebar y panel desde cabecera en cualquier pantalla autenticada de agencia, conservar la misma conversación al navegar entre superficies, consultar con fuentes verificables y preparar trabajo, plan y campaña mediante escenarios y alias explícitamente soportados. Las 42 capacidades usan el registro común y los subagentes existentes; las acciones verifican permisos y aprobaciones. Probar reanudación, cancelación, cambio de agencia/rol, aislamiento de chat, adjuntos no confiables y resultado incierto según 07.

## 13. Entrega de Claude Code

Además del código: esquema/migraciones, seed reproducible, suite de tests, `.env.example`, guía local/preview, matriz de cobertura con enlaces a implementaciones y tests, guion del presentador, inventario real/simulado/pendiente y capturas de pantallas clave. Marcar una skill implementada únicamente cuando su caso funcional y aceptación pasen.

Añadir evidencia del asistente: cobertura de herramientas de las 42 skills, escenarios guionados EN/ES y alias soportados, referencias de fuentes, pruebas de confirmación/aprobación y capturas de página chat y panel derecho. Entregar recorridos E2E de todos los casos de 08 y evidenciar al menos una delegación simulada que ejecute un comando real y deje auditoría. La IA live queda fuera de alcance; no exigir una clave o ensayo live para completar esta demo.

Construir en slices funcionales sucesivos, manteniendo los nueve módulos en alcance: primero contexto/permisos/comandos; luego intake y contrato; producción y planificación; compra/conciliación; facturación/contabilidad; rentabilidad y configuración. No terminar en la primera slice: la aceptación de esta entrega exige las 42 capacidades básicas.

El término “chasis determinístico” describe el sistema que garantiza coherencia aunque cambie el modelo de IA. El mensaje al usuario final sigue siendo simple: **Build your agency with the power of AgeOS.** El producto debe demostrarlo con registros que persisten, números que cuadran y decisiones que se pueden explicar.
