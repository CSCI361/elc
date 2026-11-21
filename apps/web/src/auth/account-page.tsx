import {
  ArrowRightIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  ShieldCheckIcon,
  SignOutIcon,
  UserCircleIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { OrganizerProfilePanel } from "@/organizer-profile/panel"
import { authClient } from "./client"
import { useAccount } from "./context"
import { authErrorMessage, type AuthErrorKey } from "./errors"
import { LocaleSelect } from "./locale-select"
import { AuthNotice } from "./notice"

export function AccountPage() {
  const {
    account,
    status,
    messages: t,
    locale,
    capabilities,
    refresh,
    signOut,
    preferenceError,
    preferencePending,
  } = useAccount()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{
    key: AuthErrorKey
    tone: "success" | "error"
  } | null>(null)

  async function securityAction(
    action: "reset" | "other-sessions" | "sign-out"
  ) {
    if (pending) return
    setPending(true)
    setNotice(null)
    try {
      if (action === "sign-out") {
        if (!(await signOut()))
          setNotice({ key: "errorNetwork", tone: "error" })
        return
      }
      if (!account) return
      const result =
        action === "reset"
          ? await authClient.requestPasswordReset({
              email: account.user.email,
              redirectTo: `${window.location.origin}/auth/reset-password`,
              fetchOptions: { headers: { "Accept-Language": locale } },
            })
          : await authClient.revokeOtherSessions()
      setNotice(
        result.error
          ? { key: authErrorMessage(result.error), tone: "error" }
          : {
              key: action === "reset" ? "resetSent" : "otherSessionsRevoked",
              tone: "success",
            }
      )
    } catch {
      setNotice({ key: "errorNetwork", tone: "error" })
    } finally {
      setPending(false)
    }
  }

  if (status === "loading")
    return (
      <SkeletonRegion label={t.loadingAccount} className="account-skeleton">
        <div className="account-identity">
          <Bar width={64} height={64} radius={32} />
          <div className="account-identity-text">
            <Bar width={240} height={28} />
            <Bar width={300} height={16} style={{ marginTop: 10 }} />
          </div>
        </div>
        <div className="settings-list">
          <Bar height={72} radius={10} />
          <Bar height={72} radius={10} />
        </div>
      </SkeletonRegion>
    )
  if (!account)
    return (
      <section className="auth-card account-state-card">
        <span className="status-icon">
          <UserCircleIcon size={32} aria-hidden />
        </span>
        <h1>
          {status === "signed-out"
            ? t.signInTitle
            : status === "verification-required"
              ? t.verificationTitle
              : t.account}
        </h1>
        <p>
          {status === "signed-out"
            ? t.signInDescription
            : status === "verification-required"
              ? t.errorUnverified
              : status === "denied"
                ? t.accessDenied
                : t.errorNetwork}
        </p>
        {notice ? (
          <AuthNotice tone={notice.tone}>{t[notice.key]}</AuthNotice>
        ) : null}
        {status === "signed-out" ? (
          <a className="primary-link" href="/auth/sign-in?returnTo=%2Faccount">
            {t.signIn}
            <ArrowRightIcon size={20} aria-hidden />
          </a>
        ) : status === "verification-required" ? (
          <a className="primary-link" href="/auth/verify-email">
            {t.resendVerification}
          </a>
        ) : (
          <Button className="auth-button" onClick={refresh}>
            {t.retry}
          </Button>
        )}
        {status === "denied" || status === "verification-required" ? (
          <Button
            variant="outline"
            className="auth-button"
            onClick={() => {
              void securityAction("sign-out")
            }}
            disabled={pending}
          >
            {t.signOut}
          </Button>
        ) : null}
      </section>
    )

  return (
    <div className="account-page">
      <header className="account-identity">
        <span className="account-avatar" aria-hidden>
          <UserIcon size={28} />
        </span>
        <div className="account-identity-text">
          <h1>{account.user.name}</h1>
          <p>
            <span>{account.user.email}</span>
            <span className="verified-label">
              <CheckCircleIcon size={16} weight="fill" aria-hidden />
              {t.emailVerified}
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          className="account-sign-out"
          disabled={pending}
          onClick={() => {
            void securityAction("sign-out")
          }}
        >
          <SignOutIcon size={18} aria-hidden />
          {t.signOut}
        </Button>
      </header>
      {notice ? (
        <AuthNotice tone={notice.tone}>{t[notice.key]}</AuthNotice>
      ) : null}
      {preferenceError ? <AuthNotice>{t.errorGeneric}</AuthNotice> : null}
      {preferencePending ? (
        <p role="status" className="field-hint">
          {t.pending}
        </p>
      ) : null}
      <div className="settings-list">
        <section className="settings-row" aria-label={t.languagePreference}>
          <LocaleSelect />
        </section>
        <section className="settings-row" aria-labelledby="account-security">
          <div className="settings-label">
            <h2 id="account-security">{t.security}</h2>
            <p>{t.securityDescription}</p>
          </div>
          <div className="security-actions">
            <Button
              variant="outline"
              disabled={pending || !capabilities?.emailDelivery}
              onClick={() => {
                void securityAction("reset")
              }}
            >
              <EnvelopeSimpleIcon size={18} aria-hidden />
              {t.sendResetLink}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                void securityAction("other-sessions")
              }}
            >
              <ShieldCheckIcon size={18} aria-hidden />
              {t.signOutAll}
            </Button>
            {!capabilities?.emailDelivery && capabilities ? (
              <p className="field-hint">{t.emailUnavailable}</p>
            ) : null}
          </div>
        </section>
        <OrganizerProfilePanel key={account.user.id} />
      </div>
    </div>
  )
}
