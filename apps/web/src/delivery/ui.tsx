import { EventApiError } from "@/events/api"
import { EventError } from "@/events/ui"
import { AuthNotice } from "@/auth/notice"
import { useDeliveryText } from "./messages"

export function DeliveryFailure({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  const { t } = useDeliveryText()
  return error instanceof EventApiError &&
    [401, 403, 404].includes(error.status) ? (
    <AuthNotice>
      {t("denied")}{" "}
      <button type="button" className="text-action" onClick={retry}>
        {t("reload")}
      </button>
    </AuthNotice>
  ) : (
    <EventError error={error} retry={retry} />
  )
}
