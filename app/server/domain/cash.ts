import "server-only"

import { and, asc, eq, lte, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { bankAccount, bankTransaction, connection, fileObject, paymentHold } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { DomainError } from "@/server/kernel/errors"
import { privateDisk } from "@/server/storage/private-disk"

import { blocked } from "./ledger"

// Treasury of the simulated demo bank (contract 03 §7, payment_funding_policy):
// confirmed cash comes only from confirmed bank transactions; available cash =
// confirmed cash − active payment holds. Receivables and forecasts never count
// as cash, and there is no overdraft or implicit credit line.

export type BankAccountRow = typeof bankAccount.$inferSelect

export async function bankAccountByConnection(tx: Tx, tenantId: string, connectionId: string) {
  const [row] = await tx
    .select({ account: bankAccount, conn: connection })
    .from(bankAccount)
    .innerJoin(connection, and(eq(connection.tenantId, bankAccount.tenantId), eq(connection.id, bankAccount.connectionId)))
    .where(and(eq(bankAccount.tenantId, tenantId), eq(bankAccount.connectionId, connectionId)))
    .limit(1)
  if (!row) throw new DomainError("not_found", "No simulated bank account for this connection")
  return row
}

export async function bankAccountById(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({ account: bankAccount, conn: connection })
    .from(bankAccount)
    .innerJoin(connection, and(eq(connection.tenantId, bankAccount.tenantId), eq(connection.id, bankAccount.connectionId)))
    .where(and(eq(bankAccount.tenantId, tenantId), eq(bankAccount.id, id)))
    .limit(1)
  if (!row) throw new DomainError("not_found", "Bank account not found")
  return row
}

/** Operating account for a job: same currency and reporting group. */
export async function bankAccountForJob(tx: Tx, tenantId: string, j: { currency: string; reportingGroup: string }) {
  const rows = await tx
    .select({ account: bankAccount, conn: connection })
    .from(bankAccount)
    .innerJoin(connection, and(eq(connection.tenantId, bankAccount.tenantId), eq(connection.id, bankAccount.connectionId)))
    .where(and(eq(bankAccount.tenantId, tenantId), eq(bankAccount.currency, j.currency), eq(bankAccount.reportingGroup, j.reportingGroup)))
    .orderBy(asc(bankAccount.fixtureKey), asc(bankAccount.createdAt), asc(bankAccount.id))
    .limit(1)
  if (!rows[0]) blocked("no_bank_account", "No simulated bank account for this currency", { currency: j.currency })
  return rows[0]
}

export function assertConnected(conn: typeof connection.$inferSelect) {
  if (conn.state !== "connected_demo") {
    throw new DomainError("connection_revoked", "The simulated bank connection is not available", { connectionId: conn.id, state: conn.state })
  }
}

/** Row lock that serializes fund reservations per tenant+entity+account+currency. */
export async function lockBankAccount(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(bankAccount)
    .where(and(eq(bankAccount.tenantId, tenantId), eq(bankAccount.id, id)))
    .for("update")
    .limit(1)
  if (!row) throw new DomainError("not_found", "Bank account not found")
  return row
}

export async function cashPosition(tx: Tx, tenantId: string, bankAccountId: string, asOf?: string) {
  const conds = [eq(bankTransaction.tenantId, tenantId), eq(bankTransaction.bankAccountId, bankAccountId), eq(bankTransaction.state, "confirmed")]
  if (asOf) conds.push(lte(bankTransaction.businessDate, asOf))
  const [c] = await tx
    .select({
      inflow: sql<string>`coalesce(sum(case when ${bankTransaction.direction} = 'in' then ${bankTransaction.amountMinor} else 0 end), 0)`,
      outflow: sql<string>`coalesce(sum(case when ${bankTransaction.direction} = 'out' then ${bankTransaction.amountMinor} else 0 end), 0)`,
    })
    .from(bankTransaction)
    .where(and(...conds))
  const [h] = await tx
    .select({ held: sql<string>`coalesce(sum(${paymentHold.amountMinor}), 0)` })
    .from(paymentHold)
    .where(and(eq(paymentHold.tenantId, tenantId), eq(paymentHold.bankAccountId, bankAccountId), eq(paymentHold.state, "active")))
  const confirmed = BigInt(c?.inflow ?? "0") - BigInt(c?.outflow ?? "0")
  const held = BigInt(h?.held ?? "0")
  return { confirmedMinor: confirmed, activeHoldsMinor: held, availableMinor: confirmed - held }
}

/** Inserts a confirmed bank movement once per provider receipt. */
export async function recordBankTransaction(
  tx: Tx,
  ctx: AgencyContext,
  v: {
    bankAccountId: string
    direction: "in" | "out"
    amountMinor: bigint
    currency: string
    businessDate: string
    kind: "collection" | "payment"
    providerReceiptId: string
    sourceType: string
    sourceId: string
    detail?: Record<string, unknown>
    statementLineId?: string | null
  }
) {
  const [row] = await tx
    .insert(bankTransaction)
    .values({
      tenantId: ctx.tenant.id,
      bankAccountId: v.bankAccountId,
      direction: v.direction,
      amountMinor: v.amountMinor,
      currency: v.currency,
      businessDate: v.businessDate,
      kind: v.kind,
      provider: "demo_bank",
      providerReceiptId: v.providerReceiptId,
      sourceType: v.sourceType,
      sourceId: v.sourceId,
      statementLineId: v.statementLineId ?? null,
      detail: { simulation: true, ...(v.detail ?? {}) },
      createdBy: ctx.user.id,
    })
    .onConflictDoNothing()
    .returning()
  if (row) return { transaction: row, created: true }
  const [existing] = await tx
    .select()
    .from(bankTransaction)
    .where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.bankAccountId, v.bankAccountId), eq(bankTransaction.providerReceiptId, v.providerReceiptId)))
    .limit(1)
  return { transaction: existing!, created: false }
}

