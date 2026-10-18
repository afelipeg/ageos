import { type ReactNode } from "react"

import { PlaneShell } from "@/components/control/plane-shell"
import { requirePlatformSession } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"

// AgeOS platform operations (/ops/*): platform operator or admin identities
// only (anything else is 404). Separate from every agency's navigation.
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const session = await requirePlatformSession()
  const { t } = await getI18n()
  return (
    <PlaneShell
      context={t("ops.context")}
      home="/ops"
      userLabel={`${session.user.displayName} · ${t(`header.roles.${session.user.platformRole}`)}`}
      demoLabel={t("common.demoShort")}
      signOutLabel={t("common.signOut")}
    >
      {children}
    </PlaneShell>
  )
}
