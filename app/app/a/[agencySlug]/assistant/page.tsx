import type { Metadata } from "next"

import { AssistantConversation } from "@/components/assistant/assistant-conversation"
import { requireAgency } from "@/server/auth/request"

export const metadata: Metadata = { title: "Assistant" }

// Full-page view of the same conversation the right panel shows. The shell
// hides the panel on this route so the thread is never rendered twice.
export default async function AssistantPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  await requireAgency(agencySlug)
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col border-x border-border">
      <AssistantConversation variant="page" />
    </div>
  )
}
