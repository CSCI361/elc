import { Input } from "@base-ui/react/input"
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { useState, type ComponentProps } from "react"
import { useAccount } from "./context"

type FieldProps = ComponentProps<typeof Input> & {
  label: string
  hint?: string
}

export function AuthField({ label, hint, id, ...props }: FieldProps) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        className="auth-input"
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function PasswordField({
  label,
  hint,
  id,
  ...props
}: Omit<FieldProps, "type">) {
  const [visible, setVisible] = useState(false)
  const { messages } = useAccount()
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <Input
          id={id}
          className="auth-input"
          type={visible ? "text" : "password"}
          minLength={8}
          maxLength={128}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? messages.hidePassword : messages.showPassword}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeSlashIcon size={20} aria-hidden />
          ) : (
            <EyeIcon size={20} aria-hidden />
          )}
        </button>
      </div>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
