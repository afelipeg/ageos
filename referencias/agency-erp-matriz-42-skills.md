# AgencyOS matriz de cobertura de las 42 skills

Fecha: 17 de octubre de 2026. Cobertura de diseño completa; implementación y pruebas pendientes. Conectores indicados como opciones según país, cuenta y configuración, no como dependencias simultáneas.

Fuente: [contratos del repositorio](https://github.com/afelipeg/agentic-advertising-agency-erp/blob/d73539e62ec27060347763f0ec40115c36be6f16/contracts/workflows.json). La versión JSON conserva los inputs y todos los outputs originales.

## 01 Arranque

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-orchestrator | Estado del trabajo y dependencias | Servicios internos de AgencyOS | Reanudar un job sin repetir una escritura; bloquear etapas dependientes de una revisión obsoleta. |
| agency-integrations | Inventario de capacidades y conexiones por etapa | Composio | Descubrir scopes reales y mostrar faltantes; una conexión revocada bloquea únicamente las acciones que la necesitan. |
| agency-access-governance | Matriz de acceso y cambios de configuración | Servicios internos de AgencyOS | Usuario de agencia A no accede a conexiones, archivos ni acciones de B, incluyendo subagentes. |
| agency-master-data | Maestros y equivalencias externas | Salesforce, Attio, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Detectar un proveedor duplicado y conservar los IDs externos correctos al sincronizar. |

## 02 Clientes y contratos

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-onboarding | Alta de cliente y brief | Salesforce, Attio, Google Drive, Notion, OneDrive y SharePoint, Dropbox, Box | Importar cliente/brief sin crear duplicado y registrar faltantes de facturación. |
| agency-job-lifecycle | Apertura y cierre de trabajos | Salesforce, Attio, ClickUp | Asignar JobNumber único; impedir cierre con compromisos o documentos pendientes. |
| agency-contract-po | Contrato, PO, reservas y ruta de facturación | Google Drive, Notion, OneDrive y SharePoint, Dropbox, Box | Extraer un límite de PO del documento, validarlo y bloquear un compromiso que lo exceda. |
| agency-budget-control | Presupuesto, crédito y reservas | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo, Google Sheets, Microsoft Excel | Dos operaciones concurrentes no pueden reservar el mismo saldo disponible. |
| agency-fee-contracts | Honorarios, cuotas y liquidación de horas | Harvest, ClickUp, Google Sheets, Microsoft Excel | Calcular fee fijo y por horas con moneda/redondeo explícitos, sin duplicar horas importadas. |
| agency-billing-requirements | Matriz de requisitos y expediente de emisión | Google Drive, Notion, OneDrive y SharePoint, Dropbox, Box | Bloquear factura final si falta PO, aceptación o evidencia requerida por ese cliente. |

## 03 Trabajo y producción

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-tasks-timesheets | Horas validadas, valoración y aprobaciones | Harvest, ClickUp, Google Sheets, Microsoft Excel | Reimportar la misma semana no duplica horas; horas rechazadas no se facturan. |
| agency-production-estimating | Estimación, comparación de proveedores y órdenes | Harvest, ClickUp, Google Sheets, Microsoft Excel | Recalcular subtotal, markups y asignaciones; cambio del presupuesto invalida aprobación anterior. |
| agency-production | Calendario, activos, control de calidad y derechos | ClickUp, Google Drive, OneDrive y SharePoint, Dropbox, Box | Relacionar la versión exacta del creativo con sus derechos y bloquear liberación vencida. |

## 04 Planificación de medios

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-media-ranking | Ranking y manifest de datos | GWI, Numeris, Nielsen, Kantar IBOPE Media, Google Ads, Display & Video 360 | No comparar ratings de universos incompatibles ni inventar un ranking cuando faltan tarifas o audiencia. |
| agency-media-planning | Plan, calendario, costos y aprobación | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Vistar Media, GWI, Numeris, Nielsen, Kantar IBOPE Media | Todas las líneas cuadran con presupuesto, moneda, fuente de audiencia y revisión; aprobación ligada al plan exacto. |
| agency-tv-radio-planning | Pauta, spots, materiales e instrucciones de tráfico | Mediaocean Prisma, FreeWheel Strata, Numeris, Nielsen, Kantar IBOPE Media | Validar fecha/hora local, duración, tarifa y material de cada spot; importar emisiones y obtener post-evaluación. |
| agency-ooh-planning | Sitios, costos, reservas y evidencia exigida | Vistar Media, Broadsign, Google Sheets, Microsoft Excel | Distinguir pantalla digital de soporte estático, ubicación, vigencia y formato compatible. |
| agency-digital-planning | Plan digital, taxonomía, costos y conciliación | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Google Analytics 4 | Validar objetivo/targeting permitido y conversiones disponibles antes de entregar el plan a compra. |
| agency-plan-changes | Diferencias entre revisiones y acciones sobre órdenes | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Vistar Media, Mediaocean Prisma, FreeWheel Strata | Cambio de presupuesto produce diff y nueva aprobación; una aprobación vieja no ejecuta la nueva revisión. |

## 05 Compra de medios

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-rate-cards-contracts | Tarifarios, contratos y saldos | Google Drive, OneDrive y SharePoint, Dropbox, Box, Mediaocean Prisma, FreeWheel Strata, Google Sheets, Microsoft Excel | Aplicar tarifa vigente y cascada de descuentos; no usar una tarifa vencida sin excepción aprobada. |
| agency-media-buying | Órdenes versionadas, envío y compromisos | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Vistar Media, Mediaocean Prisma, FreeWheel Strata | Cada orden conserva vínculo a la línea aprobada; resultado incierto se concilia antes de reintentar. |
| agency-campaign-activation | Preflight, IDs externos y comprobantes de ejecución | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Vistar Media | Crear borrador/pausado cuando se soporte; activar solo tras aprobación, comprobar estado externo y no duplicar por timeout. |
| agency-campaign-optimization | Diagnóstico, propuesta, experimento y recibos | Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, Netflix Ads, OpenAI Ads, Vistar Media, Google Analytics 4 | Con datos atrasados no aumentar presupuesto; propuesta respeta techo y conserva resultado de verificación. |
| agency-transmission-control | Conciliación de emisiones y compensaciones | Mediaocean Prisma, FreeWheel Strata, Broadsign, Vistar Media | Conciliar orden contra transmisión/proof-of-play; identificar faltantes, duplicados y makegoods. |
| agency-ooh-inventory | Disponibilidad, reservas, caras y órdenes del operador | Broadsign, Google Sheets, Microsoft Excel | Dos clientes no reservan la misma cara y periodo; mantener separado inventario propio de compra externa. |

## 06 Proveedores y pagos

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-delivery-reconciliation | Cruce de orden, entrega y factura | Mediaocean Prisma, FreeWheel Strata, Broadsign, Vistar Media, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Bloquear factura cuyo importe o entrega no coincide y adjuntar la evidencia correspondiente. |
| agency-payables | Recepción, normalización y propuesta de registro | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo, BILL | Detectar factura duplicada por entidad/proveedor/número/importe; registrar una sola vez tras aprobar. |
| agency-payment-run | Lista de pagos, retenciones y órdenes bancarias | Wise Business, BILL, PayPal, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | No fondear con credencial solo lectura; aprobar beneficiario/importe exactos y conciliar timeout antes de repetir. |
| agency-cash-settlement | Conciliación bancaria y caja sin aplicar | Wise Business, Stripe, PayPal, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo, BILL | Webhook repetido no duplica recibo; cuadrar comisiones, moneda y liquidación bancaria. |
| agency-expenses | Gastos, rendiciones y diferimientos | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo, BILL, Google Drive, OneDrive y SharePoint | OCR con baja confianza requiere revisión; no registrar dos veces el mismo comprobante. |

## 07 Facturación y cobranza

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-client-billing | Facturas y notas de crédito o débito | Stripe, PayPal, QuickBooks Online, Xero, Alegra, Siigo, Oracle NetSuite, Facturapi, ARCA, Nuvem Fiscal | Emitir una vez y guardar folio/estado; separar factura comercial de documento fiscal autorizado. |
| agency-collections | Aplicación de cobros y antigüedad de saldos | Stripe, PayPal, Wise Business, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Pago parcial reduce saldo correcto; borrador de recordatorio no se envía sin la autorización prevista. |
| agency-rebates | Base elegible, provisión y rebate al cliente | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo, Google Sheets, Microsoft Excel | Aplicar tramos del contrato y excluir facturas no elegibles; no reconocer ingreso duplicado. |
| agency-tax-compliance | Autorizaciones, impuestos y exportaciones fiscales | Facturapi, ARCA, Nuvem Fiscal, Alegra, Siigo, QuickBooks Online, Xero, Oracle NetSuite | País sin adaptador validado permite preparación, pero bloquea emisión/declaración automática y muestra el faltante. |

## 08 Contabilidad y cierre

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-general-ledger | Asientos y conciliación contable | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Debe y haber cuadran; mapa de cuentas incompleto bloquea publicación en el libro maestro. |
| agency-accruals-revaluation | Provisiones y revaluación cambiaria | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Recalcular con tipo de cambio/fecha aprobados; no mutar periodo cerrado ni duplicar reversión. |
| agency-fixed-assets | Registro de activos y depreciación | Xero, QuickBooks Online, Alegra, Oracle NetSuite, Siigo, Google Sheets, Microsoft Excel | Calendario aprobado respeta vida útil, residual y periodo; si API de activos no existe usar registro nativo y asiento revisado. |
| agency-period-close | Checklist, conciliaciones y bloqueo de periodo | QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Impedir cierre con diferencias; bloqueo local no se anuncia como cierre externo sin recibo del sistema contable. |

## 09 Rentabilidad

| Skill | Entregable | Opciones de conexión | Prueba de aceptación |
|---|---|---|---|
| agency-profitability | Rentabilidad por job y cliente | Harvest, ClickUp, Meta e Instagram Ads, Google Ads, TikTok Ads, Amazon Ads, Display & Video 360, OpenAI Ads, Vistar Media, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Separar gasto de medios administrado de ingreso propio; no duplicar costos entre factura y feed de plataforma. |
| agency-revenue-budget | Versiones del presupuesto e ingresos proyectados | Google Sheets, Microsoft Excel, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Comparar plan y real en moneda/período homogéneos y conservar revisión aprobada. |
| agency-cash-forecast | Pronóstico de caja y escenarios | Stripe, PayPal, Wise Business, BILL, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Separar confirmado de probable y partidas sin fecha; evitar sumar distintas monedas sin conversión explícita. |
| agency-management-reporting | Paquete gerencial y exportaciones | Google Sheets, Microsoft Excel, QuickBooks Online, Xero, Alegra, Oracle NetSuite, Siigo | Cada KPI trazable a datos/versiones y totales conciliados; exportación respeta permisos de agencia/cliente. |


