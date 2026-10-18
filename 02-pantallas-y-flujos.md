# AgeOS — Pantallas, navegación y flujos del chasis V1

Especificación para Claude Code. Fecha: 17 de octubre de 2026. Estado: instrucciones de construcción; estas pantallas todavía no son una aplicación implementada. Interfaz principal en inglés, con español seleccionable. Leer junto con el contrato determinista, los fixtures, la selección ReUI y `rutas-y-pantallas.json` de este paquete.

La selección visual concreta está cerrada en [04A — Dirección de producto y mapa UI](./04A-direccion-producto-y-mapa-ui.md): bloques por pantalla, componentes e iconos exactos de cada menú. Este documento define comportamiento; 04A define su composición con ReUI.

## 1. El resultado que debe poder usar una persona

Construir una demo ejecutable de AgeOS: una persona configura una agencia, activa su espacio de demostración y entra a una aplicación con su nombre, marca, procesos y datos. Puede trabajar en los nueve módulos y ejecutar las 42 capacidades del catálogo mediante formularios y recorridos conversacionales deterministas, con reglas, cálculos y resultados persistidos. Las integraciones externas se simulan y se identifican. El asistente utiliza un driver guionizado, presets, aliases y parámetros tipados; no requiere LLM ni credenciales de modelos. Los textos de demo pueden estar predefinidos, pero sus cifras, estados, propuestas y efectos proceden de consultas y handlers reales del chasis.

La promesa visible es **“Build your agency with the power of AgeOS agentic ERP infrastructure.”** Traducción: **“Construya su agencia con el poder de la infraestructura agéntica ERP de AgeOS.”** La prueba del producto será una operación coherente desde el trabajo hasta su resultado, no una animación de agentes ni una lista de logos.

Tres pilares, visibles en la entrada y demostrables dentro del producto:

1. **Build your agency / Construya su agencia:** configurar el negocio, las conexiones y su identidad.
2. **Activate your workspace / Active su espacio:** validar y publicar una configuración, con todos los módulos disponibles.
3. **Operate with confidence / Opere con control:** consultar y gestionar trabajos, campañas, planes y finanzas desde las pantallas o los casos soportados del asistente; atender excepciones, aprobar cambios y ver resultados sustentados en registros comunes. En esta demo tanto el recorrido conversacional como las autorizaciones, cálculos, aprobaciones y escrituras son deterministas; no atribuir comprensión general o inferencia real al guion.

El alcance completo de producto mantiene **9 módulos / 42 skills**. La selección de una agencia modifica qué utiliza y ve inicialmente; nunca apaga aislamiento, auditoría, permisos, validación financiera, cuotas o comprobaciones de aprobación. Una capacidad desactivada sigue visible en el catálogo, con motivo, dependencias y la acción para configurarla.

## 2. Una base visual; familias de pantallas reutilizables

Usar el template ReUI y las referencias comprobadas en el documento ReUI del paquete. Mantener su lenguaje, componentes y tokens originales. No combinar tres templates completos, inventar componentes con nombres de ReUI ni reinterpretar su sistema de espaciado, estados o animación.

Las rutas no equivalen a pantallas hechas desde cero. Construir estas familias y reutilizarlas:

| Familia | Uso | Anatomía |
|---|---|---|
| `landing` | Entrada a la demo | Promesa, tres pilares, CTA principal, alcance y etiqueta de demostración. |
| `control-list` | Agencias y activaciones | Cabecera, búsqueda, estado, tabla, acción contextual. |
| `setup-wizard` | Configuración inicial y revisión | Pasos, formulario principal, resumen lateral y guardado de borrador. |
| `workspace-home` | Inicio de la agencia | Indicadores calculados, bandeja de atención y trabajos recientes. |
| `module-desk` | Nueve módulos | Cabecera, vistas guardadas, filtros, tabla principal, acciones y capacidades relacionadas. |
| `record-detail` | Trabajo, cliente, plan, orden, factura | Identidad, estado, relaciones, tabs, acciones autorizadas y evidencia. |
| `workflow-workbench` | Las 42 skills | Entrada tipada → validación → resultado/versiones → aprobación/ejecución cuando corresponda. |
| `approval-detail` | Decidir cambios | Diferencias, motivo, impacto, evidencia y botones de decisión. |
| `run-detail` | Ejecución y diagnóstico | Pasos con estado real, resultados, bloqueos y siguiente acción. |
| `settings-form` | Marca, equipo, conexiones, dominio, límites | Formulario, ayuda, permisos y revisión antes de publicar. |
| `file-library` | Documentos privados | Tabla, carga, metadatos, relaciones, vista previa y estado de análisis. |
| `report` | Rentabilidad y gerencia | Filtros, definiciones, tabla de resultados y desglose a registros. |
| `platform-ops` | Administración de AgeOS | Incidentes, trazas y propuestas de cambio. Acceso separado de la agencia. |
| `assistant-conversation` | Orquestador en página completa y panel global | Historial, contexto, composer, resultados enlazados, aclaraciones y propuestas de acción. Ambas superficies comparten conversación y backend. |

Los indicadores en tarjetas y las tablas en el contenedor que prescriba ReUI son regiones separadas. No anidar frames y cards porque ambos parezcan decorativos. No tomar los totales de ejemplo del template: toda cifra operativa viene de los servicios canónicos del chasis.

Referencias verificadas por MCP para implementar esas familias: `onboarding-1` para wizard; `solution-agents-5` para bandeja de aprobaciones; `solution-files-1` para biblioteca; `solution-dev-ops-6` para conexiones; `solution-agents-4` para matriz de acceso; `agent-activity-1` para consola de ejecución; `data-grid-advanced-1` para medios, `data-grid-advanced-2` para P&L y `data-grid-advanced-3` para revisión de objetivos. El documento `04-reui-seleccion-e-instalacion.md` fija URLs, dependencias, estilo y limitaciones. Adaptar los seis pasos del ejemplo de onboarding a los cinco pasos definidos aquí; sustituir sus timers por resultados del servidor.

## 3. Tres contextos de navegación

### 3.1 Control de AgeOS

