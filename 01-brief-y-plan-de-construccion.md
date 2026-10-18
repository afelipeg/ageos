# AgeOS — Brief y plan del chasis determinista

Fecha: 17 de octubre de 2026. Destino: Claude Code. Objetivo: construir una demo funcional que explique la promesa de AgeOS a inversionistas y sirva de base para el producto. La postulación a YC Fall 2027 es una meta del fundador; este paquete no presupone fechas ni requisitos de esa convocatoria.

## Decisión de producto

**Construya su agencia con el poder de la infraestructura agéntica ERP de AgeOS.**

La interfaz principal estará en inglés, con cambio a español. La formulación breve para la demo será **“Build your agency on AgeOS.”** La explicación será: **“Your clients, work, media and finances — configured around the way your agency operates.”**

La demo debe hacer tangible una promesa sencilla: elegir cómo funciona una agencia y obtener una operación conectada con sus propias reglas. La configuración afecta de verdad a navegación, permisos, responsables, flujos y resultados. El núcleo determinista mantiene la operación consistente; el asistente global guionado utiliza esos mismos servicios para consultar, preparar acciones y coordinar los procedimientos especializados del ERP.

Los tres pilares se muestran mediante acciones del producto:

1. **Build your agency.** Configurar servicios, equipo, responsables, conexiones de demostración, marca y capacidades del catálogo completo.
2. **Activate your workspace.** Revisar una configuración versionada y validada; activar el espacio lógico de la agencia y recibir su aplicación configurada.
3. **Run and improve your operation.** Ejecutar procesos, detectar excepciones con reglas explícitas, aprobar una corrección y observar su efecto en el trabajo y sus cifras.

La última decisión del usuario exige una **demo determinística y hardcodeada en sus guiones y fixtures**, sin inferencia ni llamadas a modelos. El asistente representa `agency-orchestrator`, una de las 42 skills existentes, y coordina las capacidades habilitadas; no agrega un módulo ni una skill. Se permiten respuestas precargadas, sugerencias, variantes de texto explícitamente soportadas y ramificaciones programadas. Los cálculos, permisos, aprobaciones y efectos se ejecutan realmente sobre el núcleo persistente. Las conexiones externas del ERP permanecen simuladas. La interfaz indica `Scripted demo / Demo guionada` y explica honestamente las peticiones fuera de cobertura. IA real y proveedores reales quedan para una etapa posterior, sin bloquear esta entrega.

## Qué se construye ahora

| Área | Comportamiento exigido |
|---|---|
| Aplicación | Next.js/TypeScript desde la base ReUI elegida, con navegación y rutas funcionales |
| Datos | PostgreSQL real, migraciones, seed reproducible y consultas del servidor |
| Procesos | Estados y comandos deterministas con validaciones, revisión esperada y auditoría |
| ERP | Nueve módulos; 42 procedimientos básicos funcionales con entradas, resultado y prueba |
| Configuración | Guardar borrador, validar, mostrar diferencias, aprobar y activar versión |
| Conexiones | Adaptadores simulados con cuentas por agencia, resultados, errores y reintentos controlados |
| Archivos | Biblioteca privada y persistente, metadatos, permisos, descarga y relación con el expediente; importación estructurada validada |
| Reportes | Cálculos desde los registros existentes; exportaciones reproducibles |
| Identidad | Sesiones del servidor y roles de demostración autorizados; aislamiento entre agencias |
| Asistente global | Driver determinístico de escenarios, respuestas precargadas, handoffs programados, herramientas tipadas y evidencia; sin llamadas a modelos ni proveedores externos |
| Chat | Página `/a/:agencySlug/assistant` y panel lateral derecho global sobre el mismo hilo, runtime, permisos y componentes; ruta implementada mediante `page.tsx` |
| Marca y dominio | Nombre, logo/identidad de muestra y colores reales mediante tokens; dirección propia y DNS simulados |
| Plan | Cupos de demo aplicados por backend; precios comerciales pendientes |

La arquitectura objetivo de `referencias/` sigue vigente. La simulación aceptada para esta etapa aplica a proveedores externos, no a las reglas, la persistencia ni los resultados del ERP. La cobertura de un módulo no se obtiene con una tarjeta “Coming soon” o un botón que solo muestra una notificación.

## El valor que la demo debe demostrar

