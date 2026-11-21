import Svg, { Circle, G, Path } from "react-native-svg"
import { colors } from "./theme"

export function Logo({ height = 26 }: { height?: number }) {
  return (
    <Svg
      width={(height * 47) / 24}
      height={height}
      viewBox="0 0 47 24"
      fill="none"
      accessibilityLabel="elc"
    >
      <G
        stroke={colors.ink}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M1.6 15H14.4A6.4 6.4 0 1 0 12.53 19.53" />
        <Path d="M20.5 2.6V21.4" />
        <Path d="M37.03 10.47A6.4 6.4 0 1 0 37.03 19.53" />
      </G>
      <Circle cx={43.4} cy={19.6} r={2.4} fill={colors.brand} />
    </Svg>
  )
}