Rutas `/control/*`. Sirve para crear una agencia, continuar un borrador y revisar una activación. Marca AgeOS. Selector de agencia y perfil de usuario visibles. Botón `Open workspace / Abrir aplicación` únicamente para una agencia lista y autorizada.

### 3.2 Aplicación de la agencia

Rutas `/a/:agencySlug/*`. Ejemplo: `/a/rayo-de-sol`. Nombre de agencia **Rayo de Sol**; nombre de aplicación **Estudio Solar**. Mostrar ambos en la configuración; en la operación domina el nombre de la aplicación. El hostname o el slug ayudan a resolver la presentación, pero la autorización del servidor determina el acceso.

Sidebar agrupada, sin convertir 42 skills en 42 entradas:

| Grupo EN / ES | Entradas |
|---|---|
| **Workspace / Espacio** | Overview / Resumen; Assistant / Asistente; Inbox / Pendientes; Jobs / Trabajos. |
| **Operations / Operación** | Clients & contracts; Work & production; Media planning; Media buying. |
| **Finance / Finanzas** | Suppliers & payments; Billing & collections; Accounting & close; Profitability. |
| **Manage / Administrar** | Agency setup; Connections; Library; Settings. |

`Agency setup` es el módulo 01 Arranque. Los otros ocho aparecen en Operations y Finance. La biblioteca, conexiones y asistente son superficies compartidas del ERP, no nuevos módulos. `All capabilities / Todas las capacidades` abre el catálogo de 42 con nueve grupos y la cobertura de activación. Cada módulo tiene su propio acceso al catálogo ya filtrado. El sidebar tiene 17 entradas, contando el catálogo. Assistant navega a `/a/:agencySlug/assistant`; no se implementa como un menú sin destino.

Cabecera: breadcrumb, búsqueda autorizada, botón `Ask AgeOS / Consultar a AgeOS`, `Demo environment / Entorno de demostración`, idioma, perfil y acceso a ayuda. Ask AgeOS abre el panel derecho sin abandonar la pantalla; el sidebar abre la página completa del mismo asistente. Mostrar la marca de la agencia sin eliminar la etiqueta de demo. El selector de entorno/persona es una herramienta de presentación autorizada, no una opción de impersonación general de usuarios.

### 3.3 Operación de la plataforma

Rutas `/ops/*`, con rol platform operator o platform admin según acción. El operador investiga y propone; un administrador distinto aprueba el cambio. No aparecen en el menú ordinario de la agencia. La sesión de un propietario de agencia no concede estos roles. Reutilizar el mismo lenguaje visual, con distintivo `AgeOS platform operations` y datos mínimos por agencia.

La demo debe implementar un circuito mínimo completo: anomalía técnica sintética → evidencia → propuesta de cambio seguro de configuración local → aprobación de administrador de plataforma → aplicación local → verificación y auditoría. No crear un PR remoto, arreglar infraestructura ni presentar un agente autónomo real como resultado de un timer. El circuito local es obligatorio para completar el chasis. Una propuesta de código descargable es opcional y no sustituye ese recorrido.

Incidente obligatorio `ops_csv_delimiter_mismatch`: el archivo sintético `demo-media-orders.csv` tiene seis columnas separadas por `;`, mientras que su perfil demo `import_profile_demo_media_orders` usa `,`. La primera lectura produce una columna y el validador espera seis. El investigador muestra archivo/hash, versión de perfil, seis nombres esperados y resultado real de una columna. Propone cambiar únicamente el campo tipado `delimiter` de ese perfil demo, de `,` a `;`; un administrador de plataforma distinto del solicitante aprueba esa revisión exacta. El backend publica la revisión, vuelve a analizar el mismo archivo y comprueba seis columnas con los nombres previstos. Guarda evento y resultado verificable. No importa órdenes, no modifica registros de negocio y no permite editar configuración global arbitraria. La corrección no es un mecanismo para reintentar pagos de resultado incierto.

### 3.4 Assistant: un orquestador, página y panel

