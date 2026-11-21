import { useEffect, useState } from "react"
import { Linking, Pressable, Text, View } from "react-native"
import { authCapabilitiesSchema } from "@elc/shared"
import { service, authClient, configuration } from "./service"
import type { Copy } from "./copy"
import { Action, Field, Notice } from "./ui"
import { styles } from "./theme"

export function SignIn({ copy }: { copy: Copy }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<
    "signInError" | "verifyEmail" | "refreshError" | "requestError" | null
  >(null)
  const [capabilities, setCapabilities] = useState<ReturnType<
    typeof authCapabilitiesSchema.parse
  > | null>(null)
  const loadCapabilities = () =>
    service
      .capabilities()
      .then((raw) => {
        setCapabilities(authCapabilitiesSchema.parse(raw))
        setMessage(null)
      })
      .catch(() => setMessage("refreshError"))
  useEffect(() => {
    const controller = new AbortController()
    void service
      .capabilities(controller.signal)
      .then((raw) => {
        if (!controller.signal.aborted)
          setCapabilities(authCapabilitiesSchema.parse(raw))
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("refreshError")
      })
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
            ? "verifyEmail"
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
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text style={styles.body}>{copy.intro}</Text>
      <View style={styles.card}>
        <Field
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
        <Action
          label={copy.signIn}
          busy={pending}
          disabled={
            !email.trim() || !password || !capabilities?.emailAndPassword
          }
          onPress={() => {
            void signIn(false)
          }}
        />
        <View style={styles.divider} />
        <Action
          label={copy.google}
          secondary
          disabled={pending || !capabilities?.google}
          onPress={() => {
            void signIn(true)
          }}
        />
        {capabilities && !capabilities.google ? (
          <Text style={styles.muted}>{copy.googleUnavailable}</Text>
        ) : null}
      </View>
      {message ? <Notice tone="error">{copy[message]}</Notice> : null}
      {!capabilities ? (
        <Action
          label={copy.refresh}
          secondary
          onPress={() => {
            void loadCapabilities()
          }}
        />
      ) : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={copy.webAccount}
        style={styles.smallLink}
        onPress={() => {
          void Linking.openURL(`${configuration.apiOrigin}/auth/sign-in`).catch(
            () => setMessage("requestError")
          )
        }}
      >
        <Text style={styles.linkText}>{copy.webAccount}</Text>
      </Pressable>
    </>
  )
}
