import { useEffect, useRef, useState } from "react"
import { AppState, Linking, Text, View } from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import { useNetworkState } from "expo-network"
import * as Crypto from "expo-crypto"
import type { ScanResponse, ScannerEvent } from "@elc/shared"
import type { Copy } from "./copy"
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
  copy,
  onResult,
}: {
  event: ScannerEvent
  copy: Copy
  onResult: () => void
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
    "invalidQr" | "notConfirmed" | "requestError" | null
  >(null)
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
      const result = confirmedScanResponse(
        await service.scan(input, request.signal),
        input.operationId
      )
      if (!result) throw new ServiceError(null)
      if (request.signal.aborted) return
      setResponse(result)
      setPending(null)
      onResult()
    } catch (error) {
      if (request.signal.aborted) return
      const uncertain = uncertainRequest(error)
      setMessage(uncertain ? "notConfirmed" : "requestError")
      if (!uncertain) setPending(null)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const capture = (raw: string) => {
    if (
      busyRef.current ||
      pending ||
      response ||
      message ||
      !foreground ||
      !online ||
      !eventCanScan(event, Date.now())
    )
      return
    const input = prepareOnlineScan(event.id, raw, Crypto.randomUUID())
    if (!input) {
      setMessage("invalidQr")
      return
    }
    void verify(input)
  }
  const eligible = eventCanScan(event, clock)
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {event.title}
      </Text>
      <Text style={styles.eyebrow}>{copy.onlineOnly}</Text>
      {!eligible ? (
        <Notice tone="error">
          {event.cancelledAt
            ? copy.eventCancelled
            : event.suspendedAt
              ? copy.eventSuspended
              : copy.ended}
        </Notice>
      ) : null}
      {!online ? <Notice tone="error">{copy.connectionRequired}</Notice> : null}
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
      online &&
      !pending &&
      !response &&
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
      {!response && !message ? (
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
      {message ? <Notice tone="error">{copy[message]}</Notice> : null}
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
      {(response || message) && !pending ? (
        <Action
          label={copy.next}
          disabled={!online || !eligible}
          onPress={() => {
            setResponse(null)
            setMessage(null)
          }}
        />
      ) : null}
      <Text style={styles.muted}>{copy.qrPrivacy}</Text>
    </>
  )
}
