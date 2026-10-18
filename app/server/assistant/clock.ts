import "server-only"

import { getBusinessDate } from "@/server/domain/presenter"

/**
 * Demo business date for assistant snapshots and as-of labels (the presenter
 * may advance it). Failures surface: a missing clock store is a deployment
 * error, not something to paper over with the fixture date.
 */
export async function assistantBusinessDate(): Promise<string> {
  return getBusinessDate()
}
