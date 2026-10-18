# AgeOS — Cierre del chasis + demo completa con agentes

Actúa como líder técnico y de producto de AgeOS. Continúa construyendo la aplicación existente, corrige los hallazgos de auditoría y termina la instrucción 2. Este es un único encargo, dividido en hitos verificables. No te detengas en un plan: implementa, integra, prueba y entrega.

## 1. Ubicación, precedencia y estado real

Proyecto: /Users/andresgutierrez/Documents/Proyectos_ai/AgencyOS - ERP Agentico/claude-code-chasis-v1

Aplicación: app/. Template licenciado: inputs/reui/verve/verve-v1.1.0.

Lee CLAUDE.md y las instrucciones locales aplicables. Este encargo del usuario actualiza la dirección visual: conserva la estructura y componentes de Verve/ReUI, pero aplica el tema Vercel de tweakcn, oscuro por defecto con toggle. Si una especificación anterior exige mantener los colores/tipografía del template, prevalece esta actualización. La demo sigue siendo determinista, guionizada y sin modelos en vivo. No reduzcas los nueve módulos ni las 42 skills.

Claude ya estaba trabajando durante la auditoría del 17 de octubre de 2026. Antes de editar, revisa el estado más reciente: algunas correcciones pueden estar hechas. No reviertas trabajo nuevo ni trates cada hallazgo como una instrucción de reemplazar archivos completos. Conserva los datos y cambios locales. No resetees la base de desarrollo para correr pruebas.

Evidencia de ese corte:

- Solo existían 6 de 31 patrones de página: landing, sign-in, overview, jobs, dossier y assistant. 14 de 17 entradas del sidebar no tenían destino implementado. Los 31 son patrones: una familia dinámica puede cubrir nueve módulos o 42 workbenches; no hacen falta 42 páginas duplicadas.
- Navegador confirmó 404 desde Build my demo agency, Media planning, New job y un cliente desde búsqueda. Las siete pestañas del dossier sí cargaban.
- El asistente explicó el margen de Aurora con datos y fuentes: fee USD 20,000, costo USD 11,000, margen USD 9,000 / 45%; el historial persistió tras recargar. Su borrador se perdió al volver de página a panel y perdió la pestaña anterior del dossier.
- Había 42 contratos y 9 handlers. Los otros 33 eran pendientes legítimos de instrucción 2; a la entrega final de este encargo deben quedar implementados y probados.
- Las 85 pruebas existentes pasaron en tres archivos, contra una base exclusiva de test distinta de dev. No cubren todos los defectos ni acreditan la demo completa. Build y E2E completos no quedaron certificados durante esta auditoría.
- El selector actual Light/Dark/System funciona y conserva Dark al recargar, pero el default era Light. Los tokens exactos del JSON oficial no pudieron contrastarse en esta auditoría; Claude debe descargarlos y revisar el diff. No confundir seleccionar Dark en el navegador con implementar el tema Vercel.

Informes detallados en la carpeta superior .validation/auditoria-chasis-2026-10-17/: frontend-review.md, backend-review.md, openui-recommendation.md, routes-audited.json, source-snapshot.json y test-full.log. Capturas en la carpeta superior output/playwright/auditoria-chasis-2026-10-17/. Consulta la evidencia cuando repares cada área. Los hallazgos de concurrencia/backend proceden de lectura de código y necesitan pruebas de reproducción; no se presentaron como exploits ejecutados.

## 2. Activa estos agentes de desarrollo

Estos son agentes para construir el software, distintos de los subagentes de negocio del ERP. No crean módulos ni skills nuevas. Usa el mecanismo multiagente disponible en tu entorno; no inventes comandos ni dependas de que una función ausente exista. Si hay menos slots, ejecuta las mismas responsabilidades en tandas.

