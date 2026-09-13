import type { Bindings } from "../env"

export function recoveryPaused(env: Pick<Bindings, "RECOVERY_MODE"> = {}) {
  return env.RECOVERY_MODE !== undefined && env.RECOVERY_MODE !== "running"
}
