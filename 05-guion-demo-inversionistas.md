# AgeOS — Guion de demostración para inversionistas

Fecha: 17 de octubre de 2026. Entregable: guion e instrucciones para construir y ensayar una demo, no afirmación de que la aplicación ya existe. Idioma de presentación sugerido: inglés; interfaz inglés/español. Referencia de escenario: `aurora_scope_change`, fixture de Rayo de Sol / Estudio Solar.

## La idea que debe recordar la audiencia

**Build your agency with the power of AgeOS agentic ERP infrastructure.**

Traducción de apoyo: **Construya su agencia con el poder de la infraestructura agéntica ERP de AgeOS.**

El hilo conductor tiene tres partes: configurar el negocio, activar su aplicación y operar cada trabajo con datos y reglas conectados. El humano puede operar desde pantallas o recorrer casos guionados desde el asistente del orquestador ERP. La demo muestra la misma información pasando de una decisión a su consecuencia. La conversación está programada y rotulada como demo; reglas, persistencia, cálculos y permisos sí se ejecutan. La capacidad de armar una agencia es la promesa comercial; la ventaja que se intenta construir está en los procesos reutilizables, su ejecución confiable y el contexto que se acumula dentro de cada agencia. No presentar la frase comercial por sí sola como una barrera técnica probada.

## Qué es real y qué está simulado

Esta tabla describe el objetivo de construcción. Marcar como real únicamente lo que esté implementado y probado al grabar/presentar.

| Parte | Objetivo de la demo | Cómo contarlo |
|---|---|---|
| Configuración y marca | Formularios, versiones, permisos y persistencia reales | “These choices configure the workspace you are about to see.” |
| Activación | Crear/habilitar un espacio lógico de demo en la aplicación compartida | “This activates a demo workspace. It does not purchase infrastructure or domains.” |
| Reglas y cálculos | Cálculos y transiciones ejecutadas por el backend sobre datos guardados | “The numbers update from the underlying records and rules.” |
| Aprobaciones y auditoría | Revisión exacta, permiso independiente, registro de decisión y resultado | “The approval is tied to this version and amount.” |
| Archivos | Carga privada y exportaciones implementadas; extracción según soporte real | “Documents remain linked to the work they support.” |
| Conexiones externas | Adaptadores simulados y cuentas de ejemplo | “External platforms are simulated in this demo.” |
| Facturas fiscales, pagos, anuncios, dominios | Estados y comprobantes de demo, sin efecto externo | “No live funds, campaigns or tax documents are issued here.” |
| Asistente y especialistas | Driver determinístico de `agency-orchestrator`, respuestas precargadas y handoffs programados sobre herramientas del ERP | “This is a scripted product demo. The conversation is predefined; the ERP executes the calculations, permissions and approvals.” |
| Página y panel de chat | Mismo hilo y runtime desde sidebar o panel derecho contextual | “I can continue this conversation from the job, the plan or the full assistant workspace.” |
| Datos de negocio | Fixture sintético, con fechas fijas y monedas explícitas | “The agency and operating data shown here are illustrative.” |

Mantener una etiqueta visible `Demo environment · Scripted assistant · Sample data · Simulated integrations`. La demo puede sentirse terminada y confiable sin ocultar su alcance. No mencionar inferencia, integración real o agente en producción que no haya sido construido. No se realiza ninguna llamada a modelo o proveedor externo en esta etapa.

## Preparación antes de presentar

1. Desplegar la demo en preview con acceso restringido. Las acciones de reset, fixtures y cambio de actor están disponibles solo al presentador autorizado mediante sesión comprobada en servidor.
2. Restaurar el escenario base de demostración de forma controlada. No tocar datos de una agencia real ni reiniciar un entorno compartido con usuarios trabajando.
3. Preparar un borrador de Rayo de Sol / Estudio Solar cerca del paso Review; conservar también una ruta para iniciar desde cero si preguntan. El guion corto no obliga a mecanografiar todos los campos en vivo.
4. Comprobar owner, account manager y finance approver como actores distintos. El cambio de sesión de presentación debe ser explícito y autorizado; no habilitar un selector de cualquier usuario en la aplicación ordinaria.
5. Abrir un solo navegador con dos contextos de sesión si facilita mostrar la separación de responsabilidades; evitar mostrar correos personales, tokens o credenciales.
6. Tener listo el job `job_demo_aurora`, número canónico `AURSL7AF0001`, referencia visible `RDS-2027-001`, **Aurora Spring Launch**, cliente **Aurora Beverages**.
7. Ensayar con red lenta, recarga durante la activación y una validación rechazada. Si una parte falla, mostrar el diagnóstico real; no reproducir una animación que anuncie éxito.
8. Registrar el tiempo real de activación si se va a mencionar. No prometer “un ERP completo en segundos” a partir de un fixture preparado. Diferenciar tiempo de configurar una demo de tiempo de implantación para un cliente.
9. Cargar la versión del driver y el caso guionado adecuados; ensayar las peticiones/sugerencias soportadas en EN/ES y sus ramas. Las respuestas pueden estar precargadas, pero los valores dinámicos y fuentes se obtienen del ERP. Verificar que no haya llamadas a modelos/proveedores, que la etiqueta demo sea visible y que una petición fuera de alcance ofrezca honestamente los casos disponibles.
10. Abrir `/a/rayo-de-sol/assistant` desde el sidebar y comprobar que al continuar desde el panel derecho del expediente aparece el mismo hilo. No mostrar dos chats simultáneos en la página completa. Confirmar que un cambio de agencia no conserva contexto ajeno.

