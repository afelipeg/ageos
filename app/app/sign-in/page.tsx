import type { Metadata } from "next"

import { ThemeToggle } from "@/components/app/theme-toggle"
import { LocaleSwitch } from "@/components/auth/locale-switch"
import { SignInForm } from "@/components/auth/sign-in-form"
import { Badge } from "@/components/reui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Sign in" }

// Auth card: one centered Card, one primary action. The access code is a
// server-held demo secret; the form never sends a role or a tenant.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const { t } = await getI18n()
  const safeNext = next && /^\/(?!\/)/.test(next) ? next : "/a/rayo-de-sol"
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-muted/40 px-4 py-10">
      <div className="flex w-full max-w-sm flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">{t("common.demoBadge")}</Badge>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>{t("auth.signInTitle")}</h1>
          </CardTitle>
          <CardDescription>{t("auth.signInDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm next={safeNext} />
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">{t("auth.syntheticNotice")}</p>
        </CardFooter>
      </Card>
    </main>
  )
}
