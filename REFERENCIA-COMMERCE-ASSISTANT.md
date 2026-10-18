# Referencia Commerce Assistant para AgeOS

Revisión de código local: 17 de octubre de 2026. Repositorio inspeccionado de solo lectura: `/Users/andresgutierrez/Documents/Proyectos_ai/airline-banking-commerce-agent`. No se ejecutó la aplicación, instalaron dependencias ni leyeron secretos. Las líneas identifican la copia local consultada y pueden desplazarse con futuras ediciones.

El repositorio presenta Quasar Airlines, un ejemplo ficticio sobre commerce-agents. La referencia útil para AgeOS es el portal del operador: un asistente global junto a las vistas, respuestas con componentes operativos, propuestas de cambios y aplicación gobernada. **La referencia usa un modelo; la demo AgeOS actual usará guiones y fixtures determinísticos, sin llamadas a modelos.** La especificación normativa está en `07-asistente-global-erp.md` y `asistente-global-v1.json`; los casos completos se programan en la instrucción 2 de `08-instruccion-2-demo-e2e.md` y `demo-scenarios-v1.json`.

## Evidencia de la implementación

Los paths siguientes son relativos al repositorio de referencia.

| Fuente y línea | Comportamiento comprobado | Adaptación AgeOS |
|---|---|---|
| `web-shared/portal/Shell.tsx:28` y `:162` | Shell compuesto por navegación, página y rail del asistente | Montar Assistant en el layout de agencia, preservando Verve |
| `web-shared/portal/Shell.tsx:96` | Entrada de asistente en sidebar que abre/cierra el panel | En AgeOS, sidebar abre la página completa; acción de cabecera abre panel contextual |
| `airline/merchant-web/app/page.tsx:35` y `:45` | Chat y sesión se crean por encima de las vistas | Provider compartido; hilo persistente entre rutas reales |
| `airline/merchant-web/app/page.tsx:59` | Acción contextual abre panel y prellena composer | Acciones Ask Assistant desde trabajo, plan o tabla; contextos validados en servidor |
| `web-shared/portal/AssistantRail.tsx:8`, `:36`, `:59`, `:90` | Ancho inicial 420 px, preferencia, redimensionado, ampliación y overlay móvil | Adoptar patrón de acoplamiento usando ReUI y controles accesibles |
| `web-shared/portal/AssistantPanel.tsx:29`, `:94`, `:114`, `:128` | Cabecera, sugerencias, transcript, actividad y composer | Contenido `ai-chat-6`; actividad complementa la conversación |
| `airline/merchant-web/components/generative/index.tsx:28` | Registro limitado de tarjetas metrics, digest, change_preview y plan_mix | Registro tipado de respuestas: resultados, fuentes, aclaración, draft, diff, aprobación y recibo |
| `airline/merchant-web/components/generative/ChangePreviewCard.tsx:40`, `:62`, `:78` | Antes/después, impacto y restricciones con aprobación | La tarjeta de AgeOS usa payload/revisión exactos y permisos del núcleo |
| `web-shared/protocol.ts:6`, `:50`, `:73` | Eventos tipados de texto, herramientas, UI, cambios, error y completion | Protocolo durable de eventos y renderer allowlisted; no código arbitrario generado |
| `web-shared/portal/merchant.ts:57`, `:75`, `:84` | Un cambio actualiza el transcript y vuelve a consultar las vistas | Invalidar/reconsultar datos tras recibo comprometido; coherencia panel/página |
| `airline/api/portfolio_mix.py:16`, `:49`, `:71` | Modelo elige IDs; backend completa las cifras del componente | Cifras y entidades provenientes de consultas autorizadas, no inventadas por el modelo |
| `demo_common/merchant.py:237`, `:255`, `:276` | Botón explícito pasa por el mismo executor de herramientas | UI y orquestador usan servicios comunes; aprobación independiente según política |

## Arquitectura real de la referencia

`airline/api/merchant.py:21` construye un `MerchantAgent` con backend `MockQuasarMerchant`, skills y herramientas de presentación. `demo_common/merchant.py:146` recibe chat y `demo_common/host.py:156` transmite eventos SSE del runtime Anthropic. Es un modelo real sobre datos/efectos de muestra; no es un router de frases predefinidas.

`airline/api/mock_merchant.py:869` prepara cambios de precio, comprueba productos regulados y límites, y genera una propuesta. `:1038` aplica el cambio y `:1053` actualiza el estado que leen otras vistas. La separación entre propuesta y efecto es el patrón útil; los controles concretos de AgeOS deben ser más fuertes por su naturaleza financiera y multiagencia.

`query_metrics` (`airline/api/mock_merchant.py:427`) utiliza métricas conocidas. `get_merchant_context` (`:1110`) expone periodo, métricas disponibles y restricciones. No es un agente con acceso libre al esquema SQL. Para AgeOS: catálogo semántico de entidades, relaciones y métricas permitidas; consultas paginadas y herramientas autorizadas por sesión; referencias a registros fuente.

## Qué conservar y qué reconstruir

