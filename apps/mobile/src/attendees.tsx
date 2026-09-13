import { useCallback, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import * as Crypto from "expo-crypto"
import {
  reversedCheckInResponseSchema,
  scannerAttendeesResponseSchema,
  type ScannerAttendee,
  type ScannerEvent,
} from "@elc/shared"
import type { Copy } from "./copy"
import { canReverse } from "./model"
import { uncertainRequest } from "./transport"
import { service, ServiceError } from "./service"
import { Action, Field, Notice } from "./ui"
import { styles } from "./theme"

export function Attendees({
  event,
  copy,
  onChange,
}: {
  event: ScannerEvent
  copy: Copy
  onChange: () => void
}) {
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [items, setItems] = useState<ScannerAttendee[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
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
    "reverseDone" | "reverseUncertain" | "requestError" | null
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
            after ? [...current, ...result.items] : result.items
          )
          setCursor(result.nextCursor)
          setAppliedQuery(search)
        })
        .catch(() => {
          if (!request.signal.aborted) {
            setError(true)
            setItems([])
            setCursor(null)
          }
        })
        .finally(() => {
          if (!request.signal.aborted) setBusy(false)
        })
    },
    [event.id]
  )
  const search = (query: string, after?: string) => {
    setBusy(true)
    setError(false)
    void load(query, after)
  }
  useEffect(() => {
    void load("")
    return () => abort.current?.abort()
  }, [load])
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
      setCorrectionState("reverseDone")
      await load(appliedQuery)
      onChange()
    } catch (error) {
      setCorrectionState(
        uncertainRequest(error) ? "reverseUncertain" : "requestError"
      )
    } finally {
      correctionLock.current = false
      setCorrectionBusy(false)
    }
  }
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.attendees}
      </Text>
      <Field
        label={copy.searchHint}
        value={query}
        onChangeText={setQuery}
        maxLength={100}
        returnKeyType="search"
        onSubmitEditing={() => {
          search(query.trim())
        }}
      />
      <Action
        label={copy.search}
        busy={busy}
        onPress={() => {
          search(query.trim())
        }}
      />
      {error ? <Notice tone="error">{copy.refreshError}</Notice> : null}
      {correctionState ? (
        <Notice tone={correctionState === "reverseDone" ? "success" : "error"}>
          {copy[correctionState]}
        </Notice>
      ) : null}
      {!busy && !items.length && !error ? (
        <Text style={styles.muted}>{copy.noAttendees}</Text>
      ) : null}
      {items.map((item) => (
        <View key={item.ticketId} style={styles.card}>
          <Text style={styles.heading}>{item.attendeeName}</Text>
          {item.seat ? (
            <Text style={styles.muted}>
              {item.seat.section} · {item.seat.row} · {item.seat.number}
            </Text>
          ) : null}
          <Text style={styles.body}>
            {item.admissionBlocked
              ? copy.blocked
              : item.state === "checked_in"
                ? copy.alreadyUsed
                : item.state === "cancelled"
                  ? copy.cancelledState
                  : item.state === "refunded"
                    ? copy.refundedState
                    : copy.valid}
          </Text>
          {canReverse(event) &&
          item.activeCheckInId &&
          !item.admissionBlocked &&
          !correcting ? (
            <Action
              label={copy.reverse}
              secondary
              onPress={() => {
                setCorrecting(item.activeCheckInId)
                setCorrection(null)
                setCorrectionState(null)
                setReason("")
              }}
            />
          ) : null}
          {correcting === item.activeCheckInId && correcting ? (
            <View style={{ gap: 10 }}>
              <Field
                label={copy.reason}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1000}
                editable={!correction && !correctionBusy}
              />
              <Action
                label={correction ? copy.retryCorrection : copy.confirmReverse}
                disabled={!reason.trim()}
                busy={correctionBusy}
                onPress={() => {
                  void reverse()
                }}
              />
              <Action
                label={copy.dismiss}
                secondary
                disabled={correctionBusy}
                onPress={() => {
                  setCorrecting(null)
                  setCorrection(null)
                  setReason("")
                }}
              />
            </View>
          ) : null}
        </View>
      ))}
      {cursor ? (
        <Action
          label={copy.more}
          secondary
          busy={busy}
          onPress={() => {
            search(appliedQuery, cursor)
          }}
        />
      ) : null}
    </>
  )
}
