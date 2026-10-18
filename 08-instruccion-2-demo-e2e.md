# Instrucción 2 — demo determinista completa, de principio a fin

Fecha: 17 de octubre de 2026. Estado: especificación para construir. Ejecutar después de levantar el chasis de la instrucción 1. El resultado requerido es una demo presentable que funciona sin modelo, credenciales de proveedores ni cuentas comerciales.

## Alcance definitivo

Programar todos los casos de uso de los **nueve módulos y las 42 skills**. Los datos, respuestas del asistente, delegaciones y respuestas externas se preparan de antemano. Los comandos, validaciones, cálculos y transiciones se ejecutan y persisten: las pantallas y el chat reflejan el mismo estado.

El orquestador existente atiende página de chat y panel derecho. Un driver `scripted` selecciona casos previstos y sus herramientas. La arquitectura futura permite sustituir ese driver; integrar un LLM no es requisito de esta etapa.

Una etiqueta discreta y permanente identifica **Demo · Scripted assistant · Simulated integrations**. No se presentan como reales campañas, cobros, pagos, DNS, búsquedas externas o generación de IA. No usar indicadores de tokens ni costos de inferencia inventados.

## Archivos que gobiernan la implementación

- `demo-scenarios-v1.json`: diez recorridos de producto y 42 escenarios, uno por skill; cada uno tiene un caso positivo y otro negativo.
- `cobertura-42-skills.json`: handlers, entradas, resultados del repo y calculadoras requeridas.
- `demo-fixtures.json`: identidades sintéticas, cifras, fechas, asientos, casos secundarios, aislamiento y reset.
- `07-asistente-global-erp.md` y `asistente-global-v1.json`: conversación, orquestador, autorizaciones y escenarios A01–A18.
- `02-pantallas-y-flujos.md` y `rutas-y-pantallas.json`: rutas y controles, incluida la página chat y el panel global.
- `03-chasis-deterministico.md`: reglas, aprobación, dinero e idempotencia.
- `05-guion-demo-inversionistas.md` y `06-aceptacion-y-evidencias.md`: recorridos de presentación y pruebas.

El manifiesto es una especificación, no una lista de pruebas ya pasadas. Mantener `implemented=false` hasta tener código y evidencia. No cambiar los IDs originales ni reducir el alcance.

## Preparación del escenario

1. Comprobar que el chasis arranca y completar cualquier pieza necesaria para los recorridos. No reemplazar Verve ni construir una segunda app.
2. Implementar seeds reproducibles, un reloj de negocio fijo y un `demo_run_id`. Las marcas temporales de auditoría conservan su tiempo real.
3. Ofrecer `from_intake` para recorrer desde alta/configuración y `ready_for_scope_review` para presentar directamente el cambio de alcance. El segundo crea un checkpoint coherente; no marca como realizadas operaciones posteriores.
4. Separar la agencia principal Rayo de Sol, la agencia de aislamiento Norte Studio y los ejercicios `demo-lab`. Los casos de depreciación, revaluación u otros secundarios no contaminan los KPIs del caso principal.
5. El reset es una acción del presentador autenticado y afecta únicamente su run/agencia demo. Mantener auditoría y no borrar otros tenants.
6. Proveer un lanzador de escenarios protegido con nombre, punto de entrada, actor requerido, estado inicial y resultados esperados. Se puede salir de un recorrido y navegar manualmente conservando los registros.

Los saltos entre capítulos deben cargar snapshots coherentes o reproducir comandos idempotentes del fixture. No asignar únicamente un número final a una tarjeta. Un checkpoint no permite saltar una autorización en una acción interactiva posterior.

## Recorridos obligatorios