1. **Coordinador e integrador (agente principal).** Posee contratos compartidos, decisiones de arquitectura, dependencias, lockfile, integración, README y estado de entrega. Define primero contratos de acciones, rutas y MessagePart. Revisa todos los cambios antes de integrarlos. Solo él modifica package.json/lockfile, aplica migraciones coordinadas y declara completitud.
2. **Design System y Shell.** Posee globals.css, fuentes, ThemeProvider, shell, sidebar, controles de idioma/tema y componentes visuales compartidos. Aplica Vercel, verifica contraste, teclado y responsive. Coordina cambios de props con los otros agentes. No cambia reglas de negocio.
3. **Navegación y pantallas.** Posee páginas de control, onboarding, activación, los nueve module desks, workbenches, catálogo, Inbox, aprobaciones, archivos, conexiones, settings, reportes, ops y presenter. Integra los servicios acordados; no duplica cálculos ni implementa reglas en componentes.
4. **Núcleo determinista y finanzas.** Posee server/domain, kernel, capacidades, adaptadores, integridad de datos y migraciones propuestas. Corrige idempotencia, concurrencia, evidencia, autorización y aprobaciones; completa los handlers de las 42 skills. No modifica el shell.
5. **Asistente y OpenUI.** Posee driver/store/scenarios del asistente, endpoints y componentes de conversación/renderizado. Corrige continuidad, cancelación, recuperación y permisos; integra OpenUI en página y panel, sobre los mismos comandos y datos. No crea un segundo backend/chat ni modifica el modelo financiero sin acuerdo.
6. **QA independiente y evidencia.** Posee pruebas unitarias/integración/E2E, matriz de cobertura y evidencias. Diseña casos desde contratos, reproduce bugs, recorre rutas en navegador y reporta bloqueos al coordinador. No certifica por contar archivos ni edita implementación para hacer pasar aserciones débiles.

Antes de paralelizar, el coordinador asigna archivos y fronteras explícitas. En checkout compartido, un solo dueño por archivo; si hay worktrees, integra cambios revisados sin reset destructivo. Evita varios resets/seeds sobre una misma base; cada suite paralela usa su DB/run aislado o se ejecuta en serie. QA puede diseñar pruebas mientras los demás implementan, pero certifica sobre la versión integrada. Cada agente entrega archivos tocados, decisiones, pruebas realmente ejecutadas y pendientes. No permitas que un agente sobreescriba componentes de otro.

## 3. Hito A — cerrar el chasis y sus defectos

### Navegación y cableado

Usa rutas-y-pantallas.json como inventario obligatorio. Completa los 31 patrones y prueba parámetros reales, permisos, refresh, back/forward y deep links. Deben funcionar las 17 entradas del sidebar, los nueve módulos y el catálogo completo de 42 skills.

Familias que faltaban: /control/agencies, /control/agencies/:agencyId, /control/setup/:draftId/:step, /control/activations/:runId; /a/:agencySlug/inbox, clients/:clientId, modules/:moduleKey, modules/:moduleKey/workflows/:skillId, records/:recordType/:recordId, capabilities, approvals, approvals/:approvalId, runs, runs/:runId, connections, connections/:connectionId, library, library/:fileId, settings/:section, explore, reports/:reportId; /ops, /ops/incidents/:incidentId, /ops/changes/:changeId y /demo/presenter.

No basta una pantalla con título o un redirect común a Overview. Cada familia tiene datos, acciones, estados y contexto según su contrato. El wizard debe guardar borrador, validar pasos, revisar configuración, activar lógicamente una agencia y abrirla. No simula un despliegue de infraestructura real. Los enlaces de fuentes, clientes, archivos, aprobaciones y runs deben llevar al registro autorizado correcto.

Conecta a una fachada autenticada común los nueve handlers ya existentes: orchestrator, integrations, onboarding, job-lifecycle, contract-po, budget-control, fee-contracts, production-estimating y profitability. Formularios y asistente deben invocar la misma lógica. Añade las superficies de decidir y ejecutar aprobaciones con sesiones elegibles. Completa después los restantes handlers durante el hito B. Mientras trabajas puedes distinguir registered/handler_implemented/scenario_verified; en la entrega final ningún módulo queda Coming soon.

