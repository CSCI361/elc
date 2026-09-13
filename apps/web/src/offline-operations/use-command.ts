import { useSyncExternalStore } from "react"
import { EventApiError } from "../events/api"
import type { OfflineCommands, OfflineCommand } from "./commands"
export function useOfflineCommand(commands: OfflineCommands, key: string) {
  return useSyncExternalStore(commands.subscribe, () => commands.get(key))
}
export function commandText(command: OfflineCommand | undefined, key: string) {
  const value = command?.request.body[key]
  return typeof value === "string" ? value : ""
}
export function authorityFailed(command: OfflineCommand | undefined) {
  return (
    command?.phase === "failed" &&
    command.error instanceof EventApiError &&
    [401, 403, 404].includes(command.error.status)
  )
}
