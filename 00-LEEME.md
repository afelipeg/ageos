# AgeOS — De la arquitectura a una demo ejecutable

Este paquete contiene las instrucciones para que Claude Code construya el chasis de AgeOS. Incluye pantallas, navegación, reglas, datos de prueba, selección de ReUI y guiones para presentar el producto. **La aplicación todavía debe construirse.**

**Promesa:** Construya su agencia con el poder de la infraestructura agéntica ERP de AgeOS.

El alcance aprobado conserva **los nueve módulos y las 42 skills**, con interfaz en **inglés y opción de español**. Los datos, permisos, cálculos y aprobaciones serán reales dentro de la demo. **El asistente será determinístico y guionado, con respuestas y casos precargados:** representa al orquestador ERP existente y coordina sus procedimientos sobre las mismas reglas que las pantallas. Las cifras variables vienen del servidor, no de una copia desconectada en el guion. Las conexiones externas del ERP —anuncios, pagos, contabilidad, OAuth y dominios— estarán simuladas y señaladas. No se requiere ni se llama a un modelo de IA o proveedor externo para recorrer la demo.

## Su siguiente paso

1. Descargue **[Verve](https://reui.io/template/verve-crm)** desde su cuenta de ReUI. Es la única plantilla necesaria para empezar. Puede ver su [preview](https://verve-crm.reui.io).
2. Coloque el ZIP original o su carpeta descomprimida en `inputs/reui/verve/`. Conserve la licencia y no incluya claves ni archivos con secretos.
3. Abra **esta carpeta completa** en Claude Code. Si la lleva a otra computadora, copie también `referencias/`; el ZIP de entrega contiene el paquete completo, pero no la plantilla comercial.
4. Conecte ReUI al entorno de Claude Code, con la misma cuenta que tenga acceso a los recursos. La conexión usada en Codex no se transfiere automáticamente. Hay ejemplos seguros en `configuracion/` y detalles en el documento 04.
5. Pegue el contenido de **[PROMPT-PARA-CLAUDE-CODE.txt](./PROMPT-PARA-CLAUDE-CODE.txt)**. Claude leerá `CLAUDE.md`, inspeccionará Verve y construirá la aplicación en `app/`.
6. Al terminar el chasis, use **[PROMPT-2-DEMO-E2E.txt](./PROMPT-2-DEMO-E2E.txt)**. Esa segunda instrucción exige programar y probar todos los casos de uso de punta a punta según **[08 — Demo E2E](./08-instruccion-2-demo-e2e.md)** y **[demo-scenarios-v1.json](./demo-scenarios-v1.json)**. No se limita a la presentación de 90 segundos: debe cubrir las 42 capacidades y los tres pilares.

No necesita entregar claves de modelos ni de plataformas de clientes para esta etapa. La experiencia muestra `Scripted demo / Demo guionada`; fuera de los casos programados explica su alcance y ofrece recorridos disponibles. La IA real queda para una etapa posterior.

No hace falta descargar varias aplicaciones. Flowly y Flux quedan como referencias opcionales; los bloques elegidos se incorporan dentro de Verve. Las versiones y APIs deben comprobarse contra la fuente que descargue.

## Qué contiene el paquete

| Archivo | Para qué sirve |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Instrucciones permanentes que Claude Code carga desde el proyecto |
| [01 — Brief y plan](./01-brief-y-plan-de-construccion.md) | Promesa, alcance y orden de construcción |
| [02 — Pantallas y flujos](./02-pantallas-y-flujos.md) | Recorrido desde configuración hasta operación; acciones, estados y navegación |
| [03 — Chasis determinístico](./03-chasis-deterministico.md) | Datos, reglas, estados, permisos, cálculos y contratos de ejecución |
| [04 — ReUI](./04-reui-seleccion-e-instalacion.md) | Comparación de las 18 plantillas, selección de bloques, componentes, iconos y pasos de instalación |
| [04A — Dirección de producto y mapa UI](./04A-direccion-producto-y-mapa-ui.md) | Decisiones concretas de composición, bloques por pantalla, componentes e iconos exactos del sidebar |
| [05 — Guion de demo](./05-guion-demo-inversionistas.md) | Recorridos de 90 segundos y cinco minutos, con evidencias y narrativa |
| [06 — Aceptación](./06-aceptacion-y-evidencias.md) | Qué debe funcionar y cómo demostrarlo antes de presentar |
| [07 — Asistente global ERP](./07-asistente-global-erp.md) | Orquestador, subagentes, conversación contextual, página de chat y panel lateral derecho |
| [08 — Instrucción 2: demo E2E](./08-instruccion-2-demo-e2e.md) | Programación y verificación de todos los casos de demostración después del chasis |
| [Escenarios E2E](./demo-scenarios-v1.json) | Casos de uso, checkpoints, resultados esperados y cobertura integral |
| [Contrato del asistente](./asistente-global-v1.json) | Contratos estructurados de contexto, consultas, ejecución y aceptación |
| [Referencia Commerce Assistant](./REFERENCIA-COMMERCE-ASSISTANT.md) | Patrones comprobados en el repositorio de referencia y límites para adaptarlos |
| [Cobertura de 42 skills](./cobertura-42-skills.json) | Entrada, procedimiento, resultado, ruta y prueba de cada capacidad |
| [Rutas y pantallas](./rutas-y-pantallas.json) | Inventario estructurado para implementar la navegación |
| [Datos de demo](./demo-fixtures.json) | Agencias ficticias, escenario, importes y resultados esperados |
| [Inventario ReUI](./reui-inventario-verificado.json) | Recursos e IDs comprobados mediante el MCP |
| [Referencias](./referencias/manifest.json) | Arquitectura y catálogos anteriores, conservados como contexto |

`referencias/agency-erp-all-skills.zip` conserva la copia local de las 42 skills del repositorio, incluidos los contratos de cálculo. Claude debe inspeccionar esos archivos como fuente del ERP y comprobar su procedencia contra el commit indicado; la copia no constituye por sí sola una verificación del commit.

Las rutas reutilizan familias de pantalla; no implican construir un diseño distinto para cada destino. El guion principal recorre un trabajo completo y los casos secundarios prueban las capacidades restantes. **El guion corto no reduce el alcance del ERP.**

## La demostración que vamos a construir

La agencia ficticia **Rayo de Sol** configura su aplicación **Estudio Solar**, activa su espacio y abre un trabajo de **Aurora Beverages**. Un cambio de alcance añade 40 horas, afecta el margen proyectado y requiere una aprobación. El nuevo fee se refleja en el expediente, el reporte y la bitácora desde los mismos registros.

Ese caso hace visible el valor de AgeOS: configurar una operación propia y conservar conectadas sus decisiones, documentos y cifras. El humano puede seleccionar o escribir una petición soportada, preparar un cambio y abrir sus evidencias desde el asistente. Un driver determinístico reconoce el caso programado; los servicios del ERP calculan y controlan cada efecto. El texto de respuesta puede estar precargado, pero el resultado financiero refleja el estado persistido del escenario.

**Assistant** en el sidebar abre la página completa de conversación. La acción global de la cabecera abre el mismo hilo en un panel lateral derecho desde las otras pantallas. No son dos agentes ni una capacidad adicional: es `agency-orchestrator`, con acceso a los registros permitidos, coordinación de subagentes y aprobaciones exactas. Se conserva Verve, con contenido de `ai-chat-6` y referencia de acoplamiento de `app-shell-18`; Agent Activity sirve para evidencia de ejecución.

## Qué significa “terminado”

Claude debe entregar una aplicación que arranque, conserve datos al recargar, aplique permisos por agencia, ejecute los 42 procedimientos y pase las comprobaciones del documento 06. Debe completar el asistente guionado y todos los recorridos E2E, con consultas sustentadas en registros, handoffs programados y acciones gobernadas; conservar el hilo entre página y panel; y registrar pruebas realmente ejecutadas, capturas del navegador y limitaciones pendientes. La aceptación actual no exige un modelo real ni se bloquea por falta de sus credenciales.

Este paquete ya tiene revisión documental y comprobaciones de estructura y aritmética. Eso no equivale a pruebas de una aplicación. No se descargó la plantilla, no se instaló un proyecto y no se desplegó una demo durante esta preparación.

El [registro de validación del paquete](./VALIDACION-PAQUETE.json) conserva los resultados: correspondencia de las 42 skills, rutas, entregables del repositorio, 26 calculadoras, cifras del escenario, balance contable, fuentes y enlaces locales.

La meta de YC Fall 2027 se conserva como objetivo del fundador. El recorrido de producto es independiente del video de presentación de fundadores; el documento 05 explica esa distinción.
