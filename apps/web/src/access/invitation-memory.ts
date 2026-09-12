import { acceptEventInvitationSchema } from "@elc/shared"

export function readInvitationToken(url: URL): string | null {
  if (url.pathname !== "/invitations/accept") return null
  const fragment = new URLSearchParams(url.hash.slice(1))
  const values = fragment.getAll("token")
  if (values.length !== 1) return null
  const parsed = acceptEventInvitationSchema.shape.token.safeParse(values[0])
  return parsed.success ? parsed.data : null
}

export function withoutInvitationSecrets(input: URL): string {
  const url = new URL(input)
  if (url.pathname === "/invitations/accept") return url.pathname
  const returnTo = url.searchParams.get("returnTo")
  if (
    returnTo?.startsWith("/invitations/accept") &&
    new URL(returnTo, url.origin).pathname === "/invitations/accept"
  )
    url.searchParams.set("returnTo", "/invitations/accept")
  return `${url.pathname}${url.search}${url.hash}`
}

/** This credential never enters browser storage or a navigation URL. */
export function createInvitationMemory(initialToken: string | null) {
  let token = initialToken
  return {
    read: () => token,
    replace: (next: string | null) => {
      token = next
    },
    clear: () => {
      token = null
    },
  }
}
export type InvitationMemory = ReturnType<typeof createInvitationMemory>
