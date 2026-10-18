import { type ReactNode } from "react"

import { PlaneShell } from "@/components/control/plane-shell"
import { requireControlSession } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"

// AgeOS control plane (/control/*): an agency identity builds, resumes and
// activates agencies. Platform identities get 404; no agency navigation here.
export default async function ControlLayout({ children }: { children: ReactNode }) {
  const session = await requireControlSession()
  const { t } = await getI18n()
  return (
    <PlaneShell context={t("control.context")} home="/control/agencies" userLabel={session.user.displayName} demoLabel={t("common.demoShort")} signOutLabel={t("common.signOut")}>
      {children}
    </PlaneShell>
  )
}