/** Cash timeline of one bank account (confirmed movements in business order). */
export async function cashTimeline(tx: Tx, tenantId: string, bankAccountId: string) {
  const rows = await tx
    .select()
    .from(bankTransaction)
    .where(and(eq(bankTransaction.tenantId, tenantId), eq(bankTransaction.bankAccountId, bankAccountId)))
    .orderBy(asc(bankTransaction.businessDate), asc(bankTransaction.createdAt))
  let balance = 0n
  return rows.map((r) => {
    const delta = r.direction === "in" ? r.amountMinor : -r.amountMinor
    balance += delta
    return { id: r.id, kind: r.kind, businessDate: r.businessDate, deltaMinor: delta, cashMinor: balance, receiptId: r.providerReceiptId, sourceType: r.sourceType, sourceId: r.sourceId }
  })
}

// ── Queries ──

export async function getCashPositions(ctx: AgencyContext, opts: { includeDemoLab?: boolean } = {}) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const accounts = await tx
      .select({ account: bankAccount, conn: connection })
      .from(bankAccount)
      .innerJoin(connection, and(eq(connection.tenantId, bankAccount.tenantId), eq(connection.id, bankAccount.connectionId)))
      .where(eq(bankAccount.tenantId, ctx.tenant.id))
      .orderBy(asc(bankAccount.createdAt))
    const out = []
    for (const a of accounts) {
      if (!opts.includeDemoLab && a.account.reportingGroup === "demo-lab") continue
      const pos = await cashPosition(tx, ctx.tenant.id, a.account.id)
      out.push({
        bankAccountId: a.account.id,
        name: a.account.name,
        connectionId: a.conn.id,
        accountAlias: a.conn.accountAlias,
        connectionState: a.conn.state,
        currency: a.account.currency,
        reportingGroup: a.account.reportingGroup,
        basis: "confirmed_demo_bank" as const,
        simulation: true as const,
        ...pos,
      })
    }
    return out
  })
}

/** Stores a generated, synthetic document in the private library. */
export async function storeGeneratedFile(
  tx: Tx,
  ctx: AgencyContext,
  f: { name: string; format: "csv" | "pdf"; bytes: Uint8Array; jobId?: string | null; label: string }
) {
  const id = crypto.randomUUID()
  const stored = await privateDisk.put(ctx.tenant.id, id, f.bytes)
  const [row] = await tx
    .insert(fileObject)
    .values({
      id,
      tenantId: ctx.tenant.id,
      logicalId: id,
      version: 1,
      jobId: f.jobId ?? null,
      originalName: f.name,
      format: f.format,
      mimeType: f.format === "csv" ? "text/csv" : "application/pdf",
      sizeBytes: stored.size,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      extractionStatus: "not_analyzed",
      extraction: { label: f.label },
      synthetic: "generated",
      uploadedBy: ctx.user.id,
    })
    .returning()
  return row!
}

export async function readTenantFile(tx: Tx, tenantId: string, fileId: string) {
  const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, fileId))).limit(1)
  if (!f) throw new DomainError("not_found", "File not found")
  const bytes = await privateDisk.get(tenantId, f.storageKey)
  return { file: f, bytes }
}
