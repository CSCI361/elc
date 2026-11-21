import { MinusIcon, PlusIcon } from "@phosphor-icons/react"
import { useId } from "react"

export function QuantityStepper({
  label,
  value,
  max,
  disabled = false,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  label: string
  value: number
  max: number
  disabled?: boolean
  decreaseLabel: string
  increaseLabel: string
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="stepper" role="group" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        aria-label={`${decreaseLabel}, ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon size={14} weight="bold" aria-hidden />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`${increaseLabel}, ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon size={14} weight="bold" aria-hidden />
      </button>
    </div>
  )
}
