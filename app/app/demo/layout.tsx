import { type ReactNode } from "react"

import { PlaneShell } from "@/components/control/plane-shell"
import { requirePresenter } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"

// Demo tools (/demo/*): only the authorized presenter session (404 otherwise).
export default async function DemoLayout({ children }: { children: ReactNode }) {
  const session = await requirePresenter()
  const { t } = await getI18n()
  return (
    <PlaneShell context={t("presenter.context")} home="/demo/presenter" userLabel={t("presenter.actingAs", { name: session.user.displayName })} demoLabel={t("common.demoShort")} signOutLabel={t("common.signOut")}>
      {children}
    </PlaneShell>
  )
}
