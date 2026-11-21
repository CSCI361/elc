import { ScrollView, Text, View } from "react-native"
import { SignOut, UserCircle } from "./icons"
import { languageNames, type Copy, type Language } from "./copy"
import { BackButton, Button, Notice, Segmented } from "./ui"
import { colors, styles } from "./theme"

const languages = (["kk", "ru", "en"] as const).map((value) => ({
  value,
  label: languageNames[value],
}))

export function LanguagePicker({
  language,
  onChange,
}: {
  language: Language
  onChange: (language: Language) => void
}) {
  return <Segmented options={languages} value={language} onChange={onChange} />
}

export function AccountScreen({
  user,
  copy,
  language,
  signingOut,
  signOutFailed,
  onLanguage,
  onSignOut,
  onBack,
}: {
  user: { name: string; email: string }
  copy: Copy
  language: Language
  signingOut: boolean
  signOutFailed: boolean
  onLanguage: (language: Language) => void
  onSignOut: () => void
  onBack: () => void
}) {
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8 }]}>
      <BackButton label={copy.back} onPress={onBack} />
      <Text accessibilityRole="header" style={styles.title}>
        {copy.account}
      </Text>
      <View style={[styles.card, styles.row, { gap: 12 }]}>
        <UserCircle size={44} color={colors.ink3} weight="light" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.heading} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={styles.secondary} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{copy.language}</Text>
        <LanguagePicker language={language} onChange={onLanguage} />
      </View>
      {signOutFailed ? (
        <Notice tone="danger">{copy.signOutFailed}</Notice>
      ) : null}
      <Button
        testID="sign-out"
        label={copy.signOut}
        variant="danger"
        icon={SignOut}
        busy={signingOut}
        onPress={onSignOut}
      />
      <Text style={styles.small}>{copy.signOutNote}</Text>
    </ScrollView>
  )
}
