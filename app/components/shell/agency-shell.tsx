"use client"

import { type CSSProperties, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { AssistantDock } from "@/components/assistant/assistant-dock"
import { AssistantProvider } from "@/components/assistant/assistant-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

import { AgencyHeader } from "./agency-header"
import { AgencySidebar, type ShellAgency } from "./agency-sidebar"
import type { ShellUser } from "./user-menu"

// Verve shell, consolidated into one navigation (four groups + catalog). The
// assistant provider lives here — the agency layout — so the conversation
// survives navigation; the right panel docks beside the main content.
export function AgencyShell({ agency, user, children }: { agency: ShellAgency; user: ShellUser; children: ReactNode }) {
  const pathname = usePathname()
  // The full assistant page owns the whole content area (bounded by the shell,
  // no nested h-svh); every other page uses the padded work column.
  const fullBleed = pathname === `/a/${agency.slug}/assistant`
  return (
    <AssistantProvider key={agency.slug} slug={agency.slug}>
      {/* Active/hover use the theme's own --sidebar-accent (Vercel neutral). */}
      <SidebarProvider className="h-svh [--header-height:50px]" style={{ "--sidebar-width": "15.5rem" } as CSSProperties}>
        <AgencySidebar agency={agency} user={user} />
        {/* SidebarInset is the single <main> landmark; the work column inside it is a plain region. */}
        <SidebarInset className="min-w-0 overflow-hidden border border-border shadow-none">
          <AgencyHeader agency={agency} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div id="main-content" className={cn("min-w-0 flex-1", fullBleed ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
              {fullBleed ? children : <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">{children}</div>}
            </div>
            <AssistantDock />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AssistantProvider>
  )
}
