"use server"

import { revalidatePath } from "next/cache"

import { getRequestSession } from "@/server/auth/request"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

import { loadSampleScopeRequest, SAMPLE_SCOPE, type SampleScopeResult } from "./presenter-scope"

/** /demo/presenter → "Load sample scope request" (presenter session only; audited; idempotent per demo run). */
export async function loadSampleScopeRequestAction(): Promise<{ ok: true; data: SampleScopeResult } | Failure> {
  try {
    const session = await getRequestSession()
    if (!session) throw new DomainError("unauthenticated", "Sign in to continue")
    const data = await loadSampleScopeRequest(session)
    revalidatePath("/demo/presenter")
    revalidatePath(`/a/${SAMPLE_SCOPE.tenantSlug}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toFailure(e)
  }
}
