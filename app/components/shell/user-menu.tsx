"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Building2Icon,
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PresentationIcon,
  SunIcon,
} from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { setLocale, signOut } from "@/server/actions/session"

export type ShellUser = {
  name: string
  email: string
  role: string
  presenter: boolean
  memberships: { slug: string; appName: string; name: string }[]
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

// Light and Dark first; System is an explicit third choice, never implied.
const THEMES = [
  { value: "light", key: "common.light", icon: SunIcon },
  { value: "dark", key: "common.dark", icon: MoonIcon },
  { value: "system", key: "common.system", icon: MonitorIcon },
] as const

/** Theme as menu radio items: keyboard-navigable like the language choice. */
function ThemeMenuGroup() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <PaletteIcon aria-hidden="true" className="size-3.5" />
        {t("common.theme")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme ?? ""} onValueChange={(v) => setTheme(String(v))}>
        {THEMES.map(({ value, key, icon: Icon }) => (
          <DropdownMenuRadioItem key={value} value={value}>
            <Icon aria-hidden="true" />
            {t(key)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

/** Language switch keeps the URL and client state; server data re-renders. */
export function useLocaleSwitch() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return {
    pending,
    switchTo: (locale: "en" | "es") =>
      start(async () => {
        await setLocale(locale)
        router.refresh()
      }),
  }
}

export function UserMenu({ user }: { user: ShellUser }) {
  const { t, locale } = useI18n()
  const { switchTo } = useLocaleSwitch()
  const roleLabel = t(`header.roles.${user.role}`)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={t("header.profile")} />}
          >
            <Avatar className="size-7 rounded-md">
              <AvatarFallback className="rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
            </span>
            <ChevronsUpDownIcon aria-hidden="true" className="ml-auto opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                <span className="text-sm font-semibold text-foreground">{user.name}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                <span className="text-xs font-normal text-muted-foreground">{t("header.actingAs", { name: user.name, role: roleLabel })}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                <LanguagesIcon aria-hidden="true" className="size-3.5" />
                {t("common.language")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={locale} onValueChange={(v) => switchTo(v as "en" | "es")}>
                <DropdownMenuRadioItem value="en">{t("common.english")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="es">{t("common.spanish")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <ThemeMenuGroup />
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {user.memberships.length > 1 &&
                user.memberships.map((m) => (
                  <DropdownMenuItem key={m.slug} render={<Link href={`/a/${m.slug}`} />}>
                    <Building2Icon aria-hidden="true" />
                    {m.appName}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem render={<Link href="/control/agencies" />}>
                <Building2Icon aria-hidden="true" />
                {t("header.controlPlane")}
              </DropdownMenuItem>
              {user.presenter && (
                <DropdownMenuItem render={<Link href="/demo/presenter" />}>
                  <PresentationIcon aria-hidden="true" />
                  {t("header.presenterControls")}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              <LogOutIcon aria-hidden="true" />
              {t("common.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
