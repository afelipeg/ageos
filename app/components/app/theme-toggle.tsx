"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHydrated } from "@/hooks/use-hydrated"

/**
 * One-click Light/Dark switch (header, landing, sign-in). The icon shows the
 * active theme; the label names the action. It always stores an explicit
 * choice, like the `d` hotkey; "System" is only offered in the user menu.
 * Until hydration it renders the default (dark) state so server and client
 * markup agree whatever the stored preference is.
 */
export function ThemeToggle() {
  const { t } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const isDark = !hydrated || resolvedTheme !== "light"
  const label = isDark ? t("common.switchToLight") : t("common.switchToDark")
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="outline" size="icon-sm" aria-label={label} onClick={() => setTheme(isDark ? "light" : "dark")} />
        }
      >
        {isDark ? <MoonIcon aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
