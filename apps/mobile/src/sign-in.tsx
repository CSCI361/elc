import { useEffect, useState } from "react"
import { Linking, ScrollView, Text, View } from "react-native"
import { ArrowsClockwise, EnvelopeSimple, GoogleLogo, SignOut } from "./icons"
import { authCapabilitiesSchema } from "@elc/shared"
import { service, authClient, configuration } from "./service"
import type { Copy, Language } from "./copy"
import { Logo } from "./logo"
import { LanguagePicker } from "./account-screen"
import { Button, Field, Notice } from "./ui"
import { colors, styles } from "./theme"

type Capabilities = ReturnType<typeof authCapabilitiesSchema.parse>
const openWebsite = (path: string) =>
  Linking.openURL(`${configuration.apiOrigin}${path}`)

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 20, paddingTop: 24 }}>
      <Logo height={30} />
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.secondary}>{body}</Text>
      </View>
    </View>
  )
}

export function SignIn({
  copy,
  language,
  onLanguage,
}: {
  copy: Copy
  language: Language
  onLanguage: (language: Language) => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<
    "signInError" | "verifyBody" | "requestError" | null
  >(null)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const loadCapabilities = (signal?: AbortSignal) =>
    service
      .capabilities(signal)
      .then((raw) => {
        if (signal?.aborted) return
        setCapabilities(authCapabilitiesSchema.parse(raw))
        setMessage(null)
      })
      .catch(() => {
        if (!signal?.aborted) setMessage("requestError")
      })
  useEffect(() => {
    const controller = new AbortController()
    void loadCapabilities(controller.signal)
    return () => controller.abort()
  }, [])
  const signIn = async (google: boolean) => {
    if (pending) return
    setPending(true)
    setMessage(null)
    try {
      const result = google
        ? await authClient.signIn.social({
            provider: "google",
            callbackURL: "elc://account",
          })
        : await authClient.signIn.email({ email: email.trim(), password })
      if (result.error) {
        setMessage(
          result.error.code === "EMAIL_NOT_VERIFIED"
            ? "verifyBody"
            : "signInError"
        )
        return
      }
      setPassword("")
      await authClient.getSession({ query: { disableCookieCache: true } })
    } catch {
      setMessage("signInError")
    } finally {
      setPending(false)
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { gap: 24 }]}
    >
      <Intro title={copy.signInTitle} body={copy.signInIntro} />
      <View style={{ gap: 14 }}>
        <Field
          testID="email-input"
          label={copy.email}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="email"
          autoComplete="email"
          textContentType="emailAddress"
          editable={!pending}
        />
        <Field
          testID="password-input"
          label={copy.password}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          editable={!pending}
          onSubmitEditing={() => {
            void signIn(false)
          }}
        />
        {message ? (
          <Notice
            tone="danger"
            action={
              message === "requestError" ? (
                <Button
                  label={copy.retry}
                  variant="secondary"
                  icon={ArrowsClockwise}
                  onPress={() => {
                    void loadCapabilities()
                  }}
                />
              ) : undefined
            }
          >
            {copy[message]}
          </Notice>
        ) : null}
        <Button
          testID="sign-in"
          label={copy.signIn}
          busy={pending}
          disabled={
            !email.trim() || !password || !capabilities?.emailAndPassword
          }
          onPress={() => {
            void signIn(false)
          }}
        />
        {capabilities?.google ? (
          <>
            <View style={[styles.row, { gap: 12 }]}>
              <View style={[styles.divider, { flex: 1 }]} />
              <Text style={styles.small}>{copy.or}</Text>
              <View style={[styles.divider, { flex: 1 }]} />
            </View>
            <Button
              label={copy.google}
              variant="secondary"
              icon={GoogleLogo}
              disabled={pending}
              onPress={() => {
                void signIn(true)
              }}
            />
          </>
        ) : null}
      </View>
      <View style={{ gap: 4, alignItems: "center" }}>
        <Text style={[styles.small, { textAlign: "center" }]}>
          {copy.webAccount}
        </Text>
        <Button
          label={copy.openWebsite}
          variant="ghost"
          onPress={() => {
            void openWebsite("/auth/sign-in").catch(() =>
              setMessage("requestError")
            )
          }}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{copy.language}</Text>
        <LanguagePicker language={language} onChange={onLanguage} />
      </View>
    </ScrollView>
  )
}

export function VerifyEmail({
  copy,
  email,
  signingOut,
  onDone,
  onSignOut,
}: {
  copy: Copy
  email: string
  signingOut: boolean
  onDone: () => void
  onSignOut: () => void
}) {
  return (
    <ScrollView contentContainerStyle={[styles.content, { gap: 24 }]}>
      <Intro title={copy.verifyTitle} body={copy.verifyBody} />
      <View style={[styles.card, styles.row, { gap: 12 }]}>
        <EnvelopeSimple size={24} color={colors.ink2} />
        <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
          {email}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <Button label={copy.verifyDone} onPress={onDone} />
        <Button
          label={copy.openWebsite}
          variant="secondary"
          onPress={() => {
            void openWebsite("/account")
          }}
        />
        <Button
          label={copy.signOut}
          variant="ghost"
          icon={SignOut}
          busy={signingOut}
          onPress={onSignOut}
        />
      </View>
    </ScrollView>
  )
}