## Recorrido de 90 segundos

Los tiempos siguientes organizan la narración. No son una promesa de velocidad del producto. Si una operación toma más, respetar su estado real y ajustar el guion.

| Tiempo orientativo | Pantalla y acción | Narración sugerida en inglés | Prueba que ve la audiencia |
|---|---|---|---|
| 0–12 s | Review del wizard, mostrar Rayo de Sol y Estudio Solar | “An agency should be able to configure its own operating system: its services, approvals, tools and brand.” | La configuración define el negocio y los nueve módulos disponibles; no exige conocimientos de infraestructura. |
| 12–25 s | `Deploy demo agency`; ver pasos y `Open workspace` | “AgeOS turns that configuration into a workspace the team can use. This is a demo activation on a shared platform.” | Publicación de configuración, registro de activación y aplicación con identidad propia. |
| 25–40 s | Inicio → Aurora Spring Launch → abrir panel Assistant; seleccionar o escribir la petición soportada “What needs attention on this job?” | “Every job connects the client agreement, production, media, billing and margin. This scripted assistant demonstrates the same workflow from the screen where I work.” | El driver consulta herramientas autorizadas; expediente relacionado, referencias a registros y etiqueta demo. |
| 40–58 s | Preguntar “Explain the margin change and prepare the fee adjustment for review”; abrir diff | “Forty additional hours reduce projected margin from forty-five to thirty-five percent. The assistant prepares the next step; the ERP calculates and validates it.” | USD 2,000 de costo adicional, cálculo sustentado y propuesta sin efecto financiero hasta la autorización. Etiqueta Forecast visible. |
| 58–76 s | Finance approver revisa evidencia PO v2 y aprueba cambio de fee de USD 3,000 | “A three-thousand-dollar scope change goes to the right person, with the client's updated authorization attached. The approval applies to this exact version.” | Evidencia de autorización del cliente, permisos, payload y aprobación interna separados y persistidos. No autoaprobación del solicitante. |
| 76–90 s | Regresar al job, margen actualizado y enlace a catálogo | “The approved change updates the job, projected margin and audit trail together. The V1 covers nine ERP areas and forty-two workflows, configurable for each agency.” | Fee USD 23,000, costo proyectado USD 13,000, margen USD 10,000 / 43.5%; nueve módulos/42 capacidades. |

Cerrar con la promesa, sin un número de velocidad inventado: **“Build your agency with AgeOS. Configure once, then operate from one connected system.”**

La creación de la excepción no debe parecer un suceso externo espontáneo. Antes de la grabación puede cargarse el fixture del incidente. Si se dispara en vivo, usar `Load sample scope request` desde herramientas de demo y narrar “Let’s introduce a sample scope change.” El cambio de estado y su aritmética sí son reales dentro del chasis.

El texto y las ramas pueden estar preparados; el driver debe esperar el resultado real del comando antes de mostrar éxito. No simular latencia de inferencia ni utilizar un temporizador para marcar un efecto no ejecutado. Si falta evidencia de la enmienda o referencia de autorización comercial, la rama correspondiente pide el campo o abre el formulario. Si los datos cambian, el texto interpola el resultado actual; no repite un importe incompatible con el backend.

## Recorrido de cinco minutos

### 0:00–0:45 — Construir

Mostrar un perfil Full-service ya preparado; modificar el nombre de la aplicación, un responsable de aprobación o una capacidad. Abrir el catálogo con nueve módulos y 42 skills. Explicar que todos están disponibles; una agencia activa lo que usa. Guardar y recargar el borrador para demostrar persistencia si conviene.

