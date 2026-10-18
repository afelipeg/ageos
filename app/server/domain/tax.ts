import "server-only"

import { and, asc, eq, isNotNull } from "drizzle-orm"
import { z } from "zod"

import { csvSafeCell } from "@/lib/csv"
import { minorToDecimalString } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { invoiceCheck, withholding } from "@/server/calculators/finance"
import { clientInvoice, taxProfile } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { blocked, Decimal, loadJob, moneyInput } from "./ledger"

// Tax compliance (M07): a preparatory checklist and export over synthetic,
// explicitly non-fiscal profiles. A country without an enabled profile is
// blocked; nothing here is a fiscal authorization or folio.

export const NON_FISCAL_LABEL = "DEMO — preparatory only · not a tax filing · no fiscal folio"

export const ValidateDemoTaxInput = z
  .object({
    job: z.string().uuid(),
    country: z.enum(["US", "CA", "MX", "CO", "UNCONFIGURED"]),
    taxProfile: z.enum(["DEMO_NO_TAX", "DEMO_SYNTHETIC_5_PERCENT"]),
    taxableBase: Decimal,
    invoiceNumber: z.string().trim().max(60).optional().nullable(),
  })
  .strict()

export async function validateDemoTaxProfile(ctx: AgencyContext, input: z.infer<typeof ValidateDemoTaxInput>) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const [profile] = await tx.select().from(taxProfile).where(and(eq(taxProfile.tenantId, ctx.tenant.id), eq(taxProfile.code, input.taxProfile))).limit(1)
    if (!profile || !profile.enabled || !profile.countries.includes(input.country)) {
      blocked("no_fiscal_profile", "No enabled synthetic tax profile for this country; fiscal emission is blocked", { country: input.country, taxProfile: input.taxProfile })
    }
    const base = moneyInput(input.taxableBase, j.currency, "taxableBase")
    const first = invoiceCheck({ currency: j.currency, lines: [{ lineId: "base", netMinor: base, vatBps: profile.rateBps }], perceptionsMinor: 0n, otherChargesMinor: 0n, withholdingsNettedMinor: 0n, declaredTotalMinor: 0n, roundingToleranceMinor: 0n })
    const check = invoiceCheck({ currency: j.currency, lines: [{ lineId: "base", netMinor: base, vatBps: profile.rateBps }], perceptionsMinor: 0n, otherChargesMinor: 0n, withholdingsNettedMinor: 0n, declaredTotalMinor: first.computedTotalMinor, roundingToleranceMinor: 0n })
    const issued = await tx
      .select({ number: clientInvoice.number, grossMinor: clientInvoice.grossMinor, taxMinor: clientInvoice.taxMinor, taxProfile: clientInvoice.taxProfile, invoiceDate: clientInvoice.invoiceDate })
      .from(clientInvoice)
      .where(and(eq(clientInvoice.tenantId, ctx.tenant.id), isNotNull(clientInvoice.number)))
      .orderBy(asc(clientInvoice.number))
    const referenced = input.invoiceNumber ? issued.find((i) => i.number === input.invoiceNumber!.trim().toUpperCase()) ?? null : null
    const numbers = issued.map((i) => Number(i.number!.replace(/\D/g, "")))
    const gaps = numbers.length ? Array.from({ length: Math.max(...numbers) }, (_, i) => i + 1).filter((n) => !numbers.includes(n)) : []
    const fmt = (m: bigint) => minorToDecimalString(m, j.currency)
    const exportCsv = [
      ["label", "country", "profile", "currency", "taxable_base", "tax", "gross", "fiscal_validity"].join(";"),
      [NON_FISCAL_LABEL, input.country, profile.code, j.currency, fmt(check.netMinor), fmt(check.vatMinor), fmt(check.computedTotalMinor), "false"].map(csvSafeCell).join(";"),
    ].join("\n")
    const checklist = [
      { id: "profile_enabled_for_country", ok: true, detail: `${profile.code} covers ${input.country}` },
      { id: "synthetic_rate_applied", ok: check.status === "matched", detail: `${profile.rateBps} bps` },
      { id: "fiscal_authority_connection", ok: false, detail: "Not available in the demo: preparation only" },
      { id: "invoice_referenced", ok: !input.invoiceNumber || !!referenced, detail: input.invoiceNumber ?? null },
    ]
    return {
      jobId: j.id,
      country: input.country,
      profile: { code: profile.code, rateBps: profile.rateBps, label: profile.label, fiscalValidity: false },
      label: NON_FISCAL_LABEL,
      checklist,
      authorization_requests: { items: [], reason: "No tax authority integration in the demo; a fiscal folio is never generated." },
      numbering_report: { series: "DEMO-INV (internal demo numbering, not fiscal)", issued: issued.map((i) => i.number), gaps, referenced },
      vat_books_reconciliation: check,
      withholding_perception_schedule: [{ ...withholding({ currency: j.currency, method: "per_payment", paymentBaseMinor: base, accumulatedBaseMinor: 0n, accumulatedWithheldMinor: 0n, nonTaxableMinimumMinor: 0n, rateBps: 0, minimumWithholdingMinor: 0n }), note: "No withholding table in synthetic profiles" }],
      certificate_register: { items: [], reason: "No certificates in the demo." },
      tax_positions: [{ currency: j.currency, taxableBaseMinor: check.netMinor, taxMinor: check.vatMinor, grossMinor: check.computedTotalMinor, profile: profile.code }],
      statutory_exports: { format: "csv", label: NON_FISCAL_LABEL, content: exportCsv, filing: false },
    }
  })
}
