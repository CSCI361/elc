import type { ReactNode } from "react"
import type { OfflineDevice } from "@elc/shared"
import type { OfflineCommands } from "./commands"
import { DeviceForm, AdmissionForm, type AdmissionReport } from "./forms"
import { useOfflineCommand } from "./use-command"
import { useOfflineText } from "./messages"
export function RecordTime({ value }: { value: string | null }) {
  const { locale, t } = useOfflineText()
  return value ? (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))}
    </time>
  ) : (
    <span>{t("never")}</span>
  )
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
export function DeviceCard({
  device,
  manage,
  commands,
  reload,
}: {
  device: OfflineDevice
  manage: boolean
  commands: OfflineCommands
  reload: () => void
}) {
  const { t } = useOfflineText()
  const command = useOfflineCommand(commands, `device:${device.id}`)
  const retry = command?.phase === "pending" || command?.phase === "uncertain"
  return (
    <article className="event-panel offline-record" data-device-id={device.id}>
      <h3>{device.label}</h3>
      <p className="offline-state">
        {t(device.revokedAt ? "revokedAt" : "active")}
        {device.lossReported ? ` · ${t("lost")}` : ""}
      </p>
      <dl className="offline-facts fact-grid">
        <Fact label={t("deviceId")}>{device.id}</Fact>
        <Fact label={t("accountId")}>{device.accountId}</Fact>
        <Fact label={t("registered")}>
          <RecordTime value={device.registeredAt} />
        </Fact>
        <Fact label={t("lastSync")}>
          <RecordTime value={device.lastSyncAt} />
        </Fact>
        {device.revokedAt ? (
          <Fact label={t("revokedAt")}>
            <RecordTime value={device.revokedAt} />
          </Fact>
        ) : null}
      </dl>
      {command?.phase === "succeeded" ? (
        <p role="status">{t("saved")}</p>
      ) : null}
      {manage &&
      (!device.revokedAt || retry) &&
      command?.phase !== "succeeded" ? (
        <details open={retry || undefined}>
          <summary>{t("revoke")}</summary>
          <DeviceForm device={device} commands={commands} reload={reload} />
        </details>
      ) : null}
    </article>
  )
}
export function AdmissionCard({
  report,
  commands,
  reload,
}: {
  report: AdmissionReport
  commands: OfflineCommands
  reload: () => void
}) {
  const { t } = useOfflineText()
  const command = useOfflineCommand(commands, `admission:${report.operationId}`)
  const retry = command?.phase === "pending" || command?.phase === "uncertain"
  return (
    <article
      className="event-panel offline-record"
      data-operation-id={report.operationId}
    >
      <h3>
        {t("reviewState")}: {t(report.reviewState)}
      </h3>
      <dl className="offline-facts fact-grid">
        <Fact label={t("operationId")}>{report.operationId}</Fact>
        <Fact label={t("deviceId")}>{report.deviceId}</Fact>
        <Fact label={t("accountId")}>{report.accountId}</Fact>
        {report.ticketId ? (
          <Fact label={t("ticketId")}>{report.ticketId}</Fact>
        ) : null}
        {report.orderId ? (
          <Fact label={t("orderId")}>{report.orderId}</Fact>
        ) : null}
        <Fact label={t("captured")}>
          <RecordTime value={report.capturedAt} />
        </Fact>
        <Fact label={t("reported")}>
          <RecordTime value={report.reportedAt} />
        </Fact>
        <Fact label={t("result")}>{t(report.result)}</Fact>
        {report.resolution ? (
          <Fact label={t("resolution")}>{t(report.resolution)}</Fact>
        ) : null}
        {report.reviewedAt ? (
          <Fact label={t("reviewedAt")}>
            <RecordTime value={report.reviewedAt} />
          </Fact>
        ) : null}
        {report.reviewedBy ? (
          <Fact label={t("reviewedBy")}>{report.reviewedBy}</Fact>
        ) : null}
        {report.reason ? (
          <Fact label={t("reason")}>{report.reason}</Fact>
        ) : null}
      </dl>
      {command?.phase === "succeeded" ? (
        <p role="status">{t("saved")}</p>
      ) : null}
      {((report.reviewState === "unresolved" && report.ticketId) || retry) &&
      command?.phase !== "succeeded" ? (
        <details open={retry || undefined}>
          <summary>{t("review")}</summary>
          <AdmissionForm report={report} commands={commands} reload={reload} />
        </details>
      ) : null}
    </article>
  )
}
