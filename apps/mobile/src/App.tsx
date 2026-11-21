import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, BackHandler, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { getLocales } from "expo-localization"
import { useNetworkState } from "expo-network"
import { UserCircle } from "./icons"
import {
  accountResponseSchema,
  scannerEventsResponseSchema,
  type ScannerEvent,
} from "@elc/shared"
import { copies, type Language } from "./copy"
import { selectDeviceLocale, sortForStaff } from "./model"
import { service, authClient } from "./service"
import { useClock } from "./use-clock"
import { SignIn, VerifyEmail } from "./sign-in"
import { EventsScreen } from "./events-screen"
import { EventScreen } from "./event-screen"
import { AccountScreen } from "./account-screen"
import { ConnectionPill } from "./connection-pill"
import { Logo } from "./logo"
import { IconButton } from "./ui"
import { styles } from "./theme"
import { offlineController, offlineVault } from "./offline/runtime"
import { useOfflineLifecycle } from "./offline/lifecycle"
import { useOfflineAccount } from "./offline/use-offline-account"

type Screen =
  | { name: "events" }
  | { name: "event"; event: ScannerEvent }
  | { name: "account" }

function useLanguage(accountId: string | null) {
  const [language, setLanguage] = useState<Language>(() =>
    selectDeviceLocale(getLocales().map((locale) => locale.languageTag))
  )
  const explicit = useRef(false)
  useEffect(() => {
    if (!accountId) return
    const controller = new AbortController()
    service
      .account(controller.signal)
      .then((raw) => {
        const account = accountResponseSchema.parse(raw)
        if (
          !controller.signal.aborted &&
          !explicit.current &&
          account.profile.hasSavedLocale
        )
          setLanguage(account.profile.locale)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [accountId])
  const choose = (next: Language) => {
    explicit.current = true
    setLanguage(next)
    if (accountId) void service.saveLanguage(next).catch(() => undefined)
  }
  return [language, choose] as const
}

function EventAdmin({
  sessionState,
}: {
  sessionState: ReturnType<typeof authClient.useSession>
}) {
  const { data: session, isPending, refetch } = sessionState
  const accountId = session?.user.id ?? null
  const verified = session?.user.emailVerified === true
  const [language, setLanguage] = useLanguage(verified ? accountId : null)
  const copy = copies[language]
  const now = useClock()
  const network = useNetworkState()
  const online =
    network.isConnected !== false && network.isInternetReachable !== false
  const offlineAccount = useOfflineAccount(verified ? accountId : null, online)
  const offlineMode = !online && offlineAccount.accountId !== null
  const [screen, setScreen] = useState<Screen>({ name: "events" })
  const [events, setEvents] = useState<ScannerEvent[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set())
  const [cookie, setCookie] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  const fetchEvents = useCallback(async (after?: string) => {
    try {
      const result = scannerEventsResponseSchema.parse(
        await service.events(after)
      )
      setEvents((current) =>
        after && current ? [...current, ...result.items] : result.items
      )
      setCursor(result.nextCursor)
      setLoadError(false)
    } catch {
      setLoadError(true)
      setEvents((current) => current ?? [])
    }
  }, [])
  useEffect(() => {
    if (!online || !accountId || !verified) return
    const controller = new AbortController()
    service
      .events(undefined, controller.signal)
      .then((raw) => {
        const result = scannerEventsResponseSchema.parse(raw)
        if (controller.signal.aborted) return
        setEvents(result.items)
        setCursor(result.nextCursor)
        setLoadError(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLoadError(true)
        setEvents((current) => current ?? [])
      })
    return () => controller.abort()
  }, [online, accountId, verified])
  useEffect(() => {
    const id = offlineAccount.accountId
    if (!id || screen.name !== "events") return
    let active = true
    offlineController
      .events(id)
      .then((saved) => {
        if (!active) return
        setSavedIds(new Set(saved.map((event) => event.id)))
        if (!online) {
          setEvents(saved)
          setCursor(null)
        }
      })
      .catch(() => {
        if (active && !online) setEvents([])
      })
    return () => {
      active = false
    }
  }, [offlineAccount.accountId, online, screen.name])
  useEffect(() => {
    if (!accountId) return
    void authClient.getCookie().then(setCookie)
  }, [accountId])
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void authClient.getSession({ query: { disableCookieCache: true } })
    })
    return () => listener.remove()
  }, [])
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen.name === "events") return false
      setScreen({ name: "events" })
      return true
    })
    return () => listener.remove()
  }, [screen.name])

  const updateEvent = useCallback((next: ScannerEvent) => {
    setEvents(
      (current) =>
        current?.map((event) => (event.id === next.id ? next : event)) ??
        current
    )
    setScreen((current) =>
      current.name === "event" && current.event.id === next.id
        ? { name: "event", event: next }
        : current
    )
  }, [])
  const showEvents = useCallback(() => setScreen({ name: "events" }), [])
  const signOut = async () => {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await offlineVault.signOut()
      const result = await authClient.signOut()
      if (result.error) throw new Error("Sign out failed")
    } catch {
      setSignOutFailed(true)
    } finally {
      setSigningOut(false)
    }
  }
  const selected = screen.name === "event" ? screen.event : null
  const listedEvents =
    !online && offlineAccount.ready && !offlineAccount.accountId
      ? (events ?? [])
      : events
  const header = (
    <View style={[styles.spread, { paddingTop: 8 }]}>
      <Logo />
      <View style={styles.row}>
        <ConnectionPill online={online} copy={copy} />
        {session ? (
          <IconButton
            testID="account-button"
            icon={UserCircle}
            label={copy.account}
            onPress={() => setScreen({ name: "account" })}
          />
        ) : null}
      </View>
    </View>
  )

  const content = (() => {
    if (!offlineMode && !isPending && !session)
      return <SignIn copy={copy} language={language} onLanguage={setLanguage} />
    if (session && !verified)
      return (
        <VerifyEmail
          copy={copy}
          email={session.user.email}
          signingOut={signingOut}
          onDone={() => void refetch()}
          onSignOut={() => void signOut()}
        />
      )
    if (screen.name === "account" && session)
      return (
        <AccountScreen
          user={session.user}
          copy={copy}
          language={language}
          signingOut={signingOut}
          signOutFailed={signOutFailed}
          onLanguage={setLanguage}
          onSignOut={() => void signOut()}
          onBack={showEvents}
        />
      )
    const scannerId = accountId ?? offlineAccount.accountId
    if (selected && scannerId)
      return (
        <EventScreen
          event={selected}
          accountId={scannerId}
          offlineAccount={offlineAccount}
          online={online}
          now={now}
          cookie={cookie}
          copy={copy}
          language={language}
          onBack={showEvents}
          onEvent={updateEvent}
        />
      )
    return (
      <EventsScreen
        header={header}
        events={
          isPending || !listedEvents ? null : sortForStaff(listedEvents, now)
        }
        error={loadError}
        cursor={cursor}
        loadingMore={loadingMore}
        refreshing={refreshing}
        offlineMode={!online}
        savedIds={savedIds}
        now={now}
        cookie={cookie}
        copy={copy}
        language={language}
        onRefresh={() => {
          setRefreshing(true)
          void fetchEvents().finally(() => setRefreshing(false))
        }}
        onMore={() => {
          if (!cursor) return
          setLoadingMore(true)
          void fetchEvents(cursor).finally(() => setLoadingMore(false))
        }}
        onOpen={(event) => setScreen({ name: "event", event })}
      />
    )
  })()

  return (
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      {content}
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
