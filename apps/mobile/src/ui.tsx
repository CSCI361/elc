import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type TextInputProps,
} from "react-native"
import type { IconProps } from "phosphor-react-native"
import { colors, styles, toneColors, type Tone } from "./theme"
import { CaretLeft } from "./icons"

export type Icon = ComponentType<IconProps>
type Variant = "primary" | "secondary" | "ghost" | "danger"

const variantStyles: Record<
  Variant,
  { background: string; border: string; text: string }
> = {
  primary: {
    background: colors.brand,
    border: colors.brand,
    text: colors.onBrand,
  },
  secondary: {
    background: colors.surface,
    border: colors.lineStrong,
    text: colors.ink,
  },
  ghost: {
    background: "transparent",
    border: "transparent",
    text: colors.brandPressed,
  },
  danger: {
    background: colors.surface,
    border: colors.lineStrong,
    text: colors.danger,
  },
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon: IconComponent,
  disabled = false,
  busy = false,
  testID,
}: {
  label: string
  onPress: () => void
  variant?: Variant
  icon?: Icon
  disabled?: boolean
  busy?: boolean
  testID?: string
}) {
  const look = variantStyles[variant]
  const inactive = disabled || busy
  const muted = disabled && variant === "primary"
  const text = muted ? colors.ink3 : look.text
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: muted
          ? colors.surface3
          : pressed && variant === "primary"
            ? colors.brandPressed
            : look.background,
        borderColor: muted ? colors.surface3 : look.border,
        opacity:
          pressed && variant !== "primary" ? 0.7 : disabled && !muted ? 0.5 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={text} />
      ) : (
        <>
          {IconComponent ? (
            <IconComponent size={20} color={text} weight="bold" />
          ) : null}
          <Text style={{ color: text, fontSize: 16, fontWeight: "600" }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  )
}

export function IconButton({
  icon: IconComponent,
  label,
  onPress,
  testID,
}: {
  icon: Icon
  label: string
  onPress: () => void
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
        },
        pressed && styles.pressed,
      ]}
    >
      <IconComponent size={22} color={colors.ink} />
    </Pressable>
  )
}

export function Field({
  label,
  icon: IconComponent,
  ...props
}: TextInputProps & { label: string; icon?: Icon }) {
  return (
    <View style={{ gap: 6 }}>
      {IconComponent ? null : <Text style={styles.label}>{label}</Text>}
      <View style={{ justifyContent: "center" }}>
        {IconComponent ? (
          <View style={{ position: "absolute", left: 14, zIndex: 1 }}>
            <IconComponent size={20} color={colors.ink3} />
          </View>
        ) : null}
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholder={IconComponent ? label : props.placeholder}
          placeholderTextColor={colors.ink3}
          style={[
            styles.input,
            IconComponent && { paddingLeft: 44 },
            props.multiline && { minHeight: 88, textAlignVertical: "top" },
          ]}
        />
      </View>
    </View>
  )
}

export function Notice({
  tone = "neutral",
  icon: IconComponent,
  children,
  action,
}: {
  tone?: Tone
  icon?: Icon
  children: ReactNode
  action?: ReactNode
}) {
  const palette = toneColors[tone]
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: palette.soft,
        borderRadius: 12,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        {IconComponent ? (
          <IconComponent size={20} color={palette.ink} weight="bold" />
        ) : null}
        <Text style={[styles.body, { flex: 1, fontSize: 15, lineHeight: 21 }]}>
          {children}
        </Text>
      </View>
      {action}
    </View>
  )
}

export function Badge({
  label,
  tone = "neutral",
  icon: IconComponent,
}: {
  label: string
  tone?: Tone
  icon?: Icon
}) {
  const palette = toneColors[tone]
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        backgroundColor: palette.soft,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      {IconComponent ? (
        <IconComponent size={14} color={palette.ink} weight="bold" />
      ) : null}
      <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.surface2,
        borderRadius: 12,
        padding: 4,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? colors.surface : "transparent",
              shadowColor: "#000",
              shadowOpacity: selected ? 0.08 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: selected ? "600" : "500",
                color: selected ? colors.ink : colors.ink2,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.surface3,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.round(value * 100)}%`,
          height: "100%",
          borderRadius: 4,
          backgroundColor: colors.success,
        }}
      />
    </View>
  )
}

const skeletonRevealMs = 400
export function Skeleton({
  width = "100%",
  height,
  radius = 8,
}: {
  width?: DimensionValue
  height: number
  radius?: number
}) {
  const [opacity] = useState(() => new Animated.Value(0))
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  }, [])
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(skeletonRevealMs),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      ...(reduceMotion
        ? []
        : [
            Animated.loop(
              Animated.sequence([
                Animated.timing(opacity, {
                  toValue: 0.55,
                  duration: 700,
                  useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                  toValue: 1,
                  duration: 700,
                  useNativeDriver: true,
                }),
              ])
            ),
          ]),
    ])
    animation.start()
    return () => animation.stop()
  }, [opacity, reduceMotion])
  return (
    <Animated.View
      aria-hidden
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.surface3,
        opacity,
      }}
    />
  )
}

export function BackButton({
  label,
  onPress,
}: {
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { minHeight: 44, gap: 2, alignSelf: "flex-start" },
        pressed && styles.pressed,
      ]}
    >
      <CaretLeft size={22} color={colors.brandPressed} weight="bold" />
      <Text
        style={{ color: colors.brandPressed, fontSize: 17, fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