### Tema Vercel, negro por defecto y toggle

Fuente solicitada por el usuario: https://tweakcn.com/r/themes/vercel.json

Comando de referencia: npx shadcn@latest add https://tweakcn.com/r/themes/vercel.json

El coordinador inspecciona el contenido y el diff antes de aplicar el registro en app/. Conserva Base UI, aliases, imports de ReUI y tokens de estados propios. No reinitialices shadcn, no reemplaces componentes a ciegas y no mezcles primitivas incompatibles. Usa las versiones instaladas/lockfile de forma coherente; registra la versión efectivamente usada.

- Incorpora las variables light/dark oficiales y adapta tokens adicionales de success/warning/info para contraste; no reduzcas todo a cambiar background.
- Usa defaultTheme="dark"; respeta la elección explícita posterior del usuario. Para la experiencia solicitada, proporciona un toggle claro Light/Dark, disponible también en landing/login y móvil. Evita que System anule el default negro; si se conserva como tercera opción, debe ser elección explícita y estar probado.
- Evita flash claro/hydration mismatch; usa color-scheme y fuentes coherentes con los tokens. No pongas colores fijos que ignoren el toggle. No borres silenciosamente preferencias del usuario para forzar una captura.
- Mantén diferenciación entre fondo negro, superficies, bordes, estados, foco y datos. Gráficas con leyenda/etiquetas y tabla alternativa; no dependen solo de color.
- Prueba primera visita sin preferencia, toggle, recarga, navegación, dialog/sheet/popover/toast, tablas, chat y OpenUI en ambos temas.

### Integridad y concurrencia

Reproduce y corrige estos hallazgos; las líneas exactas pueden haberse movido:

1. server/capabilities/runner.ts: el replay devuelve un resultado previo sin comparar payload/expectedRevision y antes de ciertos permisos. Guarda/compara digest canónico y ámbito autorizado; misma clave+misma solicitud reproduce; solicitud distinta genera conflicto. Revalida permisos actuales. No generes otra clave para ocultar el conflicto.
2. En ese runner, SELECT e INSERT separados permiten colisión en doble envío. Reclama el run atómicamente; una ejecución/efecto lógico y respuestas coherentes, sin error SQL de unicidad al usuario.
3. server/assistant/driver.ts: Stop/interrupción no se revalida entre pasos y el resultado anterior puede sobrescribir cancelled. Usa lease/revisión/CAS, comprueba cancelación antes del siguiente paso y al guardar. Conserva efectos ya committed; Stop impide los posteriores.
4. El driver guarda progreso solo al final y no tiene recuperación durable. Añade checkpoints por paso y reanudación/reconciliación autenticada; caída después de commit y antes de respuesta no duplica efectos ni deja running eterno. Reintenta con las mismas claves.
5. server/domain/budget.ts: evidenceId de PO solo se valida como UUID. Exige evidencia existente, autorizada, de la misma agencia y vinculada al cliente/trabajo, versión/hash revisados e integridad referencial. Bloquea evidencia aleatoria, ajena o modificada. Aprobación interna no sustituye autoridad del cliente.
6. kernel/domain approvals: antes de ejecutar una aprobación diferida vuelve a comprobar caducidad, capacidad habilitada, permisos, política, revisión y digest. Una aprobación que quedó bloqueada no se vuelve válida por haber sido aprobada antes.
7. server/assistant/store.ts: el historial persistido no debe reenviar contenido cuyo acceso fue revocado. Reautoriza fuentes y proyecciones al leer; conserva auditoría sin revelar valores restringidos. No confundas dueño del hilo con acceso vigente a todos sus datos.
8. server/domain/jobs.ts: el displayReference basado en COUNT tiene carrera entre clientes diferentes. Usa contador/operación atómica por agencia/año y prueba creación concurrente con referencias únicas.
9. record-grid.tsx: ordenar con Number(BigInt(v)/100n) pierde centavos. Compara unidades menores exactamente; define tratamiento de monedas diferentes y valores grandes/negativos.

