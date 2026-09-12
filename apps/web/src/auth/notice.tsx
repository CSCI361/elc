import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"

export function AuthNotice({
  children,
  tone = "error",
}: {
  children: React.ReactNode
  tone?: "error" | "success"
}) {
  const notice = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tone === "error") notice.current?.focus()
  }, [children, tone])
  return (
    <div
      ref={notice}
      className={`auth-notice auth-notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={-1}
    >
      {tone === "error" ? (
        <WarningCircleIcon size={21} aria-hidden />
      ) : (
        <CheckCircleIcon size={21} aria-hidden />
      )}
      <span>{children}</span>
    </div>
  )
}
