export function deliveryRoute(path: string): { id: string | null } | null {
  if (path === "/admin/deliveries") return { id: null }
  const match = /^\/admin\/deliveries\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(
    path
  )
  return match ? { id: match[1]! } : null
}
