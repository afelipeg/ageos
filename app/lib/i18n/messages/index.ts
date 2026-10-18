// Message registry. Each namespace lives in its own file per locale; the
// Spanish files are typed against the English ones so keys cannot drift.
import type { Locale } from "../translate"

import * as enCore from "./en/core"
import * as esCore from "./es/core"
import { overview as en_overview } from "./en/overview"
import { overview as es_overview } from "./es/overview"
import { jobs as en_jobs } from "./en/jobs"
import { jobs as es_jobs } from "./es/jobs"
import { dossier as en_dossier } from "./en/dossier"
import { dossier as es_dossier } from "./es/dossier"
import { clients as en_clients } from "./en/clients"
import { clients as es_clients } from "./es/clients"
import { modules as en_modules } from "./en/modules"
import { modules as es_modules } from "./es/modules"
import { workbench as en_workbench } from "./en/workbench"
import { workbench as es_workbench } from "./es/workbench"
import { catalog as en_catalog } from "./en/catalog"
import { catalog as es_catalog } from "./es/catalog"
import { approvals as en_approvals } from "./en/approvals"
import { approvals as es_approvals } from "./es/approvals"
import { inbox as en_inbox } from "./en/inbox"
import { inbox as es_inbox } from "./es/inbox"
import { runs as en_runs } from "./en/runs"
import { runs as es_runs } from "./es/runs"
import { connections as en_connections } from "./en/connections"
import { connections as es_connections } from "./es/connections"
import { library as en_library } from "./en/library"
import { library as es_library } from "./es/library"
import { settings as en_settings } from "./en/settings"
import { settings as es_settings } from "./es/settings"
import { explore as en_explore } from "./en/explore"
import { explore as es_explore } from "./es/explore"
import { records as en_records } from "./en/records"
import { records as es_records } from "./es/records"
import { control as en_control } from "./en/control"
import { control as es_control } from "./es/control"
import { ops as en_ops } from "./en/ops"
import { ops as es_ops } from "./es/ops"
import { presenter as en_presenter } from "./en/presenter"
import { presenter as es_presenter } from "./es/presenter"
import { assistant as en_assistant } from "./en/assistant"
import { assistant as es_assistant } from "./es/assistant"

export const en = {
  ...enCore,
  overview: en_overview,
  jobs: en_jobs,
  dossier: en_dossier,
  clients: en_clients,
  modules: en_modules,
  workbench: en_workbench,
  catalog: en_catalog,
  approvals: en_approvals,
  inbox: en_inbox,
  runs: en_runs,
  connections: en_connections,
  library: en_library,
  settings: en_settings,
  explore: en_explore,
  records: en_records,
  control: en_control,
  ops: en_ops,
  presenter: en_presenter,
  assistant: en_assistant,
}

export type Messages = typeof en

export const es: Messages = {
  ...esCore,
  overview: es_overview,
  jobs: es_jobs,
  dossier: es_dossier,
  clients: es_clients,
  modules: es_modules,
  workbench: es_workbench,
  catalog: es_catalog,
  approvals: es_approvals,
  inbox: es_inbox,
  runs: es_runs,
  connections: es_connections,
  library: es_library,
  settings: es_settings,
  explore: es_explore,
  records: es_records,
  control: es_control,
  ops: es_ops,
  presenter: es_presenter,
  assistant: es_assistant,
}

export const MESSAGES: Record<Locale, Messages> = { en, es }
