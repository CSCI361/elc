import { z } from "zod"
import { platformPermissionSchema } from "./states"

export const platformAccessResponseSchema = z.strictObject({
  permissions: z.array(platformPermissionSchema).max(4),
})
