"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BriefcaseBusinessIcon, ContactRoundIcon, MessagesSquareIcon, SearchIcon } from "lucide-react"

import { ThemeToggle } from "@/components/app/theme-toggle"
import { useAssistant } from "@/components/assistant/assistant-provider"
import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { activeEntryId, CATALOG_ENTRY, NAV_GROUPS } from "./nav-config"
import type { ShellAgency } from "./agency-sidebar"

type SearchHit = { kind: "job" | "client"; id: string; title: string; subtitle: string; href: string }

function SearchDialog({ slug, open, onOpenChange }: { slug: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const inputId = useId()
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [state, setState] = useState<"idle" | "loading" | "error">("idle")
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++seq.current
    const timer = setTimeout(async () => {
      setState("loading")
      try {
        const res = await fetch(`/api/a/${slug}/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { hits: SearchHit[] }
        if (id === seq.current) {
          setHits(body.hits)
          setState("idle")
        }
      } catch {
        if (id === seq.current) setState("error")
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [q, open, slug])

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-2 px-4 py-2">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("common.search")}</DialogTitle>
          <DialogDescription>{t("header.searchPlaceholder")}</DialogDescription>
        </DialogHeader>
        <div className="relative flex items-center gap-2.5">
          <SearchIcon aria-hidden="true" className="pointer-events-none size-4 opacity-60" />
          <Input
            id={inputId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10 border-none p-0 shadow-none outline-none focus-visible:ring-0"
            autoFocus
            placeholder={t("header.searchPlaceholder")}
            aria-label={t("header.searchPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) go(hits[0].href)
            }}
          />
        </div>
        <Separator />
        <div role="listbox" aria-label={t("common.search")} className="flex max-h-80 flex-col gap-0.5 overflow-y-auto pb-2">
          {state === "error" && <p className="px-2 py-3 text-sm text-destructive">{t("states.errorTitle")}</p>}
          {state !== "error" && hits.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{state === "loading" ? t("common.loading") : t("header.searchEmpty")}</p>
          )}
          {hits.map((h) => (
            <button
              key={`${h.kind}:${h.id}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => go(h.href)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
            >
              {h.kind === "job" ? (
                <BriefcaseBusinessIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ContactRoundIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{h.title}</span>
                <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AgencyHeader({ agency }: { agency: ShellAgency }) {
  const { t } = useI18n()
  const pathname = usePathname()
  const assistant = useAssistant()
  const [searchOpen, setSearchOpen] = useState(false)
  const activeId = activeEntryId(pathname, agency.slug)
  const entry = [...NAV_GROUPS.flatMap((g) => g.entries), CATALOG_ENTRY].find((e) => e.id === activeId)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    // The header is a size container: what collapses (demo badge, search field,
    // Ask label) depends on the header's own width, which shrinks with the
    // sidebar and the docked assistant, not on the viewport.
    <header className="@container sticky top-0 z-30 flex h-(--header-height) w-full shrink-0 items-center gap-2 border-b border-border bg-background px-2.5">
      <SidebarTrigger aria-label={t("nav.toggleSidebar")} />
      <Separator orientation="vertical" className="my-auto h-4" />
      <Breadcrumb aria-label={t("nav.breadcrumb")} className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden min-w-0 @md:inline-flex">
            <BreadcrumbLink className="truncate" render={<Link href={`/a/${agency.slug}`} />}>
              {agency.appName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          {entry && entry.id !== "overview" && (
            <>
              <BreadcrumbSeparator className="hidden @md:flex" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{t(entry.labelKey)}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="outline" className="hidden @5xl:inline-flex">
                {t("common.demoBadge")}
              </Badge>
            }
          />
          <TooltipContent>{t("header.demoEnvironment")}</TooltipContent>
        </Tooltip>
        <Badge variant="outline" className="@5xl:hidden" aria-label={t("common.demoBadge")}>
          {t("common.demoShort")}
        </Badge>

        <button
          type="button"
          aria-label={t("common.search")}
          onClick={() => setSearchOpen(true)}
          className="hidden w-56 cursor-pointer rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30 @3xl:flex"
        >
          <InputGroup className="pointer-events-none">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5 opacity-60" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupText className="flex-1 ps-1.5 font-normal text-muted-foreground">{t("common.search")}…</InputGroupText>
            <InputGroupAddon align="inline-end" aria-hidden="true">
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            </InputGroupAddon>
          </InputGroup>
        </button>
        <Button variant="outline" size="icon-sm" className="@3xl:hidden" aria-label={t("common.search")} onClick={() => setSearchOpen(true)}>
          <SearchIcon aria-hidden="true" />
        </Button>

        <ThemeToggle />

        {!assistant.isAssistantPage && (
          <Button
            variant={assistant.panelOpen ? "secondary" : "outline"}
            size="sm"
            aria-label={t("header.openAssistantPanel")}
            aria-expanded={assistant.panelOpen}
            onClick={() => (assistant.panelOpen ? assistant.closePanel() : assistant.openPanel())}
          >
            <MessagesSquareIcon aria-hidden="true" />
            <span className="hidden @lg:inline">{t("header.askAgeos")}</span>
          </Button>
        )}
      </div>
      <SearchDialog slug={agency.slug} open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  )
}
