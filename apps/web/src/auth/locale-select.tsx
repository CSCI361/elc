import { localeNames, localeSchema } from "@elc/shared"
import { useId } from "react"
import { Select } from "@/components/ui/select"
import { useAccount } from "./context"

export function LocaleSelect() {
  const id = useId()
  const { locale, messages: t, changeLocale, preferencePending } = useAccount()
  return (
    <div className="account-locale">
      <label id={`${id}-label`}>{t.languagePreference}</label>
      <Select
        options={Object.entries(localeNames).map(([value, label]) => ({
          value,
          label,
        }))}
        value={locale}
        disabled={preferencePending}
        onValueChange={(value) => void changeLocale(localeSchema.parse(value))}
        labelledBy={`${id}-label`}
        describedBy={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="field-hint">
        {t.languagePreferenceHint}
      </p>
    </div>
  )
}
