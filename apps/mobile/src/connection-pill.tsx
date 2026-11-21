import { Text, View } from "react-native"
import type { Copy } from "./copy"
import { colors, toneColors } from "./theme"

export function ConnectionPill({
  online,
  copy,
}: {
  online: boolean
  copy: Copy
}) {
  const palette = toneColors[online ? "success" : "warning"]
  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: palette.soft,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: online ? colors.success : colors.warning,
        }}
      />
      <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "600" }}>
        {online ? copy.online : copy.offline}
      </Text>
    </View>
  )
}
