# AgeOS — Aceptación del chasis y evidencia de entrega

Esta lista verifica la aplicación que construirá Claude Code. Ninguna casilla se considera cumplida por existir en esta especificación. El resultado de cada prueba debe enlazar a un test, registro o captura de la versión construida.

## Contrato de entrega

La demo tiene persistencia real y reglas deterministas, nueve módulos y 42 procedimientos funcionales. El asistente usa un driver guionado que representa a `agency-orchestrator`, coordina los procedimientos especializados existentes y utiliza los mismos servicios que la UI. Las respuestas pueden estar precargadas y hardcodeadas; las cifras dinámicas, estados y efectos deben provenir del backend. Los proveedores externos del ERP están simulados e identificados. No hay inferencia ni llamadas a modelos o proveedores externos. La interfaz es inglés/español; la navegación y sus datos se mantienen al cambiar de idioma. El alcance actual se acepta mediante recorridos determinísticos completos, reproducibles y rotulados como demo; no requiere credenciales ni pruebas de un modelo real.

## Asistente global y orquestación obligatorios

Aplicar también `07-asistente-global-erp.md`, `asistente-global-v1.json` y, al completar el chasis, `08-instruccion-2-demo-e2e.md` / `demo-scenarios-v1.json`. Los escenarios A01–A18 de 07/JSON son el catálogo canónico del asistente; AG01–AG14 son las condiciones transversales de este documento. Registrar versión del driver, escenario, checkpoint y resultado. El objetivo es programar todos los casos de uso para recorrerlos E2E sin modelo.

| ID | Comprobación | Evidencia esperada |
|---|---|---|
| AG01 | Driver guionado funcional en EN/ES | Prompts/sugerencias/variantes soportadas recorren ramas programadas, solicitan campos faltantes y consultan herramientas; texto precargado permitido con etiqueta demo; fuera de cobertura informa y ofrece casos soportados |
| AG02 | Sidebar abre `/a/:agencySlug/assistant`; cabecera abre panel derecho en pantallas autorizadas | `page.tsx` real, navegación directa y captura de ambas superficies; mismo contenido y ausencia de segundo panel en la página completa |
| AG03 | Un hilo sobrevive cambios de ruta, panel, recarga y reconexión | IDs/eventos persistidos y pruebas de continuidad; cerrar panel no cancela o reinicia el trabajo |
| AG04 | Tenant, usuario y permisos gobiernan conversación, contexto, adjuntos, herramientas y delegaciones | Dos agencias y distintos roles; IDs ajenos y acceso revocado fallan en servidor; contexto heredado no amplía permisos |
| AG05 | Respuestas de datos se sustentan en registros autorizados | Referencias, revisión/fecha de corte, moneda y definición; cifras iguales a la UI; catálogo semántico y consultas parametrizadas sin SQL libre |
| AG06 | El driver del orquestador coordina capacidades y handoffs habilitados | Registro verificable de pasos programados, inputs/results y permisos; las 42 IDs originales permanecen, sin módulo adicional ni skill 43; no se atribuye inferencia a un handoff guionado |
| AG07 | Escrituras y propuestas usan los mismos command handlers | Prueba chat/UI del mismo efecto, validación, revisión esperada y auditoría; el guion no cambia directamente saldos/estados para fingir éxito |
| AG08 | Aprobación exacta, independiente y vigente | Un sí genérico, autoaprobación, payload distinto o revisión obsoleta no autoriza; tarjeta exacta usa identidad y política del servidor |
| AG09 | Cancelar, reconectar y reanudar no duplican ni esconden efectos | Detener secuencia cancela únicamente trabajo cancelable; operación ya comprometida conserva recibo; estado incierto se concilia antes del reintento |
| AG10 | Mensajes y eventos repetidos o fuera de orden se manejan | Idempotencia de turno/comando, cursor/event ID, actualización de UI una vez, resultados recuperables tras interrupción |
| AG11 | Datos recuperados son datos, no instrucciones privilegiadas | Documento o respuesta de tool con instrucciones maliciosas no modifica política ni permite consultas/escrituras fuera de alcance |
| AG12 | No se llama a modelos ni proveedores externos | Prueba de ausencia de solicitudes externas de inferencia/negocio; ningún token/costo/razonamiento IA inventado; estados de fallo del proveedor son fixtures rotulados |
| AG13 | Alcance de demo explícito | `Scripted demo / Demo guionada` visible; respuestas precargadas reconocidas; petición no soportada no inventa datos ni comprensión general; todos los escenarios funcionan sin credenciales de modelo |
| AG14 | Contenido ReUI y controles son accesibles | `ai-chat-6` adaptado a Verve, docking basado en `app-shell-18`, foco/escape/teclado/móvil; Agent Activity es evidencia, no sustituto de chat |