| ID | Recorrido | Qué debe quedar conectado |
|---|---|---|
| J01 | Configurar y activar agencia | Servicios, equipo, permisos, catálogo, conexiones demo, marca, dominio simulado, revisión y espacio activado |
| J02 | Cliente a producción | Brief, cliente/contrato/PO, trabajo, presupuesto, tareas, horas, proveedor y entregable |
| J03 | Planificar y comprar medios | Audiencias/specs sintéticos, digital/TV/radio/OOH, revisión, órdenes, creativos, campaña demo, entrega, optimización y cambios |
| J04 | Proteger margen ante cambio de alcance | Horas extra, impacto, propuesta de fee, autoridad comercial del cliente y aprobación interna |
| J05 | Conciliar, facturar, cobrar y pagar | Diferencia de factura, corrección, fondos confirmados, liberación autorizada, recibos y saldos |
| J06 | Contabilidad, cierre y rentabilidad | Asientos, conciliación, cierre, P&L, aging, caja y reportes; capacidades secundarias en demo-lab |
| J07 | Orquestador en página y panel | Consulta, evidencia, abrir registro, mismo hilo, aclaración, propuesta, aprobación y efecto visible |
| J08 | Archivos, conexiones y aislamiento | Biblioteca privada, archivos asociados, permiso revocado, agencia ajena y bloqueo verificable |
| J09 | Operar la plataforma | Incidente CSV, diagnóstico, cambio permitido, aprobación independiente, verificación y auditoría |
| J10 | Catálogo completo y excepciones | ERP-01 a ERP-42 con resultado positivo, bloqueo negativo y evidencia por skill |

El recorrido largo combina esos capítulos. Los guiones de 90 segundos y cinco minutos usan checkpoints del mismo sistema; no constituyen un segundo producto con datos incompatibles. La duración se ensaya y mide; no se promete una velocidad no probada.

## Programar las 42 capacidades

Para cada entrada `ERP-xx` del manifiesto:

1. Crear el fixture mínimo válido y el fixture de bloqueo indicado por la matriz. Reutilizar el caso principal cuando corresponde.
2. Conectar su ruta/workbench y comando o consulta real; usar el esquema de entrada declarado y valores de ejemplo editables.
3. Producir todos los `repository_outputs`, incluyendo relaciones, evidencia y referencias. No sustituir salidas por un texto “Completed”.
4. Hacer el mismo caso accesible desde el asistente con el prompt predefinido EN/ES, un botón de sugerencia o el selector de escenario. El orquestador invoca la misma capacidad por su `skill_id`.
5. Registrar origen, actor, ámbito, input validado, resultado, pasos y especialista lógico. La ruta de delegación es programada y se identifica como tal.
6. Verificar el resultado desde otra pantalla y después de recargar. Repetir la solicitud para comprobar idempotencia donde corresponde.
7. Ejecutar el caso negativo y comprobar ausencia de efectos prohibidos, mensaje útil y siguiente acción permitida.

Cada skill necesita al menos un caso positivo y uno negativo: **84 comprobaciones de capacidad**, además de pruebas transversales. No cuenta mostrar 42 tarjetas ni generar 42 respuestas idénticas. El contador de cobertura se deriva de resultados de pruebas.

## Asistente hardcodeado que opera el mismo ERP

Centralizar el guion en un registro versionado dentro de la aplicación. Evitar respuestas y estados dispersos en componentes ReUI. Cada escenario contiene:

- ID, alias EN/ES admitidos, contexto aplicable y esquema de parámetros.
- Requisitos de rol, skill habilitada, estado y revisión.
- Pasos deterministas: lectura, aclaración, preparación, confirmación, solicitud de aprobación, comando y recibo.
- Plantillas de respuesta y tarjetas tipadas con variables procedentes de resultados autorizados.
- Casos de error, reintento y datos faltantes; resultado esperado y evidencia.

Ejemplos mínimos: “Explain Aurora's margin”, “Create a job for Aurora”, “Prepare Aurora's media plan”, “Prepare the Meta campaign”, “Which invoices need attention?” y sus alias en español. Las variantes admitidas se enumeran; una frase no reconocida ofrece los casos disponibles. No se pretende interpretar lenguaje libre ilimitado.

Ejemplo de respuesta de margen: plantilla **“Forecast margin is {margin_percent}, based on {net_fee} net agency revenue and {agency_cost} agency cost.”** El servidor calcula esas variables en cada checkpoint. Nunca responder siempre “35%” si el usuario ya aplicó la modificación aprobada.

Página `/a/:agencySlug/assistant` y panel derecho usan el mismo hilo y driver. El sidebar abre la página; la cabecera abre el panel en la pantalla actual. Los mensajes sobreviven navegación y recarga; el contexto del run se congela al iniciarlo y no cambia silenciosamente al navegar. No abrir dos ejecuciones al ampliar el panel.

