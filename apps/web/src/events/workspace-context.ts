import { eventDetailResponseSchema } from "@elc/shared"
import { createContext, use } from "react"

export type EventDetail = ReturnType<typeof eventDetailResponseSchema.parse>

export interface Workspace {
  detail?: EventDetail
  error?: unknown
  reload: () => void
  update: (detail: EventDetail) => void
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const workspace = use(WorkspaceContext)
  if (!workspace) throw new Error("useWorkspace needs OrganizerEventLayout")
  return workspace
}
