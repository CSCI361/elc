import { localeNames, localeSchema } from "@elc/shared"
import { GlobeIcon } from "@phosphor-icons/react"
import { useId } from "react"
import { useAccount } from "./context"

export function LocaleSelect({
  accountPreference = false,
}: {
  accountPreference?: boolean
}) {
  const id = useId()
  const { locale, messages: t, changeLocale, preferencePending } = useAccount()
  return (
    <div className={accountPreference ? "account-locale" : "header-locale"}>
      <label htmlFor={id} className={accountPreference ? "" : "sr-only"}>
        {accountPreference ? t.languagePreference : t.language}
      </label>
      <div className="locale-control">
        <GlobeIcon size={18} aria-hidden />
        <select
          id={id}
          value={locale}
          disabled={preferencePending}
          onChange={(event) => {
            const next = localeSchema.parse(event.target.value)
            void changeLocale(next)
          }}
          aria-describedby={accountPreference ? `${id}-hint` : undefined}
        >
          {Object.entries(localeNames).map(([key, label]) => (
            <option key={key} value={key} lang={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {accountPreference ? (
        <p id={`${id}-hint`} className="field-hint">
          {t.languagePreferenceHint}
        </p>
      ) : null}
    </div>
  )
}
