import type { Metadata } from "next"
import Link from "next/link"
import { LayersIcon, RocketIcon, ShieldCheckIcon } from "lucide-react"

import { ThemeToggle } from "@/components/app/theme-toggle"
import { LocaleSwitch } from "@/components/auth/locale-switch"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Build your agency on AgeOS" }

// Landing (marketing spine): eyebrow, headline, one-clause subhead, actions,
// demo disclosure and the three pillars. No logos, traction or savings claims.
export default async function LandingPage() {
  const { t } = await getI18n()
  const pillars = [
    { key: "build", icon: LayersIcon },
    { key: "activate", icon: RocketIcon },
    { key: "operate", icon: ShieldCheckIcon },
  ] as const
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-8">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            Ag
          </span>
          AgeOS
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex">{t("common.demoBadge")}</Badge>
          <Badge variant="outline" className="sm:hidden">{t("common.demoShort")}</Badge>
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-16 md:px-8 md:py-24">
        <section className="flex flex-col items-start gap-5">
          <Badge variant="outline">{t("landing.eyebrow")}</Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">{t("landing.title")}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{t("landing.subtitle")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" nativeButton={false} render={<Link href="/sign-in?next=/control/agencies" />}>
              {t("landing.primaryCta")}
            </Button>
            <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/sign-in?next=/a/rayo-de-sol" />}>
              {t("landing.secondaryCta")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("landing.strip")}</p>
        </section>
        <section aria-label={t("landing.scopeNote")} className="grid gap-4 md:grid-cols-3">
          {pillars.map(({ key, icon: Icon }) => (
            <Card key={key}>
              <CardHeader>
                <Icon aria-hidden="true" className="size-5 text-primary" />
                <CardTitle>{t(`landing.pillars.${key}.title`)}</CardTitle>
                <CardDescription>{t(`landing.pillars.${key}.body`)}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>
        <p className="text-sm text-muted-foreground">{t("landing.scopeNote")}</p>
      </main>
    </div>
  )
}