Narración: “This is one product foundation configured around the way an agency works. The controls stay in place as the agency expands or simplifies its operation.”

### 0:45–1:15 — Activar

Mostrar resumen, dependencias y cuentas simuladas. Activar y entrar a Estudio Solar. El botón publica configuración y habilita un tenant de demo; no mostrar cuentas cloud ni comandos. Comprobar el mismo nombre, color y procesos configurados.

Narración: “The user configures the business. AgeOS handles how that configuration becomes an application.”

### 1:15–2:35 — Operar el trabajo

Abrir el expediente Aurora y el panel derecho Assistant. Seleccionar o escribir la petición soportada “Why did Aurora's projected margin fall, and what needs approval?”. El driver ejecuta la secuencia programada de consultas y handoffs; la respuesta enlaza al trabajo, horas, forecast y propuesta. Explicar que la conversación está guionada. Recorrer Scope, Production, Media y Finance brevemente, conservando el hilo. Mostrar el desglose inicial y el incidente de 40 horas. La relación debe verse: cada costo y compromiso enlaza al job correcto; el presupuesto de medios administrado no se suma como ingreso propio.

Abrir la propuesta de cambio, mostrar la revisión exacta, la evidencia sintética de PO v2 por USD 53,000 y aprobar con finance approver. La aprobación comercial inicial corresponde al owner; la aceptación del cliente se documenta aparte de las aprobaciones internas. Una nueva lectura muestra el forecast actualizado, no una tarjeta hardcodeada. Volver a Profitability y comprobar el mismo total.

Narración: “I can manage the work through the assistant or the screens. Both use the same records and rules, so the operational decision and its financial consequence stay connected.”

### 2:35–3:25 — Mostrar control y confiabilidad

Intentar una acción inválida segura: reusar una aprobación obsoleta, exceder un PO o registrar una factura duplicada de ejemplo. El sistema la bloquea y explica cómo corregirla. Mostrar auditoría y permiso independiente. No utilizar una transferencia real o lanzamiento de anuncios para demostrar seguridad.

Narración: “The scripted assistant uses the same rules as the human interface. It can prepare an action; the system still enforces who can execute it and against which version.”

Mostrar una petición de escritura del asistente que requiere aprobación. Un “yes” genérico en el chat no aprueba otra revisión ni permite autoaprobación. Usar la tarjeta exacta de aprobación y comprobar que la pantalla se actualiza desde el resultado comprometido. Abrir Assistant desde el sidebar para mostrar el mismo hilo a página completa; regresar al expediente conserva el contexto autorizado.

### 3:25–4:10 — Conexiones y documentos

Abrir una cuenta simulada con scopes; señalar qué flujos la usan y cómo se puede empezar con archivos. Abrir un documento relacionado del job y su evidencia. Si la carga real está terminada, subir un CSV de ejemplo, revisar columnas y guardar. Mostrar importación duplicada bloqueada solo si fue probada.

Narración: “The agency keeps its tools. AgeOS provides a shared operating model above them, with source and permission attached to the data.”

### 4:10–4:40 — Operación de la plataforma

Entrar con rol autorizado a Operations y abrir `ops_csv_delimiter_mismatch`. El archivo de demo tiene seis columnas separadas por `;`; el perfil de importación usa `,` y el parser devuelve una columna. Mostrar el resultado real, proponer cambiar solo el delimitador del perfil demo, aprobar con un administrador de plataforma distinto del solicitante y volver a analizar el mismo archivo. El resultado verificado ahora tiene las seis columnas esperadas y la auditoría identifica el cambio. No se importan órdenes ni se modifica configuración global. Este circuito determinista es obligatorio para dar la demo por terminada; un preview de diseño no lo sustituye. No crear un PR remoto ni afirmar que se reparó infraestructura cloud.

Narración: “The same design extends to the platform. This sample import is using the wrong delimiter. We can review the evidence, approve a specific correction and verify that all six columns are now recognized. The incident is synthetic; the parsing and configuration change are real within the demo.”

### 4:40–5:00 — Cierre

Volver a la aplicación de la agencia. Mostrar cobertura 9/42 y dar una frase de posicionamiento. Si preguntan por el moat, responder en términos sencillos:

> “AgeOS lets an agency build and run its own operation on a reusable agentic ERP foundation. We aim to make setup and day-to-day execution simpler, while every completed job adds structured operational context for that agency.”

