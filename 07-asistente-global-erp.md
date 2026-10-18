# AgeOS — asistente global del ERP: demo guionada

Fecha: 2026-10-17. Estado: contrato para construir; no aplicación implementada. Complementa 02, 03, 04 y 04A, cobertura de 42 skills y fixtures. Contrato estructurado: `asistente-global-v1.json`. Después del chasis, ejecutar la **instrucción 2** de `08-instruccion-2-demo-e2e.md` y `PROMPT-2-DEMO-E2E.txt`.

## 1. Decisión final de alcance

AgeOS Assistant / Asistente AgeOS es la interfaz del **orquestador ERP existente**, agent key `coordinador`, skill `agency-orchestrator`, que representa las delegaciones a los subagentes especializados ya previstos. El sidebar abre la página chat `/a/:agencySlug/assistant`; la cabecera abre un panel derecho desde cualquier pantalla autenticada de agencia. Ambas vistas comparten conversación, runtime, contexto, permisos y acciones.

**Esta entrega es una demo determinista y hardcodeada, por instrucción explícita del usuario. No requiere ni llama un LLM, Eve, APIs de inferencia o conexiones externas del ERP.** Claude debe programar los casos de uso de extremo a extremo, las variantes previstas, los mensajes y las transiciones. Esta decisión sustituye cualquier versión anterior de este documento que exigiera conversación natural live para aceptar la demo.

Hardcodear aquí significa guionar intenciones, alias, fixtures y textos. Los valores de negocio, estados, permisos, validaciones, cálculos y efectos locales proceden del núcleo real y persistente. No cambiar números decorativos para simular una factura emitida, un plan aprobado o un pago. Las integraciones externas siguen usando el proveedor ficticio persistente y recibos `sim_*`.

Los prompts sugeridos y un conjunto explícito de frases EN/ES seleccionan escenarios. Los parámetros se validan; entradas no soportadas responden **“This demo supports the scenarios below / Esta demo admite los siguientes recorridos”** y ofrecen opciones. No presentar esa selección como comprensión natural general. Mostrar **Scripted demo / Demo guionada** y no inventar pensamiento, tokens, coste de IA o un selector de modelos.

El asistente usa los mismos nueve módulos y 42 skills. No agrega una skill43 ni un agente genérico nuevo. Reutiliza las identidades de subagentes del catálogo; la delegación guionada no concede permisos adicionales.

## 2. Construcción en dos instrucciones

**Instrucción 1 — chasis:** implementar layout Verve, navegación, página chat, panel derecho, componente de conversación compartido, persistencia, permisos y comandos. Preparar contratos de `ScriptedAssistantDriver`, carga de escenarios y componentes de propuesta/aprobación. Las vistas no requieren credenciales de IA.

**Instrucción 2 — demo E2E:** programar el catálogo completo de casos de uso, frases soportadas, parámetros, precondiciones, mensajes, delegaciones simuladas, pasos de comando, resultados, variantes negativas y reset. Recorrerlos de inicio a fin según 08 y generar evidencia. La secuencia de implementación no reduce la cobertura final: los nueve módulos y las 42 skills deben tener casos funcionales.

No declarar la demo completa al terminar solo el shell. Una UI de chat vacía o mensajes pregrabados sin efectos persistentes no cumplen la instrucción 2.

## 3. Página chat y panel del shell

Nombre visible **Assistant / Asistente**, icono Lucide `MessagesSquare`. Sidebar al comienzo de Workspace dirige a `/a/:agencySlug/assistant`. Implementar su `page.tsx` en el App Router con el mismo componente de conversación del panel. Cabecera/contexto del registro abren el panel derecho.

