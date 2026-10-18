# ReUI: selección e instrucciones para Claude Code

Fecha de verificación: 17 octubre 2026. Esta es una especificación para construir el chasis; todavía no se descargó ni instaló una plantilla.

**Selección de producto concretada:** leer [04A — Dirección y mapa UI](./04A-direccion-producto-y-mapa-ui.md). Define qué recursos utilizar por pantalla, los componentes y los iconos exactos del sidebar. Añade card-28, data-grid-filtering-1 y data-grid-filtering-2; la ampliación Assistant incorpora ai-chat-6 y app-shell-18 como referencia de acoplamiento, elevando el inventario combinado a 22 recursos. Deja las visualizaciones avanzadas opcionales fuera de la composición inicial. Este documento conserva la investigación y las instrucciones de instalación.

## Decisión

**Descargar Verve como único proyecto base.** Next.js 16 App Router, Base UI, estilo Nova y Lucide. Su experiencia de registros, cotizaciones y aprobaciones es la más cercana a la operación comercial de una agencia; conservaremos ese lenguaje para las tres áreas lógicas de AgeOS. [Ficha](https://reui.io/template/verve-crm) · [Preview](https://verve-crm.reui.io)

Los nueve módulos y las 42 skills se implementan sobre esa base. Las plantillas aceleran la interfaz; la persistencia, las reglas y el aislamiento los aporta el chasis AgeOS.

**Descargas opcionales:** Flowly solo si se implementa el canvas avanzado durante esta versión; Flux solo para consultar su organización de operaciones. No son necesarias para empezar: sus patrones pueden obtenerse como bloques. Limelight puede servir para un sitio de presentación separado. No combinar routers, autenticaciones, themes, providers ni layouts completos de varios templates.

## Estado de acceso y cobertura

- El MCP ReUI está conectado; la búsqueda respondió `plan: ultimate` y devolvió metadatos de bloques e iconos.
- El usuario declara licencia extended. No se infirió equivalencia contractual entre ese nombre y Ultimate: se verificó lo que el MCP permite en esta sesión. Claude debe verificar su propia conexión y la disponibilidad de descarga en la cuenta.
- Se revisaron las **18 entradas del catálogo**, **17 fichas completas**, el roadmap publicado el **15 octubre 2026**, los **8 bloques Advanced** que el catálogo devuelve hoy y el índice de **27 componentes ReUI**.
- La ficha individual de Mesh no pudo recuperarse después de reintentar; su inclusión y stack provienen del listado oficial. No es una dependencia seleccionada.
- El inventario es documental: no se revisó cada variante de cada bloque, no se descargó código premium y no se hicieron pruebas de ejecución ni revisión visual en navegador.
- Nombres, props seleccionadas y 17 ítems se comprobaron con `validate_usage`: resultado `ok: true`. Esa comprobación no sustituye typecheck ni tests del código descargado.
- Evidencia estructurada: [reui-inventario-verificado.json](./reui-inventario-verificado.json).

## Todos los templates revisados

Las 18 entradas actuales aparecen disponibles con Ultimate. El roadmap anuncia futuras ampliaciones genéricas; ninguna futura plantilla es requisito del chasis. La columna de decisión es recomendación para AgeOS, no afirmación del proveedor.

| Template y preview | Stack | Estilo/superficie declarados | Decisión AgeOS |
|---|---|---|---|
| [Flowly](https://reui.io/template/flowly-app) · [preview](https://flowly-app.reui.io) | Next.js 16 (App Router) | Nova/Card | Referencia opcional para el editor avanzado de flujos. No es motor de ejecución. |
| [Mesh](https://reui.io/template/mesh-whiteboard) · [preview](https://mesh-whiteboard.reui.io) | TanStack Start | No verificado/No especificada | Inventario revisado; ficha no recuperable. Whiteboard no necesario. |
| [Echo](https://reui.io/template/echo-chat) · [preview](https://echo-chat.reui.io) | Next.js 16 (App Router) | Nova/Card | Referencia de conversación y artefactos; el producto sigue centrado en jobs. |
| [Limelight](https://reui.io/template/limelight-landing) · [preview](https://limelight-landing.reui.io) | Next.js 16 (App Router) | Luma/No especificada | Opcional como sitio de presentación separado; no importarlo dentro del ERP. |
| [Verve](https://reui.io/template/verve-crm) · [preview](https://verve-crm.reui.io) | Next.js 16 (App Router) | Nova/Card | Base elegida: clientes, contratos, cotizaciones, aprobaciones y navegación. |
| [Manifest](https://reui.io/template/manifest-commerce) · [preview](https://manifest-commerce.reui.io) | Laravel 13 + Inertia 3 (React 19) | Nova/Frame | Laravel; no elegir para el stack Vercel/Next.js acordado. |
| [Lucent](https://reui.io/template/lucent-devops) · [preview](https://lucent-devops.reui.io) | TanStack Start (React 19, Vite 8) | Nova/Frame | DevOps/TanStack; referencia técnica secundaria. |
| [Overture](https://reui.io/template/overture-waitlist) · [preview](https://overture-waitlist.reui.io) | Next.js 16 (App Router) | Nova/No especificada | Waitlist; no sustituye una demo ejecutable. |
| [Atlas](https://reui.io/template/atlas-admin) · [preview](https://atlas-admin.reui.io) | Next.js 16 (App Router) | Nova/Card | Alternativa administrativa; no fusionar su shell con Verve. |
| [Tempo](https://reui.io/template/tempo-tasks) · [preview](https://tempo-tasks.reui.io) | TanStack Start (file-based routing, SPA mode) | Nova/Frame | Referencia de producción; usar bloques Gantt/Kanban en Next.js. |
| [Miro](https://reui.io/template/miro-clinic) · [preview](https://miro-clinic.reui.io) | Vite 8 (React 19 SPA) | Nova/Card | Dominio clínico; no aporta una base mejor para agencia. |
| [Cohort](https://reui.io/template/cohort-hr) · [preview](https://cohort-hr.reui.io) | Laravel 13 + Inertia 3 (React 19) | Nova/No especificada | Laravel HR; referencia, no base técnica. |
| [Filespace](https://reui.io/template/filespace-drive) · [preview](https://filespace-drive.reui.io) | Next.js 16 (App Router) | Nova/Frame | Referencia de documentos; basta solution-files-1 para V1. |
| [Roster](https://reui.io/template/roster-hr) · [preview](https://roster-hr.reui.io) | React 19 (Vite 8 SPA) | Nova/No especificada | Timesheets/HR; referencia, no introducir segundo router. |
| [Pulse](https://reui.io/template/pulse-helpdesk) · [preview](https://pulse-helpdesk.reui.io) | TanStack Start (React 19, Vite 8) | Nova/No especificada | Helpdesk; no prioritario para demo ERP. |
| [Surge](https://reui.io/template/surge-commerce) · [preview](https://surge-commerce.reui.io) | TanStack Start (React 19) | Nova/Frame | Buen patrón de repositorios y transiciones; no importar su app. |
| [Filebox](https://reui.io/template/filebox-drive) · [preview](https://filebox-drive.reui.io) | Laravel 13 + Inertia 3 (React 19) | Nova/Frame | Laravel; preferir los patrones Next.js de Filespace. |
| [Flux](https://reui.io/template/flux-agentops) · [preview](https://flux-agentops.reui.io) | Next.js 16 (App Router) | Luma/Frame | Referencia opcional de runs, aprobaciones y consumo; sus bloques se instalan por separado. |

Fuentes de cada fila: ficha enlazada y [catálogo](https://reui.io/templates). No elegir una base Laravel por tener más backend: la aplicación acordada vive en el stack Next.js/Vercel.

## Lo nuevo del 15 octubre que sí aprovechamos

Se confirmó el release del [roadmap](https://reui.io/roadmap). Para AgeOS son útiles Trace (evidencia de actividad y aprobaciones), File Type (archivos), Sankey (flujo de ingresos) y AI Usage (cupos/consumo). El nuevo grid de revisión aporta un patrón de checks. Digital Twin, carreras/estadios y SLO son dominios distintos y no se añaden al panel de agencia.

La etiqueta antigua del menú Advanced dice “5”; el listado y MCP devuelven **8**. Registrar nombres reales, nunca generar IDs por secuencia: no existe una recomendación nuestra llamada `data-grid-advanced-8`.

| Advanced revisado | ID real | Uso decidido |
|---|---|---|
| [Fourplex Pro Forma](https://reui.io/preview/base/data-grid-advanced-7?ref=mcp) | `data-grid-advanced-7` | Referencia subtotales; fórmulas inmobiliarias no aplican al ERP. |
| [Stock Mix](https://reui.io/preview/base/data-grid-advanced-6?ref=mcp) | `data-grid-advanced-6` | Referencia edición matriz; dominio retail innecesario. |
| [Service Visit Planner](https://reui.io/preview/base/data-grid-advanced-9?ref=mcp) | `data-grid-advanced-9` | Referencia calendario/matriz; no introducir dominio mantenimiento. |
| [Wholesale Onboarding](https://reui.io/preview/base/data-grid-advanced-5?ref=mcp) | `data-grid-advanced-5` | Referencia de checks jerárquicos; no segundo onboarding. |
| [Ad Campaign Performance](https://reui.io/preview/base/data-grid-advanced-1?ref=mcp) | `data-grid-advanced-1` | Usar para compra de medios. |
| [Regional Store P&L](https://reui.io/preview/base/data-grid-advanced-2?ref=mcp) | `data-grid-advanced-2` | Adaptar a rentabilidad por cliente/job. |
| [SLO Reliability Index](https://reui.io/preview/base/data-grid-advanced-4?ref=mcp) | `data-grid-advanced-4` | Solo operación de plataforma futura; no dashboard del dueño de agencia. |
| [Campaign Target Review](https://reui.io/preview/base/data-grid-advanced-3?ref=mcp) | `data-grid-advanced-3` | Usar para planificación y optimización. |

[Categoría Advanced](https://reui.io/blocks/data-grid/advanced).

## Mapa de componentes por pantalla

Las rutas concretas y sus transiciones se definen en la especificación UX del paquete. Reutilizar estos bloques dentro del shell Verve; quitar wrappers de página redundantes, no copiar una segunda aplicación.

| Pantalla / capacidad | Bloque o ejemplo — preview | Superficie | Adaptación obligatoria |
|---|---|---|---|
| Assistant: página y panel global | [ai-chat-6](https://reui.io/preview/base/ai-chat-6?ref=mcp) | card | Orquestador con driver determinista, contexto autorizado, conversación persistida, preguntas y propuestas sobre los mismos servicios ERP. Escenarios/presets reemplazan los datos de muestra; retirar MODELS y enlazar archivos autorizados. |
| Acoplamiento del asistente | [app-shell-18](https://reui.io/preview/base/app-shell-18?ref=mcp) | neutral | Solo referencia del panel derecho de escritorio y Sheet móvil. No reemplazar shell Verve ni copiar taxonomía de tareas o un segundo sidebar. |
| Configure your agency | [onboarding-1](https://reui.io/preview/base/onboarding-1?ref=mcp) | card | Cambiar inbox por preview de Estudio Solar; persistir borrador, validar cada paso y derivar readiness. |
| Approvals | [solution-agents-5](https://reui.io/preview/base/solution-agents-5?ref=mcp) | card | Bind exact resource/version/payload; mostrar efecto, evidencia y razón. El SLA viene de política, no 4h fijo. |
| Documents | [solution-files-1](https://reui.io/preview/base/solution-files-1?ref=mcp) | card | Blob privado, grants server-side, IDs y versiones persistentes; cada upload y preview autorizados. |
| Production · timeline | [gantt-1](https://reui.io/preview/base/gantt-1?ref=mcp) | card | Job/task real, dependencias y fechas persistentes; revalidar cambios en servidor. |
| Production · capacity | [gantt-4](https://reui.io/preview/base/gantt-4?ref=mcp) | card | Capacidad configurable; validación backend para reserva/concurrencia. |
| Connections | [solution-dev-ops-6](https://reui.io/preview/base/solution-dev-ops-6?ref=mcp) | frame | Indicar simulated/test/live; nunca afirmar OAuth real por completar un temporizador; enmascarar servidor. |
| Policies / advanced agent tools | [solution-agents-4](https://reui.io/preview/base/solution-agents-4?ref=mcp) | frame | Scoping por agencia y rol; modos Auto/Approval/Blocked son política efectiva backend. |
| Run / job activity | [agent-activity-1](https://reui.io/preview/base/agent-activity-1?ref=mcp) | frame | Actividad de eventos persistidos, pausas de aprobación y reintentos acotados. |
| Media buying · performance | [data-grid-advanced-1](https://reui.io/preview/base/data-grid-advanced-1?ref=mcp) | frame | Métricas del dataset demo común; series diarias verdaderas del fixture, no inventadas desde un total. |
| Profitability | [data-grid-advanced-2](https://reui.io/preview/base/data-grid-advanced-2?ref=mcp) | frame | Jerarquía agencia→cliente→job; cambiar cálculo retail por definición de margen de agencia. |
| Media planning · targets | [data-grid-advanced-3](https://reui.io/preview/base/data-grid-advanced-3?ref=mcp) | frame | Targets y revisiones aprobadas; vincular al mismo plan/campaña de compra. |
| Job / budget / timesheet editor | [data-grid-editing-5](https://reui.io/preview/base/data-grid-editing-5?ref=mcp) | frame | Mantener rangos/edición como UI; dinero con decimal o minor units, batch validation y control de revisión. |
| Profitability · revenue flow | [chart-48](https://reui.io/preview/base/chart-48?ref=mcp) | frame | Opcional, útil para narrativa; usar units/currency reales del demo, nunca asumir millones USD. |
| Usage / caps | [ai-usage-2](https://reui.io/preview/base/ai-usage-2?ref=mcp) | frame | Medir consumo demo separado de gasto IA real; totales y particiones deben reconciliar. |
| Activity · delegated tasks | [c-trace-4](https://reui.io/preview/base/components/c-trace-4?ref=mcp) | Neutral | Gratis; estado padre derivado de hijos. Solo eventos, entradas/salidas y evidencias, sin razonamiento privado. |
| Activity · approval transition | [c-trace-5](https://reui.io/preview/base/components/c-trace-5?ref=mcp) | Neutral | Gratis; adaptar a aprobación ERP con foco accesible; backend decide transición. |
| Other module desks | [c-data-grid-3](https://reui.io/preview/base/components/c-data-grid-3?ref=mcp) | Neutral | Gratis; grilla densa común para toda skill que no requiere layout especializado. |

Los bloques Frame se usan como desks propios. El shell general no se sustituye al abrirlos. Se admite una fila de Cards para KPI y un Frame para tabla, como regiones hermanas; nunca anidar Card dentro de Frame o viceversa. Para el inbox de aprobaciones, archivos y wizard se conserva Card. Un control repetido se implementa una vez y se reutiliza en todas las skills.

### Assistant: cómo integrarlo sin una segunda aplicación

La entrada Assistant con icono [MessagesSquare](https://lucide.dev/icons/messages-square) navega a `/a/:agencySlug/assistant`. El botón de cabecera y accesos contextuales abren el panel derecho en cualquier pantalla de agencia. Compartir conversación, orquestador `agency-orchestrator`, contexto y backend entre página y panel; montar el estado en el layout persistente y ocultar el panel duplicado en página completa. Mantener nueve módulos y 42 skills; el asistente enruta a las capacidades existentes.

`ai-chat-6` ya trae composer, mensajes y controles de plan. Consultar [Message](https://reui.io/components/message?ref=mcp), [Bubble](https://reui.io/components/bubble?ref=mcp), [Message Scroller](https://reui.io/components/message-scroller?ref=mcp), [Input Group](https://reui.io/components/input-group?ref=mcp) y [Trace](https://reui.io/components/trace?ref=mcp). Son primitives shadcn: leer su implementación instalada, pues ReUI no documenta sus props. Acotar el alto del historial al shell; retirar el `h-svh` anidado del ejemplo, conservar foco y desplazamiento accesibles, y verificar Sheet móvil.

La selección se verificó por MCP con plan Ultimate y validate_usage; no implica prueba visual o compilación. Comando consultado: `pnpm dlx shadcn@latest add @reui/ai-chat-6`, sujeto al package manager, licencia y estilo instalados. Instalar el contenido de conversación elegido; usar app-shell-18 como referencia, sin añadir otro shell.

El asistente usa un driver guionizado, sin LLM ni credenciales. Primero se construyen chasis, página, panel, persistencia y contratos; después se aplican [08-instruccion-2-demo-e2e.md](./08-instruccion-2-demo-e2e.md), [PROMPT-2-DEMO-E2E.txt](./PROMPT-2-DEMO-E2E.txt) y [demo-scenarios-v1.json](./demo-scenarios-v1.json). Centralizar presets, aliases, parámetros, preguntas y respuestas de plantilla; cada consulta o modificación obtiene resultados reales de servicios autorizados. No copiar respuestas aisladas que inventen cifras/estados ni timers de éxito. Identificar `Scripted demo`, reconocer entradas no soportadas y no atribuir comprensión general. Las integraciones de negocio externas siguen simuladas. [agent-activity-1](https://reui.io/preview/base/agent-activity-1?ref=mcp) es evidencia de ejecuciones, no una sustitución del chat. [sheet-10](https://reui.io/preview/base/sheet-10?ref=mcp) se revisó como alternativa y no se seleccionó porque no aporta los controles de plan/acciones elegidos.

## Qué debe pedir Claude al MCP antes de escribir UI

1. `get_agent_skill({})`. Versión observada: `68f0e6fa91`; usar la vigente durante implementación.
2. Leer `compose` y los temas pertinentes. Antes de estilos, revisar `color`, `layout` y `motion`; antes de props, `components`.
3. Para cada pantalla completa, `compose_page`; contrastar su resultado con el mapa de este documento. Sus búsquedas son recomendaciones, no permiso para añadir pantallas fuera de alcance.
4. `search` con intención y categoría; `get_block` / `get_example` para los IDs elegidos. Leer `agentNotes` y `whenNotToUse`.
5. `get_component({name: [...componentsUsed]})` y `get_examples`. Si se recorta una API, recuperar las secciones necesarias. No extrapolar una versión anterior de TanStack ni shadcn.
6. `get_install_command`; revisar archivo instalado y adaptar datos/acciones, conservando estilo.
7. `validate_usage`, temas `quality` y `anti-patterns`, `get_audit_checklist`, typecheck, lint y pruebas de los recorridos.

Antes de cada pantalla, escribir en el registro de implementación: superficie, arquetipo, familia de contenedores, densidad, regiones, estados, movimiento. Default operativo: denso y sin animación de entrada; flow: Card y una acción primaria.

## Instalación y licencias

**Templates no son ítems del registry.** El usuario descarga Verve de su cuenta y entrega la carpeta/ZIP. Claude inspecciona README, `package.json`, lockfile y `components.json` antes de instalar. No usar un comando inventado como `shadcn add @reui/verve`.

Conservar package manager y versiones del template. Las siguientes órdenes verificadas son para un proyecto pnpm; si el ZIP usa otro gestor, volver a pedir el comando adecuado al MCP:

```bash
pnpm dlx shadcn@latest add @reui/onboarding-1 --yes
pnpm dlx shadcn@latest add @reui/data-grid-advanced-1 --yes
```

Instalar el resto **por fase y por necesidad**, usando los nombres validados del inventario. Hacer dry-run/diff si existen archivos; nunca sobrescribir componentes compartidos automáticamente. El CLI resuelve la variante Base UI/Nova desde `components.json`.

Para bloques premium, la configuración oficial del registry es:

```json
{
  "registries": {
    "@reui": {
      "url": "https://reui.io/r/{style}/{name}.json",
      "headers": {
        "Authorization": "Bearer ${REUI_LICENSE_KEY}"
      }
    }
  }
}
```

La variable se configura localmente o en el entorno seguro del agente; no debe copiarse a este paquete, al repositorio, al navegador ni a capturas. El plan MCP de esta sesión no se transfiere automáticamente al Claude Code del usuario. Si no tiene el MCP conectado, seguir [configuración oficial](https://reui.io/docs/agent-skills) y [registry](https://reui.io/docs/registry); no detener el diseño por falta de un icono premium.

Bloques: Pro/Ultimate. Motion Icons: Ultimate. Los componentes y ejemplos `c-*` son gratuitos. La aplicación comercial es el producto; no redistribuir las fuentes como una biblioteca de templates.

## Contratos de API ya verificados

Estos puntos evitan que Claude invente props:

- **DataGrid:** TanStack v9 `useTable({features: dataGridFeatures, data, columns})`; pasar `table` y `recordCount` a DataGrid. No tiene `data`/`columns` como props directas. `getRowId` estable; con paginación servidor usar `manualPagination` y `rowCount`. [API](https://reui.io/docs/components/base/data-grid) · [Preview](https://reui.io/components/data-grid).
- **Filters:** `fields`, `query`, `onQueryChange`. El valor es un árbol AND/OR `FilterQuery`; `filters`/`onChange` del diseño anterior no aplican. El componente no compila SQL. AgeOS valida campos/operadores y transforma el árbol en consulta parametrizada dentro del tenant; no concatenar valores del navegador. [API](https://reui.io/docs/components/base/filters) · [Preview](https://reui.io/components/filters).
- **Stepper:** índices numéricos desde 1, `StepperItem step`, `StepperPanel`, `StepperContent value`. Guardar borrador por agencia para reanudar. [API](https://reui.io/docs/components/base/stepper) · [Preview](https://reui.io/components/stepper).
- **Kanban:** `value`, `onValueChange`, `getItemValue`; preservar Overlay y handles. Persistir al commit/drop, no cada frame; servidor valida transición de estado. [API](https://reui.io/docs/components/base/kanban) · [Preview](https://reui.io/components/kanban).
- **Gantt:** recursos + eventos, altura definida; fechas de fin exclusivas, progreso 0–100. Validar `onEventUpdate`/`canDropEvent` con reglas de negocio; un movimiento no confirma una campaña ni aprueba un gasto. [API](https://reui.io/docs/components/base/gantt) · [Preview](https://reui.io/components/gantt).
- **File Upload:** resolver mediante el hook documentado `useFileUpload`; selector/dropzone no almacena por sí mismo. La capa servidor valida extensión/MIME, tamaño, tenant, cuota y URL privada.
- **Color Picker:** `value`, `onValueChange`, `onValueCommit`; persistir al commit y aplicar tokens de marca aprobados. Un color elegido no puede anular colores de estado ni legibilidad. [API](https://reui.io/docs/components/base/color-picker) · [Preview](https://reui.io/components/color-picker).
- **Trace:** el MCP lo resuelve como categoría de ejemplos sobre shadcn, con API propia no indexada. Leer los archivos del ejemplo instalado; no inventar un componente `@reui/trace`. Estado también en palabras, nunca color solamente. Mostrar acciones y evidencia observables, no razonamiento privado del modelo.

## Iconos y marca

Conservar **Lucide**, la biblioteca de Verve. No mezclar Hugeicons/colecciones ni añadir iconos decorativos a cada cifra. Los bloques que traigan otra biblioteca se normalizan a la instalada utilizando importaciones reales verificadas en el proyecto.

Se comprobó acceso MCP a Motion Icons Ultimate; `receipt-square` existe y tiene variante animada. Es **opcional** y no necesario para la V1. [Preview](https://reui.io/icons/preview/receipt-square). Si se utiliza un acento animado en una acción primaria, mantener un único estilo y respetar reduced motion. La UI operacional debe comunicar estabilidad.

Nombre de agencia y nombre de aplicación son campos diferentes: agencia Rayo de Sol, aplicación Estudio Solar. Logo, acento y dominio se configuran; la biblioteca de componentes, jerarquía y comportamiento se mantienen.

## Adaptaciones indispensables del template

La [ficha de Verve](https://reui.io/template/verve-crm) declara datos de ejemplo sin backend, login no protegido y fuentes que no se reconcilian entre home y forecast. Por eso:

1. Eliminar login falso, usuario global fijo, credenciales del template y navegación directa como si autenticara.
2. Sustituir todos los stores de ejemplo por el mismo servicio persistente AgeOS. Un cambio de presupuesto debe llegar a detalle, tabla, dashboard y rentabilidad tras recargar.
3. Mantener un dataset demo con relaciones válidas y un reloj controlado; nunca mezclar números de CRM del template con fixtures de agencia.
4. El botón de activación completa una transición persistida; no un timeout que diga “deployed”. Las conexiones externas del demo se etiquetan **Simulated**, incluyendo los resultados de acciones.
5. El log de actividad nace de eventos reales del chasis. Un contador animado o una traza estática no prueba ejecución.
6. Deshacer en UI no equivale a revertir una compra o un pago. Aplicar undo solo a cambios reversibles; las operaciones contabilizadas usan reversión/compensación con evidencia.
7. Búsqueda, filtros, selección masiva y paginación usan el mismo scope de agencia y misma definición de totales.
8. Una aprobación aprobada en otra pestaña debe actualizarse aquí; una aprobación sobre versión anterior debe marcarse obsoleta.
9. No reutilizar logos “trusted by”, cifras de usuarios, testimonials o métricas del template como tracción de AgeOS.
10. Mantener English por defecto, Spanish completo como opción, incluyendo validaciones, grids, estados, fechas y accesibilidad; no solo el menú.

## Criterios de revisión visual y funcional

- Desktop 1440/1280, tablet y 390px: sin scroll horizontal del documento. La tabla puede desplazarse dentro de su región.
- Header, búsqueda, filtros y acción primaria accesibles en todos los tamaños. Mobile desplaza controles a un menú real.
- Empty con una acción, loading con skeleton del layout real, error con retry y unauthorized con explicación.
- Light/dark con contraste, foco visible, keyboard nav, labels y feedback accesible; body mínimo text-sm y metadata mínimo text-xs.
- Estados con variantes Badge/Alert, tokens semánticos; conservar espaciado, radios y animación de ReUI.
- Ningún botón decorativo: ejecutar acción persistente, abrir un destino real o indicar por qué está deshabilitado.
- Todos los nueve módulos están navegables; las 42 skills abren su workbench compartido con inputs, checks, outputs y actividad.
- Prueba crítica: cambiar presupuesto → revisión requerida → aprobación → acción simulada persistida → actualización de margen y evidencia → reload conserva resultado.
- Registrar qué es implementación real del chasis y qué es integración simulada. La demo demuestra capacidad de producto sin atribuirse operaciones externas inexistentes.

## Entrega exigida a Claude

Entregar el código, instrucciones de arranque, variables documentadas sin secretos, migrations/seed/reset demo, screenshots de los recorridos y resultados de pruebas. Confirmar qué template y versión fueron usados y qué bloques se instalaron. No declarar “listo para producción” por superar una prueba visual.

