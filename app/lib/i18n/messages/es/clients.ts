import type { clients as en } from "../en/clients"

// Mensajes en español: ficha de cliente.
export const clients: typeof en = {
  edit: "Editar en datos maestros",
  newJob: "Nuevo trabajo del cliente",
  tabsLabel: "Secciones del cliente",
  tabs: { overview: "Resumen", jobs: "Trabajos", contracts: "Contratos", invoices: "Facturas", files: "Archivos" },
  briefs: "Briefs",
  noBriefs: "No hay brief registrado para este cliente.",
  profile: "Perfil de facturación",
  owner: "Responsable de la cuenta",
  billingCurrency: "Moneda de facturación",
  creditLimit: "Límite de crédito",
  fiscalProfile: "Perfil fiscal (demo)",
  jobCount: "Trabajos",
  noJobs: "Este cliente aún no tiene trabajos.",
  noContracts: "No hay contrato ni OC registrados para este cliente.",
  contractsHelp: "Autorización del cliente. La aprobación interna nunca la sustituye.",
  invoicesPendingTitle: "Facturas al cliente — backend en curso",
  invoicesPendingBody: "Las facturas provienen de Facturación y cobranza (agency-client-billing). Esta pestaña las listará cuando ese servicio las exponga; mientras tanto no se muestran cifras.",
  noFiles: "No hay archivos en los trabajos de este cliente.",
  openLibrary: "Abrir biblioteca",
}
