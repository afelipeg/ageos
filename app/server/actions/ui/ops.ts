"use server"

import { revalidatePath } from "next/cache"

import { getRequestSession } from "@/server/auth/request"
import { applyPlatformChange, decidePlatformChange, investigate, proposeDelimiterChange, verifyPlatformChange, type VerifyResult } from "@/server/domain/ops"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Platform operations actions for the ops_csv_delimiter_mismatch circuit.
// Roles (operator proposes, a different admin approves), allowlist, exact
// digest/revision and idempotency are enforced by server/domain/ops.ts.

type Result<T> = { ok: true; data: T } | Failure

async function session() {
  const s = await getRequestSession()
  if (!s) throw new DomainError("unauthenticated", "Sign in to continue")
  return s
}

export async function investigateAction(input: { incidentId: string }): Promise<Result<{ state: string }>> {
  try {
    const res = await investigate(await session(), String(input.incidentId))
    revalidatePath("/ops", "layout")
    return { ok: true, data: { state: res.state } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function proposeDelimiterAction(input: { incidentId: string; delimiter: string; expectedProfileRevision: number; reason: string; idempotencyKey: string }): Promise<Result<{ changeId: string; state: string }>> {
  try {
    const res = await proposeDelimiterChange(await session(), input as Parameters<typeof proposeDelimiterChange>[1])
    revalidatePath("/ops", "layout")
    return { ok: true, data: { changeId: res.changeId, state: res.state } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function decidePlatformChangeAction(input: { changeId: string; decision: "approve" | "reject"; reviewedDigest: string; reason?: string }): Promise<Result<{ outcome: string }>> {
  try {
    const res = await decidePlatformChange(await session(), input)
    revalidatePath("/ops", "layout")
    return { ok: true, data: { outcome: res.outcome } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function applyPlatformChangeAction(input: { changeId: string; idempotencyKey: string }): Promise<Result<{ profileRevision: number; replayed: boolean }>> {
  try {
    const res = await applyPlatformChange(await session(), input)
    revalidatePath("/ops", "layout")
    return { ok: true, data: { profileRevision: res.profileRevision, replayed: res.replayed } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function verifyPlatformChangeAction(input: { changeId: string }): Promise<Result<VerifyResult>> {
  try {
    const res = await verifyPlatformChange(await session(), input)
    revalidatePath("/ops", "layout")
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}