No presentar “data network effects” entre clientes, aprendizaje automático o ahorros medidos como hechos si no están implementados y autorizados.

## Métricas del ejemplo y respuestas esperadas

| Pregunta | Respuesta verificable en la demo |
|---|---|
| ¿Por qué cayó el margen? | 40 horas × USD 50 = USD 2,000 de costo proyectado adicional, fee original sin cambio. |
| ¿Por qué subió al aprobar el cambio? | Fee pasó de USD 20,000 a USD 23,000; costo proyectado permanece USD 13,000; margen proyectado USD 10,000 / 43.5%. |
| ¿Cuánto dinero administra la agencia en medios? | USD 30,000 en este ejemplo, separado del fee propio. |
| ¿USD 53,000 es ingreso de la agencia? | No. Es el total del ejemplo de fee más medios trasladados al cliente; el fee propio es USD 23,000. |
| ¿Es margen ya realizado? | En este recorrido es proyectado. El reconocimiento depende de horas, entregas y registros aprobados; el cierre es otro escenario. |
| ¿Está conectado a Meta, Salesforce o al banco? | Las cuentas y respuestas externas son simuladas en este chasis. Sus contratos están separados para conectar proveedores reales después. |
| ¿La IA tomó esa decisión? | No se llama a un modelo en esta demo. El driver ejecuta conversaciones y handoffs programados; cálculos, permisos y ejecución se validan en el ERP, y el humano aprueba según política. El modelo real se incorporará en una etapa posterior. |
| ¿Puedo pedir cualquier cosa? | Esta versión cubre los casos programados; una petición fuera de ellos explica el alcance y ofrece opciones soportadas. No se afirma comprensión general. |
| ¿Puede consultar todo? | Conoce las entidades y capacidades del ERP, pero solo consulta los registros, campos y documentos permitidos para esta agencia y usuario. No tiene acceso administrativo ilimitado ni SQL libre. |
| ¿Es otro agente agregado al catálogo? | Es `agency-orchestrator`, una de las 42 skills existentes, presentado mediante chat completo y panel contextual; coordina los subagentes habilitados. |
| ¿El cliente configura servidores? | No. Configura su operación; la plataforma publica la configuración en un espacio lógico propio. |
| ¿Solo funcionan tres módulos? | El objetivo de aceptación incluye nueve módulos y 42 capacidades, cada una con entrada, validación y resultado persistido; el guion muestra una cadena representativa. |

## Presentación a YC

El usuario contempla **Fall 2027** como objetivo. Confirmar nombre de convocatoria, fechas y requisitos cuando abra; esta especificación no afirma que estén publicados o que se haya presentado una solicitud.

La página oficial de YC distingue el video de presentación de los fundadores, de un minuto, y pide que no sea un video promocional ni una demo de producto: [YC application video](https://www.ycombinator.com/video). Por ello:

- Mantener este recorrido de producto separado del video de fundadores y de los campos de la solicitud.
- Preparar una URL de demo y, si la solicitud vigente lo permite, un video del producto. Verificar duración/formato entonces.
- No afirmar usuarios, revenue, rapidez de activación, cobertura de integraciones o resultados de clientes que todavía no se hayan medido.
- La demo con datos sintéticos demuestra una hipótesis y capacidad de ejecución; no sustituye validación comercial con agencias.

## Criterio para decir “lista para enseñar”

Se puede grabar y presentar cuando el recorrido termina de principio a fin sin edición engañosa; el asistente guionado ejecuta consultas y comandos programados y devuelve evidencias; página y panel conservan el mismo hilo; los números provienen de datos persistidos; refrescar conserva estado; la persona correcta aprueba; las reglas bloquean lo inválido; todos los módulos/capacidades tienen su flujo mínimo; EN/ES funciona; las etiquetas de conversación guionada están presentes y los artefactos exportados son reales y honestos. No se requiere un modelo: se exige que los casos programados funcionen E2E sin llamadas a modelos/proveedores.

El guion corto y el extendido son recorridos de presentación. **Después de construir el chasis, la instrucción 2 debe programar todos los casos de `demo-scenarios-v1.json`, siguiendo `08-instruccion-2-demo-e2e.md` y `PROMPT-2-DEMO-E2E.txt`.** La cobertura completa incluye las 42 capacidades y los tres pilares; no se considera terminada por pasar solo la historia de Aurora.

Tener a mano un reset autorizado, un fixture limpio, un respaldo de la grabación y una lista breve de lo aún simulado. No esconder una caída del backend con capturas o métricas inventadas.