La presentación no necesita explicar SQL, sandboxes o MCPs. Debe permitir observar que:

- Una configuración determina la aplicación que recibe la agencia.
- Un cliente y un trabajo mantienen la misma identidad de contrato a cobro.
- Un cambio de alcance afecta presupuesto y rentabilidad de manera comprobable.
- Una aprobación autoriza una revisión concreta y deja evidencia.
- Las cifras del panel se pueden abrir y reconciliar con sus registros.
- El humano puede recorrer peticiones programadas desde el chat, inspeccionar evidencia y continuar desde cualquier pantalla sin perder el hilo; la demo distingue esos casos de la comprensión general de lenguaje natural futura.

La base técnica que sostiene esa promesa incluye contexto común, reglas de dominio y ejecución confiable. La defensa competitiva se construye cuando ese producto resuelve operaciones reales; el material de demo no debe presentar como logrados datos de tracción o ventajas medidas que todavía no existen.

## Base visual y alcance de las pantallas

Usar **Verve** como base de aplicación, sujeto a comprobar la edición que entregue el propietario; la selección detallada y sus alternativas figuran en `04-reui-seleccion-e-instalacion.md`. Mantener una sola aplicación y su sistema visual. Otros templates aportan referencias puntuales, no se fusionan sus routers, temas o sistemas de autenticación.

Reutilizar unas pocas familias de pantalla: configuración guiada, mesa de trabajo con Data Grid, expediente con pestañas, revisión/aprobación, formularios y ajustes. Las rutas en `rutas-y-pantallas.json` describen destinos y estados del producto; no exigen fabricar un diseño independiente para cada ruta.

La conversación usa `ai-chat-6` como contenido y `app-shell-18` únicamente como referencia para acoplar el panel derecho. Preservar el shell, navegación y estilo Verve. Agent Activity y Trace muestran ejecución y evidencias; no sustituyen composer, mensajes ni historial. Sidebar → página de chat; acción de cabecera → panel contextual. La página completa no muestra una segunda copia del chat en el lateral.

El usuario principal es el dueño/director de una agencia de servicios, con responsables de cuentas, producción, medios y finanzas. La demo puede alternar personas de prueba desde una herramienta del presentador protegida; cada acción conserva el actor real de esa sesión. La experiencia del inversionista no ofrece una puerta pública para asumir cualquier rol.

## Estructura de trabajo para Claude Code

```text
claude-code-chasis-v1/
  CLAUDE.md
  00-LEEME.md
  01-brief-y-plan-de-construccion.md
  02-pantallas-y-flujos.md
  03-chasis-deterministico.md
  04-reui-seleccion-e-instalacion.md
  05-guion-demo-inversionistas.md
  06-aceptacion-y-evidencias.md
  07-asistente-global-erp.md
  asistente-global-v1.json
  REFERENCIA-COMMERCE-ASSISTANT.md
  08-instruccion-2-demo-e2e.md
  PROMPT-2-DEMO-E2E.txt
  demo-scenarios-v1.json
  PROMPT-PARA-CLAUDE-CODE.txt
  cobertura-42-skills.json
  rutas-y-pantallas.json
  demo-fixtures.json
  reui-inventario-verificado.json
  referencias/                 # Copias de la arquitectura y del catálogo previo
  inputs/reui/verve/            # Fuente licenciada que aporta Andrés
  app/                         # Aplicación que construirá Claude Code
```

La carpeta `app/` aún no está creada como aplicación. Las instrucciones describen qué debe producir Claude Code. Si se mueve este paquete a otra máquina, conservar toda la carpeta y sus referencias. La fuente comercial de ReUI no se incluye en el paquete.

## Orden de implementación

**Dos instrucciones consecutivas:** la instrucción 1 construye el chasis, sus reglas, rutas y superficies del asistente; la instrucción 2 (`08-instruccion-2-demo-e2e.md` / `PROMPT-2-DEMO-E2E.txt`) programa, completa y prueba todos los casos de uso guionados definidos en `demo-scenarios-v1.json`. Ambas conservan nueve módulos y 42 skills. Los recorridos de presentación son una selección narrativa; no reemplazan la cobertura completa E2E.

### Fase 0 — Preparar la base

Leer las instrucciones, inspeccionar la plantilla y su versión, verificar el MCP de ReUI y crear un registro de decisiones. Copiar/adaptar la fuente a `app/` preservando su licencia y archivos de origen. Mantener el package manager y lockfile compatible; si no existe elección previa, usar pnpm. Revisar las APIs reales de componentes antes de instalar bloques adicionales.

