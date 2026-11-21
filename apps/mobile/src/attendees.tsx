import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Text, View } from "react-native"
import { ArrowCounterClockwise, MagnifyingGlass } from "./icons"
import * as Crypto from "expo-crypto"
import {
  reversedCheckInResponseSchema,
  scannerAttendeesResponseSchema,
  type ScannerAttendee,
  type ScannerEvent,
  type seatSnapshotSchema,
} from "@elc/shared"
import { fill, intlLocale, type Copy, type Language } from "./copy"
import { canReverse, guestStatus, type GuestStatus } from "./model"
import { uncertainRequest } from "./transport"
import { service, ServiceError } from "./service"
import { Badge, Button, Field, Notice, Skeleton } from "./ui"
import { styles } from "./theme"
import type { Tone } from "./theme"
import { offlineController } from "./offline/runtime"
import { cachedAttendeeDisplay } from "./offline/attendee-display"
import type { OfflineStatus, SnapshotTicket } from "./offline/model"

type SeatSnapshot = ReturnType<typeof seatSnapshotSchema.parse>

const searchDelayMs = 300
const statusLabels: Record<GuestStatus, { label: keyof Copy; tone: Tone }> = {
  notIn: { label: "notIn", tone: "neutral" },
  checkedIn: { label: "checkedIn", tone: "success" },
  cancelled: { label: "statusCancelled", tone: "danger" },
  refunded: { label: "statusRefunded", tone: "danger" },
  blocked: { label: "statusBlocked", tone: "danger" },
}

export function Attendees({
  event,
  copy,
  language,
  online,
  offline,
  onChange,
}: {
  event: ScannerEvent
  copy: Copy
  language: Language
  online: boolean
  offline: { accountId: string; status: OfflineStatus | null } | null
  onChange: () => void
}) {
  const [query, setQuery] = useState("")
  const snapshot = online ? null : offline?.status?.snapshot
  return (
    <View style={{ gap: 12 }}>
      <Field
        label={copy.searchGuests}
        icon={MagnifyingGlass}
        value={query}
        onChangeText={setQuery}
        maxLength={100}
        autoCorrect={false}
        returnKeyType="search"
      />
      {offline && snapshot ? (
        <SavedGuests
          event={event}
          accountId={offline.accountId}
          snapshotIssuedAt={snapshot.issuedAt}
          query={query.trim()}
          copy={copy}
          language={language}
        />
      ) : (
        <OnlineGuests
          event={event}
          query={query.trim()}
          copy={copy}
          onChange={onChange}
        />
      )}
    </View>
  )
}

