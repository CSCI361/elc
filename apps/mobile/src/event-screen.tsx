import { useCallback, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native"
import { CalendarBlank, MapPin, Warning } from "./icons"
import { scannerEventSchema, type ScannerEvent } from "@elc/shared"
import { eventWhen, fill, type Copy, type Language } from "./copy"
import { service, ServiceError } from "./service"
import { ScanScreen } from "./scan-screen"
import { Attendees } from "./attendees"
import { EventCover } from "./event-cover"
import { CheckInSummary, PhaseBadge } from "./events-screen"
import { ConnectionPill } from "./connection-pill"
import { BackButton, Notice, Segmented } from "./ui"
import { colors, styles } from "./theme"
import { useOfflineEvent } from "./offline/use-offline-event"
import { OfflineCard } from "./offline/offline-card"
import type { OfflineAccount } from "./offline/use-offline-account"

type Tab = "scan" | "guests"

export function EventScreen({
  event,
  accountId,
  offlineAccount,
  online,
  now,
  cookie,
  copy,
  language,
  onBack,
  onEvent,
}: {
  event: ScannerEvent
  accountId: string
  offlineAccount: OfflineAccount
  online: boolean
  now: number
  cookie: string | null
  copy: Copy
  language: Language
  onBack: () => void
  onEvent: (event: ScannerEvent) => void
}) {
  const [tab, setTab] = useState<Tab>("scan")
  const [refreshing, setRefreshing] = useState(false)
  const offline = useOfflineEvent({
    accountId: offlineAccount.accountId,
    event,
    online,
    deviceLabel: copy.deviceLabel,
    onEvent,
  })
  const offlineScan = offlineAccount.accountId
    ? { accountId: offlineAccount.accountId, status: offline.status }
    : null
  const { refreshStatus } = offline
  const refreshEvent = useCallback(async () => {
    if (!online) return
    try {
      const fresh = scannerEventSchema.parse(await service.event(event.id))
      if (fresh.id === event.id) onEvent(fresh)
    } catch (error) {
      if (
        error instanceof ServiceError &&
        [403, 404].includes(error.status ?? 0)
      )
        onBack()
    }
  }, [online, event.id, onEvent, onBack])
  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([refreshEvent(), refreshStatus()])
    setRefreshing(false)
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: 0 }]}
        refreshControl={
          online ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.ink3}
            />
          ) : undefined
        }
      >
        <View style={[styles.spread, { paddingTop: 8 }]}>
          <BackButton label={copy.back} onPress={onBack} />
          <ConnectionPill online={online} copy={copy} />
        </View>
        <EventCover event={event} cookie={cookie} height={110} radius={16} />
        <View style={{ gap: 6 }}>
          <PhaseBadge event={event} now={now} copy={copy} />
          <Text
            accessibilityRole="header"
            style={[styles.title, { fontSize: 24, lineHeight: 30 }]}
            numberOfLines={2}
          >
            {event.title}
          </Text>
          <View style={styles.row}>
            <CalendarBlank size={16} color={colors.ink3} />
            <Text style={styles.secondary}>{eventWhen(event, language)}</Text>
          </View>
          <View style={styles.row}>
            <MapPin size={16} color={colors.ink3} />
            <Text style={[styles.secondary, { flex: 1 }]}>
              {event.venueName}
            </Text>
          </View>
          <View style={{ marginTop: 6 }}>
            <CheckInSummary event={event} copy={copy} />
          </View>
        </View>
        {event.counts.unresolvedOffline > 0 ? (
          <Notice tone="warning" icon={Warning}>
            {fill(copy.needsReview, { count: event.counts.unresolvedOffline })}
          </Notice>
        ) : null}
        <Segmented
          options={[
            { value: "scan", label: copy.scanTab },
            { value: "guests", label: copy.guestsTab },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "scan" ? (
          <>
            <ScanScreen
              key={event.id}
              event={event}
              accountId={accountId}
              copy={copy}
              offline={offlineScan ?? undefined}
              onResult={() => {
                void refreshEvent()
                void refreshStatus()
              }}
            />
            <OfflineCard
              offline={offline}
              copy={copy}
              language={language}
              online={online}
              unavailable={offlineAccount.unavailable}
            />
          </>
        ) : (
          <Attendees
            key={event.id}
            event={event}
            copy={copy}
            language={language}
            online={online}
            offline={offlineScan}
            onChange={() => {
              void refreshEvent()
            }}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