Leer también el contrato 07 y el catálogo de escenarios de la instrucción 2. Implementar un adaptador `scripted` que consume fixtures y comandos autorizados, sin configurar proveedor ni pedir claves de IA. La arquitectura conserva una frontera futura para Eve/AI SDK; cuando esa etapa se autorice, verificar APIs y versiones. No instalar un framework o activar inferencia para resolver la demo actual.

Si falta la descarga licenciada, construir de inmediato contratos, esquema, fixtures y pruebas en la estructura futura. Dejar un bloqueo concreto sobre el origen de UI; no cambiar unilateralmente a otra estética ni descargar código de fuentes no autorizadas.

Salida: aplicación base que compila, variables documentadas, scripts de desarrollo y registro de decisiones. No conservar datos o autenticación ficticia de la plantilla como backend final.

### Fase 1 — Núcleo y datos de prueba

Implementar agencias, entidades legales, usuarios, membresías, trabajos, revisiones, aprobaciones, conexiones simuladas y eventos. Crear transacciones y comandos compartidos con autorización, idempotencia y control de concurrencia. Añadir la representación monetaria y el diccionario de métricas. Cargar los fixtures y comprobar todos sus resultados esperados.

Salida: las reglas se pueden probar sin interfaz ni modelo de IA. Dos agencias no pueden leer ni modificar sus registros entre sí. Recargar el servidor conserva el estado.

### Fase 2 — Configurar y activar

Construir el recorrido de configuración, revisión y activación. Guardar borradores; validar dependencias; conservar controles de gobierno permanentes; distinguir catálogo disponible de capacidades seleccionadas. La activación crea la configuración publicada y el espacio lógico, no un proyecto de Vercel por cliente.

Salida: un cambio de configuración modifica de verdad la experiencia y se puede rastrear a una revisión aprobada. El dominio simulado tiene estado propio y no impide utilizar el espacio de demo.

### Fase 3 — Expediente completo

Conectar cliente/contrato, presupuesto, tareas/horas, producción, plan y compra de medios, orden/entrega, cuentas por pagar, factura/cobro y margen. Implementar primero una sección vertical de extremo a extremo para validar las relaciones y después completar todas las operaciones pendientes de la matriz. Esta secuencia no reduce el alcance de entrega.

Salida: el caso principal puede recorrerse de principio a fin y sus montos coinciden en cada pantalla. Las listas y paneles se derivan del mismo estado persistente.

### Fase 3A — Asistente y orquestación sobre el núcleo

Construir el registro común de consultas/comandos/capacidades y el driver guionado del orquestador. Cada tool resuelve actor y agencia desde el servidor, aplica las reglas del núcleo y devuelve referencias, revisión, moneda y fecha de corte cuando corresponda. Un escenario selecciona consultas y handoffs especializados mediante IDs permitidos; no ejecuta código o SQL enviado por el usuario. El driver puede renderizar texto precargado, pero todos los valores variables y recibos provienen del backend. Los handoffs preservan permisos y límites.

Persistir conversaciones, mensajes, contextos, propuestas, invocaciones, delegaciones y recibos. Montar un provider de conversación en el layout de agencia; reutilizarlo entre página y panel. Cambiar de agencia, usuario o permisos debe revalidar el acceso y separar los contextos. Las propuestas de escritura y las aprobaciones exactas utilizan los mismos comandos que la UI.

Salida: los casos soportados EN/ES producen consultas reales y propuestas sustentadas, incluyendo referencias cruzadas entre módulos. Cerrar el panel o detener la secuencia no revierte un comando ya aplicado. Reconectar recupera estado y reanuda sin duplicar efectos. Peticiones fuera de los guiones muestran un mensaje honesto y sugieren casos disponibles. El driver y todos los recorridos funcionan sin credenciales de modelo; no se pide inferencia real para aceptar esta etapa.

### Fase 4 — Completar las nueve áreas

Implementar las capacidades restantes de las 42 filas: cambios de plan, conciliación, gastos, impuestos parametrizados de demo, provisiones, depreciación, cierre, presupuesto de ingresos, caja y reportes. La simulación fiscal no equivale a cumplimiento legal ni emisión electrónica real. Cada procedimiento produce un artefacto o transición verificable.

