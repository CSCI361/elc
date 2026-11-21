import { Text, View } from "react-native"
import {
  ArrowsClockwise,
  CloudArrowDown,
  CloudCheck,
  PaperPlaneTilt,
  Warning,
} from "../icons"
import { fill, intlLocale, type Copy, type Language } from "../copy"
import { Button, Notice } from "../ui"
import { colors, styles } from "../theme"
import type { useOfflineEvent } from "./use-offline-event"

export function OfflineCard({
  offline,
  copy,
  language,
  online,
  unavailable,
}: {
  offline: ReturnType<typeof useOfflineEvent>
  copy: Copy
  language: Language
  online: boolean
  unavailable: boolean
}) {
  const { status, busy, message, save, send } = offline
  const locale = intlLocale(language)
  const time = (value: string | number) =>
    new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
      new Date(value)
    )
  const dateTime = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value)
  const snapshot = status?.snapshot
  const HeaderIcon = snapshot ? CloudCheck : CloudArrowDown
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <HeaderIcon
          size={22}
          color={snapshot ? colors.success : colors.ink2}
          weight="bold"
        />
        <Text style={styles.heading}>{copy.offlineTitle}</Text>
      </View>
      {unavailable ? (
        <Text style={styles.secondary}>{copy.offlineUnavailable}</Text>
      ) : snapshot ? (
        <Text style={styles.secondary}>
          {fill(copy.savedAt, {
            time: time(snapshot.issuedAt),
            until: time(snapshot.expiresAt),
          })}
        </Text>
      ) : (
        <Text style={styles.secondary}>{copy.offlineIntro}</Text>
      )}
      {status?.pendingCount ? (
        <Notice
          tone="warning"
          icon={PaperPlaneTilt}
          action={
            <Button
              label={copy.sendNow}
              variant="secondary"
              disabled={!online}
              busy={busy === "send"}
              onPress={() => {
                void send()
              }}
            />
          }
        >
          {fill(copy.waiting, { count: status.pendingCount })}
        </Notice>
      ) : null}
      {status?.conflictCount ? (
        <Notice tone="warning" icon={Warning}>
          {fill(copy.conflicts, { count: status.conflictCount })}
        </Notice>
      ) : null}
      {status?.uncertainOnlineCount ? (
        <Notice>
          {fill(copy.uncertainOnline, { count: status.uncertainOnlineCount })}
        </Notice>
      ) : null}
      {status?.warning && status.deletionDeadline ? (
        <Notice tone="danger" icon={Warning}>
          {fill(copy.oldScans, { date: dateTime(status.deletionDeadline) })}
        </Notice>
      ) : null}
      {status?.clockUnsafe ? (
        <Notice tone="danger" icon={Warning}>
          {`${copy.clockChanged}. ${copy.clockChangedBody}`}
        </Notice>
      ) : null}
      {status?.deviceRevoked ? (
        <Notice tone="danger" icon={Warning}>
          {copy.deviceRevoked}
        </Notice>
      ) : null}
      {message ? (
        <Notice
          tone={
            message === "listSaved" || message === "sent" ? "success" : "danger"
          }
        >
          {copy[message]}
        </Notice>
      ) : null}
      {unavailable ? null : (
        <Button
          label={snapshot ? copy.updateList : copy.saveList}
          variant={snapshot ? "secondary" : "primary"}
          icon={snapshot ? ArrowsClockwise : CloudArrowDown}
          disabled={!online}
          busy={busy === "save"}
          onPress={() => {
            void save()
          }}
        />
      )}
    </View>
  )
}
