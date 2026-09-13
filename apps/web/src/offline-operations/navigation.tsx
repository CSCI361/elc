import { useOfflineText } from "./messages"
import { offlineHref } from "./policies"
export function OfflineOperationsLink({
  eventId,
  className = "text-action",
}: {
  eventId?: string
  className?: string
}) {
  const { t } = useOfflineText()
  return (
    <a className={className} href={eventId ? offlineHref(eventId) : "/offline"}>
      {t("title")}
    </a>
  )
}
