import type { NextRequest } from "next/server"

import { listClients, listJobs } from "@/server/domain/jobs"
import { withAgencyApi } from "@/server/http/agency-api"

/** Authorized header search: only this agency's jobs and clients. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80)
    const jobs = await listJobs(ctx, { q: q || undefined, pageSize: "8" })
    const term = q.toLowerCase()
    const clients = (await listClients(ctx)).filter((c) => !term || c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)).slice(0, 5)
    return {
      hits: [
        ...jobs.items.map((j) => ({ kind: "job", id: j.id, title: j.name, subtitle: `${j.displayReference} · ${j.jobNumber} · ${j.clientName}`, href: `/a/${ctx.tenant.slug}/jobs/${j.id}` })),
        ...clients.map((c) => ({ kind: "client", id: c.id, title: c.name, subtitle: `${c.code} · ${c.billingCurrency}`, href: `/a/${ctx.tenant.slug}/clients/${c.id}` })),
      ],
    }
  })
}
