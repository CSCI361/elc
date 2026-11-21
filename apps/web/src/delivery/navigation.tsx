import { platformAccessResponseSchema } from "@elc/shared"
import { useResource } from "@/events/api"
import { useEffect } from "react"
import { useAccount } from "@/auth/context"
import {
  platformHrefsFor,
  readHeaderHint,
  rememberPlatform,
} from "@/auth/header-hint"

const deliveryLabels = {
  kk: "Хаттарды жеткізу",
  ru: "Доставка писем",
  en: "Email deliveries",
} as const

const administrationLabels = {
  kk: "Платформаны басқару",
  ru: "Управление платформой",
  en: "Platform administration",
} as const

export interface PlatformLink {
  href: string
  label: string
}

export function usePlatformLinks(): PlatformLink[] {
  const resource = useResource(
    "/admin/access",
    platformAccessResponseSchema,
    15000
  )
  const { locale } = useAccount()
  const permissions = resource.data?.permissions
  const failed = Boolean(resource.error)
  useEffect(() => {
    if (permissions) rememberPlatform(platformHrefsFor(permissions))
    else if (failed) rememberPlatform([])
  }, [permissions, failed])
  const hrefs = resource.error
    ? []
    : permissions
      ? platformHrefsFor(permissions)
      : readHeaderHint().platform
  return hrefs.map((href) => ({
    href,
    label: (href === "/admin/deliveries"
      ? deliveryLabels
      : administrationLabels)[locale],
  }))
}