La entrada **Assistant / Asistente**, icono [MessagesSquare](https://lucide.dev/icons/messages-square), abre `/a/:agencySlug/assistant`. Implementar su `page.tsx` en el árbol Next.js de la aplicación (por ejemplo `app/a/[agencySlug]/assistant/page.tsx`, relativo al proyecto Next.js). El botón de cabecera y las acciones contextuales abren un panel lateral derecho sobre cualquier pantalla de agencia. La página y el panel usan el mismo componente de conversación, thread, orquestador y servicios; no crear dos agentes ni duplicar ejecuciones.

El punto de entrada es el orquestador asociado a **`agency-orchestrator`**, con un driver de demo determinista que enruta a los procedimientos y especialistas existentes según caso, skill y configuración. El catálogo conserva nueve módulos y 42 capacidades; el chat presenta los casos y acciones soportados, sin prometer interpretar cualquier instrucción. No añade una skill número 43. La página completa da espacio a conversaciones largas; el panel conserva la pantalla de trabajo mientras se conversa.

**Composición:** usar [ai-chat-6 — Agentic Task Panel](https://reui.io/preview/base/ai-chat-6?ref=mcp) para conversación, composer y controles de acciones. Tomar de [app-shell-18](https://reui.io/preview/base/app-shell-18?ref=mcp) únicamente el patrón acoplado de escritorio y Sheet móvil; conservar el shell Verve. [agent-activity-1](https://reui.io/preview/base/agent-activity-1?ref=mcp) sigue siendo la consola de ejecución/auditoría, no el chat.

**Persistencia y contexto:** montar el estado de conversación en el layout de agencia, no en cada página. Persistir mensajes, referencias autorizadas, propuestas y eventos de ejecución en servidor con agencia, usuario y permisos. Navegar entre módulos conserva thread, borrador y ejecuciones. Al abrir la página completa, ocultar el panel duplicado; volver al trabajo restaura la misma conversación. Cambiar de agencia selecciona contexto e hilos de esa agencia, descarta asociaciones locales previas y nunca copia mensajes o archivos entre tenants. Cerrar el panel no cancela una acción ya confirmada; cancelar un envío o ejecución necesita una acción y resultado explícitos.

La cabecera del asistente muestra agencia, módulo/registro en contexto, etiqueta `Scripted demo / Demo guionizada` y un control para retirar o cambiar el contexto. Contexto de pantalla es una referencia tipada que el servidor vuelve a autorizar; no DOM completo. `New conversation`, historial, adjuntar archivo autorizado, abrir página completa/volver al trabajo y cerrar tienen comportamiento real.

**Consultas:** ofrecer preguntas sugeridas en inglés y español sobre clientes, trabajos, planes, campañas, documentos y finanzas según el catálogo de casos. Presets y aliases declarativos seleccionan una consulta tipada, con parámetros validados; una entrada no soportada muestra opciones en vez de inventar una respuesta. Las cifras se consultan en el modelo canónico mediante servicios autorizados y definiciones semánticas, con moneda, periodo y fuente. No exponer el esquema físico, SQL arbitrario, secretos o datos fuera de permisos. Respuestas de plantilla enlazan registros y muestran fecha/base de cálculo usando variables obtenidas del servidor.

**Acciones:** los presets o aliases soportados, como “crea un trabajo”, “prepara este plan” o “ajusta esta campaña”, seleccionan un caso declarativo; el driver solicita parámetros faltantes y devuelve una propuesta tipada con diff, impacto, dependencias y siguiente paso. Confirmación del usuario, aprobación empresarial y permiso de ejecución son controles distintos. El backend revalida revisión, permisos y política antes de escribir. Las tarjetas muestran borrador, pendiente de aprobación, ejecutado, bloqueado o resultado incierto con evidencia y enlaces reales. La conversación jamás concede un rol, evita autoaprobación ni aprueba silenciosamente una nueva revisión.

**Driver determinista y estados:** construir primero el chasis, la página, el panel, la persistencia y los contratos del orquestador. Después ejecutar la instrucción 2 de demo E2E: [08-instruccion-2-demo-e2e.md](./08-instruccion-2-demo-e2e.md), [PROMPT-2-DEMO-E2E.txt](./PROMPT-2-DEMO-E2E.txt) y [demo-scenarios-v1.json](./demo-scenarios-v1.json). Centralizar ahí casos, presets, aliases, parámetros, preguntas y plantillas de respuesta; no dispersar handlers improvisados dentro de los bloques ReUI. No requerir LLM, claves ni red de modelos. Son válidos guiones hardcodeados que llaman servicios reales y muestran sus resultados. No son válidos cifras o estados fingidos, botones sin efecto ni timers que anuncien éxito. Añadir estados ready, entrada no soportada, validación, ejecución, espera de datos/aprobación, error, resultado incierto y contexto obsoleto. No mostrar razonamiento, selector de modelos o voz inexistentes.

**UX adaptable:** panel acoplado a la derecha en escritorio con anchura que preserve el trabajo; Sheet accesible en móvil y anchos insuficientes. Altura limitada por el shell, historial con scroll propio, composer visible, salto al mensaje más reciente y foco restaurado al cerrar. En página completa, usar la misma conversación con anchura disponible y sin panel duplicado. El historial no debe saltar al final cuando el humano está leyendo mensajes anteriores. Adjuntos y fuentes permanecen sujetos a autorización en cada acceso.

**Pruebas obligatorias:** tras completar el chasis, aplicar los casos de instrucción 2 para consultar el margen Aurora con resultado reconciliable; crear un borrador de trabajo con parámetros faltantes; proponer una revisión de plan y completar la aprobación por actor distinto; navegar página → panel → otro módulo sin duplicar mensajes/acciones; refrescar y recuperar historial; cambiar de agencia sin filtración; bloquear una acción no permitida; devolver opciones ante una entrada no soportada y ejecutar presets/aliases en EN/ES sin LLM ni credenciales. Se conservan nueve módulos y 42 skills, y el inventario contiene **31 patrones de ruta** por la página Assistant.

## 4. Normas transversales de interacción

### Navegación, tablas y detalles

- Todas las acciones principales producen navegación, un cambio persistido, un archivo real, una validación visible o un resultado explícito. No dejar botones decorativos, links `#` ni acciones que respondan solamente con un toast genérico.
- Filtros, búsqueda, orden, paginación, tab y registro seleccionado deben poder restaurarse al volver. Usar URL para el estado compartible; no incluir secretos, datos de documentos ni cadenas de búsqueda sensibles en enlaces externos.
- Filas enlazan al detalle. Usar drawer para previsualizar y `Open full record / Abrir registro` para un enlace estable. El historial del navegador debe funcionar con ambos.
- Páginas y tabs deben existir al recargar o abrir un enlace directo. La ruta del trabajo debe admitir `?tab=overview|scope|production|media|finance|files|activity`.
- Campos de dinero muestran moneda; fechas muestran zona de referencia; porcentajes incluyen definición en ayuda. No sumar monedas distintas sin una conversión explícita y versionada.
- Selección de filas no equivale a autorización para ejecutar en lote. Mostrar preview y resultados por fila; no aplicar un estado de éxito global a un lote parcialmente fallido.

### Formularios y versiones

- `Save draft / Guardar borrador` conserva datos en el servidor y muestra hora/versión. Al salir con cambios sin guardar, ofrecer `Save`, `Discard` y `Stay`.
- Validar campo y formulario; llevar foco al primer error. Preservar valores al fallar. Guardar borradores incompletos cuando el contrato lo permita; bloquear la publicación inválida.
- Usar control de versión optimista. Ante conflicto: `This record changed`, resumen de diferencias, `Reload latest` y oportunidad de recuperar los cambios propios. No sobrescribir otra revisión silenciosamente.
- `Approve` muestra persona, motivo opcional/obligatorio según política, payload exacto, versión, importe, moneda, cuenta y consecuencias. Un cambio material invalida la aprobación anterior.
- Acciones con efecto financiero requieren confirmación específica dentro del producto. Las validaciones y prohibición de autoaprobación pertenecen al servidor, aunque el botón esté oculto.

### Estados obligatorios

| Estado | Comportamiento |
|---|---|
| Loading | Skeleton de la misma estructura; conservar contexto. No inventar cifras mientras carga. |
| Empty, agencia nueva | Explicar qué se necesita y un CTA autorizado, por ejemplo `Create first job`. |
| No results | Mostrar filtros activos y `Clear filters`; no confundir con falta de permisos. |
| Error recuperable | Motivo legible, referencia de incidente y `Retry` idempotente cuando sea seguro. |
| Blocked por regla | Regla incumplida, registro/campo causante y acción correctiva. |
| Waiting approval | Responsable, revisión y botón para abrir la aprobación; no spinner infinito. |
| Unknown external result | Mostrar que no se sabe si el proveedor ejecutó; permitir conciliación, bloquear reenvío ciego. |
| Forbidden / not found | No filtrar nombres, importes o existencia de registros de otra agencia. |
| Partial result | Resultados confirmados y pendientes separados. |
| Stale source | Fecha, fuente y efecto: se puede consultar, pero una acción que exige frescura queda bloqueada. |

### Inglés y español

Strings mediante diccionarios; no duplicar páginas. Recordar idioma por usuario. Cambiarlo conserva URL, estado, permisos y borrador. `en-US` inicial, opción `es`. Formatear números/fechas según idioma y moneda del registro. Nombres, IDs, contenido de archivos y códigos de skills no se traducen automáticamente. Completar todos los mensajes de validación, vacíos, menús, estados y textos de la demo en ambos idiomas.

## 5. Entrada y configuración: construir la agencia

### P01 — `/`: entrada

Hero con la promesa y CTA `Build my demo agency / Crear mi agencia demo`; secundario `Explore the configured agency / Explorar agencia configurada`. Una franja aclara: `Executable demo · Sample data · External integrations simulated`. Tres bloques sencillos representan construir, activar y operar. No incluir logos de clientes, cifras de tracción, ahorros o tiempos de activación sin evidencia real. La palabra infraestructura está en la promesa; el usuario no necesita ver nombres de servicios cloud para completar el recorrido.

El CTA principal autentica según el contrato del chasis y crea/retoma un borrador persistido. El secundario abre el fixture autorizado de presentación. Nunca crea una sesión de administrador desde un parámetro en la URL.

### P02 — `/control/agencies`: lista

Agencia, aplicación, configuración publicada, estado y dirección de demo. `New agency`, `Resume setup`, `View activation` y `Open workspace` son acciones distintas según estado. Crear agencia no duplica una ya creada al refrescar o repetir la solicitud.

### P03 — `/control/setup/:draftId/:step`: wizard de cinco pasos

Pasos EN: **Agency → Operations → Connections → Brand & access → Review**. Mostrar progreso y borrador guardado, con `Back`, `Save draft`, `Continue`. Guardar el resultado del paso antes de avanzar. El usuario puede volver y editar; los pasos dependientes conservan lo válido y señalan lo que debe revisarse.

| Paso | Controles | Efecto real y validación |
|---|---|---|
| Agency | Nombre, nombre de app, país/entidad de ejemplo, moneda base, zona horaria, servicios; opción `Use a sample agency` | Guarda configuración. Región LATAM/US/CAN es segmentación comercial, no jurisdicción fiscal. Elegir país concreto para reglas de ejemplo. No representar fiscalidad válida para toda LATAM. |
| Operations | Servicios ofrecidos, tipo de fee, presupuesto, responsables y aprobaciones; perfiles `Full-service`, `Media`, `Production` | El perfil prellena una configuración editable. El catálogo siempre incluye nueve módulos/42 skills. Mostrar dependencias antes de desactivar procesos; controles obligatorios permanecen activos. |
| Connections | Catálogo por área, búsqueda, cuenta simulada, alcance, clientes/jobs autorizados; opción `Start with files` | Crear conexión demo con tenant/cuenta/scopes reales dentro del chasis. Sin OAuth real ni tokens. Una cuenta no se comparte automáticamente entre agencias. Mostrar faltantes y modo manual por flujo. |
| Brand & access | Logo, color permitido, app slug, miembros de ejemplo/roles, dirección de demo y opción dominio propio | Vista previa inmediata, guardado real. Validar slug único, contraste según tokens, MIME/tamaño de logo. Invitaciones de correo y DNS se simulan explícitamente. Dominio mostrado como `estudio.rayodesol.example`, sin abrirlo como sitio activo. |
| Review | Resumen de procesos, 42 disponibles, activos/dependencias, conexiones, roles, límites demo y marca; enlaces `Edit` por sección | Ejecuta validación de configuración; bloqueos tienen enlace a solución. Muestra exactamente qué se publicará y la nueva versión. CTA `Deploy demo agency / Desplegar agencia demo`. |

Un cuadro opcional `Describe your agency` puede guardar una descripción y aplicar un perfil predefinido mediante reglas deterministas visibles. No mostrar texto generado ni un “AI architect” si no existe inferencia real. Si se ofrece, titularlo `Guided setup / Configuración guiada` y explicar qué campos cambió.

### P04 — `/control/activations/:runId`: activación

Pasos derivados del backend: validar → crear/recuperar espacio lógico → aplicar roles → publicar configuración → preparar referencias de almacenamiento → habilitar capacidades → comprobar acceso → listo. Cada paso conserva inicio/fin, resultado y error. No simular infraestructura cloud mediante porcentajes arbitrarios.

Se puede recargar y continuar sin crear dos agencias. `Retry failed step` reanuda el punto autorizado. Si falta una autorización, estado `Waiting for setup` y acción a conexiones. La activación puede terminar con dominio simulado pendiente: `Workspace ready · Custom domain simulation pending`.

Resultado: nombre Estudio Solar, enlace real de demo `/a/rayo-de-sol`, configuración publicada y botones `Open workspace` / `Review configuration`. Copia debajo: `Your demo workspace is active. No external account, domain or paid infrastructure was provisioned by this action.`

## 6. Inicio de agencia y expediente del trabajo

### P05 — Resumen

Una cabecera útil: `Good morning, ...` no es requisito; priorizar `Estudio Solar` y fecha de corte. Tarjetas: trabajos activos, aprobaciones pendientes, facturación pendiente y margen proyectado, siempre con definiciones y navegación al conjunto que las compone. Debe existir la opción de ver números en privacidad durante una presentación.

Centro: `Needs attention / Requiere atención`, ordenado por riesgo y vencimiento. Cada fila tiene trabajo, excepción, efecto, responsable y CTA específico, por ejemplo `Review scope change`. A la derecha o debajo, actividad reciente y ejecuciones pausadas. No convertir el home en una pared de gráficos.

### P06 — Inbox

Tabs `For me`, `Approvals`, `Blocked`, `All`. Filtros por módulo/job/responsable. Abrir un ítem abre la evidencia, no una conversación vacía. `Assign` guarda asignación; `Snooze` exige fecha y no borra el bloqueo; `Resolve` solo se habilita cuando el servicio confirma la condición resuelta. Un ítem puede cerrarse automáticamente tras su acción causal, con evento de auditoría.

### P07 — Jobs

Data grid: JobNumber, referencia amigable, nombre, cliente, dueño, etapa, presupuesto/fee, margen proyectado, próxima acción y actualización. Tabla y detalle usan la misma consulta. `New job` abre formulario de cliente/alcance/servicio/fee y genera JobNumber en servidor. `Import` tiene preview/validación, sin importación externa real.

Fixture: ID `job_demo_aurora`; JobNumber canónico `AURSL7AF0001`; referencia humana `RDS-2027-001`; nombre **Aurora Spring Launch**. No confundir los dos identificadores.

### P08 — Job dossier

Cabecera: nombre, cliente, JobNumber, estado, owner y acciones permitidas. Banda breve con fee propio, gasto de medios administrado, costo propio proyectado y margen proyectado. Marcar explícitamente `Forecast` o `Recognized`; el forecast no se presenta como resultado contable real.

| Tab | Contenido y acciones |
|---|---|
| Overview | Próximo paso, bloqueos, relaciones y resumen de alcance; enlaces a documentos de origen. |
| Scope & budget | Versiones del contrato/PO/fee, presupuesto, reservado/disponible, cambios y comparación. `Propose change`, `Request approval`. |
| Production | Tareas, horas, estimaciones, órdenes y entregables. `Log time`, `Submit timesheet`, `Review asset`. |
| Media | Planes, líneas, audiencia/specs con fuente y fecha, órdenes/campañas y conciliación. `Open plan`, `Run preflight`. |
| Finance | Facturas de proveedor/cliente, cobros/pagos, compromisos, costos y vínculos a asientos. Separación inequívoca por estado. |
| Files | Documentos relacionados, versión, autoría, permisos, estado de análisis y carga. |
| Activity | Eventos inmutables, actor, hora, acción, versión, aprobación y run relacionado; vista de detalles redaccionada según rol. |

Las relaciones deben ser navegables en ambos sentidos. Una factura enlaza a job/orden/entrega; volver conserva tab y filtros. Las acciones no copian datos a una segunda representación incompatible.

## 7. Superficie común de las 42 capacidades

Ruta común `/a/:agencySlug/modules/:moduleKey/workflows/:skillId`. Mostrar el nombre de negocio; código `agency-*` en detalles avanzados, no como título principal. Reutilizar `workflow-workbench` con estas regiones:

1. **Context:** job/cliente/período/entidad según contrato. Resolver agencia desde sesión; nunca editable como texto libre.
2. **Inputs:** formulario tipado, fuentes o archivos elegidos, revisiones e información faltante.
3. **Validate:** resultado por regla y cálculos con desglose. La validación no equivale a ejecución.
4. **Output:** entregable persistido y versionado; filas/documentos/tablas según skill. Enlace a cada input/evidencia y al expediente.
5. **Next action:** guardar borrador, solicitar aprobación, ejecutar acción autorizada o descargar. Separar estas acciones visual y semánticamente.

Cada skill debe satisfacer su entrada/salida original en `agency-erp-matriz-42-skills.json`. Las siguientes tablas definen su experiencia mínima; no reemplazan el contrato ni autorizan omitir outputs. Un output no aplicable se conserva vacío con razón explícita. No completar outputs con prosa inventada. Toda capacidad tiene al menos un fixture válido, un bloqueo reproducible y un resultado persistido; un formulario genérico que solo cambia su título no constituye cobertura.

### M01 — Agency setup / Arranque — 4 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-orchestrator` | Seleccionar job y `Check next steps` | Dependencias, estado, bloqueos y próximos pasos reales; `Resume` continúa checkpoint sin repetir acciones. |
| `agency-integrations` | Elegir conexión/cuenta, permisos y flujo; `Check coverage` | Matriz de capacidades disponibles/faltantes, conexión exacta y modo archivos. Revocar una conexión bloquea solo sus acciones. |
| `agency-access-governance` | Perfil de miembro, acciones, límites y propuesta de rol | Conflictos de funciones, matriz de acceso y diff revisable. Probar que operador no aprueba su propio cambio financiero. |
| `agency-master-data` | Crear/importar cliente, proveedor o cuenta; revisar duplicados | Cambio de maestro validado, IDs externos y propuesta de coincidencia; no fusionar automáticamente dos entidades distintas. |

Desk con tabs `Configuration`, `Capabilities`, `Team & policy`, `Master data`. Mostrar versión publicada y borrador separados. `Publish configuration` requiere diff y revisión; no edita retroactivamente aprobaciones de jobs abiertos.

### M02 — Clients & contracts / Clientes y contratos — 6 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-onboarding` | Cliente/brand/contactos y brief; `Create client intake` | Cliente y brief persistidos, requisitos pendientes, referencias de facturación y siguiente paso. |
| `agency-job-lifecycle` | Alcance/cliente/servicio; `Open job` o `Request close` | JobNumber y expediente; cierre bloqueado si faltan documentos/compromisos/conciliación. |
| `agency-contract-po` | Contrato/PO, límite, vigencia y requisitos | Registro versionado y saldo utilizable; enlace a evidencia; importe superior al PO produce bloqueo. |
| `agency-budget-control` | Presupuesto y propuesta de reserva | Desglose aprobado/comprometido/disponible, resultado transaccional y motivo si no hay saldo. |
| `agency-fee-contracts` | Fee fijo o tarifa/horas aprobadas | Cálculo de honorarios, alcance y revisión; no factura horas rechazadas. |
| `agency-billing-requirements` | Reglas de cliente y documentos del job | Checklist de expediente completo/incompleto; `Prepare invoice` solo con requisitos válidos. |

Desk: clientes y contratos mediante tabs. Detalle de cliente: overview, jobs, contracts, invoices, files. Crear un cliente debe hacerlo seleccionable en New job tras guardar.

### M03 — Work & production / Trabajo y producción — 3 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-tasks-timesheets` | Tarea, fecha, horas, persona, costo y job | Hoja enviada/aprobada/rechazada; valoración; bloqueo de duplicados y horas rechazadas fuera del facturable. |
| `agency-production-estimating` | Partidas, cotizaciones, tarifas y asignaciones | Estimación comparada/versionada y propuesta de orden; modificación invalida revisión aprobada. |
| `agency-production` | Entregable, archivo/versión, fecha, derechos y QA | Calendario de entregables, checklist de calidad/derechos y liberación autorizada o bloqueo. |

Desk: tabla de tareas, timesheets y entregables. Una vista de tablero usa los mismos registros; arrastrar solo realiza transiciones válidas, con confirmación cuando afecte aprobación. No dedicar tiempo a un Gantt propio para esta demo.

### M04 — Media planning / Planificación de medios — 6 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-media-ranking` | Audiencia/objetivo, mercados, fuentes y tarifas | Ranking reproducible con manifest de datos; incompatible o faltante queda señalado, sin inventar ratings. |
| `agency-media-planning` | Líneas, fechas, inversión, moneda y objetivo | Plan y totales; calendario; revisión que puede enviarse a aprobación. |
| `agency-tv-radio-planning` | Spots, estaciones, franjas, duración y material | Pauta y tráfico; validación de zona horaria, duración y fuente. Datos de audiencia de demo rotulados sintéticos. |
| `agency-ooh-planning` | Sitio, cara/pantalla, vigencia, tarifa y evidencia | Disponibilidad/reserva de ejemplo, costo y requerimiento de proof-of-play/foto según soporte. |
| `agency-digital-planning` | Plataforma/cuenta, objetivo, targeting, conversiones y specs | Plan digital/taxonomía y preflight de compatibilidad; metas no se presentan como resultados garantizados. |
| `agency-plan-changes` | Editar revisión de plan; `Compare revisions` | Diff de líneas/importe/órdenes afectadas y nueva aprobación; la anterior pierde validez para el cambio. |

Desk: planes y fuentes. El editor de plan es una tabla de líneas con totales calculados; clic abre detalle de línea. Audiencias y specs muestran fuente, fecha, alcance/licencia y estado sintético. `Send to buying` conserva IDs y revisión exacta del plan aprobado.

### M05 — Media buying / Compra de medios — 6 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-rate-cards-contracts` | Tarifario, vigencia y descuentos | Tarifa aplicada explicable, saldo y alerta de vencimiento. |
| `agency-media-buying` | Línea aprobada, proveedor/cuenta y orden | Orden versionada con compromiso y recibo simulado separado del evento interno. |
| `agency-campaign-activation` | Campaña preparada, cuenta, creativos y revisión | Preflight y estado de activación simulado; falta de aprobación/scopes/rights bloquea. |
| `agency-campaign-optimization` | Resultados de fixture y umbral aprobado | Diagnóstico numérico, propuesta de cambio y límites; con fuente vencida bloquea incremento. |
| `agency-transmission-control` | Orden y registros de transmisión/proof-of-play | Conciliación con faltantes/duplicados y propuesta de compensación. |
| `agency-ooh-inventory` | Cara/pantalla, ubicación y rango de fechas | Inventario y reservas; una segunda reserva solapada del mismo recurso falla. |

Desk: órdenes/campañas, delivery y OOH inventory. Etiqueta `Simulated account` junto al nombre de cuenta. `Activate` abre revisión; `Simulate activation` es el CTA que ejecuta el adaptador de demo. El resultado nunca dice “Live on Meta”.

### M06 — Suppliers & payments / Proveedores y pagos — 5 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-delivery-reconciliation` | Orden, entrega e invoice de proveedor | Cruce de tres vías, diferencias y bloqueo/conciliación por línea. |
| `agency-payables` | Factura, proveedor, entidad, número y job | Cuenta por pagar, resultado de duplicado y propuesta de registro. |
| `agency-payment-run` | Vencimientos, cuenta demo y beneficiarios | Lote revisable con monto/moneda exactos, aprobación independiente y recibos simulados. |
| `agency-cash-settlement` | Estado de cuenta/cobro, comisiones y referencias | Aplicaciones y caja sin asignar; repetir importación/evento no duplica saldo. |
| `agency-expenses` | Comprobante, concepto, importe y asignación | Rendición validada, documentos pendientes y revisión humana cuando extracción es incierta. |

Desk: proveedores, bills, payment runs, expenses y reconciliation. `Record demo payment` mueve el estado contable interno de demo según contrato; no presenta transferencia bancaria real. Una factura pagada no suma el costo por segunda vez.

### M07 — Billing & collections / Facturación y cobranza — 4 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-client-billing` | Job/alcance, requisitos, líneas de fee y pass-through | Borrador comercial, PDF de demo, revisión y número de documento interno. Separar fee propio de medios trasladados al cliente. |
| `agency-collections` | Factura, vencimiento, pago parcial y referencia | Saldo/aging, aplicación y recordatorio borrador; sin envío externo. |
| `agency-rebates` | Contrato/tramos y partidas elegibles | Cálculo reproducible, exclusiones y propuesta de provisión/abono. |
| `agency-tax-compliance` | País/entidad, reglas de fixture y expediente | Checklist, exportación preparatoria y razón de bloqueo. Nunca generar un folio fiscal supuestamente autorizado. |

Desk: invoices, collections, rebates y compliance. Los documentos exportados llevan `DEMO — NOT A TAX INVOICE` / `DEMO — NO ES FACTURA FISCAL`. Un país sin adaptador real no se muestra como “compliant”; permite preparación documentada.

### M08 — Accounting & close / Contabilidad y cierre — 4 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-general-ledger` | Asiento, cuentas, periodo, moneda y origen | Debe/haber, validación de mapeo y posteo en libro interno de demo. Desbalance bloquea. |
| `agency-accruals-revaluation` | Provisión o moneda/FX/fecha aprobada | Cálculo y asiento/reversión propuestos; periodo cerrado bloquea cambios. |
| `agency-fixed-assets` | Costo, residual, vida útil y fecha | Registro y calendario calculado, depreciación por periodo y asiento revisable. |
| `agency-period-close` | Periodo y sublibros | Checklist con bloqueos navegables, cierre interno de demo y auditoría; sin afirmar cierre en QuickBooks/Xero. |

Desk: ledger, accruals, assets y close. Se permite reabrir solo al rol/política correspondiente, con motivo y evento; no un toggle de frontend. El mes del fixture se selecciona explícitamente.

### M09 — Profitability / Rentabilidad — 4 skills

| Skill | Entrada/acción visible | Resultado mínimo visible |
|---|---|---|
| `agency-profitability` | Job/cliente/periodo, base forecast o reconocido | Ingreso propio, costo propio y margen con desglose a fuentes; medios administrados separados. |
| `agency-revenue-budget` | Escenario, partidas y versión | Plan vs real comparable, diff de revisiones y asignaciones. |
| `agency-cash-forecast` | Vencimientos/fechas esperadas, escenarios y FX | Caja confirmada/probable/sin fecha, desglose y supuestos visibles. |
| `agency-management-reporting` | Periodo, entidades y métricas permitidas | Reporte persistido con corte, definiciones, fuentes, totales conciliados y exportación. |

Desk: margen por job/cliente, revenue budget, cash forecast y management pack. Consulta destacada `Which jobs are losing projected margin?` ejecuta una consulta nombrada, parametrizada y de solo lectura. Cambiar filtros recalcula sobre los mismos datos que el dossier. No se utiliza SQL libre escrito en el navegador.

## 8. Aprobación y ejecución: evidencia, decisión, resultado

### Aprobación

`/a/:agencySlug/approvals/:approvalId` muestra título de acción, estado, solicitante, responsables válidos y vencimiento si aplica. Dos columnas para revisión anterior/propuesta o una tabla diff accesible. Debajo: impacto financiero, cuenta/entidad, documentos y reglas comprobadas.

Botones: `Approve exact change`, `Request changes`, `Reject`. El solicitante ve la solicitud pero no puede autoaprobar cuando la política exige otra persona. `Request changes` guarda comentario y retorna a edición; `Reject` requiere motivo. Si la revisión quedó vieja, mostrar `Approval outdated` y permitir abrir la nueva propuesta, nunca aprobar el payload anterior para el nuevo importe.

### Ejecución

`/a/:agencySlug/runs/:runId`: título de negocio, job, revisión, actor, modo `Deterministic demo`, inicio/fin y resultado. Pasos `queued`, `executing`, `awaiting_approval`, `blocked`, `succeeded`, `failed` y `outcome_unknown` se alimentan de eventos persistidos. La UI no controla el reloj de ejecución ni crea resultados. Los estados del contrato determinista prevalecen; traducir sus etiquetas sin cambiar sus códigos.

Cada paso muestra inputs autorizados, comprobación, output y comprobante. `View source`, `Open approval`, `Retry safe step`, `Reconcile result` y `Open record` deben llevar a una acción útil. No animar pensamiento privado ni mostrar razonamiento inventado. Puede mostrarse la explicación de una regla: “Fee revision changed; previous approval is no longer valid.”

El chasis y su asistente de demostración funcionan sin una API de modelos. La página y el panel comparten el driver determinista y los contratos del ERP. Presentar preguntas guardadas como `Explore your operation`, presets y filtros. Si se permite texto libre y no corresponde a un alias o consulta soportada, responder con las opciones disponibles. Los guiones se centralizan en la instrucción 2 y sus casos E2E, sin cifras decorativas ni respuestas de estado independientes del servidor.

## 9. Conexiones, biblioteca, marca, planes y administración

### Connections

Catálogo con los proveedores del documento de conexiones, agrupados por uso. Cada tarjeta indica `Simulated`, `File workflow` o `Not configured`. Conectar abre diálogo con cuenta de ejemplo, permisos requeridos y procesos que los usan; guardar genera una vinculación persistida. No pedir credenciales reales. Probar devuelve un diagnóstico del adaptador simulado; retirar scopes o revocar deja un evento y bloquea las acciones dependientes.

Detalle: cuenta, entidad, owner, capacidad/acción, último sync simulado, filtros por cliente/job y botón `Review impact before disconnecting`. Elegir Eve, Composio o un adaptador no es una decisión obligatoria para el usuario final. En Advanced puede consultarse el transporte previsto. Un MCP nuevo se registra como propuesta revisable, sin conectarse a un endpoint arbitrario durante la demo.

### Library

Carga privada real mediante el mecanismo definido por el contrato del chasis. Admitir PDF, DOCX, XLSX y CSV bajo límites explícitos. Verificar tamaño/tipo del lado servidor, conservar nombre original seguro, versión, hash, propietario, job relacionado y estado de extracción. No hacer públicos los originales mediante enlaces de Blob sin control de acceso.

Carga → validación → guardado → metadatos → análisis disponible o pendiente. `Stored` no significa `Analyzed`. El parser que se implemente debe extraer realmente lo que anuncia; para un PDF escaneado sin OCR, mostrar `OCR not connected in demo` y permitir revisión/entrada manual. La extracción pregrabada de un fixture se identifica como tal y solo se usa para su archivo/hash conocido. No producir texto de ejemplo al cargar un archivo distinto.

CSV/XLSX: preview de columnas/filas y mapeo antes de aplicar. Un import inválido no muta datos de negocio. Exportar reportes produce archivos reales; HTML renombrado a XLSX/PDF no sirve. Controlar fórmulas peligrosas al exportar CSV. Documentos con datos de otra agencia nunca se obtienen con solo cambiar un ID.

### Branding & domains

Cambiar nombre de app, logo y color guarda un borrador; `Preview` muestra la variante, `Publish` registra una versión y actualiza la experiencia. No permitir colores ilegibles ni CSS arbitrario. El logo tiene alternativa textual.

Dominio incluido de demo apunta a la ruta real del workspace. Dominio propio usa `.example` y presenta los estados simulados `Requested → Pending DNS → Verifying → Simulated ready`. `Simulate DNS verification` avanza el estado mediante fixture, no comprueba DNS real. Compra de dominio prepara una orden demo sin cargo; no inventar precio de mercado ni registrante confirmado.

### Plan & usage

Mostrar capacidades/cuotas de ejemplo claramente rotuladas, sin precios comerciales aprobados ni cobro real. Todos los planes de ejemplo conservan los nueve módulos; cambian capacidades y límites. El uso local medido se distingue de consumo externo estimado o no medido. `Change demo plan` revisa impacto, persiste la selección y aplica los límites internos. No borrar archivos al bajar un plan; bloquear nuevas cargas si excede el cupo y explicar cómo resolverlo.

### Team, policy, audit

Roles del fixture: owner, account manager, finance approver y producer. `Invite` crea invitación de demo sin enviar correo. Mostrar `Copy demo invitation` solo cuando haya enlace interno real y restringido. Cambios de permiso se prueban después en servidor. La auditoría contiene usuario/servicio, tenant, acción, registro, revisión, timestamp, resultado y correlación con run; evitar secretos y contenido completo de documentos.

## 10. Escenario financiero que debe coincidir en todas las pantallas

Usar `aurora_scope_change` del contrato/fixtures; estos números son datos sintéticos de demostración, no una promesa comercial:

| Momento | Fee propio | Costo propio proyectado | Margen proyectado | Medios administrados |
|---|---:|---:|---:|---:|
| Alcance original | USD 20,000 | USD 11,000 | USD 9,000 · 45.0% | USD 30,000 |
| 40 horas adicionales sin ajuste de fee | USD 20,000 | USD 13,000 | USD 7,000 · 35.0% | USD 30,000 |
| Cambio de alcance de USD 3,000 aprobado | USD 23,000 | USD 13,000 | USD 10,000 · 43.5% | USD 30,000 |

Costo inicial = 100 horas × USD 50 + USD 5,500 producción + USD 500 gastos. El incremento es 40 × USD 50 = USD 2,000. El margen final proyectado exacto es 10,000/23,000; la UI redondea a 43.5%. La suma facturable del ejemplo con medios es USD 53,000; no se llama ingreso propio de la agencia a ese total.

La aprobación inicial corresponde al owner; la enmienda de USD 3,000 la aprueba finance approver, distinto del solicitante. El nuevo límite comercial de USD 53,000 exige la evidencia sintética `evidence_demo_po_r2`. Mostrar esa autorización del cliente y la aprobación interna como hechos distintos; la segunda no crea ni demuestra por sí sola la aceptación del cliente.

Fecha de incidente: 2027-03-15; período de cierre: marzo de 2027, fecha 2027-03-31. Mostrar fecha de datos demo y fecha real de la ejecución de forma separada. El costo incurrido/reconocido solo cambia tras registrar/aprobar los hechos que exige el contrato. El cierre de la demo es un segundo recorrido; no se simula que el trabajo se completó al aprobar el fee.

## 11. Recorridos de aceptación visual y funcional

1. Crear borrador de agencia → recargar → continuar → activar → abrir aplicación con su identidad. Repetir submit no duplica tenant.
2. Todos los nueve módulos son alcanzables desde la navegación; el catálogo contiene exactamente 42 skills únicas y el enlace de cada una abre su workbench correcto.
3. Crear cliente/job → guardar → abrir desde otra vista → ver el mismo dato. Editar en dos sesiones produce conflicto de revisión controlado.
4. Usar la cuenta operator para preparar cambio de alcance; su autoaprobación falla. Finance approver aprueba payload exacto; el forecast cambia de 35.0% a 43.5% y el diff/auditoría explica por qué.
5. Modificar importe después de solicitar aprobación deja la aprobación previa obsoleta. El botón y el backend impiden ejecutar con ella.
6. Cambiar de tenant en una URL directa no permite leer job, archivo, aprobación, conexión, exportación o run ajenos.
7. Revocar un scope de conexión → acción afectada bloqueada → otras operaciones siguen funcionando → restaurar scope habilita nueva verificación.
8. Cargar un archivo real → recargar → ver metadatos/descargar autorizadamente. Import inválido muestra errores y no modifica el ledger.
9. Registro de pago demo reduce deuda/caja según contrato, no duplica costo. Un mismo evento repetido no crea un segundo recibo.
10. Cierre contable con diferencia falla; al corregirla puede cerrar el libro interno demo. La UI no declara cierre externo real.
11. Cambiar idioma en wizard, job y aprobación conserva estado, valores y permisos. Todos los mensajes se traducen.
12. Revisar teclado, foco, labels, contraste del tema publicado, zoom 200%, escritorio 1440/1280 y móvil 390. En móvil, tablas permiten scroll dentro de su región y el menú no tapa decisiones.
13. Con rol platform operator, abrir `ops_csv_delimiter_mismatch`: el parser devuelve una columna en lugar de seis. Preparar el cambio tipado del delimitador del perfil demo a `;`; un platform admin distinto aprueba. Aplicar la revisión y verificar seis columnas con los nombres esperados en el mismo archivo/hash. El circuito completo queda auditado y no importa registros ni modifica configuración global; un panel estático o un preview de diseño no satisface esta prueba.

No declarar terminada una pantalla porque se ve bien: comprobar una acción válida, una regla que la bloquea, persistencia al recargar, permisos del rol y recuperación del error. Las pruebas detalladas del contrato determinista prevalecen sobre este checklist de presentación.
