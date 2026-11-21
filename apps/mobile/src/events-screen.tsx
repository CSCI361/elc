import type { ReactNode } from "react"
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native"
import { CalendarBlank, CloudCheck, MapPin, WifiSlash } from "./icons"
import type { ScannerEvent } from "@elc/shared"
import { eventWhen, fill, type Copy, type Language } from "./copy"
import { checkInShare, eventPhase, type EventPhase } from "./model"
import { EventCover } from "./event-cover"
import { Badge, Button, Notice, ProgressBar, Skeleton } from "./ui"
import { colors, styles, type Tone } from "./theme"

const phaseBadges: Record<
  EventPhase,
  { label: keyof Copy; tone: Tone } | null
> = {
  live: { label: "live", tone: "success" },
  today: { label: "today", tone: "brand" },
  ended: { label: "ended", tone: "neutral" },
  cancelled: { label: "cancelled", tone: "danger" },
  suspended: { label: "suspended", tone: "warning" },
  upcoming: null,
}

const phaseLabel = (event: ScannerEvent, now: number, copy: Copy) => {
  const badge = phaseBadges[eventPhase(event, now)]
  return badge ? copy[badge.label] : null
}

export function PhaseBadge({
  event,
  now,
  copy,
}: {
  event: ScannerEvent
  now: number
  copy: Copy
}) {
  const badge = phaseBadges[eventPhase(event, now)]
  return badge ? <Badge label={copy[badge.label]} tone={badge.tone} /> : null
}

const checkedInText = (event: ScannerEvent, copy: Copy) =>
  fill(copy.checkedInOf, {
    checked: event.counts.checkedIn,
    total: event.counts.registered,
  })

export function CheckInSummary({
  event,
  copy,
}: {
  event: ScannerEvent
  copy: Copy
}) {
  return (
    <View style={{ gap: 6 }}>
      <ProgressBar value={checkInShare(event.counts)} />
      <Text style={styles.small}>{checkedInText(event, copy)}</Text>
    </View>
  )
}

export function EventsScreen({
  header,
  events,
  error,
  cursor,
  loadingMore,
  refreshing,
  offlineMode,
  savedIds,
  now,
  cookie,
  copy,
  language,
  onRefresh,
  onMore,
  onOpen,
}: {
  header: ReactNode
  events: ScannerEvent[] | null
  error: boolean
  cursor: string | null
  loadingMore: boolean
  refreshing: boolean
  offlineMode: boolean
  savedIds: ReadonlySet<string>
  now: number
  cookie: string | null
  copy: Copy
  language: Language
  onRefresh: () => void
  onMore: () => void
  onOpen: (event: ScannerEvent) => void
}) {
  return (
    <FlatList
      data={events ?? []}
      keyExtractor={(event) => event.id}
      contentContainerStyle={[styles.content, { paddingTop: 0 }]}
      refreshControl={
        offlineMode ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ink3}
          />
        )
      }
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          {header}
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={styles.title}>
              {copy.eventsTitle}
            </Text>
            <Text style={styles.secondary}>{copy.eventsIntro}</Text>
          </View>
          {offlineMode && events?.length ? (
            <Notice icon={WifiSlash}>{copy.offlineEvents}</Notice>
          ) : null}
          {error ? <Notice tone="danger">{copy.loadError}</Notice> : null}
        </View>
      }
      ListEmptyComponent={
        events === null ? (
          <EventSkeleton />
        ) : error ? null : (
          <View
            style={[styles.card, { alignItems: "center", paddingVertical: 32 }]}
          >
            {offlineMode ? (
              <WifiSlash size={36} color={colors.ink3} />
            ) : (
              <CalendarBlank size={36} color={colors.ink3} />
            )}
            <Text style={[styles.secondary, { textAlign: "center" }]}>
              {offlineMode ? copy.noSavedEvents : copy.noEvents}
            </Text>
          </View>
        )
      }
      ListFooterComponent={
        cursor ? (
          <Button
            label={copy.more}
            variant="secondary"
            busy={loadingMore}
            onPress={onMore}
          />
        ) : null
      }
      ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[
            item.title,
            phaseLabel(item, now, copy),
            savedIds.has(item.id) ? copy.savedOffline : null,
            eventWhen(item, language),
            item.venueName,
            checkedInText(item, copy),
          ]
            .filter(Boolean)
            .join(", ")}
          onPress={() => onOpen(item)}
          style={({ pressed }) => [
            styles.card,
            { padding: 0, gap: 0, overflow: "hidden" },
            pressed && styles.pressed,
          ]}
        >
          <EventCover event={item} cookie={cookie} height={150} />
          <View style={{ padding: 16, gap: 10 }}>
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              <PhaseBadge event={item} now={now} copy={copy} />
              {savedIds.has(item.id) ? (
                <Badge
                  label={copy.savedOffline}
                  tone="success"
                  icon={CloudCheck}
                />
              ) : null}
            </View>
            <Text style={styles.heading} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={{ gap: 4 }}>
              <View style={styles.row}>
                <CalendarBlank size={16} color={colors.ink3} />
                <Text style={styles.secondary}>
                  {eventWhen(item, language)}
                </Text>
              </View>
              <View style={styles.row}>
                <MapPin size={16} color={colors.ink3} />
                <Text style={[styles.secondary, { flex: 1 }]} numberOfLines={1}>
                  {item.venueName}
                </Text>
              </View>
            </View>
            <CheckInSummary event={item} copy={copy} />
          </View>
        </Pressable>
      )}
    />
  )
}

function EventSkeleton() {
  return (
    <View style={{ gap: 14 }}>
      {[0, 1].map((card) => (
        <View
          key={card}
          style={[styles.card, { padding: 0, gap: 0, overflow: "hidden" }]}
        >
          <Skeleton height={150} radius={0} />
          <View style={{ padding: 16, gap: 10 }}>
            <Skeleton width={90} height={22} radius={11} />
            <Skeleton width="80%" height={20} />
            <Skeleton width="55%" height={16} />
            <Skeleton height={8} radius={4} />
          </View>
        </View>
      ))}
    </View>
  )
}
