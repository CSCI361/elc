import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { getLocales } from "expo-localization"
import { selectDeviceLocale } from "./model"
import { StatusBar } from "expo-status-bar"
import {
  accountResponseSchema,
  scannerEventSchema,
  scannerEventsResponseSchema,
  type ScannerEvent,
} from "@elc/shared"
import { Attendees } from "./attendees"
import { copies, type Language } from "./copy"
import { ScanScreen } from "./scan-screen"
import { service, authClient, configuration } from "./service"
import { SignIn } from "./sign-in"
import { useClock } from "./use-clock"
import { Action, Notice } from "./ui"
import { colors, styles } from "./theme"
import { OfflineWorkspace } from "./offline/workspace"
import { offlineCopies } from "./offline/copy"
import { offlineVault } from "./offline/runtime"
import { useOfflineLifecycle } from "./offline/lifecycle"

type Tab = "events" | "scan" | "attendees" | "settings" | "offline"
function EventAdmin({
  sessionState,
}: {
  sessionState: ReturnType<typeof authClient.useSession>
}) {
  const { data: session, isPending, refetch } = sessionState
  const [language, setLanguage] = useState<Language>(() =>
    selectDeviceLocale(getLocales().map((locale) => locale.languageTag))
  )
  const explicitLanguage = useRef(false)
  const copy = copies[language]
  const clock = useClock()
  const [tab, setTab] = useState<Tab>("events")
  const [events, setEvents] = useState<ScannerEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<ScannerEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<
    "refreshError" | "requestError" | "signOutFailed" | null
  >(null)
  const accountId = session?.user.id
  const verified = session?.user.emailVerified === true
  const loadEvents = useCallback(async (after?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = scannerEventsResponseSchema.parse(
        await service.events(after)
      )
      setEvents((current) =>
        after ? [...current, ...result.items] : result.items
      )
      setCursor(result.nextCursor)
    } catch {
      setEvents([])
      setCursor(null)
      setMessage("refreshError")
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!accountId || !verified) return
    const controller = new AbortController()
    void service
      .events(undefined, controller.signal)
      .then((raw) => {
        const result = scannerEventsResponseSchema.parse(raw)
        if (controller.signal.aborted) return
        setEvents(result.items)
        setCursor(result.nextCursor)
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("refreshError")
      })
    void service
      .account(controller.signal)
      .then((raw) => {
        const account = accountResponseSchema.parse(raw)
        if (
          !controller.signal.aborted &&
          !explicitLanguage.current &&
          account.profile.hasSavedLocale
        )
          setLanguage(account.profile.locale)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [accountId, verified])
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void authClient.getSession({ query: { disableCookieCache: true } })
    })
    return () => listener.remove()
  }, [])
  const refreshEvent = async () => {
    if (!selected) return
    const eventId = selected.id
    try {
      const event = scannerEventSchema.parse(await service.event(eventId))
      if (event.id !== eventId) throw new Error("Event response does not match")
      setSelected((current) => (current?.id === eventId ? event : current))
      setEvents((current) =>
        current.map((item) => (item.id === eventId ? event : item))
      )
      setMessage(null)
    } catch {
      setMessage("refreshError")
      setSelected(null)
      setTab("events")
    }
  }
  const chooseLanguage = (next: Language) => {
    explicitLanguage.current = true
    setLanguage(next)
    if (accountId && verified)
      void service.saveLanguage(next).catch(() => setMessage("requestError"))
  }
  const signOut = async () => {
    setBusy(true)
    setSelected(null)
    setTab("settings")
    try {
      await offlineVault.signOut()
      const result = await authClient.signOut()
      if (result.error) throw new Error("Sign out failed")
      setEvents([])
      setMessage(null)
    } catch {
      setMessage("signOutFailed")
    } finally {
      setBusy(false)
    }
  }
  const locale =
    language === "kk" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-GB"
  return (
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>elc</Text>
        <View style={styles.row}>
          {(["kk", "ru", "en"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`${copy.language}: ${value.toUpperCase()}`}
              accessibilityState={{ selected: language === value }}
              onPress={() => chooseLanguage(value)}
              style={[
                styles.language,
                language === value && styles.activeLanguage,
              ]}
            >
              <Text
                style={[styles.tabText, language === value && styles.activeTab]}
              >
                {value.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Action
            label={
              tab === "offline"
                ? offlineCopies[language].close
                : offlineCopies[language].workspace
            }
            secondary
            onPress={() => setTab(tab === "offline" ? "events" : "offline")}
          />
          {tab === "offline" ? (
            <OfflineWorkspace
              onlineAccountId={verified ? (accountId ?? null) : null}
              language={language}
              copy={copy}
            />
          ) : isPending ? (
            <>
              <ActivityIndicator color={colors.green} />
              <Text style={styles.body}>{copy.sessionLoading}</Text>
            </>
          ) : !session ? (
            <SignIn copy={copy} />
          ) : !verified ? (
            <>
              <Notice>{copy.verifyEmail}</Notice>
              <Action
                label={copy.webAccount}
                onPress={() => {
                  void Linking.openURL(`${configuration.apiOrigin}/account`)
                }}
              />
              <Action
                label={copy.refresh}
                secondary
                onPress={() => {
                  void refetch()
                }}
              />
              <Action
                label={copy.signOut}
                secondary
                busy={busy}
                onPress={() => {
                  void signOut()
                }}
              />
            </>
          ) : (
            <>
              {message ? <Notice tone="error">{copy[message]}</Notice> : null}
              {tab === "events" ? (
                <>
                  <View style={styles.spread}>
                    <Text accessibilityRole="header" style={styles.title}>
                      {copy.chooseEvent}
                    </Text>
                  </View>
                  <Action
                    label={copy.refresh}
                    secondary
                    busy={busy}
                    onPress={() => {
                      void loadEvents()
                    }}
                  />
                  {!busy && !events.length ? (
                    <Notice>{copy.noEvents}</Notice>
                  ) : null}
                  {events.map((event) => (
                    <Pressable
                      key={event.id}
                      accessibilityRole="button"
                      accessibilityLabel={event.title}
                      onPress={() => {
                        setSelected(event)
                        setTab("scan")
                        setMessage(null)
                      }}
                      style={({ pressed }) => [
                        styles.card,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.heading}>{event.title}</Text>
                      <Text style={styles.muted}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: event.timeZone,
                        }).format(new Date(event.startsAt))}
                      </Text>
                      <Text style={styles.body}>{event.venueName}</Text>
                      <View style={styles.row}>
                        <View style={styles.counter}>
                          <Text style={styles.number}>
                            {event.counts.checkedIn}
                          </Text>
                          <Text style={styles.muted}>{copy.checkedIn}</Text>
                        </View>
                        <View style={styles.counter}>
                          <Text style={styles.number}>
                            {event.counts.registered}
                          </Text>
                          <Text style={styles.muted}>{copy.registered}</Text>
                        </View>
                      </View>
                      {event.cancelledAt ? (
                        <Text style={styles.muted}>{copy.eventCancelled}</Text>
                      ) : event.suspendedAt ? (
                        <Text style={styles.muted}>{copy.eventSuspended}</Text>
                      ) : Date.parse(event.endsAt) <= clock ? (
                        <Text style={styles.muted}>{copy.ended}</Text>
                      ) : null}
                    </Pressable>
                  ))}
                  {cursor ? (
                    <Action
                      label={copy.more}
                      secondary
                      busy={busy}
                      onPress={() => {
                        void loadEvents(cursor)
                      }}
                    />
                  ) : null}
                </>
              ) : null}
              {selected && (tab === "scan" || tab === "attendees") ? (
                <>
                  <Action
                    label={copy.back}
                    secondary
                    onPress={() => {
                      setTab("events")
                      setSelected(null)
                    }}
                  />
                  <View style={[styles.card, styles.row]}>
                    <View style={styles.counter}>
                      <Text style={styles.number}>
                        {selected.counts.checkedIn}
                      </Text>
                      <Text style={styles.muted}>{copy.checkedIn}</Text>
                    </View>
                    <View style={styles.counter}>
                      <Text style={styles.number}>
                        {selected.counts.registered}
                      </Text>
                      <Text style={styles.muted}>{copy.registered}</Text>
                    </View>
                    {selected.counts.unresolvedOffline > 0 ? (
                      <Text style={styles.muted}>
                        {copy.reported}: {selected.counts.unresolvedOffline}
                      </Text>
                    ) : null}
                  </View>
                  {tab === "scan" ? (
                    <ScanScreen
                      key={selected.id}
                      event={selected}
                      accountId={accountId!}
                      language={language}
                      copy={copy}
                      onResult={() => {
                        void refreshEvent()
                      }}
                    />
                  ) : (
                    <Attendees
                      key={selected.id}
                      event={selected}
                      copy={copy}
                      onChange={() => {
                        void refreshEvent()
                      }}
                    />
                  )}
                  <Action
                    label={copy.refresh}
                    secondary
                    onPress={() => {
                      void refreshEvent()
                    }}
                  />
                </>
              ) : null}
              {tab === "settings" ? (
                <>
                  <Text accessibilityRole="header" style={styles.title}>
                    {copy.settings}
                  </Text>
                  <View style={styles.card}>
                    <Text style={styles.eyebrow}>{copy.currentAccount}</Text>
                    <Text style={styles.heading}>{session.user.name}</Text>
                    <Text style={styles.body}>{session.user.email}</Text>
                    <Action
                      label={copy.signOut}
                      secondary
                      busy={busy}
                      onPress={() => {
                        void signOut()
                      }}
                    />
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.eyebrow}>{copy.server}</Text>
                    <Text style={styles.body}>
                      {configuration.environment === "local"
                        ? copy.local
                        : configuration.environment === "preview"
                          ? copy.preview
                          : copy.demo}
                    </Text>
                    <Text style={styles.muted}>{configuration.apiOrigin}</Text>
                  </View>
                  <Notice>{offlineCopies[language].retention}</Notice>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {session && verified ? (
        <View style={styles.tabs}>
          {(["events", "scan", "attendees", "settings"] as const).map(
            (item) => (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityLabel={copy[item]}
                accessibilityState={{
                  selected: tab === item,
                  disabled:
                    !selected && (item === "scan" || item === "attendees"),
                }}
                disabled={
                  !selected && (item === "scan" || item === "attendees")
                }
                onPress={() => setTab(item)}
                style={[
                  styles.tab,
                  !selected &&
                    (item === "scan" || item === "attendees") &&
                    styles.disabled,
                ]}
              >
                <Text
                  style={[styles.tabText, tab === item && styles.activeTab]}
                >
                  {copy[item]}
                </Text>
              </Pressable>
            )
          )}
        </View>
      ) : null}
    </SafeAreaView>
  )
}
export default function App() {
  const sessionState = authClient.useSession()
  useOfflineLifecycle()
  return (
    <SafeAreaProvider>
      <EventAdmin
        key={sessionState.data?.user.id ?? "signed-out"}
        sessionState={sessionState}
      />
    </SafeAreaProvider>
  )
}
