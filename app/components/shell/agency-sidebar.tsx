"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useI18n } from "@/components/i18n/i18n-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

import { activeEntryId, CATALOG_ENTRY, NAV_GROUPS, type NavEntry } from "./nav-config"
import { UserMenu, type ShellUser } from "./user-menu"

export type ShellAgency = {
  slug: string
  name: string
  appName: string
  accent: string | null
  logoText: string | null
}

function BrandMark({ agency }: { agency: ShellAgency }) {
  // Agency brand accent is applied to its own mark only; system, state and
  // contrast tokens stay Verve's.
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
      style={agency.accent ? { backgroundColor: agency.accent, color: "#fff" } : undefined}
    >
      {(agency.logoText ?? agency.appName.slice(0, 2)).slice(0, 2).toUpperCase()}
    </span>
  )
}

function NavItem({ entry, slug, active }: { entry: NavEntry; slug: string; active: boolean }) {
  const { t } = useI18n()
  const { setOpenMobile, isMobile } = useSidebar()
  const label = t(entry.labelKey)
  const Icon = entry.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            href={`/a/${slug}${entry.path}`}
            aria-current={active ? "page" : undefined}
            onClick={() => isMobile && setOpenMobile(false)}
          />
        }
        isActive={active}
        tooltip={label}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AgencySidebar({ agency, user }: { agency: ShellAgency; user: ShellUser }) {
  const { t } = useI18n()
  const pathname = usePathname()
  const active = activeEntryId(pathname, agency.slug)

  return (
    <Sidebar
      collapsible="icon"
      variant="inset"
      role="navigation"
      aria-label={t("nav.mainNavigation")}
      mobileTitle={t("nav.mainNavigation")}
      mobileDescription={t("nav.mobileNavigationDescription")}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href={`/a/${agency.slug}`} />}
              tooltip={agency.appName}
            >
              <BrandMark agency={agency} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold">{agency.appName}</span>
                <span className="truncate text-xs text-muted-foreground">{agency.name}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.entries.map((entry) => (
                  <NavItem key={entry.id} entry={entry} slug={agency.slug} active={active === entry.id} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem entry={CATALOG_ENTRY} slug={agency.slug} active={active === CATALOG_ENTRY.id} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
