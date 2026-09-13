import {
  ArrowRightIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  ShieldCheckIcon,
  SignOutIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { authClient } from "./client"
import { useAccount } from "./context"
import { authErrorMessage, type AuthErrorKey } from "./errors"
import { LocaleSelect } from "./locale-select"
import { AuthNotice } from "./notice"

const OrganizerProfilePanel = lazy(() =>
  import("@/organizer-profile").then((module) => ({
    default: module.OrganizerProfilePanel,
  }))
)

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
      <section className="account-state" role="status">
        <span className="loading-dot" />
        {t.loadingAccount}
      </section>
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
      <div className="account-heading">
        <span className="eyebrow">
          <CheckCircleIcon size={17} weight="fill" aria-hidden />
          {t.activeAccount}
        </span>
        <h1>{t.accountTitle}</h1>
        <p>{t.accountDescription}</p>
      </div>
      {notice ? (
        <AuthNotice tone={notice.tone}>{t[notice.key]}</AuthNotice>
      ) : null}
      {preferenceError ? <AuthNotice>{t.errorGeneric}</AuthNotice> : null}
      {preferencePending ? (
        <p role="status" className="field-hint">
          {t.pending}
        </p>
      ) : null}
      <div className="account-grid">
        <section className="account-section" aria-labelledby="account-details">
          <span className="section-icon">
            <UserCircleIcon size={28} aria-hidden />
          </span>
          <h2 id="account-details">{t.accountDetails}</h2>
          <dl className="account-data">
            <div>
              <dt>{t.fullName}</dt>
              <dd>{account.user.name}</dd>
            </div>
            <div>
              <dt>{t.email}</dt>
              <dd>{account.user.email}</dd>
            </div>
          </dl>
          <span className="verified-label">
            <CheckCircleIcon size={17} weight="fill" aria-hidden />
            {t.emailVerified}
          </span>
          <div className="account-section-divider" />
          <LocaleSelect accountPreference />
        </section>
        <section className="account-section" aria-labelledby="account-security">
          <span className="section-icon">
            <ShieldCheckIcon size={28} aria-hidden />
          </span>
          <h2 id="account-security">{t.security}</h2>
          <p>{t.securityDescription}</p>
          <div className="security-actions">
            <Button
              variant="outline"
              className="auth-button"
              disabled={pending || !capabilities?.emailDelivery}
              onClick={() => {
                void securityAction("reset")
              }}
            >
              <EnvelopeSimpleIcon size={20} aria-hidden />
              {t.sendResetLink}
            </Button>
            {!capabilities?.emailDelivery && capabilities ? (
              <p className="field-hint">{t.emailUnavailable}</p>
            ) : null}
            <Button
              variant="outline"
              className="auth-button"
              disabled={pending}
              onClick={() => {
                void securityAction("other-sessions")
              }}
            >
              <ShieldCheckIcon size={20} aria-hidden />
              {t.signOutAll}
            </Button>
            <Button
              variant="ghost"
              className="auth-button sign-out-button"
              disabled={pending}
              onClick={() => {
                void securityAction("sign-out")
              }}
            >
              <SignOutIcon size={20} aria-hidden />
              {t.signOut}
            </Button>
          </div>
        </section>
      </div>
      <Suspense fallback={<p role="status">{t.loadingAccount}</p>}>
        <OrganizerProfilePanel key={account.user.id} />
      </Suspense>
    </div>
  )
}