### Continuidad y UX del asistente

- Borrador compartido por agencia/usuario/hilo; página ↔ panel, cerrar/reabrir y fallo de envío no lo pierden. Vaciarlo solo tras aceptación o restaurarlo ante error.
- Implementa ?thread= autorizado y selección persistente; expandir/recargar debe recuperar el hilo elegido. Un ID ajeno devuelve denegación/not-found uniforme, no otra conversación silenciosamente.
- Una respuesta tardía de A no puede reemplazar la selección B; controla generación de petición/selección y concurrencia en send/confirm/cancel.
- returnTo debe conservar ruta, query, pestaña y filtros. Valida que el destino pertenece a la agencia actual. Al ampliar desde ?tab=activity, volver recupera Activity.
- Propaga la zona horaria de la agencia al proveedor cliente de formato; no fijar México para todas las agencias US/CAN/LATAM. Fechas de negocio no sufren desplazamientos horarios.
- Verifica sugerencias en conversación vacía: se observó una corrección durante la auditoría. Reutilízala y prueba la versión actual; no la sobrescribas por el diagnóstico anterior.
- Prueba panel acoplado en escritorio y Sheet accesible en móvil, especialmente anchos de 768–900 px; foco, Escape, retorno de foco, títulos y controles sin recortes. La auditoría visual se hizo en viewport estrecho, no acredita todos los breakpoints.

## 4. OpenUI dentro del asistente existente

El usuario solicitó charts, cards y dashboards. Es viable integrar el renderizador de OpenUI en React. No ejecutes create sobre el chasis: npx @openuidev/cli@latest create genera otra aplicación y puede introducir un framework/backend distinto.

Verifica documentación oficial y peer dependencies antes de instalar: https://www.openui.com/docs/openui-lang/renderer , https://www.openui.com/docs/openui-lang/overview , https://www.openui.com/docs/api-reference/react-lang y https://www.openui.com/docs/api-reference/cli . El app auditado usa React 19.2.8, Zod 4.6.5, Next 16.2.12 y Recharts 3.8.0. Compatibilidad de la versión elegida de OpenUI debe comprobarse; no se instaló ni validó durante la auditoría.

Integra @openuidev/react-lang como renderer en un MessagePart tipado y versionado. Reutiliza componentes ReUI/Recharts propios mediante una biblioteca cerrada: MetricCard, BarChart, LineChart, RecordTable y Dashboard. Define sus esquemas, componentes permitidos y límites de tamaño. La primera vista demostrable es margen de Aurora con tarjetas y desglose de costos, reconciliada contra Overview/dossier; en fase 2 añade los demás resultados de escenarios.

En esta demo el servidor elige layouts predefinidos y produce datos desde consultas autorizadas. No necesitas LLM, Gateway, claves Thesys/OpenAI ni generación remota para representar una respuesta fija del renderer. No cambies el driver scripted, la sesión ni la conversación. Página y panel comparten el mismo renderer y estado; adapta densidad al ancho.

Los importes exactos y sus definiciones permanecen en el servidor. Si una gráfica requiere Number, deriva valores de presentación acotados y conserva fuente exacta para etiquetas y tablas; no recalcules finanzas dentro de la visualización. Incluye moneda, periodo/as-of, revisión y fuentes autorizadas. No inventes puntos históricos para llenar una curva.

