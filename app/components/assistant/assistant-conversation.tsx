"use client"

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react"
import {
  ArrowUpIcon,
  HistoryIcon,
  Maximize2Icon,
  MessagesSquareIcon,
  Minimize2Icon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { IconStack } from "@/components/reui/icon-stack"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { useAssistant } from "./assistant-provider"
import { MessageParts } from "./message-parts"
import { FeaturedScenarios, ScenarioCatalog } from "./scenario-catalog"

// Conversation content adapted from ReUI ai-chat-6 (Message, Bubble, Marker,
// MessageScroller, InputGroup composer). Demo arrays (SOURCES, PLAN_STEPS,
// FORK_CHOICES, OWNERS, MODELS, PICKABLE_FILES) are replaced by server
// scenarios and authorized records; there is no model selector.

const MEASURED = "[content-visibility:visible]"

function Header({ variant }: { variant: "panel" | "page" }) {
  const { t, timestamp } = useI18n()
  const a = useAssistant()
  const run = a.conversation?.activeRun
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 py-2">
      <div className="flex min-h-8 items-center gap-2">
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-sm font-semibold">{t("assistant.title")}</span>
        <Tooltip>
          <TooltipTrigger render={<Badge variant="primary-light" className="shrink-0">{t("assistant.mode")}</Badge>} />
          <TooltipContent className="max-w-64">{t("assistant.modeHelp")}</TooltipContent>
        </Tooltip>
        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<span className="flex" />}>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("assistant.history")} className="text-muted-foreground hover:text-foreground" />}>
                  <HistoryIcon aria-hidden="true" />
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("assistant.history")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("assistant.history")}</DropdownMenuLabel>
                {(a.conversation?.history ?? []).length === 0 && <DropdownMenuItem disabled>{t("assistant.historyEmpty")}</DropdownMenuItem>}
                {(a.conversation?.history ?? []).map((h) => (
                  <DropdownMenuItem key={h.id} onClick={() => void a.openConversation(h.id)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{h.title}</span>
                      <span className="text-xs text-muted-foreground">{timestamp(h.updatedAt)}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("assistant.newChat")} className="text-muted-foreground hover:text-foreground" onClick={() => void a.newConversation()} />}>
              <PlusIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("assistant.newChat")}</TooltipContent>
          </Tooltip>
          {variant === "panel" ? (
            <>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("assistant.expand")} className="text-muted-foreground hover:text-foreground" onClick={a.expand} />}>
                  <Maximize2Icon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>{t("assistant.expand")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("assistant.close")} className="text-muted-foreground hover:text-foreground" onClick={a.closePanel} />}>
                  <XIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>{t("assistant.close")}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={a.returnToWork}>
              <Minimize2Icon aria-hidden="true" />
              {t("assistant.returnToWork")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono">{t("assistant.orchestrator")}</span>
        <p role="status" aria-live="polite" className="ms-auto flex min-w-0 shrink items-center">
          {run ? (
            <Badge variant={run.status === "running" ? "primary-light" : "warning-light"} className="min-w-0 gap-1.5 font-normal">
              {run.status === "running" && !run.resumable ? <Spinner className="size-3" aria-hidden="true" /> : null}
              <span className="truncate">{t(`assistant.status.${run.status}`)}</span>
            </Badge>
          ) : null}
        </p>
        {run?.resumable ? (
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="xs" onClick={() => void a.resumeRun()} />}>
              <PlayIcon aria-hidden="true" />
              {t("assistant.resume")}
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t("assistant.resumeHelp")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}

function ContextBar() {
  const { t } = useI18n()
  const a = useAssistant()
  const chips: { label: string; value: string }[] = []
  if (a.context.moduleKey) chips.push({ label: t("assistant.contextModule"), value: a.context.moduleKey })
  if (a.context.record) chips.push({ label: t("assistant.contextRecord"), value: a.pinned?.label ?? `${a.context.record.type} ${a.context.record.id.slice(0, 8)}` })
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-xs" aria-label={t("assistant.context")}>
      <span className="text-muted-foreground">{t("assistant.context")}:</span>
      <Badge variant="outline">
        {t("assistant.contextAgency")}: {a.slug}
      </Badge>
      {chips.map((c) => (
        <Badge key={c.label} variant="outline">
          {c.label}: {c.value}
        </Badge>
      ))}
      {a.pinned && (
        <Button variant="ghost" size="xs" onClick={() => a.setPinned(null)} aria-label={t("assistant.removeContext")}>
          <XIcon aria-hidden="true" />
          {t("assistant.pinned")}
        </Button>
      )}
    </div>
  )
}

