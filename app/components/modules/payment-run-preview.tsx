"use client"

import { useState, useTransition } from "react"
import { EyeIcon, TriangleAlertIcon } from "lucide-react"

import { RecordGrid } from "@/components/app/record-grid"
import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { previewPaymentRunAction } from "@/server/actions/ui/payments"

type Preview = {
  currency: string
  totalMinor: string
  availableMinor?: string
  sufficient: boolean
  items: { sourceId?: string; payee?: string; amountMinor: string; dueDate?: string; sourceType?: string; label?: string }[]
  held: { label?: string; reason?: string; reasons?: string[] }[]
}

/** Read-only preview of what a payment run would include (payments service). */
export function PaymentRunPreview({ agencySlug, banks, defaultDate }: { agencySlug: string; banks: { value: string; label: string }[]; defaultDate: string }) {
  const { t, money, messages } = useI18n()
  const [bank, setBank] = useState(banks[0]?.value ?? "")
  const [due, setDue] = useState(defaultDate)
  const [pending, start] = useTransition()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!banks.length) return <p className="text-sm text-muted-foreground">{t("modules.paymentPreview.noBank")}</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="pr-bank">{t("modules.paymentPreview.bank")}</FieldLabel>
          <Select items={banks} value={bank} onValueChange={(v) => setBank(String(v ?? bank))}>
            <SelectTrigger id="pr-bank" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {banks.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-due">{t("modules.paymentPreview.dueThrough")}</FieldLabel>
          <Input id="pr-due" type="date" min="2026-01-01" max="2028-12-31" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !bank || !due}
          onClick={() =>
            start(async () => {
              setError(null)
              const res = await previewPaymentRunAction({ agencySlug, connection: bank, dueThrough: due })
              if (!res.ok) return setError(codeLabel(messages, t, (res.error.details as { rule?: string }).rule ?? res.error.code))
              setPreview(res.data as unknown as Preview)
            })
          }
        >
          <EyeIcon aria-hidden="true" />
          {t("modules.paymentPreview.run")}
        </Button>
      </div>
      {error && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {preview && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <Alert variant={preview.sufficient ? "success" : "warning"}>
            <AlertTitle>{t("modules.paymentPreview.total", { total: money(preview.totalMinor, preview.currency), n: preview.items.length })}</AlertTitle>
            <AlertDescription>
              {preview.availableMinor ? t("modules.paymentPreview.available", { available: money(preview.availableMinor, preview.currency) }) : null}{" "}
              {preview.sufficient ? t("modules.paymentPreview.sufficient") : t("modules.paymentPreview.insufficient")}
            </AlertDescription>
          </Alert>
          <RecordGrid
            compact
            emptyMessage={t("modules.paymentPreview.none")}
            columns={[
              { id: "label", header: "modules.columns.reference", kind: "text" },
              { id: "dueDate", header: "modules.columns.due", kind: "text" },
              { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
            ]}
            rows={preview.items.map((i, idx) => ({ id: i.sourceId ?? String(idx), label: i.label ?? i.payee ?? i.sourceType ?? "—", dueDate: i.dueDate ?? "—", amountMinor: i.amountMinor, currency: preview.currency }))}
          />
          {preview.held.length > 0 && <p className="text-xs text-muted-foreground">{t("modules.paymentPreview.held", { n: preview.held.length })}</p>}
          <p className="text-xs text-muted-foreground">{t("modules.paymentPreview.note")}</p>
        </div>
      )}
    </div>
  )
}
