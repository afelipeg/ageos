import type { jobs as en } from "../en/jobs"

// Mensajes en español: mesa de trabajos.
export const jobs: typeof en = {
  title: "Trabajos",
  description: "Cada trabajo, del contrato al cobro, desde los mismos registros.",
  newJob: "Nuevo trabajo",
  searchLabel: "Buscar trabajos",
  searchPlaceholder: "Nombre, JobNumber, referencia o cliente",
  filterState: "Estado",
  filterClient: "Cliente",
  allStates: "Todos los estados",
  allClients: "Todos los clientes",
  group: "Grupo de reporte",
  groupAll: "Todos los grupos",
  groupPrimary: "Solo principal",
  columns: {
    jobNumber: "JobNumber",
    reference: "Referencia",
    name: "Trabajo",
    client: "Cliente",
    owner: "Responsable",
    state: "Estado",
    fee: "Fee de agencia",
    margin: "Margen proyectado",
    nextAction: "Próxima acción",
    updated: "Actualizado",
  },
  empty: "Ningún trabajo coincide con estos filtros.",
  emptyAgency: "Aún no hay trabajos. Abra el primero desde Clientes y contratos.",
  total: "{count} trabajos",
  marginHelp: "Margen proyectado = (fee aprobado − estimación de costos vigente) ÷ fee aprobado. Medios administrados excluidos.",
}
