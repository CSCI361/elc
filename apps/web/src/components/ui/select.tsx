import { Select as BaseSelect } from "@base-ui/react/select"
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface SelectProps {
  options: readonly SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  placeholder?: ReactNode
  labelledBy?: string
  describedBy?: string
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  disabled,
  required,
  placeholder,
  labelledBy,
  describedBy,
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={options.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next ?? "")}
      name={name}
      id={id}
      disabled={disabled}
      required={required}
    >
      <BaseSelect.Trigger
        className="select-trigger"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        <BaseSelect.Value className="select-value" placeholder={placeholder} />
        <BaseSelect.Icon className="select-icon">
          <CaretUpDownIcon size={16} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="select-positioner"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="select-popup">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="select-item"
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="select-item-check">
                  <CheckIcon size={16} weight="bold" aria-hidden />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