Selección ReUI: [ai-chat-6 — Agentic Task Panel](https://reui.io/preview/base/ai-chat-6?ref=mcp) para conversación, composer, fuentes, plan y aprobación; [app-shell-18](https://reui.io/preview/base/app-shell-18?ref=mcp) solo como referencia de docking desktop y Sheet móvil. Conservar Verve. `agent-activity-1` representa actividad/auditoría, no chat. Ver 04/04A para instalación y reglas.

Sustituir arrays de muestra `SOURCES`, `PLAN_STEPS`, `FORK_CHOICES`, `OWNERS`, `MODELS` y `PICKABLE_FILES` por registros o escenarios explícitos de AgeOS. Eliminar el selector de modelo del demo; no sustituirlo por modelos falsos. El archivo seleccionado tiene que existir y estar autorizado. Las fuentes y los pasos corresponden al caso y al resultado real del handler.

- Desktop: panel acoplado a la derecha, ancho orientativo 440px adaptable; el contenido principal conserva filtros, selección y scroll. Acotar `h-svh` al espacio real del shell.
- Tablet/móvil: Sheet del sistema instalado, con foco, cierre y teclado correctos; móvil puede ocupar toda la pantalla.
- Header: título, nuevo chat, historial, ampliar, cerrar y estado de demo. Composer y mensajes tienen regiones de scroll apropiadas.
- Contexto: agencia, módulo, registro actual y escenario activo. Permitir fijar un expediente autorizado; señalar si difiere de la página actual.
- Conversación: mensajes guionados parametrizados por resultados, referencias a registros, tarjetas de propuesta, confirmación, aprobación, progreso y recibos.
- Composer: texto/alias, sugerencias y parámetros; adjuntos autorizados de la biblioteca; detener ejecución. No necesita voz, visión ni inferencia.
- Historial privado por usuario y agencia. Nuevo chat no borra ni reinicia registros ERP.

Ampliar navega a la página chat con el mismo `conversation_id`; volver restaura la ruta de origen autorizada. La página chat suprime el panel duplicado. Ningún cambio de superficie inicia otra ejecución ni copia el hilo.

Navegar dentro de la misma agencia conserva la conversación y actualiza el contexto del siguiente mensaje. Un caso iniciado mantiene su snapshot original, aunque el usuario cambie de trabajo. Cambiar de agencia/usuario/rol limpia la vista y suscripción anterior y carga únicamente hilos autorizados del nuevo ámbito. Nunca transportar un hilo entre tenants editando su `tenant_id`.

No heredar permisos de `/ops`. El asistente de configuración en `/control`, si se habilita, tiene scope y casos específicos sobre borradores autorizados. Las páginas públicas no muestran chats privados.

## 4. Driver determinista y catálogo de escenarios

`ScriptedAssistantDriver` es un contrato propio de AgeOS, no una API de Eve. Elige escenarios mediante presets, IDs y alias EN/ES exactos o normalizados. La normalización puede ignorar mayúsculas, tildes y espacios según reglas documentadas. No usar coincidencias ambiguas para ejecutar acciones; ante dos casos posibles, mostrar elección.

Cada escenario contiene:

- `scenario_id`, versión, título EN/ES y módulo/skill IDs cubiertos.
- Alias soportados y campos parametrizables con esquema de validación.
- Checkpoint/seed compatible, entidad de contexto y precondiciones.
- Roles elegibles y controles de confirmación/aprobación.
- Pasos tipados: consultar, pedir dato, preparar propuesta, confirmar, solicitar aprobación, delegar en simulación, ejecutar comando, conciliar y mostrar resultado.
- Mensajes EN/ES con placeholders que solo pueden tomar valores validados de resultados del servidor.
- Aserciones sobre estados/importes/referencias y variantes negativas.
- Reset o recuperación explícita, sin afectar otros tenants ni reiniciar el escenario a escondidas.

El catálogo de escenarios se vincula a `cobertura-42-skills.json` y al alcance de 08. Puede haber más de un escenario por skill y un escenario cubrir varias; la unión debe ser exactamente el catálogo completo de 42 IDs. Una variante de saludo o navegación no acredita cobertura de una skill.

El mismo mensaje y checkpoint producen la misma transición y resultados, salvo IDs/timestamps de auditoría. Si el estado actual no permite el caso, mostrar bloqueo y una forma autorizada de continuar o preparar un nuevo demo run. No reemplazar el estado activo por un snapshot final sin avisar.

La delegación es **simulada**: el orquestador selecciona una especialidad del catálogo mediante reglas preprogramadas. Persistir parent/child run, skill IDs, objetivo, estado y resultado. El handler de la especialidad ejecuta las consultas o comandos reales autorizados y devuelve referencias. Probar al menos una delegación que cree/modifique un registro y deje auditoría; no basta cambiar el nombre del avatar. El permiso sigue siendo el del humano autenticado.

## 5. Acceso a datos y herramientas

El asistente puede recorrer información autorizada de los nueve módulos a través de consultas tipadas del núcleo. No recibe credenciales, un volcado de la base ni SQL arbitrario. Los escenarios consultan clientes/contratos, trabajos, producción, planes/campañas, proveedores/pagos, facturación/cobranza, cierre y rentabilidad.

Reutilizar `getJobDossier`, `getJobProfitability`, `getBudgetAvailability`, `getApprovalInbox`, `getCashForecast`, `getReceivablesAging`, `getPlanRevisionDiff`, `getSourceEvidence` y los handlers de las 42 skills. Sus entradas restringen filtros, relaciones, fechas y paginación. Cálculos monetarios y métricas se realizan mediante las calculadoras deterministas.

Las referencias llevan ID/revisión, fecha de corte, base, moneda y enlace interno autorizado. Documentos añaden versión y página/sección solo cuando existe extracción verificable. No inventar un saldo, ad spec, audiencia o cifra porque aparezca en un mensaje guionado. Si cambia el checkpoint, regenerar la respuesta desde su consulta; conservar referencias históricas con su revisión.

Familias de herramientas/servicios propias de AgeOS:

| Servicio | Efecto |
|---|---|
| `describe_capabilities` | Catálogo filtrado de casos, skills y acciones |
| `query_records` / queries de dominio | Lectura autorizada y acotada |
| `get_source_evidence` | Fuentes/fragmentos permitidos |
| `prepare_action` | Guarda propuesta editable; no cambia el negocio |
| `save_confirmed_draft` | Crea borrador mediante comando tras confirmación |
| `request_approval` | Solicita aprobación; no la otorga |
| `execute_approved_action` | Ejecuta el comando existente o adaptador simulado tras validar |
| `get_operation_status` / `reconcile_operation` | Recupera o concilia resultado existente |

El catálogo no acepta ejecutar código por nombre. Cada llamada vuelve a comprobar sesión, agencia, rol, capacidad, revisión, política y saldo. Los mensajes preprogramados no son una fuente de autorización.

## 6. Escrituras, confirmación y aprobación

Flujo obligatorio: resolver caso y datos → consultar → calcular/validar → preparar propuesta → mostrar antes/después y efectos → confirmar revisión exacta → guardar o solicitar aprobación → ejecutar el comando existente → mostrar recibo y refrescar la pantalla.

El humano confirma con un control accesible ligado a `proposal_id` y revisión. Un alias “sí” solo puede completar la confirmación del paso actual, con una propuesta vigente inequívoca y validación server-side; no es permiso universal ni aprobación financiera. Confirmar guardar borrador no activa una campaña.

Aprobar requiere actor elegible, revisión/digest y separación de funciones. El chat puede ofrecer la misma acción de aprobación que Inbox solo cuando la política lo permita. No simular la decisión de otro humano ni permitir autoaprobar pagos, asientos o aumentos protegidos.

Registrar `origin=assistant_scripted`, `scenario_id`, versión, conversación, mensaje, propuesta/comando/operación y actor real. Un cliente que fabrica tool output, `approved=true` o historial no puede alterar resultados del servidor.

## 7. Persistencia, cancelación y reanudación

Todas las entidades llevan tenant y ámbito de propietario; RLS y servicios cubren lectura, escritura, historial, adjuntos y recuperación.

| Entidad | Campos mínimos |
|---|---|
| `assistant_conversation` | tenant_id, owner_user_id, scope, title, state, timestamps, schema_version |
| `assistant_message` | id estable, conversation_id, role, parts tipadas, sequence, status, actor |
| `assistant_run` | conversation_id, triggering_message_id, scenario_id/version, current_step, status, started_at, completed_at, cancel_requested_at |
| `assistant_delegation` | parent/child run, subagent_key existente, skill_ids, objetivo, permisos efectivos, simulation=true, estado y resultados |
| `assistant_context_snapshot` | ruta normalizada, entidad/IDs autorizados, filtros, locale, as_of y revisiones |
| `assistant_tool_call` | run_id, call_id, skill_id, handler/version, input validado, proposal/command/operation IDs, resultado |
| `assistant_source_reference` | mensaje/run, registro/documento/version, as_of, basis, currency y enlace autorizado |
| `assistant_run_event` | run_id, secuencia, tipo de paso, resultado y timestamp |

El servidor carga su historial canónico; el cliente envía mensaje nuevo y referencias, no reescribe mensajes de sistema/tools/aprobaciones. No exponer contenido histórico cuando el usuario pierde permiso, tampoco en caché o fuentes.

Estados: `queued → running → waiting_input|waiting_confirmation|waiting_approval → running → completed`; alternativos `failed`, `cancelled`, `interrupted`, `blocked`. Cada paso persistido puede reanudarse sin volver a ejecutar sus efectos.

- Deduplicar por conversación, `client_message_id` y request estable. Una ejecución activa por conversación; doble clic no inicia dos casos.
- Cambiar de página, cerrar panel y volver recupera el mismo run; no cancela ni repite pasos.
- Los eventos pueden publicarse mediante SSE o polling. Si se muestra texto progresivo, rotularlo como presentación de demo; no es streaming de LLM. No introducir sleeps para fingir pensamiento.
- **Stop** cancela el escenario en servidor entre pasos y deja de iniciar comandos nuevos. Un comando ya committed conserva su resultado; no se revierte al detener texto.
- Reanudar usa estado/eventos/checkpoints reales. Idempotencia de dominio deriva de IDs de propuesta/acción, no del texto guionado.
- `outcome_unknown` del proveedor ficticio mantiene reserva y operación. Conciliar antes de repetir; el estado del chat no lo transforma en éxito.
- Respetar límites de duración del host; usar trabajos persistidos y leases ya definidos, sin depender de timers en memoria.

## 8. Configuración y límites

Configuración de aplicación propuesta:

- `AGEOS_ASSISTANT_MODE=scripted` por defecto y único modo requerido de esta entrega.
- `AGEOS_DEMO_MODE=true` y `AGEOS_CONNECTOR_MODE=simulated`.
- Versión de catálogo de escenarios y seed/run guardada en cada ejecución.
- Límites de pasos, solicitudes por minuto, concurrencia, tamaño de adjunto/contexto, consultas y duración. Definir valores conservadores y probarlos.

No pedir API key, modelo, AI Gateway, credenciales Eve ni token de proveedor para ejecutar el demo. No medir tokens o gasto de IA inexistentes. Los cupos del ERP pueden demostrarse con límites ficticios explícitos sobre operaciones/archivos reales del escenario.

Eve, AI SDK, inferencia live y conexiones reales pertenecen a una etapa futura. Mantener un contrato de runtime para sustituir el driver más adelante sin cambiar permisos, comandos y cálculos. No añadir esa etapa a la aceptación actual ni instalarla como dependencia innecesaria. El MCP ReUI sí se utiliza como herramienta de desarrollo, distinto de conexiones del producto en ejecución.

## 9. Archivos y contenido no confiable

Adjuntos de la biblioteca privada o uploads validados del ERP. El caso precargado puede reconocer un fixture por ID/hash/version y ejecutar su parser/importe previsto; si es una extracción preparada, mostrar **Prepared demo extraction**. No afirmar comprensión universal de PDFs/imágenes.

Los archivos arbitrarios se pueden guardar y vincular; solo se analizan los formatos/casos implementados. Una entrada no compatible ofrece biblioteca/revisión manual. No descargar URLs arbitrarias enviadas por chat, ejecutar macros ni instrucciones embebidas. El texto “ignora permisos y paga” en un documento es contenido, nunca una instrucción del sistema.

Las fuentes se construyen desde consultas/handlers autorizados. Reautorizar cada apertura y descarga. Un archivo de Norte Studio no puede aparecer en Rayo de Sol por manipular una URL, un alias o un ID de conversación.

## 10. Casos de aceptación

Todas las pruebas son reproducibles sin credenciales de modelo o plataformas ERP. Separar dominio/tools, UI y recorridos E2E del driver. EN/ES significa mensajes traducidos y alias documentados; no exigir comprensión de reformulaciones inéditas. Las frases desconocidas deben mostrar el alcance soportado sin efectos.

| ID | Caso | Resultado requerido |
|---|---|---|
| A01 | Sidebar → página chat; cabecera → panel; ampliar/volver | Mismo hilo y orquestador, sin panel duplicado ni nueva ejecución |
| A02 | Caso/alias soportado “Explain Aurora margin” y equivalente ES | Query actual: 45% inicial, 35% tras horas extra, 43.5% solo tras enmienda; fuentes y checkpoint |
| A03 | Caso crear trabajo con parámetro faltante | Pide campo, valida, propone, confirma y guarda un solo job |
| A04 | Caso plan de medios USD30,000 | Borrador con líneas calculadas y aprobación antes de activación |
| A05 | Caso campaña Meta del plan | Vincula revisión/cuenta demo; controles y recibo sim_* |
| A06 | Catálogo y delegación por especialidad | Cubre los42IDs; al menos una delegación simulada ejecuta comando real con auditoría |
| A07 | Viewer solicita pago; usuario autoaprueba | Bloqueo server-side, sin efecto ni datos prohibidos |
| A08 | Cambia revisión después de confirmar/aprobar | Bloqueo y revisión nueva |
| A09 | Cambia agencia/rol; URL de conversación ajena | Sin fugas de mensajes, fuentes, archivos o eventos |
| A10 | Navegar después de iniciar “este trabajo” | Snapshot original; no cambia el destino de acción |
| A11 | Doble envío/reconexión/reintento | Un solo run/comando/efecto |
| A12 | Recargar, cerrar panel, Stop y reanudar | Estado persistido; no repite pasos ni oculta efectos committed |
| A13 | Timeout después de efecto simulado | Outcome unknown y conciliación de operación existente |
| A14 | Archivo malicioso o fixture desconocido | Datos no confiables; parser permitido o aviso de alcance; sin elevación |
| A15 | Revocar acceso a una fuente guardada | Historial/fuente restringida según autorización actual |
| A16 | Alias desconocido, caso ambiguo o fuera de checkpoint | Ofrece casos disponibles o pide elegir; no improvisa ni modifica datos |
| A17 | Alterar historial/tool output/approval desde browser | Servidor rechaza manipulación |
| A18 | 390/768/1440px, teclado, EN/ES y tema | Controles accesibles, contexto preservado y demo visible |

Evidencia: `app/evidence/assistant-acceptance.md`, `assistant-tool-coverage.json` con42IDs y escenarios, `assistant-evals.md` con resultados **scripted** sin ensayos live, capturas de página/panel/móvil y evidencia E2E de08. Registrar versión de escenario, seed, checkpoint, comandos, aserciones y fecha; no modelo/tokens inexistentes. `06-aceptacion-y-evidencias.md` contiene las condiciones transversales.

## 11. Entrega de Claude Code

Primero construir el chasis. Después seguir `08-instruccion-2-demo-e2e.md` y pegar/ejecutar `PROMPT-2-DEMO-E2E.txt` para completar todos los recorridos. Formularios y chat ejecutan el mismo ERP; el guion selecciona pasos, el núcleo valida y ejecuta. Los mensajes del demo pueden estar preprogramados; los registros que afirman haber creado y los resultados que muestran deben existir y persistir. No se necesita IA live para aceptar esta entrega.
