import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarRange,
  ChartNoAxesCombined,
  Clapperboard,
  ContactRound,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Plug,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react"

// The single agency navigation: four groups, sixteen entries plus the catalog
// (17). Module entries point at canonical module desks; the 42 capabilities
// stay inside the catalog and each desk, never as 42 sidebar items.

export type NavEntry = {
  id: string
  labelKey: string
  icon: LucideIcon
  /** Path relative to /a/:agencySlug */
  path: string
  /** Extra path prefixes that keep this entry active. */
  matches?: string[]
}

export type NavGroup = { id: "workspace" | "operations" | "finance" | "manage"; labelKey: string; entries: NavEntry[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    labelKey: "nav.groups.workspace",
    entries: [
      { id: "overview", labelKey: "nav.overview", icon: LayoutDashboard, path: "" },
      { id: "assistant", labelKey: "nav.assistant", icon: MessagesSquare, path: "/assistant" },
      { id: "inbox", labelKey: "nav.inbox", icon: Inbox, path: "/inbox", matches: ["/approvals", "/runs"] },
      { id: "jobs", labelKey: "nav.jobs", icon: BriefcaseBusiness, path: "/jobs" },
    ],
  },
  {
    id: "operations",
    labelKey: "nav.groups.operations",
    entries: [
      { id: "clients-contracts", labelKey: "nav.clientsContracts", icon: ContactRound, path: "/modules/clients-contracts", matches: ["/clients"] },
      { id: "work-production", labelKey: "nav.workProduction", icon: Clapperboard, path: "/modules/work-production" },
      { id: "media-planning", labelKey: "nav.mediaPlanning", icon: CalendarRange, path: "/modules/media-planning" },
      { id: "media-buying", labelKey: "nav.mediaBuying", icon: Megaphone, path: "/modules/media-buying" },
    ],
  },
  {
    id: "finance",
    labelKey: "nav.groups.finance",
    entries: [
      { id: "suppliers-payments", labelKey: "nav.suppliersPayments", icon: WalletCards, path: "/modules/suppliers-payments" },
      { id: "billing-collections", labelKey: "nav.billingCollections", icon: ReceiptText, path: "/modules/billing-collections" },
      { id: "accounting-close", labelKey: "nav.accountingClose", icon: BookOpenCheck, path: "/modules/accounting-close" },
      { id: "profitability", labelKey: "nav.profitability", icon: ChartNoAxesCombined, path: "/modules/profitability", matches: ["/explore", "/reports"] },
    ],
  },
  {
    id: "manage",
    labelKey: "nav.groups.manage",
    entries: [
      { id: "setup", labelKey: "nav.agencySetup", icon: SlidersHorizontal, path: "/modules/setup" },
      { id: "connections", labelKey: "nav.connections", icon: Plug, path: "/connections" },
      { id: "library", labelKey: "nav.library", icon: FolderOpen, path: "/library" },
      { id: "settings", labelKey: "nav.settings", icon: Settings, path: "/settings/brand", matches: ["/settings"] },
    ],
  },
]

export const CATALOG_ENTRY: NavEntry = {
  id: "capabilities",
  labelKey: "nav.allCapabilities",
  icon: Workflow,
  path: "/capabilities",
}

export const MODULE_NAV_KEY: Record<string, string> = {
  setup: "nav.agencySetup",
  "clients-contracts": "nav.clientsContracts",
  "work-production": "nav.workProduction",
  "media-planning": "nav.mediaPlanning",
  "media-buying": "nav.mediaBuying",
  "suppliers-payments": "nav.suppliersPayments",
  "billing-collections": "nav.billingCollections",
  "accounting-close": "nav.accountingClose",
  profitability: "nav.profitability",
}

/** Active entry for a pathname under /a/:slug (longest match wins). */
export function activeEntryId(pathname: string, slug: string): string | null {
  const base = `/a/${slug}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) || "" : pathname
  const all = [...NAV_GROUPS.flatMap((g) => g.entries), CATALOG_ENTRY]
  let best: { id: string; len: number } | null = null
  for (const e of all) {
    const candidates = [e.path, ...(e.matches ?? [])]
    for (const c of candidates) {
      const hit = c === "" ? rest === "" || rest === "/" : rest === c || rest.startsWith(`${c}/`)
      if (hit && (!best || c.length > best.len)) best = { id: e.id, len: c.length }
    }
  }
  if (!best && rest.startsWith("/modules/")) {
    const key = rest.split("/")[2]
    return key ?? null
  }
  return best?.id ?? null
}
