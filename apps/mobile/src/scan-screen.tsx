import { useEffect, useRef, useState, type ReactNode } from "react"
import { ActivityIndicator, AppState, Linking, Text, View } from "react-native"
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  Camera,
  CheckCircle,
  QrCode,
  Warning,
  XCircle,
} from "./icons"
import { CameraView, useCameraPermissions } from "expo-camera"
import { useNetworkState } from "expo-network"
import * as Crypto from "expo-crypto"
import type { ScanResponse, ScannerEvent } from "@elc/shared"
import type { Copy } from "./copy"
import {
  confirmedScanResponse,
  eventCanScan,
  eventPhase,
  prepareOnlineScan,
  type PendingScan,
} from "./model"
import { scanVerdict, type ScanMessage, type Verdict } from "./scan-verdict"
import { service, ServiceError } from "./service"
import { useClock } from "./use-clock"
import { uncertainRequest } from "./transport"
import { Button, Notice } from "./ui"
import { colors, styles, toneColors } from "./theme"
import { offlineController } from "./offline/runtime"
import type { LocalScanResult, OfflineStatus } from "./offline/model"

export function ScanScreen({
  event,
  accountId,
  copy,
  onResult,
  offline,
}: {
  event: ScannerEvent
  accountId: string
  copy: Copy
  onResult: () => void
  offline?: {
    accountId: string
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
  const [message, setMessage] = useState<ScanMessage | null>(null)
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
  const verdict = scanVerdict({
    response: response?.result,
    local: localResult?.result,
    undone,
    message: message ?? undefined,
  })
  const blocked = !eligible
    ? phaseNotice(event, clock)
    : !online && !offlineEligible
      ? "noConnection"
      : null
  const showCamera =
    permission?.granted && !blocked && foreground && !pending && !verdict
  return (
    <View style={{ gap: 14 }}>
      {blocked ? (
        <Notice tone="danger" icon={Warning}>
          {copy[blocked]}
        </Notice>
      ) : null}
      {!blocked && !permission?.granted ? (
        <View
          style={[styles.card, { alignItems: "center", paddingVertical: 28 }]}
        >
          <Camera size={40} color={colors.ink2} />
          <Text style={[styles.heading, { textAlign: "center" }]}>
            {copy.cameraTitle}
          </Text>
          <Text style={[styles.secondary, { textAlign: "center" }]}>
            {permission?.canAskAgain === false
              ? copy.cameraDenied
              : copy.cameraBody}
          </Text>
          <View style={{ alignSelf: "stretch" }}>
            <Button
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
                  void requestPermission().catch(() =>
                    setMessage("requestError")
                  )
              }}
            />
          </View>
        </View>
      ) : null}
      {showCamera ? (
        <Viewfinder hint={copy.scanHint} checking={busy ? copy.checking : null}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => capture(data)}
          />
        </Viewfinder>
      ) : null}
      {pending && !verdict ? (
        <Viewfinder hint={copy.scanHint} checking={copy.checking} />
      ) : null}
      {verdict ? <VerdictPanel verdict={verdict} copy={copy} /> : null}
      {localResult?.undoAvailable && offline ? (
        <Button
          label={copy.undo}
          variant="secondary"
          icon={ArrowCounterClockwise}
          busy={busy}
          onPress={() => {
            void undoLocal()
          }}
        />
      ) : null}
      {pending ? (
        <Button
          label={copy.retry}
          icon={ArrowsClockwise}
          busy={busy}
          disabled={!online || !eligible}
          onPress={() => {
            void verify(pending)
          }}
        />
      ) : null}
      {verdict && !pending ? (
        <Button
          label={copy.next}
          icon={QrCode}
          disabled={(!online && !offlineEligible) || !eligible}
          onPress={() => {
            setLocalResult(null)
            setUndone(false)
            setResponse(null)
            setMessage(null)
          }}
        />
      ) : null}
    </View>
  )
}

function phaseNotice(event: ScannerEvent, now: number): keyof Copy {
  if (!event.permissions.includes("ticket:scan")) return "noPermission"
  const phase = eventPhase(event, now)
  return phase === "cancelled"
    ? "cancelledNotice"
    : phase === "suspended"
      ? "suspendedNotice"
      : "endedNotice"
}

function Viewfinder({
  hint,
  checking,
  children,
}: {
  hint: string
  checking: string | null
  children?: ReactNode
}) {
  const corner = {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: "#fff",
  } as const
  return (
    <View
      style={{
        aspectRatio: 1,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: colors.ink,
      }}
    >
      {children}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 48,
          left: 48,
          right: 48,
          bottom: 48,
        }}
      >
        <View
          style={[
            corner,
            {
              top: 0,
              left: 0,
              borderTopWidth: 4,
              borderLeftWidth: 4,
              borderTopLeftRadius: 14,
            },
          ]}
        />
        <View
          style={[
            corner,
            {
              top: 0,
              right: 0,
              borderTopWidth: 4,
              borderRightWidth: 4,
              borderTopRightRadius: 14,
            },
          ]}
        />
        <View
          style={[
            corner,
            {
              bottom: 0,
              left: 0,
              borderBottomWidth: 4,
              borderLeftWidth: 4,
              borderBottomLeftRadius: 14,
            },
          ]}
        />
        <View
          style={[
            corner,
            {
              bottom: 0,
              right: 0,
              borderBottomWidth: 4,
              borderRightWidth: 4,
              borderBottomRightRadius: 14,
            },
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 14,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: "rgba(0,0,0,0.6)",
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        {checking ? <ActivityIndicator color="#fff" size="small" /> : null}
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
          {checking ?? hint}
        </Text>
      </View>
    </View>
  )
}

const verdictIcons = {
  success: CheckCircle,
  danger: XCircle,
  warning: Warning,
  neutral: ArrowCounterClockwise,
} as const

function VerdictPanel({ verdict, copy }: { verdict: Verdict; copy: Copy }) {
  const palette = toneColors[verdict.tone]
  const VerdictIcon = verdictIcons[verdict.tone]
  return (
    <View
      accessibilityLiveRegion="assertive"
      style={{
        minHeight: 240,
        borderRadius: 20,
        backgroundColor: palette.soft,
        borderWidth: 1,
        borderColor: palette.ink,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 10,
      }}
    >
      <VerdictIcon size={64} color={palette.ink} weight="fill" />
      <Text
        style={{
          fontSize: 26,
          lineHeight: 32,
          fontWeight: "700",
          color: palette.ink,
          textAlign: "center",
        }}
      >
        {copy[verdict.title]}
      </Text>
      {verdict.body ? (
        <Text
          style={[styles.body, { textAlign: "center", color: colors.ink2 }]}
        >
          {copy[verdict.body]}
        </Text>
      ) : null}
    </View>
  )
}
