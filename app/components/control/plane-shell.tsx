import Link from "next/link"
import { type ReactNode } from "react"
import { LogOutIcon } from "lucide-react"

import { ThemeToggle } from "@/components/app/theme-toggle"
import { LocaleSwitch } from "@/components/auth/locale-switch"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { signOut } from "@/server/actions/session"

/**
 * Shell for the AgeOS planes that live outside an agency workspace:
 * /control (build & activate), /ops (platform operations) and
 * /demo/presenter. Same visual language as the agency shell, a distinct
 * context badge, the demo indicator and no agency navigation.
 */
export function PlaneShell({
  context,
  home,
  userLabel,
  demoLabel,
  signOutLabel,
  nav,
  children,
}: {
  context: string
  home: string
  userLabel: string
  demoLabel: string
  signOutLabel: string
  nav?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <Link href={home} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              A
            </span>
            AgeOS
          </Link>
          <Badge variant="outline">{context}</Badge>
          <Badge variant="info-light">{demoLabel}</Badge>
          {nav}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">{userLabel}</span>
            <LocaleSwitch />
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon-sm" aria-label={signOutLabel}>
                <LogOutIcon aria-hidden="true" />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-6 px-4 py-6">{children}</main>
    </div>
  )
}
