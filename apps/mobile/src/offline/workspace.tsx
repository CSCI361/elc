import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useNetworkState } from "expo-network"
import { scannerEventsResponseSchema, type ScannerEvent } from "@elc/shared"
import type { Copy, Language } from "../copy"
import { service } from "../service"
import { ScanScreen } from "../scan-screen"
import { Action, Notice } from "../ui"
import { styles } from "../theme"
import { offlineController, offlineVault } from "./runtime"
import { offlineCopies } from "./copy"
import {
  cachedAttendeeDisplay,
  currentCachedAttendees,
  type CachedAttendeePage,
} from "./attendee-display"
import { OfflineFailure, offlinePolicy, type OfflineStatus } from "./model"

export function OfflineWorkspace({
  onlineAccountId,
  language,
  copy,
}: {
  onlineAccountId: string | null
  language: Language
  copy: Copy
}) {
  const text = offlineCopies[language]
  const network = useNetworkState()
  const online =
    network.isConnected !== false && network.isInternetReachable !== false
  const [accountId, setAccountId] = useState<string | null>(null)
  const [events, setEvents] = useState<ScannerEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<ScannerEvent | null>(null)
  const [storedStatus, setStatus] = useState<OfflineStatus | null>(null)
  const status = storedStatus?.eventId === selected?.id ? storedStatus : null
  const [message, setMessage] = useState<keyof typeof text | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [attendeePage, setAttendees] = useState<CachedAttendeePage | null>(null)
  const attendees = currentCachedAttendees(attendeePage, {
    accountId: accountId ?? "",
    eventId: selected?.id ?? "",
    snapshotId: status?.snapshot?.snapshotId ?? "",
    query,
  })
  const cycleBusy = useRef(false)
  const refreshStatus = useCallback(async () => {
    if (!accountId || !selected) return
    try {
      setStatus(await offlineController.status(accountId, selected.id))
    } catch {
      setStatus(null)
      setMessage("locked")
    }
  }, [accountId, selected])
  const reconnectSelected = useEffectEvent(async (id: string) => {
    if (!selected) return
    const next = await offlineController.refresh(id, selected.id, text.label)
    setStatus(next)
    if (next.event)
      setSelected((current) =>
        current?.id === next.event!.id ? next.event : current
      )
  })
  useEffect(() => {
    let active = true
    const initialize = async () => {
      try {
        const id =
          onlineAccountId && online
            ? await offlineVault.connect(onlineAccountId)
            : await offlineVault.restore()
        if (!active) return
        if (!id || (onlineAccountId && id !== onlineAccountId)) {
          setMessage("locked")
          return
        }
        setAccountId(id)
        if (online) {
          if (!onlineAccountId) await offlineVault.connect(id)
          const result = scannerEventsResponseSchema.parse(
            await service.events()
          )
          if (active) {
            setEvents(result.items)
            setCursor(result.nextCursor)
          }
          await offlineController.sync(id)
          if (active) await reconnectSelected(id)
        } else {
          const cached = await offlineController.events(id)
          if (active) {
            setEvents(cached)
            setCursor(null)
          }
        }
      } catch (error) {
        if (active)
          setMessage(
            error instanceof OfflineFailure &&
              error.code === "encryption_unavailable"
              ? "unavailableStorage"
              : "syncFailed"
          )
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [onlineAccountId, online])
  const cycle = useCallback(
    async (prepare: boolean, manual: boolean) => {
      if (!accountId || !online || cycleBusy.current) return
      cycleBusy.current = true
      if (manual) {
        setBusy(true)
        setMessage(null)
      }
      try {
        await offlineController.sync(accountId)
        if (selected && prepare) {
          const next = await offlineController.refresh(
            accountId,
            selected.id,
            text.label
          )
          setStatus(next)
          if (next.event)
            setSelected((current) =>
              current?.id === next.event!.id ? next.event : current
            )
        } else if (selected)
          setStatus(await offlineController.status(accountId, selected.id))
        if (manual) setMessage(prepare ? "ready" : "syncDone")
      } catch (error) {
        setMessage(
          error instanceof OfflineFailure &&
            error.code === "encryption_unavailable"
            ? "unavailableStorage"
            : "syncFailed"
        )
        if (selected) {
          try {
            setStatus(await offlineController.status(accountId, selected.id))
          } catch {
            setStatus(null)
          }
        }
      } finally {
        cycleBusy.current = false
        if (manual) setBusy(false)
      }
    },
    [accountId, online, selected, text.label]
  )
  useEffect(() => {
    if (!accountId || !selected) return
    let active = true
    void offlineController
      .status(accountId, selected.id)
      .then((result) => {
        if (active) setStatus(result)
      })
      .catch(() => {
        if (active) {
          setStatus(null)
          setMessage("locked")
        }
      })
    const timer = setInterval(() => {
      void refreshStatus()
    }, offlinePolicy.cleanupInterval)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [accountId, selected, refreshStatus])
  const refreshTick = useEffectEvent(() => {
    void cycle(true, false)
  })
  useEffect(() => {
    if (!accountId || !selected?.id || !online) return
    // The immediate reconnect upload is performed by initialize; this subscription refreshes each minute.
    const timer = setInterval(
      () => refreshTick(),
      offlinePolicy.refreshInterval
    )
    return () => clearInterval(timer)
  }, [accountId, selected?.id, online])
  useEffect(() => {
    let active = true
    if (!accountId || !selected || !status?.snapshot) return
    void offlineController
      .attendees(accountId, selected.id, query)
      .then((items) => {
        if (active)
          setAttendees({
            accountId,
            eventId: selected.id,
            snapshotId: status.snapshot!.snapshotId,
            query,
            items,
          })
      })
      .catch(() => {
        if (active) setAttendees(null)
      })
    return () => {
      active = false
    }
  }, [accountId, selected, status?.snapshot, query])
  const loadMore = async (after?: string) => {
    if (!online) return
    setBusy(true)
    try {
      const result = scannerEventsResponseSchema.parse(
        await service.events(after)
      )
      setEvents((items) => (after ? [...items, ...result.items] : result.items))
      setCursor(result.nextCursor)
    } catch {
      setMessage("syncFailed")
    } finally {
      setBusy(false)
    }
  }
  const timestamp = (value: string | number) =>
    new Date(value).toLocaleString(
      language === "kk" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-GB"
    )
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {text.workspace}
      </Text>
      {message ? <Notice>{text[message]}</Notice> : null}
      {accountId ? (
        <Text style={styles.muted}>
          {text.account}: {accountId}
        </Text>
      ) : null}
      {!selected ? (
        <>
          <Action
            label={text.refresh}
            secondary
            busy={busy}
            disabled={!online || !accountId}
            onPress={() => {
              void loadMore()
            }}
          />
          {!events.length ? <Notice>{text.noEvents}</Notice> : null}
          {events.map((event) => (
            <Action
              key={event.id}
              label={event.title}
              secondary
              onPress={() => {
                setSelected(event)
                setStatus(null)
                setMessage(null)
              }}
            />
          ))}
          {cursor ? (
            <Action
              label={text.more}
              secondary
              busy={busy}
              disabled={!online}
              onPress={() => {
                void loadMore(cursor)
              }}
            />
          ) : null}
        </>
      ) : accountId ? (
        <>
          <Action
            label={text.back}
            secondary
            onPress={() => {
              setSelected(null)
              setStatus(null)
              setAttendees(null)
            }}
          />
          <View style={styles.card}>
            <Text style={styles.heading}>{text.snapshot}</Text>
            <Text style={styles.body}>
              {status?.snapshot
                ? `${timestamp(status.snapshot.issuedAt)}\n${text.expires}: ${timestamp(status.snapshot.expiresAt)}`
                : text.unavailable}
            </Text>
            <Text style={styles.body}>
              {text.pending}: {status?.pendingCount ?? 0}
            </Text>
            <Text style={styles.body}>
              {text.provisional}: {status?.provisionalCount ?? 0}
            </Text>
            <Text style={styles.body}>
              {text.conflicts}: {status?.conflictCount ?? 0}
            </Text>
            {status?.lastSyncAt ? (
              <Text style={styles.muted}>
                {text.lastSync}: {timestamp(status.lastSyncAt)}
              </Text>
            ) : null}
            {status?.uncertainOnlineCount ? (
              <Notice>
                {text.uncertainOnline} ({status.uncertainOnlineCount})
              </Notice>
            ) : null}
            {status?.warning ? (
              <Notice tone="error">{text.warning}</Notice>
            ) : null}
            {status?.deletionDeadline ? (
              <Text style={styles.body}>
                {text.deadline}: {timestamp(status.deletionDeadline)}
              </Text>
            ) : null}
            {status?.clockUnsafe ? (
              <Notice tone="error">{text.clockUnsafe}</Notice>
            ) : null}
            <Action
              label={text.prepare}
              busy={busy}
              disabled={!online}
              onPress={() => {
                void cycle(true, true)
              }}
            />
            <Action
              label={text.sync}
              secondary
              busy={busy}
              disabled={!online}
              onPress={() => {
                void cycle(false, true)
              }}
            />
          </View>
          <ScanScreen
            key={selected.id}
            event={selected}
            accountId={accountId}
            language={language}
            copy={copy}
            offline={{ accountId, copy: text, status }}
            onResult={() => {
              void refreshStatus()
            }}
          />
          {status?.snapshot ? (
            <View style={styles.card}>
              <Text style={styles.heading}>{text.search}</Text>
              <Text style={styles.muted}>{text.offlineAttendees}</Text>
              <TextInput
                accessibilityLabel={text.search}
                value={query}
                onChangeText={setQuery}
                maxLength={100}
                style={styles.input}
              />
              {attendees.map((ticket) => {
                const display = cachedAttendeeDisplay(ticket)
                return (
                  <View key={ticket.ticketId} style={styles.card}>
                    <Text style={styles.heading}>{ticket.attendeeName}</Text>
                    <Text style={styles.body}>
                      {text.snapshotState}: {copy[display.state]}
                    </Text>
                    <Text style={styles.muted}>
                      {display.seat
                        ? `${text.seat}: ${display.seat.section} · ${display.seat.row} · ${display.seat.number}${display.seat.accessible ? ` · ${text.accessibleSeat}` : ""}`
                        : text.generalAdmission}
                    </Text>
                  </View>
                )
              })}
              {!attendees.length ? (
                <Text style={styles.muted}>{text.noMatches}</Text>
              ) : null}
            </View>
          ) : null}
          {status?.recentResults.length ? (
            <View style={styles.card}>
              <Text style={styles.heading}>{text.results}</Text>
              {status.recentResults.map((result) => (
                <Text key={result.operationId} style={styles.body}>
                  {result.result} · {result.reviewState} ·{" "}
                  {timestamp(result.serverTimestamp)}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <Notice>{text.retention}</Notice>
      <Text style={styles.muted}>{text.privacy}</Text>
    </>
  )
}