Acciones permitidas como abrir expediente, cambiar filtro o preparar propuesta pasan por los servicios autorizados existentes. No habilites toolProvider abierto, MCP libre desde el navegador, SQL arbitrario, eval, JavaScript/HTML generado o una mutación por el simple montaje del renderer. Un botón visual jamás elude validación, permisos, idempotencia y aprobación. Maneja payload inválido/desconocido con error recuperable y alternativa legible; no dejes la conversación en blanco.

Aceptación: mismos valores/fuentes en tabla, gráfica, tarjeta y expediente; tema claro/oscuro; teclado y vista alternativa; persistencia y permisos al reabrir; props inválidas y datos restringidos bloqueados; cero llamadas a modelos/proveedores; ejecución de acciones una sola vez. Si una dependencia OpenUI resulta incompatible, documenta el conflicto reproducible y conserva las mismas vistas mediante renderizador tipado propio, sin reescribir el ERP ni afirmar OpenUI instalado. Esto requiere comunicar la excepción concreta.

## 5. Hito B — ejecutar la instrucción 2 completa

La instrucción 2 completa está incluida a continuación en este mismo archivo. Úsala junto a los contratos existentes. La indicación histórica de conservar Verve significa conservar su shell/componentes; la nueva orden de tema Vercel y OpenUI anterior prevalece. Las instrucciones de usar ReUI MCP aplican si está disponible en tu sesión: verifica herramientas, no inventes acceso. Si falta, usa fuentes licenciadas instaladas y documentación oficial sin frenar el núcleo.

## 6. Hitos de aceptación y entrega final

**A — Chasis listo:** 31 patrones resuelven; 17 destinos del sidebar, nueve módulos y 42 workbenches son navegables. Acciones representativas existentes conectadas con permisos y persistencia. Bugs de núcleo reproducidos/corregidos. Asistente página/panel conserva hilo, draft y retorno. Tema Vercel negro por defecto y toggle comprobados. OpenUI o su excepción documentada. Este hito no permite anunciar 42 casos E2E completos.

**B — Demo completa:** 42 handlers funcionales, 42 casos positivos y 42 negativos acreditados, J01–J10 completos. No quedan acciones visibles sin resultado ni módulos pendientes. Los negativos se bloquean por la regla correcta y no dejan efectos indebidos. Cifras y estados se reconcilian entre todas las vistas y el asistente.

**C — Entrega reproducible:** typecheck, lint, tests de dominio/integración, E2E de navegador y build pasan en la versión integrada. No reutilices el resultado de 85 tests como acreditación de los nuevos. Si pnpm intenta reinstalar/purgar node_modules por discrepancia de versión, usa el packageManager del proyecto y resuelve la configuración; no aceptes una purga automática mientras otro proceso trabaja. La auditoría usó el binario local Vitest para evitarla.

Sustituye el README heredado de Verve que afirmaba frontend sin DB/auth. Documenta variables por nombre, sin secretos, migraciones, roles, DB separada de test, seed/reset protegido, arranque, comandos y pruebas. Entrega IMPLEMENTATION_STATUS.md, HANDOFF-INSTRUCCION-2.md actualizado al resultado, matriz ruta→pantalla→acción→servicio→permiso→prueba, cobertura de 42 skills y app/evidence con resultados reales/capturas. Conserva la trazabilidad de hallazgos: vigente, corregido, prueba, resultado. Build/E2E pendientes se reportan como pendientes, nunca como éxito.

No publiques ni conectes pagos, ads, OAuth o dominios reales. No metas secretos, archivos .env, node_modules ni material licenciado en un paquete de evidencias o repositorio público. No borres/resetées datos ajenos. El producto sigue siendo demo con integraciones simuladas y persistencia real.

Empieza levantando el estado actual y repartiendo estos agentes. Completa A, integra y verifica; después termina B y C. Consulta al usuario solo si falta una decisión o acceso indispensable que los contratos no resuelvan. No pidas confirmación rutinaria para las correcciones ya autorizadas.

---

# Instrucción 2 incorporada

