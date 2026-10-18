# AgeOS — Dirección de producto y selección UI para V1

Decisión: 17 de octubre de 2026. Este documento concreta la selección del documento 04 y debe leerse antes de construir pantallas. Mantiene los nueve módulos y las 42 skills. La aplicación aún no está implementada.

## Decisión de producto

**La unidad central es el trabajo y su expediente.** Clientes, producción, medios y finanzas son vistas del mismo negocio. La demo debe demostrar tres momentos: configurar la agencia, abrir su aplicación propia y resolver una excepción con impacto financiero comprobable.

Usar **[Verve](https://reui.io/template/verve-crm)** como única base; [preview](https://verve-crm.reui.io). Conservar su sistema Base UI/Nova y Lucide, sujeto a verificar la edición descargada. Adaptar navegación, contenido y datos. Retirar los menús y métricas de CRM de muestra que no pertenecen al ERP.

Una sola navegación principal expandible con cuatro grupos: Workspace, Operations, Finance y Manage. Si Verve incluye un rail exterior de iconos y un menú interior, consolidar la navegación de la agencia usando sus componentes; no conservar dos taxonomías que compitan. El selector de agencia no se convierte en un selector ficticio CRM/Sales/Marketing. /control y /ops mantienen sus contextos y permisos separados.

La experiencia operativa es densa, con una acción principal por pantalla, tablas legibles y detalles por pestañas. El expediente conserva Overview, Scope, Production, Media, Finance, Files y Activity. Las 42 skills reutilizan un workbench con entrada, validación, resultado y evidencia. El asistente global es otra superficie para consultar y gestionar esos mismos registros: el orquestador existente `agency-orchestrator` coordina las capacidades, sin crear una skill adicional ni duplicar reglas.

## Bloques elegidos, pantalla por pantalla

Los enlaces abren los ejemplos del proveedor. La adaptación de datos, columnas, copy y acciones es obligatoria. Estos bloques no incluyen las reglas del ERP.

| Pantalla | Recurso decidido | Composición y adaptación |
|---|---|---|
| Assistant: página y panel global | [ai-chat-6](https://reui.io/preview/base/ai-chat-6?ref=mcp) | Conversación, composer, contexto, plan, aclaraciones y propuestas del orquestador. Misma conversación en `/a/:agencySlug/assistant` y panel derecho. Driver de demo guionizado; presets/aliases y parámetros usan consultas/comandos reales, sin LLM. |
| Panel acoplado y móvil | [app-shell-18](https://reui.io/preview/base/app-shell-18?ref=mcp), referencia de comportamiento | Reutilizar únicamente el patrón de panel derecho en flujo de escritorio y Sheet móvil. No copiar otra aplicación, sidebar, listas de tareas ni theme provider paralelo. Conservar Verve. |
| Configurar agencia | [onboarding-1](https://reui.io/preview/base/onboarding-1?ref=mcp) | Card + Stepper, cinco pasos acordados. Sustituir inbox de muestra por preview de la agencia. Guardar borrador y activar mediante backend. |
| Overview | [card-28](https://reui.io/preview/base/card-28?ref=mcp) | Cuatro KPIs: trabajos activos, aprobaciones pendientes, facturación pendiente y margen proyectado. Después, pendientes y trabajos recientes. No añadir gráficos sin una decisión que ayudar a tomar. |
| Inbox y aprobaciones | [solution-agents-5](https://reui.io/preview/base/solution-agents-5?ref=mcp) | Bandeja de revisión con importe, cambio, responsable y evidencia. Aprobar la revisión exacta; no aprobación en un toast. |
| Jobs y clientes/contratos | [c-data-grid-3](https://reui.io/preview/base/components/c-data-grid-3?ref=mcp), dentro del shell Verve | Tabla común con columnas de cada entidad, Filters y detalle por Tabs/Sheet. Retener los patrones de registro de Verve; no añadir otro CRM. |
| Presupuestos y horas | [data-grid-editing-5](https://reui.io/preview/base/data-grid-editing-5?ref=mcp) | Edición tabular de líneas, importes y horas. Validación al guardar, revisión esperada y totales exactos del servidor. |
| Producción | [gantt-1](https://reui.io/preview/base/gantt-1?ref=mcp) | Cronograma con tareas y dependencias reales del demo; vista Kanban secundaria de los mismos registros. Arrastrar no aprueba gastos ni entregables. |
| Planificación de medios | [data-grid-advanced-3](https://reui.io/preview/base/data-grid-advanced-3?ref=mcp) | Objetivos, audiencias, canales, inversión y checks. Revisión de plan vinculada a compra de medios. |
| Compra de medios | [data-grid-advanced-1](https://reui.io/preview/base/data-grid-advanced-1?ref=mcp) | Campañas/órdenes, presupuesto y resultados sintéticos identificados. Reemplazar todas las series de muestra por fixtures consistentes. |
| Proveedores y pagos | [data-grid-filtering-1](https://reui.io/preview/base/data-grid-filtering-1?ref=mcp) | Vistas Orders, Invoices y Payment batches; abrir conciliación orden–entrega–factura y comprobación de fondos. |
| Facturación y cobranza | [data-grid-filtering-1](https://reui.io/preview/base/data-grid-filtering-1?ref=mcp), componente reutilizado | Vistas Invoices, Receivables y Collections; vencimiento, saldo, asignación y documento demo. No reutilizar mecánicas de suscripción SaaS para facturas de una agencia. |
| Contabilidad y cierre | [c-data-grid-3](https://reui.io/preview/base/components/c-data-grid-3?ref=mcp) + Stepper/Alert | Asientos con débito/crédito, estado del periodo y checklist de cierre. El componente de tabla se comparte, las reglas de cada vista son específicas. |
| Rentabilidad | [data-grid-advanced-2](https://reui.io/preview/base/data-grid-advanced-2?ref=mcp) | Agencia → cliente → trabajo. Sustituir lógica retail por fee, costo, pass-through y margen. Selección explícita Forecast/Realized/Posted. |
| Arranque y catálogo de 42 skills | [data-grid-filtering-2](https://reui.io/preview/base/data-grid-filtering-2?ref=mcp) | Grupos por módulo; tabs Available, Enabled, Needs setup y Disabled; dependencias, responsable, conexiones y acción Configure. Eliminar rating de estrellas, archivo genérico y estados Live que sugieran agentes inexistentes. |
| Conexiones | [solution-dev-ops-6](https://reui.io/preview/base/solution-dev-ops-6?ref=mcp) | Cuenta ficticia, permisos y flujos dependientes. Estado Connected · Demo. Sin OAuth ficticio presentado como real. |
| Políticas y permisos | [solution-agents-4](https://reui.io/preview/base/solution-agents-4?ref=mcp) | Auto/Approval/Blocked como política efectiva del servidor. Los controles permanentes del ERP no se desactivan. |
| Biblioteca | [solution-files-1](https://reui.io/preview/base/solution-files-1?ref=mcp) | PDF/DOCX/XLSX/CSV privados; File Type, carga persistente, versiones y vínculo al trabajo. |
| Actividad y ejecuciones | [agent-activity-1](https://reui.io/preview/base/agent-activity-1?ref=mcp) | Ejecuciones deterministas y errores reales; usar [c-trace-4](https://reui.io/preview/base/components/c-trace-4?ref=mcp) y [c-trace-5](https://reui.io/preview/base/components/c-trace-5?ref=mcp) para pasos y aprobación. Sin razonamiento inventado. |
| Marca, dominio y ajustes | Formularios y Tabs/Sheet de Verve + Color Picker | Nombre de agencia y de aplicación separados; logo y acento; dirección real de demo y dominio solicitado claramente simulado. |
| Operación de plataforma | Actividad y aprobación anteriores, reutilizadas | Incidente CSV especificado: evidencia → propuesta de delimitador → aprobación independiente → relectura y auditoría. No añadir un dashboard DevOps completo. |

**Fuera de la composición inicial:** [gantt-4](https://reui.io/preview/base/gantt-4?ref=mcp), [chart-48](https://reui.io/preview/base/chart-48?ref=mcp) y [ai-usage-2](https://reui.io/preview/base/ai-usage-2?ref=mcp) quedan como referencias de capacidad, Sankey y consumo avanzado. No son necesarios para cumplir los flujos funcionales de las 42 skills. Los cupos se implementan con cifras reales de almacenamiento y operaciones de demo; no hay inferencia LLM ni gasto de modelos que mostrar. Tampoco hacen falta Flowly, Flux u otra plantilla descargada para esta construcción.

## Asistente: decisión de producto y comportamiento

**Assistant / Asistente**, icono [MessagesSquare](https://lucide.dev/icons/messages-square), es la segunda entrada de Workspace. Navega a `/a/:agencySlug/assistant`, una página `page.tsx` real. El botón de cabecera **Ask AgeOS / Consultar a AgeOS** y los accesos contextuales abren el panel derecho conservando la pantalla actual. Son dos vistas de un único orquestador, thread y backend; al abrir página completa se oculta el panel duplicado y al volver se conserva la conversación.

Montar el estado compartido en el layout de agencia; persistir mensajes, referencias, propuestas y ejecuciones por agencia/usuario en servidor. Las navegaciones mantienen contexto y borrador. Un cambio de agencia no traslada mensajes ni archivos. Las rutas de control y operación de plataforma permanecen separadas. El asistente puede consultar y operar los nueve módulos a través de las 42 skills existentes según permisos y configuración; `agency-orchestrator` es el punto de entrada que enruta a especialistas.

`ai-chat-6` ya contiene composer y controles de conversación, por lo que no se añade un segundo bloque de chat. Su panel se adapta al alto disponible del shell, evitando `h-svh` anidado. Desktop: panel derecho acoplado; móvil: Sheet con foco y cierre accesibles. El historial tiene scroll propio y respeta la lectura de mensajes anteriores. En página completa, la misma conversación ocupa el contenido principal. Voz y selector de modelos de muestra se retiran si no son funcionales.

Sustituir `SOURCES`, `PLAN_STEPS`, `FORK_CHOICES` y `OWNERS` por datos del escenario y contexto autorizado. Retirar `MODELS`; este driver no usa LLM. `PICKABLE_FILES` debe enlazarse a la biblioteca/carga privada o a un archivo fixture explícito y autorizado. Ninguna selección de fuentes amplía permisos. Contexto de pantalla y referencias se revalidan al consultar; el orquestador usa servicios tipados, no SQL arbitrario ni un volcado del esquema.

El asistente es una demo guionizada determinista. El chasis implementa primero página, panel, persistencia y contratos; los recorridos E2E se incorporan después mediante [08-instruccion-2-demo-e2e.md](./08-instruccion-2-demo-e2e.md), [PROMPT-2-DEMO-E2E.txt](./PROMPT-2-DEMO-E2E.txt) y [demo-scenarios-v1.json](./demo-scenarios-v1.json). Centralizar presets, aliases, parámetros y textos en el driver, sin callbacks aislados de muestra en ReUI. Las respuestas pueden ser plantillas hardcodeadas con variables del servidor. Toda modificación usa los mismos comandos, validaciones, idempotencia, aprobaciones y auditoría que la UI. Resultados con fuente/fecha; cambios con diff, moneda y enlace al expediente. Autoaprobación, revisión obsoleta o scope insuficiente se bloquean también desde el chat. No pedir LLM ni credenciales, fingir inteligencia general, fabricar estados/cálculos o dejar botones sin implementación. Entrada no soportada muestra los casos disponibles.

[agent-activity-1](https://reui.io/preview/base/agent-activity-1?ref=mcp) conserva su función de consola de una ejecución. Las trazas se derivan de eventos observables del driver y backend. [sheet-10](https://reui.io/preview/base/sheet-10?ref=mcp) fue evaluado y descartado como base porque no aporta el plan/acciones del recurso elegido. Su callback de muestra no sustituye el driver centralizado de escenarios, aunque el uso de guiones explícitos sí es parte del alcance acordado.

## Componentes que debe usar Claude

| Necesidad | Componente y preview | Decisión |
|---|---|---|
| Tablas | [Data Grid](https://reui.io/components/data-grid?ref=mcp) | Componente común para listas; selección, orden y paginación reales. |
| Filtros | [Filters](https://reui.io/components/filters?ref=mcp) | Traducir el árbol de condiciones a consultas autorizadas; sin SQL arbitrario. |
| Paneles operativos | [Frame](https://reui.io/components/frame?ref=mcp) | Una familia de contenedor por región; no anidar Frame y Card. |
| Estados | [Badge](https://reui.io/components/badge?ref=mcp) y [Alert](https://reui.io/components/alert?ref=mcp) | Variantes semánticas y etiqueta legible. |
| Configuración guiada | [Stepper](https://reui.io/components/stepper?ref=mcp) | Cinco pasos con validación y reanudación. |
| Tareas y planificación | [Kanban](https://reui.io/components/kanban?ref=mcp) y [Gantt](https://reui.io/components/gantt?ref=mcp) | Vistas de los mismos registros, sin duplicar fuentes. |
| Periodos de reportes | [Date Selector](https://reui.io/components/date-selector?ref=mcp) | Admitir las fechas 2027 de los fixtures: el default consultado termina en 2026; configurar maxYear explícito. |
| Cantidades y horas | [Number Field](https://reui.io/components/number-field?ref=mcp) | Controles numéricos; nunca autoridad financiera. Importes se convierten/validan con precisión en servidor. |
| Archivos | [File Type](https://reui.io/components/file-type?ref=mcp) | Icono por formato; resolver extensión/MIME. El botón o enlace envolvente lleva la acción accesible. |
| Marca | [Color Picker](https://reui.io/components/color-picker?ref=mcp) | Solo acento de marca permitido; preservar colores de estado y contraste. |
| Historial sencillo | [Timeline](https://reui.io/components/timeline?ref=mcp) | Eventos persistidos. Para la ejecución con aprobaciones, usar los ejemplos Trace elegidos. |
| Turnos del asistente | [Message](https://reui.io/components/message?ref=mcp) y [Bubble](https://reui.io/components/bubble?ref=mcp) | Reutilizar composición de ai-chat-6; leer archivos shadcn instalados antes de escribir props. |
| Historial conversacional | [Message Scroller](https://reui.io/components/message-scroller?ref=mcp) | Altura acotada y provider sobre sus controles; conservar posición del lector y acceso al último mensaje. |
| Composer del asistente | [Input Group](https://reui.io/components/input-group?ref=mcp) | Campo etiquetado, enviar/cancelar y adjuntos autorizados según el bloque; sin campos o botones decorativos. |
| Eventos de herramientas | [Trace](https://reui.io/components/trace?ref=mcp) | Estado textual, entrada/salida permitida y evidencia; los props son de shadcn y se verifican en archivos instalados. |

Reutilizar los primitives presentes en Verve: Sidebar, Breadcrumb, Tabs, Sheet, Dialog, AlertDialog, Command/CommandDialog, DropdownMenu, Tooltip, Input, Select, Textarea, Switch, Checkbox, Skeleton y Sonner. Confirmar sus APIs instaladas antes de escribir props. El MCP de ReUI prescribe Sidebar para el shell, Sheet móvil, Dialog para formularios y AlertDialog para confirmaciones destructivas. No fabricar componentes equivalentes a mano.

## Iconos exactos del sidebar

Una biblioteca: **lucide-react**, estática, con la escala y trazo de Verve. Cada enlace permite ver el dibujo. Verificar los exports de la versión del ZIP antes de compilar.

| Grupo | Menú | Icono |
|---|---|---|
| Workspace | Overview | [LayoutDashboard](https://lucide.dev/icons/layout-dashboard) |
| Workspace | Assistant | [MessagesSquare](https://lucide.dev/icons/messages-square) |
| Workspace | Inbox | [Inbox](https://lucide.dev/icons/inbox) |
| Workspace | Jobs | [BriefcaseBusiness](https://lucide.dev/icons/briefcase-business) |
| Operations | Clients & contracts | [ContactRound](https://lucide.dev/icons/contact-round) |
| Operations | Work & production | [Clapperboard](https://lucide.dev/icons/clapperboard) |
| Operations | Media planning | [CalendarRange](https://lucide.dev/icons/calendar-range) |
| Operations | Media buying | [Megaphone](https://lucide.dev/icons/megaphone) |
| Finance | Suppliers & payments | [WalletCards](https://lucide.dev/icons/wallet-cards) |
| Finance | Billing & collections | [ReceiptText](https://lucide.dev/icons/receipt-text) |
| Finance | Accounting & close | [BookOpenCheck](https://lucide.dev/icons/book-open-check) |
| Finance | Profitability | [ChartNoAxesCombined](https://lucide.dev/icons/chart-no-axes-combined) |
| Manage | Agency setup | [SlidersHorizontal](https://lucide.dev/icons/sliders-horizontal) |
| Manage | Connections | [Plug](https://lucide.dev/icons/plug) |
| Manage | Library | [FolderOpen](https://lucide.dev/icons/folder-open) |
| Manage | Settings | [Settings](https://lucide.dev/icons/settings) |
| Catálogo | All capabilities | [Workflow](https://lucide.dev/icons/workflow) |

Acciones compartidas: [Plus](https://lucide.dev/icons/plus), [Search](https://lucide.dev/icons/search), [Upload](https://lucide.dev/icons/upload), [Download](https://lucide.dev/icons/download), [Pencil](https://lucide.dev/icons/pencil), [Save](https://lucide.dev/icons/save), [Check](https://lucide.dev/icons/check), [X](https://lucide.dev/icons/x), [RefreshCw](https://lucide.dev/icons/refresh-cw), [ArrowUpRight](https://lucide.dev/icons/arrow-up-right), [Ellipsis](https://lucide.dev/icons/ellipsis). Permisos y riesgo: [ShieldCheck](https://lucide.dev/icons/shield-check), [LockKeyhole](https://lucide.dev/icons/lock-keyhole), [TriangleAlert](https://lucide.dev/icons/triangle-alert).

Son 17 entradas de sidebar, incluido Assistant y el catálogo. Un icono acompaña a su texto, no lo reemplaza. Sidebar colapsado: tooltip y nombre accesible. Botones solo con icono: etiqueta específica. Logos de proveedores son assets de marca separados, con Plug como fallback. No añadir Motion Icons a filas, cifras o navegación. El acceso Ultimate permite usarlos; esta V1 prioriza una interfaz estable y coherente.

## Reglas específicas de adaptación

1. card-28 trae cifras divididas en valueBold/valueFaint: obtenerlas del formateador del resultado real. No conservar tendencias sin periodo comparable.
2. data-grid-filtering-2 mantiene una copia local de automations: sustituir por configuración versionada del servidor. El switch solicita un cambio validado; nunca modifica directamente los controles permanentes.
3. data-grid-filtering-1 simula una carga de 400 ms: sustituirla por la consulta real. Las vistas financieras comparten composición, pero tienen columnas, reglas y comandos propios.
4. Mantener las variantes Base UI/Nova y las clases de los componentes; retirar wrappers demo de página al insertarlos dentro del shell.
5. Las sugerencias automáticas de compose_page no cambian estas decisiones. En esta consulta devolvió también una bandeja de correo, métricas comerciales y gráficos genéricos: no corresponden al producto y no se seleccionaron.
6. Los detalles de documentos y contratos son registros estructurados con adjuntos/versiones. Un editor legal de redlines, firma electrónica o canvas avanzado no es requisito adicional de este chasis.

## Evidencia y alcance de revisión

El MCP respondió plan Ultimate. La revisión inicial consultó core, icons y compose, el índice de componentes, compose_page, búsquedas enfocadas y fichas de tres bloques añadidos; validó 20 recursos y 11 componentes. La ampliación Assistant consultó core, compose y adapting, búsquedas y fichas completas de ai-chat-6, app-shell-18 y alternativas. validate_usage confirmó los dos recursos nuevos seleccionados: el inventario combinado contiene **22 recursos**. También confirmó existencia de Message, Bubble, Message Scroller, Input Group y Trace; sus APIs pertenecen a shadcn y no se validaron props. Los nombres maxYear y variant conservan la comprobación documental anterior. Esto valida existencia/documentación, no compilación de la futura aplicación.

La portada de Verve se abrió e inspeccionó visualmente en navegador. El preview Advanced de medios no terminó de cargar en esa revisión; su elección se sustenta en el MCP y en el inventario previo, sin afirmar prueba visual completada. La selección Assistant se verificó mediante MCP, sin prueba visual en navegador. No se descargó código premium ni se instaló una app. Evidencia: reui-direccion-producto-v1.json.

Claude debe implementar esta dirección, verificar los archivos instalados y registrar cualquier incompatibilidad concreta antes de sustituir un recurso. Mantener alcance funcional, estilo y semántica al resolverla.
