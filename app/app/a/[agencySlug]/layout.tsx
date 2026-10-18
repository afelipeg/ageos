import { type ReactNode } from "react"

import { I18nProvider } from "@/components/i18n/i18n-provider"
import { AgencyShell } from "@/components/shell/agency-shell"
import { listMemberships } from "@/server/auth/context"
import { requireAgency } from "@/server/auth/request"
import { getLocale } from "@/server/i18n"

// Agency application layout: resolves the actor on the server (404 for
// non-members), then mounts the Verve shell and the shared assistant runtime.
// Client formatting inside the agency uses the agency's own time zone (the
// nested provider overrides the root one); business dates never shift.
export default async function AgencyLayout({ children, params }: { children: ReactNode; params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  const ctx = await requireAgency(agencySlug)
  const [memberships, locale] = await Promise.all([listMemberships(ctx.user.id), getLocale()])
  return (
    <I18nProvider locale={locale} timeZone={ctx.tenant.timezone}>
      <AgencyShell
        agency={{
          slug: ctx.tenant.slug,
          name: ctx.tenant.name,
          appName: ctx.tenant.appName,
          accent: ctx.branding.accent,
          logoText: ctx.branding.logoText,
        }}
        user={{
          name: ctx.user.displayName,
          email: ctx.user.email,
          role: ctx.role,
          presenter: ctx.presenter,
          memberships: memberships.map((m) => ({ slug: m.slug, appName: m.appName, name: m.name })),
        }}
      >
        {children}
      </AgencyShell>
    </I18nProvider>
  )
}