INSTRUCCIÓN 2 PARA CLAUDE CODE — PROGRAMAR LA DEMO COMPLETA DE AGEOS

Continúa sobre el chasis existente de app/. No crees otra aplicación ni cambies Verve. El objetivo ahora es dejar una demo determinista, hardcodeada y recorrible de principio a fin para presentar a inversionistas. Debe funcionar sin LLM, claves de IA, OAuth ni servicios externos de negocio.

Lee CLAUDE.md, 08-instruccion-2-demo-e2e.md, demo-scenarios-v1.json, demo-fixtures.json, cobertura-42-skills.json, 03-chasis-deterministico.md, 07-asistente-global-erp.md, asistente-global-v1.json y los guiones/criterios de 05 y 06. Consulta 02/rutas y 04A para reutilizar pantallas, bloques, componentes e iconos ya elegidos.

ALCANCE

Programa los diez recorridos J01–J10 y los 42 escenarios ERP-01–ERP-42. Cada skill requiere caso positivo y negativo, datos de entrada, comando/consulta, resultado persistido o reporte, evidencia y acceso desde su pantalla y desde el asistente. Son al menos84 comprobaciones funcionales de skills, además de los casos transversales. No dejes módulos “Coming soon”, controles sin acción ni éxitos que solo cambian el texto de una tarjeta.

El orquestador es el existente coordinador/agency-orchestrator y deriva a sus especialistas mediante un driver scripted. Página de chat y panel derecho comparten conversación, contexto, permisos y backend. El asistente puede usar prompts, alias EN/ES, parámetros y respuestas preprogramadas. Para texto fuera del guion, explica que es una demo y ofrece escenarios disponibles. No simules comprensión ilimitada ni cobres/consumas inferencia.

Hardcodear significa datos sintéticos, escenarios, plantillas y respuestas externas reproducibles. Los estados, cálculos, permisos y efectos se procesan mediante los mismos servicios del chasis. No hardcodees cifras diferentes por pantalla ni el éxito de una operación que no ocurrió. No uses localStorage como fuente del ERP ni escribas estado de negocio directamente desde componentes.

IMPLEMENTACIÓN

1. Revisa lo construido y corrige las dependencias que impidan los recorridos. Conserva los nueve módulos,42skills,31patrones de ruta y el diseño ReUI. Usa su MCP para comprobar componentes que falten, sin reemplazar el shell ni estilos.
2. Implementa seeds/checkpoints reproducibles from_intake y ready_for_scope_review, reloj de negocio fijo, demo_run_id y reset protegido por agencia. Los checkpoints representan estados coherentes completos; nunca adelantes pagos, asientos o aprobaciones que el recorrido aún no ejecutó.
3. Crea un registro central de escenarios versionado en la aplicación: ID, skill, rol, parámetros, precondiciones, pasos, comandos, resultados esperados, plantillas de respuesta, errores e idempotencia. Usa demo-scenarios-v1.json como especificación; no marques completitud solo por generar ese archivo.
4. Haz navegable J01configurar/activar, J02cliente-producción, J03plan-campaña, J04cambio de alcance/margen, J05conciliar-facturar-cobrar-pagar, J06contabilidad/cierre/reportes, J07asistente página/panel, J08archivos/conexiones/aislamiento, J09operación plataforma y J10catálogo completo/errores. Completa los flujos secundarios en demo-lab para no contaminar los KPIs de Aurora.
5. Conecta todos los botones, formularios, grillas, Gantt, filtros, aprobaciones, archivos y enlaces a los registros adecuados. Los resultados deben sobrevivir recarga y verse coherentes en Overview, expediente, módulo, reportes y chat. No añadir temporizadores que declaren éxito sin ejecutar el handler.
6. Programa las conversaciones del orquestador con presets/alias en inglés y español, aclaraciones por campos faltantes y tarjetas tipadas. Las variables de las respuestas provienen de queries autorizadas del estado vigente. Cada delegación ejecuta la capacidad correspondiente y registra evidencia de demo. No necesita SDK/modelo real para completar esta instrucción.
7. Preserva aprobaciones exactas, actor elegible, separación de funciones, presupuesto, fondos, revisión, tenant y permisos. La propuesta del asistente no es una autorización. La persona aprobadora usa su sesión; no crear un botón que apruebe en nombre de otro.
8. Prepara adaptadores simulados con éxito, timeout, acceso revocado y resultado incierto. Un sim_* persistido representa cada operación. Reintentar y reconectar no duplica trabajos, campañas ni pagos. Concilia el efecto incierto antes de repetir.
9. Prepara archivos sintéticos válidos y datos de audiencias/specs/resultados claramente identificados como demo. Una extracción fixture solo corresponde a su archivo/version/checksum, nunca a cualquier PDF subido. No llamas a proveedores ni modelos reales.
10. Añade un lanzador protegido de escenarios con punto de inicio, actor, pasos y resultado esperado. La demo sigue permitiendo navegar manualmente. Seed/reset solo afectan el run de demostración, no otras agencias ni datos.