El asistente no concede aprobaciones ni asume roles. Puede generar la solicitud y enlazar a Inbox. La persona autorizada actúa con su sesión; el cambio de persona demo pertenece a una herramienta del presentador protegida.

## Cifras que deben cuadrar

La fuente exacta es `demo-fixtures.json`; usar importes enteros menores o decimal exacto, nunca aritmética financiera en texto.

- Inicio: fee USD20,000; costo de agencia USD11,000; margen USD9,000, 45.0%.
- Añadir 40 horas a USD50: costo USD13,000; margen USD7,000, 35.0%.
- Enmienda de fee +USD3,000: fee USD23,000; costo USD13,000; margen USD10,000, 43.5% mostrado.
- Medios administrados USD30,000 se mantienen separados del ingreso neto y margen de agencia.
- Autoridad comercial cliente: USD50,000 → USD53,000, con PO/revisión de evidencia. La aprobación interna no sustituye ese respaldo.
- Factura proveedor USD6,000 frente a entrega USD5,500: bloquear hasta resolver.
- Caja: USD10,000 inicial + USD40,000 de primer cobro − USD43,000 de pagos + USD13,000 de cobro final = USD20,000. Ningún pago permite saldo insuficiente.
- Los 15 asientos previstos se generan conforme ocurren los hechos; cada uno y el balance final cuadran. No cargar el cierre final como realizado al iniciar.

## Integraciones y archivos

Construir adaptadores simulados de resultado estable: éxito, error recuperable, acceso revocado, espera y resultado incierto. Guardar un recibo `sim_*` por operación para poder conciliar sin repetir un efecto. No usar llamadas HTTP a plataformas reales ni solicitar OAuth para la demo.

Audiencias, ad specs, búsqueda web, lectura de terceros y resultados de campaña utilizan fixtures con fuente “Synthetic demo data” y fecha de corte explícita. No atribuir los datos ficticios a un proveedor como si fueran consultados realmente.

Preparar archivos sintéticos válidos que la biblioteca pueda guardar, abrir y descargar. Para extracción no implementada, usar un fixture de extracción asociado al checksum/versión exacta y rotularlo como preprocesado de demo; un upload desconocido no recibe ese contenido ficticio. Las importaciones CSV y cálculos soportados sí aplican validación real.

## Fallos y recuperación para presentar

Además de los negativos por skill, programar y probar:

- Revisión obsoleta, autoaprobación, usuario sin permiso y agencia ajena.
- Presupuesto o cuota insuficiente; conexión revocada; archivo no admitido.
- Factura duplicada, falta de evidencia y orden/entrega/factura discrepantes.
- Campaña con plan sin aprobar o specs incompletas; no activar.
- Repetir envío/confirmación, refrescar y reconectar sin duplicar efectos.
- Resultado incierto: conciliar la operación existente antes de reintentar.
- Cerrar panel o detener texto sin deshacer ni duplicar un comando confirmado.
- Incidente de plataforma: CSV detecta una columna; tras cambio de delimitador aprobado detecta seis columnas y una fila. No crea órdenes ni gasto.

Los controles para inyectar fallos están limitados al entorno/presentador demo; no son una puerta para modificar estados de negocio arbitrarios.

## Finalización de la instrucción 2

Entregar aplicación ejecutable y reproducible, scripts de seed/reset, escenarios EN/ES, capturas y evidencia de pruebas reales. Generar:

- `app/evidence/demo-e2e-results.json`: J01–J10 y ERP-01–ERP-42, positivos/negativos, estado, test y evidencia.
- `app/evidence/demo-e2e-report.md`: qué se recorrió, resultados y limitaciones.
- `app/evidence/assistant-acceptance.md`: A01–A18 adaptados al driver scripted.
- `app/evidence/assistant-tool-coverage.json`: exactamente los 42 IDs originales.
- `IMPLEMENTATION_STATUS.md`: separar chasis terminado de demo E2E terminada.

Ejecutar typecheck, lint, tests de dominio, pruebas E2E en navegador y build. Recorrer página y panel en escritorio/móvil, EN/ES, teclado y tema. La demo debe funcionar con claves de modelos y proveedores ausentes. Si una comprobación no se ejecutó, indicarlo y mantenerla pendiente; no fabricar evidencia.
