import { useEffect, useRef, useState } from "react"
import { AppState, Linking, Text, View } from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import { useNetworkState } from "expo-network"
import * as Crypto from "expo-crypto"
import type { ScanResponse, ScannerEvent } from "@elc/shared"
import type { Copy, Language } from "./copy"
import {
  confirmedScanResponse,
  eventCanScan,
  prepareOnlineScan,
  type PendingScan,
} from "./model"
import { service, ServiceError } from "./service"
import { useClock } from "./use-clock"
import { uncertainRequest } from "./transport"
import { Action, Notice } from "./ui"
import { styles } from "./theme"
import { offlineController } from "./offline/runtime"
import { offlineCopies, type OfflineCopy } from "./offline/copy"
import type { LocalScanResult, OfflineStatus } from "./offline/model"

const resultCopy: Record<ScanResponse["result"], keyof Copy> = {
  checked_in: "success",
  invalid: "invalid",
  wrong_event: "wrongEvent",
  cancelled: "cancelled",
  refunded: "refunded",
  already_used: "alreadyUsed",
  admission_blocked: "blocked",
  forbidden: "forbidden",
  snapshot_expired: "snapshotExpired",
  locally_reversed: "locallyReversed",
}
export function ScanScreen({
  event,
  accountId,
  language,
  copy,
  onResult,
  offline,
}: {
  event: ScannerEvent
  accountId: string
  language: Language
  copy: Copy
  onResult: () => void
  offline?: {
    accountId: string
    copy: OfflineCopy
    status: OfflineStatus | null
  }
}) {
  const clock = useClock()
  const [permission, requestPermission] = useCameraPermissions()
  const network = useNetworkState()
  const online =
    network.isConnected !== false && network.isInternetReachable !== false
  const [foreground, setForeground] = useState(
    AppState.currentState === "active"
  )
  const [pending, setPending] = useState<PendingScan | null>(null)
  const [response, setResponse] = useState<ScanResponse | null>(null)
  const [message, setMessage] = useState<
    "invalidQr" | "notConfirmed" | "requestError" | "localPending" | null
  >(null)
  const [localResult, setLocalResult] = useState<LocalScanResult | null>(null)
  const [undone, setUndone] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    )
    return () => {
      listener.remove()
      abort.current?.abort()
    }
  }, [])
  const verify = async (input: PendingScan) => {
    if (busyRef.current || !online) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    setPending(input)
    const request = new AbortController()
    abort.current = request
    try {
      const reservation = await offlineController.beginOnline(
        accountId,
        event.id,
        input.credential.token,
        input.operationId
      )
      if (reservation.locallyBlocked) {
        setPending(null)
        setMessage("localPending")
        return
      }
      input = { ...input, operationId: reservation.operationId }
      setPending(input)
      if (request.signal.aborted) return
      const result = confirmedScanResponse(
        await service.scan(input, request.signal),
        input.operationId
      )
      if (!result) throw new ServiceError(null)
      await offlineController.finishOnline(
        accountId,
        event.id,
        input.operationId,
        result.result
      )
      if (request.signal.aborted) return
      setResponse(result)
      setPending(null)
      onResult()
    } catch (error) {
      if (request.signal.aborted) return
      const uncertain = uncertainRequest(error)
      setMessage(uncertain ? "notConfirmed" : "requestError")
      if (!uncertain) {
        await offlineController
          .finishOnline(
            accountId,
            event.id,
            input.operationId,
            error instanceof ServiceError &&
              [401, 403].includes(error.status ?? 0)
              ? "forbidden"
              : null
          )
          .catch(() => {})
        setPending(null)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const captureOffline = async (raw: string) => {
    if (!offline || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await offlineController.scan(
        offline.accountId,
        event.id,
        raw
      )
      setLocalResult(result)
      setUndone(false)
      onResult()
    } catch {
      setMessage("requestError")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const undoLocal = async () => {
    if (!offline || !localResult || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await offlineController.undo(
        offline.accountId,
        event.id,
        localResult.operationId
      )
      setUndone(true)
      setLocalResult({ ...localResult, undoAvailable: false })
      onResult()
    } catch {
      setMessage("requestError")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const offlineEligible = offline?.status?.admissionAvailable === true
  const capture = (raw: string) => {
    if (
      busyRef.current ||
      pending ||
      response ||
      localResult ||
      message ||
      !foreground ||
      (!online && !offlineEligible) ||
      (online &&
        !eventCanScan(event, offline?.status?.estimatedServerNow ?? Date.now()))
    )
      return
    if (!online) {
      void captureOffline(raw)
      return
    }
    const input = prepareOnlineScan(event.id, raw, Crypto.randomUUID())
    if (!input) {
      setMessage("invalidQr")
      return
    }
    void verify(input)
  }
  const eligible = online
    ? eventCanScan(event, offline?.status?.estimatedServerNow ?? clock)
    : offlineEligible
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {event.title}
      </Text>
      <Text style={styles.eyebrow}>
        {offline
          ? online
            ? offline.copy.online
            : offline.copy.offline
          : copy.onlineOnly}
      </Text>
      {!eligible ? (
        <Notice tone="error">
          {event.cancelledAt
            ? copy.eventCancelled
            : event.suspendedAt
              ? copy.eventSuspended
              : copy.ended}
        </Notice>
      ) : null}
      {!online && !offlineEligible ? (
        <Notice tone="error">
          {offline ? offline.copy.unavailable : copy.connectionRequired}
        </Notice>
      ) : null}
      {!permission?.granted ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {permission?.canAskAgain === false
              ? copy.cameraDenied
              : copy.cameraPermission}
          </Text>
          <Action
            label={
              permission?.canAskAgain === false
                ? copy.openSettings
                : copy.allowCamera
            }
            onPress={() => {
              if (permission?.canAskAgain === false)
                void Linking.openSettings().catch(() =>
                  setMessage("requestError")
                )
              else
                void requestPermission().catch(() => setMessage("requestError"))
            }}
          />
        </View>
      ) : null}
      {permission?.granted &&
      eligible &&
      foreground &&
      (online || offlineEligible) &&
      !pending &&
      !response &&
      !localResult &&
      !message ? (
        <View style={styles.camera}>
          <CameraView
            style={styles.cameraView}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => capture(data)}
          />
        </View>
      ) : null}
      {!response && !localResult && !message ? (
        <Text style={styles.body}>{busy ? copy.checking : copy.scanHint}</Text>
      ) : null}
      {response ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.card,
            response.result === "checked_in"
              ? styles.successNotice
              : styles.errorNotice,
          ]}
        >
          <Text style={styles.resultTitle}>
            {copy[resultCopy[response.result]]}
          </Text>
        </View>
      ) : null}
      {localResult && offline ? (
        <Notice
          tone={localResult.result === "provisional" ? undefined : "error"}
        >
          {undone
            ? offline.copy.undoDone
            : localResult.result === "provisional"
              ? offline.copy.provisionalResult
              : localResult.result === "unknown_ticket"
                ? offline.copy.unknown
                : localResult.result === "snapshot_unavailable"
                  ? offline.copy.unavailable
                  : localResult.result === "clock_unsafe"
                    ? offline.copy.clockUnsafe
                    : localResult.result === "invalid_qr"
                      ? copy.invalidQr
                      : localResult.result === "already_used"
                        ? offline.copy.duplicate
                        : localResult.result === "cancelled"
                          ? copy.cancelled
                          : localResult.result === "refunded"
                            ? copy.refunded
                            : copy.blocked}
        </Notice>
      ) : null}
      {localResult?.undoAvailable && offline ? (
        <Action
          label={offline.copy.undo}
          secondary
          busy={busy}
          onPress={() => {
            void undoLocal()
          }}
        />
      ) : null}
      {message ? (
        <Notice tone="error">
          {message === "localPending"
            ? offlineCopies[language].pendingLocal
            : copy[message]}
        </Notice>
      ) : null}
      {pending ? (
        <Action
          label={copy.retry}
          busy={busy}
          disabled={!online || !eligible}
          onPress={() => {
            void verify(pending)
          }}
        />
      ) : null}
      {(response || localResult || message) && !pending ? (
        <Action
          label={copy.next}
          disabled={(!online && !offlineEligible) || !eligible}
          onPress={() => {
            setLocalResult(null)
            setUndone(false)
            setResponse(null)
            setMessage(null)
          }}
        />
      ) : null}
      <Text style={styles.muted}>{copy.qrPrivacy}</Text>
    </>
  )
}
