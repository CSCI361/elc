import { useState } from "react"
import { Image, View } from "react-native"
import { CalendarBlank } from "./icons"
import type { ScannerEvent } from "@elc/shared"
import { configuration } from "./service"
import { colors } from "./theme"

export function EventCover({
  event,
  cookie,
  height,
  radius = 0,
}: {
  event: ScannerEvent
  cookie: string | null
  height: number
  radius?: number
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const frame = {
    height,
    borderRadius: radius,
    backgroundColor: colors.surface3,
    overflow: "hidden" as const,
  }
  if (!event.coverImageUrl || failedUrl === event.coverImageUrl)
    return (
      <View style={[frame, { alignItems: "center", justifyContent: "center" }]}>
        <CalendarBlank size={36} color={colors.ink3} />
      </View>
    )
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{
        uri: `${configuration.apiOrigin}${event.coverImageUrl}`,
        headers: cookie ? { cookie } : undefined,
      }}
      onError={() => setFailedUrl(event.coverImageUrl)}
      resizeMode="cover"
      style={[frame, { width: "100%" }]}
    />
  )
}
