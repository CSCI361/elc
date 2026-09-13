import { platformAccessResponseSchema } from "@elc/shared"
import { useResource } from "@/events/api"
import { useAccount } from "@/auth/context"

const labels = {
  kk: "Хаттарды жеткізу",
  ru: "Доставка писем",
  en: "Email deliveries",
} as const

export function DeliveryNavigation() {
  const resource = useResource(
      "/admin/access",
      platformAccessResponseSchema,
      15000
    ),
    { locale } = useAccount()
  if (
    resource.error ||
    !resource.data?.permissions.includes("platform:recover")
  )
    return null
  return (
    <a
      href="/admin/deliveries"
      aria-current={
        window.location.pathname.startsWith("/admin/deliveries")
          ? "page"
          : undefined
      }
    >
      {labels[locale]}
    </a>
  )
}
