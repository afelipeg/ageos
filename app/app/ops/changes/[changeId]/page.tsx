import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { BlockedState } from "@/components/app/states"
import { ChangeActions } from "@/components/ops/change-actions"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requirePlatformSession } from "@/server/auth/request"
import { getPlatformChange } from "@/server/domain/ops"
import { getI18n } from "@/server/i18n"
import { isDomainError } from "@/server/kernel/errors"

export const metadata: Metadata = { title: "Review platform change" }

// approval-detail family for a platform change: the exact typed payload and
// digest bound to the profile revision, requester vs approver (a different
// platform admin), local application and verification on the same file. No
// remote PR, no infrastructure mutation, no business import.
export default async function PlatformChangePage({ params }: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await params
  const session = await requirePlatformSession()
  let c: Awaited<ReturnType<typeof getPlatformChange>>
  try {
    c = await getPlatformChange(session, changeId)
  } catch (e) {
    if (isDomainError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound()
    throw e
  }
  const { t, timestamp } = await getI18n()
  const role = session.user.platformRole
  const decideReason =
    c.state !== "awaiting_approval"
      ? null
      : c.requestedBy.id === session.user.id
        ? t("ops.change.requesterCannot")
        : role !== "platform_admin"
          ? t("ops.change.adminOnly")
          : null
  const verification = c.verification as { passed?: boolean; before?: { delimiter: string; observedColumns: number }; after?: { observedColumns: number; observedHeaders: string[] }; sameFile?: boolean; ordersImported?: number; fileSha256?: string } | null

  return (
    <>
      <PageHeader
        title={t("ops.change.title")}
        description={`${c.commandType} · ${c.tenant.name} (${c.tenant.slug})`}
        badges={<Badge variant="outline">{t(`ops.changeStates.${c.state}`)}</Badge>}
        actions={
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/ops/incidents/${c.incidentId}`} />}>
            {t("ops.change.openIncident")}
          </Button>
        }
      />
      {c.state === "stale" && <BlockedState title={t("ops.change.staleTitle")} description={t("ops.change.staleBody")} />}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.change.payloadTitle")}</FrameTitle>
              <FrameDescription>{t("ops.change.payloadHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                <dt className="text-muted-foreground">{t("ops.change.profile")}</dt>
                <dd className="font-mono text-xs">{c.payload.profile_id}</dd>
                <dt className="text-muted-foreground">{t("ops.change.field")}</dt>
                <dd className="font-mono text-xs">delimiter → {c.payload.delimiter === "\t" ? "TAB" : c.payload.delimiter}</dd>
                <dt className="text-muted-foreground">{t("ops.change.revision")}</dt>
                <dd className="tabular-nums">r{c.targetProfileRevision}</dd>
                <dt className="text-muted-foreground">{t("ops.change.reasonLabel")}</dt>
                <dd>{c.payload.reason}</dd>
                <dt className="text-muted-foreground">{t("ops.change.digest")}</dt>
                <dd className="font-mono text-xs break-all">{c.payloadDigest}</dd>
              </dl>
              <pre className="rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(c.payload, null, 2)}</pre>
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.change.decisionTitle")}</FrameTitle>
              <FrameDescription>{t("ops.change.decisionHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ChangeActions changeId={c.id} digest={c.payloadDigest} canDecide={c.canDecide} canApply={c.canApply} canVerify={c.canVerify} decideReason={decideReason} />
            </FramePanel>
          </Frame>
          {verification && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("ops.change.verificationTitle")}</FrameTitle>
              </FrameHeader>
              <FramePanel>
                <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                  <dt className="text-muted-foreground">{t("ops.change.result")}</dt>
                  <dd>{verification.passed ? t("ops.change.passed") : t("ops.change.notPassed")}</dd>
                  <dt className="text-muted-foreground">{t("ops.change.before")}</dt>
                  <dd className="font-mono text-xs">{verification.before ? `${verification.before.delimiter === "\t" ? "TAB" : verification.before.delimiter} → ${verification.before.observedColumns}` : "—"}</dd>
                  <dt className="text-muted-foreground">{t("ops.change.after")}</dt>
                  <dd className="font-mono text-xs break-all">{verification.after ? `${verification.after.observedColumns} · ${verification.after.observedHeaders.join(" | ")}` : "—"}</dd>
                  <dt className="text-muted-foreground">{t("ops.change.sameFile")}</dt>
                  <dd>{verification.sameFile ? t("common.yes") : t("common.no")}</dd>
                  <dt className="text-muted-foreground">{t("ops.change.ordersImported")}</dt>
                  <dd className="tabular-nums">{verification.ordersImported ?? 0}</dd>
                </dl>
              </FramePanel>
            </Frame>
          )}
        </div>
        <Frame spacing="default" className="min-w-0 self-start">
          <FrameHeader>
            <FrameTitle>{t("ops.change.peopleTitle")}</FrameTitle>
          </FrameHeader>
          <FramePanel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t("ops.change.requestedBy")}</dt>
              <dd>{c.requestedBy.name}</dd>
              <dt className="text-muted-foreground">{t("ops.change.created")}</dt>
              <dd>{timestamp(c.createdAt)}</dd>
              <dt className="text-muted-foreground">{t("ops.change.approvedBy")}</dt>
              <dd>{c.approvedBy?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">{t("ops.change.approvedAt")}</dt>
              <dd>{c.approvedAt ? timestamp(c.approvedAt) : "—"}</dd>
              <dt className="text-muted-foreground">{t("ops.change.appliedAt")}</dt>
              <dd>{c.appliedAt ? timestamp(c.appliedAt) : "—"}</dd>
            </dl>
          </FramePanel>
        </Frame>
      </div>
    </>
  )
}