Salida: cobertura 42/42 con casos positivos y bloqueos relevantes. El contador se deriva de pruebas implementadas; no se fija manualmente en la UI.

### Fase 5 — Operación y excepciones

Construir la bandeja de atención, diferencias antes/después, acciones pendientes, trazas de procedimientos y conectores con fallas simulables. Un cambio de presupuesto o revisión invalida una aprobación anterior. Un resultado externo incierto se concilia antes de repetir. No hay consumo de modelo en esta etapa: mostrar no aplicable u omitir ese indicador; nunca inventar tokens, latencia de inferencia o costos IA.

Salida: la demo demuestra una excepción, la consulta contextual del asistente y su resolución gobernada. Las trazas muestran herramientas, delegaciones, resultados y evidencia, sin exponer razonamiento interno ni inventar pasos.

Incluir también un circuito mínimo de operación de plataforma: incidente sintético → evidencia → propuesta de ajuste de configuración local → aprobación de un administrador de plataforma distinto del solicitante → aplicación y comprobación local auditada. Es obligatorio para demostrar el tercer pilar; un panel estático no lo sustituye. No requiere crear PRs remotos ni modificar infraestructura real.

Caso concreto: el perfil de importación de demo usa coma para un CSV preparado con punto y coma y detecta una columna en lugar de seis. Una regla prepara el cambio del delimitador de ese perfil. Tras aprobación, el servidor aplica la revisión, vuelve a interpretar el mismo archivo y confirma seis columnas. Limitar la operación al perfil demo; no habilitar edición arbitraria de configuración global ni tocar datos ajenos. Los cambios y la verificación se conservan al recargar.

### Fase 6 — Revisar y preparar la presentación

Completar EN/ES, accesibilidad, modos claro/oscuro, navegación por teclado, estados vacíos/cargando/error y diseño adaptable. Ejecutar las pruebas de dominio y las de navegador. Preparar un entorno de preview protegido y una guía de acceso cuando exista autorización para alojarlo. Probar el guion corto y el extendido desde un estado inicial reproducible.

Salida: registro de pruebas, capturas, incidencias pendientes, instrucciones de arranque/reset y demostración reproducible. Incluir pruebas del driver guionado y de los recorridos E2E completos, con escenario/versión/checkpoint y resultado registrados. Verificar ausencia de llamadas a modelos y proveedores externos. El tiempo de activación se mide antes de utilizar una cifra comercial.

## Reglas de implementación que evitan una maqueta vacía

- Los totales provienen de consultas al servidor; ninguna tarjeta muestra una cifra decorativa que contradiga su listado.
- Los filtros, búsqueda, orden, paginación y selección se aplican realmente. Los parámetros de URL conservan las vistas compartibles cuando procede.
- Formularios con validación de campo y de negocio; no confundir guardar borrador con aprobar o contabilizar.
- Ningún proceso crítico depende de `localStorage`, de un temporizador visual o de un botón que marca todo “Complete”.
- Las trazas registran pasos ejecutados, errores y evidencia. No muestran razonamiento interno inventado.
- Los adaptadores de demo tienen los mismos contratos que sus futuros reemplazos y bloquean escrituras externas reales.
- El catálogo técnico puede incluir proveedores pendientes. En pantalla se distingue entre conexión simulada disponible, no configurada y no incluida en esta demo.
- Las revisiones, archivos y estados pertenecen a la agencia. La marca blanca no modifica esa autorización.
- Las conversaciones también pertenecen a una agencia y usuarios autorizados; conocer un thread ID no concede acceso. Un texto o documento recuperado es dato, no instrucción con permisos de ejecución.
- Una respuesta natural no acredita una escritura. El asistente solo confirma efectos cuando recibe un resultado comprometido del servicio; las aprobaciones son controles del servidor ligados a payload/revisión exactos.

## Fuentes de preparación

`CLAUDE.md` concentra las reglas permanentes y remite a documentos por fase, conforme al uso de instrucciones de proyecto descrito por [Claude Code](https://code.claude.com/docs/en/memory). La selección y el flujo de consulta del MCP siguen [ReUI](https://reui.io/docs/mcp). Estos documentos se revisaron el 17 de octubre de 2026; al construir, comprobar las versiones instaladas y los contratos actuales sin alterar el alcance aprobado.