1. **Una conversación, dos superficies.** La referencia preserva chat entre vistas; AgeOS debe ampliar a página Next.js `/a/:agencySlug/assistant` y panel contextual, con el mismo runtime y almacenamiento. No duplicar el chat en la página completa.
2. **Orquestador existente.** El asistente AgeOS es `agency-orchestrator`, que coordina subagentes y capacidades habilitadas. No importar el agente de tienda como un segundo orquestador ni agregar una skill 43.
3. **Reglas por debajo del asistente.** En AgeOS actual un driver selecciona consultas y handoffs programados. El núcleo valida permisos, revisiones, importes, aprobaciones y efectos. La interpretación por modelos queda para una etapa posterior.
4. **Presentación desde datos.** Renderers tipados reciben payloads validados con referencias, cifras y estado. No ejecutar JSX/HTML o código arbitrario enviado por el modelo.
5. **Actualización coherente.** Después de un comando aplicado, invalidar las consultas pertinentes y actualizar la propuesta, expediente y panel desde el mismo recibo.
6. **Contexto por solicitud.** Página, entidad seleccionada, filtros y documentos son contexto visible; actor, agencia y acceso se resuelven siempre en servidor. Un cambio de ruta no concede permisos.
7. **Datos durables.** Conversaciones, mensajes, herramientas, propuestas, aprobaciones y resultados deben persistir en PostgreSQL; preferencia de ancho puede quedar en el navegador.
8. **Demo determinística obligatoria.** La entrega actual utiliza respuestas precargadas y fixtures, claramente rotulados. El texto interpola cifras y referencias desde los resultados del núcleo. Fuera de los casos programados, informa el alcance y ofrece opciones soportadas. No requiere ni llama a modelos/proveedores; la aceptación exige cobertura E2E de todos los casos.

## Atajos del ejemplo que no deben trasladarse

| Fuente | Límite observado | Requisito AgeOS |
|---|---|---|
| `airline/api/merchant.py:18`; `demo_common/merchant.py:137` | Identidad fija de demostración al crear sesión | Sesión autenticada y membresía/rol comprobados |
| `demo_common/sessions.py:72` | Estado y transcript en diccionarios en memoria del proceso | Almacenamiento persistente con control de concurrencia y recuperación |
| `demo_common/sessions.py:131` | Revisión optimista local | Llevar compare-and-set a transacciones de almacenamiento compartido |
| `airline/api/mock_merchant.py:435`, `:1034` | Métodos descartan session por ser un negocio único | Autorizar cada query/tool/command por agencia y usuario |
| `demo_common/merchant.py:226` | Lectura de portal global a la tienda | Consultas siempre acotadas; nunca reutilizar esta excepción para multiagencia |
| `demo_common/host.py:71` | Variable global puede desactivar aprobación | Políticas por operación, aprobación exacta y separación de funciones permanentes |
| `airline/merchant-web/app/page.tsx:37` | Navegación local basada en `view` | Rutas App Router, enlaces directos, atrás/adelante y layout persistente |
| `web-shared/portal/AssistantRail.tsx:90`, `:101` | Overlay propio y resize por pointer | Sheet/Dialog y patrón de docking ReUI, foco/escape/retorno, teclado o presets accesibles |
| `airline/api/mock_merchant.py:878`, `:1065` | Cálculos monetarios con floats | Decimal/money exacto, moneda y redondeo explícitos |
| `web-shared/turn.ts:28` | Intervalos artificiales para dosificar render de elementos | Mostrar progreso del runtime; no retrasos decorativos ni éxito simulado |
| `demo_common/host.py:156` | Persistencia al finalizar stream | AgeOS debe preservar eventos/estados también ante desconexión, cancelación y reanudación |

La referencia usa Python/FastAPI y commerce-agents; AgeOS mantiene Next.js/TypeScript/PostgreSQL y un driver `scripted` para esta demo. Eve/AI SDK siguen como frontera futura de integración, sin instalar o activar un modelo como requisito de esta entrega. Cuando se autorice esa etapa, consultar código/skills y documentación oficial de las versiones instaladas antes de escribir imports o APIs. Este documento no autoriza un port completo ni el uso de dependencias incompatibles.

No copiar el estilo JSX/CSS de Quasar. ReUI `ai-chat-6` aporta el contenido conversacional y `app-shell-18` la referencia de docking; se conserva Verve. Agent Activity/Trace sirven para herramientas, pasos y evidencia, y no reemplazan el chat.

## Comprobaciones derivadas

- Continuidad del mismo hilo entre página, panel y navegación, con persistencia al recargar.
- Separación entre agencias/usuarios, documentos, memoria y herramientas; revalidación cuando cambian permisos.
- Respuestas de consultas fundamentadas en registros y coincidencia de cifras con las pantallas.
- Subagentes heredan límites y permisos del orquestador, nunca los amplían.
- Aprobaciones exactas, no autoaprobación ni un sí genérico para otra revisión.
- Cancelar generación no revierte una escritura comprometida; reanudar no repite efectos.
- Reintentos y eventos duplicados identificados; estado incierto conciliado antes de reenviar.
- Pruebas de los guiones y de todos los casos E2E sin llamadas a modelos/proveedores; datos sintéticos y resultados sustentados en el núcleo.

El objetivo es conservar la interacción útil del ejemplo y reconstruir sus garantías sobre los contratos persistentes de AgeOS.