function OnlineGuests({
  event,
  query,
  copy,
  onChange,
}: {
  event: ScannerEvent
  query: string
  copy: Copy
  onChange: () => void
}) {
  const [items, setItems] = useState<ScannerAttendee[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [correction, setCorrection] = useState<{
    requestId: string
    reason: string
    checkInId: string
  } | null>(null)
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [correctionState, setCorrectionState] = useState<
    "undoneOnline" | "undoUncertain" | "requestError" | null
  >(null)
  const correctionLock = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const load = useCallback(
    (search: string, after?: string) => {
      abort.current?.abort()
      const request = new AbortController()
      abort.current = request
      return service
        .attendees(event.id, search, after, request.signal)
        .then((raw) => {
          const result = scannerAttendeesResponseSchema.parse(raw)
          if (result.eventId !== event.id) throw new ServiceError(null)
          if (request.signal.aborted) return
          setError(false)
          setItems((current) =>
            after && current ? [...current, ...result.items] : result.items
          )
          setCursor(result.nextCursor)
        })
        .catch(() => {
          if (request.signal.aborted) return
          setError(true)
          if (after) return
          setItems([])
          setCursor(null)
        })
        .finally(() => {
          if (!request.signal.aborted) setLoadingMore(false)
        })
    },
    [event.id]
  )
  useEffect(() => {
    const timer = setTimeout(
      () => {
        void load(query)
      },
      query ? searchDelayMs : 0
    )
    return () => clearTimeout(timer)
  }, [load, query])
  useEffect(() => () => abort.current?.abort(), [])
  const reverse = async () => {
    if (
      correctionLock.current ||
      !correcting ||
      (!correction && !reason.trim())
    )
      return
    correctionLock.current = true
    const input = correction ?? {
      requestId: Crypto.randomUUID(),
      reason: reason.trim(),
      checkInId: correcting,
    }
    setCorrection(input)
    setCorrectionBusy(true)
    setCorrectionState(null)
    try {
      const result = reversedCheckInResponseSchema.parse(
        await service.reverse(event.id, input)
      )
      if (result.checkInId !== input.checkInId) throw new ServiceError(null)
      setCorrecting(null)
      setCorrection(null)
      setReason("")
      setCorrectionState("undoneOnline")
      await load(query)
      onChange()
    } catch (failure) {
      setCorrectionState(
        uncertainRequest(failure) ? "undoUncertain" : "requestError"
      )
    } finally {
      correctionLock.current = false
      setCorrectionBusy(false)
    }
  }
  if (items === null) return <GuestSkeleton />
  return (
    <>
      {error ? <Notice tone="danger">{copy.guestsError}</Notice> : null}
      {correctionState ? (
        <Notice
          tone={correctionState === "undoneOnline" ? "success" : "danger"}
        >
          {copy[correctionState]}
        </Notice>
      ) : null}
      {!error && !items.length ? (
        <Text style={styles.secondary}>{copy.noGuests}</Text>
      ) : null}
      {items.map((item) => (
        <GuestRow
          key={item.ticketId}
          name={item.attendeeName}
          seat={item.seat}
          status={guestStatus(item)}
          copy={copy}
        >
          {canReverse(event) &&
          item.activeCheckInId &&
          !item.admissionBlocked &&
          !correcting ? (
            <Button
              label={copy.undoCheckIn}
              variant="ghost"
              icon={ArrowCounterClockwise}
              onPress={() => {
                setCorrecting(item.activeCheckInId)
                setCorrection(null)
                setCorrectionState(null)
                setReason("")
              }}
            />
          ) : null}
          {correcting && correcting === item.activeCheckInId ? (
            <View style={{ gap: 10 }}>
              <Field
                label={copy.reason}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1000}
                editable={!correction && !correctionBusy}
              />
              <Button
                label={correction ? copy.retry : copy.undoCheckIn}
                variant="danger"
                disabled={!reason.trim()}
                busy={correctionBusy}
                onPress={() => {
                  void reverse()
                }}
              />
              <Button
                label={copy.cancel}
                variant="ghost"
                disabled={correctionBusy}
                onPress={() => {
                  setCorrecting(null)
                  setCorrection(null)
                  setReason("")
                }}
              />
            </View>
          ) : null}
        </GuestRow>
      ))}
      {cursor ? (
        <Button
          label={copy.more}
          variant="secondary"
          busy={loadingMore}
          onPress={() => {
            setLoadingMore(true)
            void load(query, cursor)
          }}
        />
      ) : null}
    </>
  )
}

function SavedGuests({
  event,
  accountId,
  snapshotIssuedAt,
  query,
  copy,
  language,
}: {
  event: ScannerEvent
  accountId: string
  snapshotIssuedAt: string
  query: string
  copy: Copy
  language: Language
}) {
  const [items, setItems] = useState<SnapshotTicket[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void offlineController
      .attendees(accountId, event.id, query)
      .then((result) => {
        if (active) {
          setItems(result)
          setError(false)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [accountId, event.id, query])
  const time = new Intl.DateTimeFormat(intlLocale(language), {
    timeStyle: "short",
  }).format(new Date(snapshotIssuedAt))
  return (
    <>
      <Notice>{fill(copy.savedListNote, { time })}</Notice>
      {error ? <Notice tone="danger">{copy.guestsError}</Notice> : null}
      {items === null && !error ? <GuestSkeleton /> : null}
      {items && !items.length ? (
        <Text style={styles.secondary}>{copy.noGuests}</Text>
      ) : null}
      {items?.map((ticket) => {
        const display = cachedAttendeeDisplay(ticket)
        return (
          <GuestRow
            key={ticket.ticketId}
            name={ticket.attendeeName}
            seat={display.seat}
            status={display.status}
            copy={copy}
          />
        )
      })}
    </>
  )
}

function GuestRow({
  name,
  seat,
  status,
  copy,
  children,
}: {
  name: string
  seat: SeatSnapshot | null
  status: GuestStatus
  copy: Copy
  children?: ReactNode
}) {
  const badge = statusLabels[status]
  return (
    <View style={[styles.card, { gap: 8 }]}>
      <View style={styles.spread}>
        <Text
          style={[styles.body, { fontWeight: "600", flex: 1 }]}
          numberOfLines={2}
        >
          {name}
        </Text>
        <Badge label={copy[badge.label]} tone={badge.tone} />
      </View>
      {seat ? (
        <Text style={styles.small}>
          {fill(copy.seat, {
            section: seat.section,
            row: seat.row,
            number: seat.number,
          })}
          {seat.accessible ? ` · ${copy.accessibleSeat}` : ""}
        </Text>
      ) : null}
      {children}
    </View>
  )
}

function GuestSkeleton() {
  return (
    <View style={{ gap: 10 }}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={[styles.card, styles.spread]}>
          <Skeleton width="55%" height={18} />
          <Skeleton width={80} height={24} radius={12} />
        </View>
      ))}
    </View>
  )
}
