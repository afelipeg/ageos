import type { overview as en } from "../en/overview"

// Mensajes en español: resumen.
export const overview: typeof en = {
  title: "Resumen",
  description: "{app} · cifras desde registros persistidos",
  kpi: {
    activeJobs: "Trabajos activos",
    activeJobsHelp: "Trabajos abiertos o en curso del grupo de reporte principal.",
    pendingApprovals: "Aprobaciones pendientes",
    pendingApprovalsHelp: "Solicitudes de aprobación que esperan una decisión elegible.",
    pendingBilling: "Facturación pendiente",
    pendingBillingHelp: "Facturable aprobado al cliente (fee + medios administrados) de trabajos activos aún no facturado. Facturas demo emitidas: {issued}.",
    projectedMargin: "Margen proyectado",
    projectedMarginHelp: "Σ(fee aprobado − costo pronosticado) ÷ Σ fee aprobado, trabajos activos, {currency}. Medios administrados excluidos.",
    open: "Abrir",
  },
  attention: {
    title: "Requiere atención",
    description: "Ordenado por riesgo; cada ítem proviene de una regla explícita.",
    empty: "Nada requiere atención en este momento.",
    job: "Trabajo",
    issue: "Excepción",
    effect: "Efecto",
    action: "Acción",
    marginEffect: "Margen proyectado {value} (mínimo {floor})",
  },
  recentJobs: {
    title: "Trabajos recientes",
    description: "Misma consulta y definición de margen que la mesa de Trabajos.",
    empty: "Aún no hay trabajos.",
    create: "Crear el primer trabajo",
    viewAll: "Ver todos los trabajos",
  },
  activity: {
    title: "Actividad reciente",
    description: "Eventos de auditoría inmutables.",
    empty: "Aún no hay actividad.",
  },
  businessDate: "Fecha de negocio demo {date} · la hora real de auditoría se muestra por evento",
}
