import type { AuthMessages } from "@elc/shared"

export type AuthErrorKey = keyof AuthMessages

export function authErrorMessage(error: {
  code?: string
  status?: number
}): AuthErrorKey {
  if (error.status === 429 || error.code === "RATE_LIMITED")
    return "errorRateLimit"
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "errorCredentials"
    case "EMAIL_NOT_VERIFIED":
      return "errorUnverified"
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "errorPasswordLength"
    case "INVALID_EMAIL":
      return "errorEmail"
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "resetInvalid"
    case "EMAIL_UNAVAILABLE":
      return "emailUnavailable"
    case "GOOGLE_UNAVAILABLE":
      return "googleUnavailable"
    case "UNAUTHENTICATED":
      return "errorSession"
    case "FORBIDDEN":
      return "accessDenied"
    default:
      return "errorGeneric"
  }
}