function Thread() {
  const { t, timestamp } = useI18n()
  const a = useAssistant()
  if (a.loading) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 py-4" aria-busy="true" aria-label={t("states.loadingRegion", { region: t("assistant.title") })}>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="ml-auto h-8 w-2/3" />
      </div>
    )
  }
  if (a.threadNotFound) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <Empty className="m-auto w-full flex-none p-0">
          <EmptyHeader>
            <EmptyTitle className="text-base">{t("assistant.threadNotFoundTitle")}</EmptyTitle>
            <EmptyDescription>{t("assistant.threadNotFoundBody")}</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" onClick={() => void a.newConversation()}>
            <PlusIcon aria-hidden="true" />
            {t("assistant.startNew")}
          </Button>
        </Empty>
      </div>
    )
  }
  if (!a.messages.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <Empty className="mx-auto mt-auto w-full flex-none p-0">
          <EmptyHeader>
            <EmptyMedia className="mb-0">
              <IconStack aria-hidden="true" className="h-16 w-14">
                <MessagesSquareIcon strokeWidth="1.9" className="size-3.5" aria-hidden="true" />
              </IconStack>
            </EmptyMedia>
            <EmptyTitle className="text-base">{t("assistant.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("assistant.emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <div className="mb-auto w-full">
          <ScenarioCatalog items={a.suggestions} disabled={a.sending} onPick={(presetId) => void a.send({ presetId })} />
        </div>
      </div>
    )
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent aria-busy={a.sending} className="flex w-full min-w-0 flex-col gap-6 px-4 py-4">
              <MessageScrollerItem scrollAnchor={false} className={MEASURED}>
                <Marker variant="separator">
                  <MarkerContent>{t("assistant.threadStart")}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
              {a.messages.map((m) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={false} className={MEASURED}>
                  {m.role === "user" ? (
                    <Message align="end" role="group" aria-label={t("assistant.you")}>
                      <MessageContent className="min-w-0 items-end gap-1.5">
                        <Bubble variant="muted" align="end" className="max-w-[88%]">
                          <BubbleContent className="text-sm/6">
                            <MessageParts parts={m.parts} />
                          </BubbleContent>
                        </Bubble>
                        <MessageFooter className="pe-0">
                          <span className="text-xs tabular-nums text-muted-foreground">{timestamp(m.createdAt)}</span>
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  ) : (
                    <Message role="group" aria-label={t("assistant.title")}>
                      <MessageContent className="min-w-0 gap-2">
                        <Bubble variant="ghost" className="w-full min-w-0">
                          <BubbleContent className="min-w-0 p-0">
                            <MessageParts parts={m.parts} />
                          </BubbleContent>
                        </Bubble>
                        <MessageFooter className="gap-1.5 px-0">
                          <span className="text-xs tabular-nums text-muted-foreground">{timestamp(m.createdAt)}</span>
                          {m.scenarioId && <Badge variant="outline">{m.scenarioId}</Badge>}
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  )}
                </MessageScrollerItem>
              ))}
              {a.sending ? (
                <MessageScrollerItem scrollAnchor={false} className={MEASURED}>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-hidden="true">
                    <Spinner className="size-3.5" />
                    {t("assistant.sending")}
                  </p>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton variant="outline" size="icon-sm" className="rounded-full shadow-sm" />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}

function Composer() {
  const { t } = useI18n()
  const a = useAssistant()
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const run = a.conversation?.activeRun
  const value = a.draft

  // A prefill (Ask assistant from a record) moves focus into the composer.
  useEffect(() => {
    if (a.focusToken) box.current?.focus()
  }, [a.focusToken])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = value.trim()
    if (!text || a.sending) return
    // The draft is cleared by the provider only when the server accepts it.
    void a.send({ text })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const showStarters = !a.loading && !a.threadNotFound && (!a.messages.length || !run)
  return (
    <div className="relative z-10 flex shrink-0 flex-col gap-2 border-t border-border px-4 pt-3 pb-4">
      {a.error && (
        <p role="alert" className="text-xs text-destructive">
          {t("assistant.error", { message: a.error })}
        </p>
      )}
      {showStarters ? <FeaturedScenarios items={a.suggestions} disabled={a.sending} onPick={(presetId) => void a.send({ presetId })} /> : null}
      <form onSubmit={submit} className="w-full">
        <Field>
          <FieldLabel className="sr-only" htmlFor={id}>
            {t("assistant.composerLabel")}
          </FieldLabel>
          <InputGroup>
            <InputGroupTextarea
              id={id}
              ref={box}
              value={value}
              onChange={(e) => a.setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              readOnly={a.sending}
              aria-busy={a.sending}
              maxLength={500}
              placeholder={t("assistant.composerPlaceholder")}
              className="field-sizing-content max-h-32 min-h-10"
            />
            <InputGroupAddon align="block-end" className="justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{t("common.demoBadge")}</span>
              <div className="flex items-center gap-1">
                {run && ["waiting_input", "waiting_confirmation", "running"].includes(run.status) ? (
                  <InputGroupButton type="button" size="sm" variant="outline" onClick={() => void a.cancelRun()} aria-label={t("assistant.stop")}>
                    <SquareIcon aria-hidden="true" />
                    <span className="hidden sm:inline">{t("assistant.stop")}</span>
                  </InputGroupButton>
                ) : null}
                <InputGroupButton type="submit" size="icon-sm" variant="default" disabled={!value.trim() || a.sending} aria-label={t("assistant.send")}>
                  {a.sending ? <Spinner className="size-3.5" aria-hidden="true" /> : <ArrowUpIcon aria-hidden="true" />}
                </InputGroupButton>
                <Kbd className={cn("hidden md:inline-flex")}>Enter</Kbd>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </form>
    </div>
  )
}

export function AssistantConversation({ variant }: { variant: "panel" | "page" }) {
  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col bg-background", variant === "page" ? "h-full" : "h-full")}>
      <Header variant={variant} />
      <ContextBar />
      <Thread />
      <Composer />
    </div>
  )
}
