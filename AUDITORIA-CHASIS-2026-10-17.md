# Auditoría del chasis AgeOS — 17 octubre 2026

**Conclusión del corte revisado: chasis incompleto.** Claude Code continuaba editando durante la auditoría, confirmado por el usuario. Este documento describe evidencia del corte, no una certificación de cambios posteriores. No se modificó código de la aplicación.

## Comentarios principales

- **Navegación bloqueada:** 6 de 31 patrones de página presentes; 14 de 17 destinos del sidebar sin página. Confirmados en navegador 404 desde crear agencia, planificación de medios, New job y cliente encontrado en búsqueda.
- **Base útil que sí funciona:** sesión demo, Overview, Jobs, siete pestañas del expediente, búsqueda y consulta programada de margen. Respuesta del chat y expediente coincidieron en USD 20,000 de fee, USD 11,000 de costo y 45% de margen. Historial recuperado después de navegación/recarga.
- **Asistente:** pérdida de borrador y retorno sin la pestaña original reproducidos. Selección de hilo, respuestas tardías, cancelación y recuperación requieren correcciones indicadas en los informes.
- **Núcleo:** hallazgos estáticos en idempotencia, doble envío concurrente, evidencia de PO, aprobaciones diferidas, revocación de permisos y numeración. Son riesgos concretos de implementación; su reproducción de regresión está indicada para Claude. No se afirma una fuga entre agencias demostrada.
- **Tema:** default actual Light. El selector oscuro sí funcionó y persistió al recargar. El tema Vercel oficial y el default oscuro siguen siendo trabajo de implementación.
- **OpenUI:** viable como renderer de cards/charts/dashboard dentro del asistente existente, con datos programados y autorizados. No ejecutar create para reemplazar el app. Compatibilidad de dependencias pendiente de comprobar al instalar.
- **Entrega/DX:** README conserva instrucciones de CRM Verve que contradicen PostgreSQL y sesión reales; faltan documentación de estado/handoff y acreditación E2E completa.

## Pruebas y límites

Se ejecutó el binario local Vitest: **85 pruebas, tres archivos, todas pasaron**. Antes se verificó que DB de test y migraciones apuntaran a la misma base exclusiva de test y a una distinta de desarrollo. El log está en ../.validation/auditoria-chasis-2026-10-17/test-full.log. La conexión local requirió autorización del entorno.

Prueba manual con navegador sobre localhost:3100: las seis páginas presentes, flujo de login, destinos representativos ausentes, siete pestañas del expediente, consulta de margen, transición página/panel, recuperación de historial, búsqueda y selector oscuro. Se guardaron capturas en ../output/playwright/auditoria-chasis-2026-10-17/. No se realizó un barrido certificado de todos los dispositivos, accesibilidad, todas las rutas dinámicas o toda la lógica de comandos. Lint, typecheck, build y E2E completos no se ejecutaron ni están certificados por esta auditoría. El JSON oficial del tema tampoco pudo recuperarse; no se atribuyen valores exactos al registro de TweakCN. No se reseteó la DB de desarrollo; la consulta de prueba creó historial/run de demostración y se seleccionó Dark en la preferencia del navegador.

La falta inicial de sugerencias en conversación vacía se corrigió en código durante la revisión; no se cuenta como hallazgo vigente. Hace falta confirmar el cambio integrado con una nueva conversación. Los otros hallazgos se releyeron tras detectar cambios concurrentes.

## Qué entregar a Claude

Use **PROMPT-UNICO-AUDITORIA-AGENTES-E-INSTRUCCION-2.md**. Contiene las recomendaciones, seis responsabilidades de agentes, reparto de archivos, orden de integración, tema Vercel, OpenUI, regresiones y la instrucción 2 completa. El coordinador debe revalidar qué ya cambió antes de editar.

Mantener la distinción: en el corte hay 42 contratos y 9 handlers; los 33 restantes no eran por sí solos un defecto de instrucción 1. El nuevo encargo completo sí debe terminar 42 handlers, 84 casos positivos/negativos y diez recorridos.

Informes de detalle: ../.validation/auditoria-chasis-2026-10-17/frontend-review.md, backend-review.md y openui-recommendation.md. Inventario de 31 rutas: routes-audited.json. Huellas del código revisado: source-snapshot.json. Las referencias de línea pueden cambiar mientras Claude trabaja.

## Fuentes para las decisiones nuevas

- Tema oficial solicitado: https://tweakcn.com/r/themes/vercel.json
- OpenUI Renderer: https://www.openui.com/docs/openui-lang/renderer
- OpenUI independiente del modelo/chat/proveedor: https://www.openui.com/docs/openui-lang/overview
- CLI create y opciones: https://www.openui.com/docs/api-reference/cli
- Integración en aplicación existente: https://www.openui.com/docs/getting-started

OpenUI no está instalado por esta auditoría. Las fuentes acreditan viabilidad general, no compatibilidad de una versión concreta ya probada en AgeOS.
