import type { inbox as en } from "../en/inbox"

// Mensajes en español: pendientes.
export const inbox: typeof en = {
  title: "Pendientes",
  description: "Excepciones, aprobaciones y ejecuciones bloqueadas que requieren a alguien, ordenadas por riesgo.",
  viewsLabel: "Vistas de pendientes",
  views: { "for-me": "Para mí", approvals: "Aprobaciones", blocked: "Bloqueados", all: "Todos" },
  filters: { job: "Trabajo", allJobs: "Todos los trabajos", owner: "Responsable", allOwners: "Todos los responsables", module: "Módulo", allModules: "Todos los módulos" },
  noResults: "Ningún pendiente coincide con los filtros activos.",
  empty: { "for-me": "Nada lo requiere en este momento", approvals: "No hay aprobaciones pendientes", blocked: "Nada está bloqueado", all: "No hay pendientes" },
  emptyBody: "Los pendientes aparecen cuando una regla abre una excepción, se solicita una aprobación o se bloquea una ejecución.",
  openJobs: "Abrir trabajos",
  columns: { item: "Pendiente", job: "Trabajo", state: "Estado", owner: "Responsable", created: "Creado" },
  source: { attention: "Excepción de regla", approval: "Solicitud de aprobación", run: "Ejecución bloqueada" },
  unassigned: "Sin asignar",
  eligibleRoles: "Roles aprobadores elegibles",
  snoozedUntil: "Pospuesto hasta",
  detailTitle: "Detalle del pendiente",
  detailEmpty: "Seleccione un pendiente para ver su evidencia y acciones.",
  openEvidence: { attention: "Abrir evidencia", approval: "Revisar cambio", run: "Abrir ejecución" },
  actions: {
    assign: "Asignar a",
    choose: "Elija un miembro",
    save: "Guardar",
    snooze: "Posponer hasta",
    snoozeCta: "Posponer",
    snoozeHelp: "La fecha es obligatoria. Posponer oculta el pendiente hasta entonces; no elimina la condición que bloquea.",
    resolve: "Marcar como resuelto",
    resolveNote: "Nota de resolución",
    done: "Guardado",
    resolveHelp: "Solo se acepta cuando el servicio confirma que la condición ya no se cumple.",
  },
}
