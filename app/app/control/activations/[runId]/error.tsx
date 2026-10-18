"use client"

import { RouteError } from "@/components/records/route-states"

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />
}
