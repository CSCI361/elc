import { z } from "zod"
import { utcTimestampSchema } from "./common"

export const calendarExportResponseSchema = z
  .strictObject({
    calendar: z.strictObject({
      uid: z.string().min(1),
      sequence: z.int().nonnegative(),
      status: z.enum(["CONFIRMED", "CANCELLED"]),
      timeZone: z.string().min(1),
      updatedAt: utcTimestampSchema,
    }),
    downloadUrl: z.url(),
    createLinks: z
      .strictObject({ google: z.url(), outlook: z.url() })
      .nullable(),
    replacementNote: z.string().min(1),
  })
  .refine(
    (value) =>
      value.calendar.status !== "CANCELLED" || value.createLinks === null,
    "Cancelled events cannot have calendar creation links."
  )

export type CalendarExportResponse = z.infer<
  typeof calendarExportResponseSchema
>