Para marcar AG06, demostrar handoffs programados que ejecutan procedimientos autorizados y trazabilidad del registro de las 42 capacidades. El texto y selección de especialidad pueden estar guionados; los pasos, datos y efectos registrados deben corresponder a ejecuciones reales del núcleo. No es necesario que se ejecuten modelos o subagentes LLM. La falta de credenciales de IA no es un bloqueo para esta aceptación. La instrucción 2 debe cubrir todos los casos E2E, no solo los ejemplos del guion corto.

## Pruebas de negocio obligatorias

| ID | Comprobación | Evidencia esperada |
|---|---|---|
| D01 | Las 42 skills de `cobertura-42-skills.json` tienen handler, entrada, resultado persistido y prueba | Mapa generado con 42 IDs únicos y enlaces a implementación/tests |
| D02 | Todos los nueve módulos tienen recorrido básico ejecutable | Navegación y pruebas por módulo; ningún módulo vacío como sustituto |
| D03 | Las cifras de `demo-fixtures.json` se reproducen exactamente | Comparación de resultados por etapa y definición de redondeo |
| D04 | Orden, entrega, factura y pago no duplican el costo | Prueba de conciliación y saldo comprometido/residual |
| D05 | Una aprobación vieja no autoriza una revisión nueva | Resultado de bloqueo y solicitud de aprobación vigente |
| D06 | Reintentar el mismo comando no duplica efectos | Misma clave + payload devuelve resultado; distinta carga con misma clave se rechaza |
| D07 | Dos editores sobre la misma revisión no pisan cambios | Conflicto controlado y recarga del estado vigente |
| D08 | Un timeout externo incierto se concilia antes de reintentar | Historial del adaptador simulado y un solo efecto final |
| D09 | Cierre y reapertura siguen reglas y permisos | Bloqueo por pendientes; reapertura registrada cuando esté habilitada |
| D10 | Monedas, fecha de corte y reconocimiento son explícitos | Métricas reproducibles sin sumas de monedas incompatibles |
| D11 | El lote de pagos exige fondos disponibles y respeta reservas concurrentes | Antes del cobro se bloquea el lote de USD 43,000 con caja USD 10,000; cobro inicial USD 40,000 permite pagarlo; cobro final USD 13,000 deja caja USD 20,000 |
| D12 | Operación de plataforma ejecuta un circuito local mínimo | El CSV de demo pasa de una columna a seis al corregir su delimitador mediante propuesta, aprobación independiente, revisión aplicada y relectura; cambios persistidos y auditados; sin PR remoto ni cambio cloud |

## Aislamiento y persistencia

- Probar con dos agencias: acceso cruzado a listas, detalle por ID, acciones, exportación, documentos, búsqueda, aprobaciones, sesión reanudada y eventos.
- El identificador de agencia del cuerpo de una petición no concede acceso. La membresía se comprueba en el servidor.
- Verificar permisos por rol mediante llamadas directas al backend, además de botones ocultos.
- Reiniciar la aplicación/recargar el navegador conserva borradores, aprobaciones, revisiones y resultados.
- Un reset solo afecta al espacio de demostración autorizado y deja registro. No se expone como endpoint anónimo.
- Ninguna prueba utiliza datos personales reales, tokens de Ads, datos bancarios o una base de producción.
- Las claves de licencia ReUI, conexión a base y sesión permanecen fuera del cliente y del repositorio.

## Interfaz y navegación

