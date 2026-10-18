"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getRequestSession } from "@/server/auth/request"
import { retryFailedStep, simulateDnsVerification, startActivation, DOMAIN_STATES, type ActivationRunView } from "@/server/domain/activation"
import { createAgencyDraft, saveSetupStep, validateConfiguration, type ConfigurationValidation, type SaveStepResult } from "@/server/domain/configuration"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Control-plane actions (build → activate). Each resolves the session on the
// server and delegates to the configuration / activation services, which
// check ownership, revisions and idempotency. The browser sends only the
// step data, the revision it saw and a per-attempt idempotency key.

type Result<T> = { ok: true; data: T } | Failure

async function session() {
  const s = await getRequestSession()
  if (!s) throw new DomainError("unauthenticated", "Sign in to continue")
  return s
}

const Key = z.string().min(8).max(160).regex(/^[A-Za-z0-9_.:-]+$/)
const Id = z.string().uuid()

export async function createAgencyDraftAction(input: { idempotencyKey: string }): Promise<Result<{ draftId: string; agencyId: string; created: boolean }>> {
  try {
    const p = z.object({ idempotencyKey: Key }).parse(input)
    const res = await createAgencyDraft(await session(), p)
    revalidatePath("/control/agencies")
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}

export async function saveSetupStepAction(input: { draftId: string; step: number; data: unknown; expectedRevision: number }): Promise<Result<SaveStepResult>> {
  try {
    const p = z.object({ draftId: Id, step: z.number().int().min(1).max(5), data: z.unknown(), expectedRevision: z.number().int().min(1) }).parse(input)
    const res = await saveSetupStep(await session(), p.draftId, p.step, p.data, p.expectedRevision)
    revalidatePath(`/control/setup/${p.draftId}`, "layout")
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}

export async function validateConfigurationAction(input: { draftId: string }): Promise<Result<ConfigurationValidation>> {
  try {
    const p = z.object({ draftId: Id }).parse(input)
    return { ok: true, data: await validateConfiguration(await session(), p.draftId) }
  } catch (e) {
    return toFailure(e)
  }
}

export async function startActivationAction(input: { draftId: string; idempotencyKey: string }): Promise<Result<ActivationRunView>> {
  try {
    const p = z.object({ draftId: Id, idempotencyKey: Key }).parse(input)
    const res = await startActivation(await session(), p.draftId, p.idempotencyKey)
    revalidatePath("/control", "layout")
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}

export async function retryActivationAction(input: { runId: string }): Promise<Result<ActivationRunView>> {
  try {
    const p = z.object({ runId: Id }).parse(input)
    const res = await retryFailedStep(await session(), p.runId)
    revalidatePath(`/control/activations/${p.runId}`)
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}

export async function simulateDnsForAgencyAction(input: { agencyId: string; expectedState: string }): Promise<Result<{ state: string }>> {
  try {
    const p = z.object({ agencyId: Id, expectedState: z.enum(DOMAIN_STATES) }).parse(input)
    const res = await simulateDnsVerification(await session(), p.agencyId, p.expectedState)
    revalidatePath(`/control/agencies/${p.agencyId}`)
    return { ok: true, data: { state: res.state } }
  } catch (e) {
    return toFailure(e)
  }
}
