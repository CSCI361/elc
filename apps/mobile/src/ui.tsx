import type { PropsWithChildren } from "react"
import { colors, styles } from "./theme"
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type TextInputProps,
  TextInput,
} from "react-native"

export function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
  busy = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  busy?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.ink : "white"} />
      ) : (
        <Text
          style={[styles.buttonText, secondary && styles.secondaryButtonText]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          props.multiline && { minHeight: 90 },
          props.style,
        ]}
      />
    </View>
  )
}
export function Notice({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "success" | "error" }>) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        tone === "error" && styles.errorNotice,
        tone === "success" && styles.successNotice,
      ]}
    >
      <Text style={styles.body}>{children}</Text>
    </View>
  )
}