1. Login de demo protegido → configuración → revisión → activación → workspace.
2. Crear/abrir trabajo → presupuesto → aprobación → ejecución → facturación/cobro → rentabilidad.
3. Detectar excepción → inspeccionar evidencia → revisar diferencia → autorizar corrección → comprobar impacto.
4. Visitar los nueve módulos desde la navegación o búsqueda; entrar por enlace directo y utilizar atrás/adelante.
5. Cambiar EN/ES sin reiniciar la operación; fechas, números y monedas se muestran correctamente.
6. Verificar búsqueda, filtros, paginación, orden, selección, detalles y acciones de cada grid realmente utilizados.
7. Completar estados vacíos, cargando, error, permiso insuficiente, revisión obsoleta y conexión simulada desconectada.
8. Revisar a 390, 768 y 1440 píxeles; tablas desplazan dentro de su región y no desbordan toda la página.
9. Teclado, foco visible, diálogos, retorno de foco, encabezados y etiquetas de controles sin texto.
10. Revisar tema claro y oscuro usando los componentes y tokens originales de ReUI.
11. Acceder al circuito de plataforma solo con rol habilitado; una sesión de dueño de agencia no obtiene esos permisos. El incidente es de muestra, pero la transición y el ajuste local sí deben ejecutarse y persistir.
12. Abrir Assistant como página completa y como panel contextual, conservar el mismo hilo y revalidar contexto al cambiar de agencia. El chat ERP no hereda privilegios de `/ops`.

## ReUI

Antes de afirmar que la interfaz está lista: `validate_usage`, `get_audit_checklist`, comprobaciones C1–C4 del skill vigente, typecheck, lint y revisión visual de las pantallas construidas. Registrar cualquier excepción con archivo, línea y motivo. No usar solo una captura de la portada como prueba de toda la aplicación.

Las capturas mínimas son configuración, revisión de activación, overview, expediente del trabajo, plan/compra de medios, conciliación de factura, aprobación con diferencia, rentabilidad, biblioteca, página Assistant, panel derecho contextual y pantalla móvil. Registrar la ruta y el escenario para poder reproducirlas. Evitar capturar secretos o cuentas reales.

## Guion y honestidad de la demo

- Los datos de negocio son sintéticos y las llamadas externas están señaladas como simuladas.
- Los pasos de una ejecución representan procedimientos reales y handoffs programados. Las respuestas precargadas están permitidas y rotuladas como demo; nunca se presentan como inferencia de un modelo ni se muestra razonamiento privado ficticio.
- La aplicación no muestra como realizadas compras de dominios, pagos, activaciones de campañas o emisión fiscal reales.
- Todas las cifras del recorrido comercial enlazan a su cálculo y registros; no hay tracción o ahorros inventados.
- El guion corto es una selección de un ERP completo, no el límite funcional de la entrega.
- El tiempo de configuración solo se comunica como resultado medido en la demo, con su alcance explícito.
- La demo de producto se prepara separada del video de fundadores requerido actualmente por YC. Revisar los requisitos al presentar la aplicación de Fall 2027.

## Evidencias que Claude Code debe entregar

| Archivo propuesto | Contenido |
|---|---|
| `app/README.md` | Arranque, entorno, migraciones, seed, acceso y reset de demo |
| `app/IMPLEMENTATION_STATUS.md` | Qué está implementado, simulado, probado y pendiente |
| `app/evidence/skill-coverage.json` | Los 42 IDs y sus handlers/tests/rutas reales |
| `app/evidence/test-results.md` | Comandos ejecutados, fecha, versión y resultado; fallos sin ocultar |
| `app/evidence/screenshots/` | Capturas de escenarios y tamaños indicados |
| `app/evidence/demo-rehearsal.md` | Recorrido ensayado, estado inicial y resultado observado |
| `app/evidence/assistant-evals.md` | Casos guionados EN/ES, versión del driver, tool runs, referencias, aprobaciones, fuera de alcance y resultados de AG01–AG14; prueba de ausencia de llamadas a modelos |

Los nombres son contratos de salida propuestos; no son archivos de pruebas ya producidos. Si una herramienta o permiso impide verificar algo, anotar el bloqueo exacto y conservar lo que sí se comprobó. La aplicación se considera lista para presentar cuando las pruebas relevantes y el recorrido de demo pasan, no cuando se termina el diseño visual.

Referencia sobre la separación entre video de fundadores y demo: [Y Combinator](https://www.ycombinator.com/video).


El catálogo canónico de escenarios del asistente es A01–A18 en `07-asistente-global-erp.md` y `asistente-global-v1.json`; AG01–AG14 son condiciones transversales de entrega de este documento. Guardar resultados de escenarios en `app/evidence/assistant-acceptance.md`, evaluaciones del driver guionado en `app/evidence/assistant-evals.md` y cobertura de las 42 skills en `app/evidence/assistant-tool-coverage.json`. Completar además la evidencia de todos los casos E2E definida por `08-instruccion-2-demo-e2e.md` y `demo-scenarios-v1.json`. Mantener una relación explícita caso → skill/pilar → pasos → resultado → prueba; ningún caso se marca terminado solo por tener una respuesta de chat.