CASO FINANCIERO OBLIGATORIO

Rayo de Sol, Estudio Solar, Aurora Spring Launch. Las cifras exactas están en demo-fixtures.json:
- Fee20,000, costo11,000, margen9,000/45.0%.
-40h extra×50: costo13,000, margen7,000/35.0%.
-Enmienda aprobada+3,000: fee23,000, costo13,000, margen10,000/43.5%.
-Medios30,000 separados del ingreso de agencia; autoridad cliente50,000→53,000 con evidencia y revisión.
-Factura proveedor6,000 frente a entrega5,500 bloqueada hasta corrección.
-Caja10,000+primer cobro40,000−pagos43,000+cobro final13,000=20,000. No permitir sobregiro.
-15asientos principales equilibrados y cierre consistente. Orden, entrega, factura y pago no son cuatro costos diferentes.

La consulta de margen del chat devuelve el checkpoint actual, con fuentes, fecha y moneda; no responde siempre el mismo porcentaje. Una propuesta prepara el diff; solo la acción aprobada cambia el estado y las cifras de todas las vistas.

PRUEBAS Y ENTREGA

Prueba las42skills con caso positivo/negativo y recorre J01–J10. Incluye autoaprobación, revisión obsoleta, tenantajeno, scope revocado, falta de evidencia, presupuesto/fondos insuficientes, duplicados, cancelación, reconexión, recarga y resultado incierto. Valida que la página chat y el panel conservan un único hilo y no ejecutan dos veces.

Prueba el incidente CSV de plataforma:1columna detectada→propuesta de delimitador→aprobación por otro administrador→6columnas y1fila; sin crear órdenes ni gastar. Las pruebas de UI no deben asumir permisos de administrador por conveniencia.

Ejecuta typecheck, lint, tests de dominio, E2E en navegador y build. Comprueba EN/ES, escritorio/móvil, teclado y temas. La aplicación debe arrancar y completar sus recorridos sin credenciales de modelo/proveedor. Conserva una etiqueta discreta Demo con asistente guionizado e integraciones simuladas.

Entrega instrucciones de inicio/seed/reset, guiones de90segundos y5minutos ensayados, capturas y app/evidence/demo-e2e-results.json, demo-e2e-report.md, assistant-acceptance.md y assistant-tool-coverage.json. Actualiza IMPLEMENTATION_STATUS.md con estado separado de chasis y demo. Registra solo pruebas que ejecutaste; todo caso incompleto queda pendiente explícito. No declares42/42 por el número de filas del catálogo.

Empieza revisando el chasis y continúa hasta dejar la demo completa y reproducible. Resuelve decisiones rutinarias con los contratos existentes; no pidas modelos, cuentas comerciales ni credenciales para una demo que debe ser determinista.

