import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EnvelopeSimpleIcon,
  GoogleLogoIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { authClient } from "./client"
import { useAccount } from "./context"
import { authErrorMessage, type AuthErrorKey } from "./errors"
import { AuthField, PasswordField } from "./field"
import { authHref, type readAuthRoute } from "./navigation"
import { AuthNotice } from "./notice"

type Route = ReturnType<typeof readAuthRoute>

export function AuthPage({ route }: { route: Route }) {
  const {
    messages: t,
    locale,
    status,
    capabilities,
    capabilitiesFailed,
    refresh,
  } = useAccount()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [pending, setPending] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [notice, setNotice] = useState<{
    key: AuthErrorKey
    tone: "error" | "success"
  } | null>(() =>
    route.hasError
      ? {
          key:
            route.mode === "reset-password"
              ? "resetInvalid"
              : route.mode === "verified"
                ? "verificationInvalid"
                : "errorGoogle",
          tone: "error",
        }
      : route.passwordReset
        ? { key: "passwordReset", tone: "success" }
        : null
  )
  const mode = registered ? "verify-email" : (route.mode ?? "sign-in")
  const credentialsMode = mode === "sign-in" || mode === "sign-up"
  const emailRequired = mode !== "reset-password" && mode !== "verified"
  const passwordRequired = credentialsMode || mode === "reset-password"
  const deliveryRequired =
    mode === "sign-up" || mode === "verify-email" || mode === "forgot-password"
  const submitDisabled =
    pending ||
    !capabilities?.emailAndPassword ||
    (deliveryRequired && !capabilities.emailDelivery)

  const titles = {
    "sign-in": t.signInTitle,
    "sign-up": t.signUpTitle,
    "verify-email": t.verificationTitle,
    "forgot-password": t.forgotTitle,
    "reset-password": t.resetTitle,
    verified: route.hasError ? t.verificationTitle : t.verifiedTitle,
  }
  const descriptions = {
    "sign-in": t.signInDescription,
    "sign-up": t.signUpDescription,
    "verify-email": registered
      ? t.verificationDescription
      : t.resendDescription,
    "forgot-password": t.forgotDescription,
    "reset-password": t.resetDescription,
    verified: route.hasError ? t.resendDescription : t.verifiedDescription,
  }
  const actions = {
    "sign-in": t.signIn,
    "sign-up": t.signUp,
    "verify-email": t.resendVerification,
    "forgot-password": t.sendResetLink,
    "reset-password": t.resetPassword,
    verified: t.signIn,
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || submitDisabled) return
    setNotice(null)
    if (
      (mode === "sign-up" || mode === "reset-password") &&
      password !== confirmation
    ) {
      setNotice({ key: "errorPasswordMismatch", tone: "error" })
      return
    }
    if (passwordRequired && (password.length < 8 || password.length > 128)) {
      setNotice({ key: "errorPasswordLength", tone: "error" })
      return
    }
    setPending(true)
    const fetchOptions = { headers: { "Accept-Language": locale } }
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password, fetchOptions })
          : mode === "sign-up"
            ? await authClient.signUp.email({
                email,
                password,
                name,
                callbackURL: `${window.location.origin}${authHref("verified", route.returnTo)}`,
                fetchOptions,
              })
            : mode === "verify-email"
              ? await authClient.sendVerificationEmail({
                  email,
                  callbackURL: `${window.location.origin}${authHref("verified", route.returnTo)}`,
                  fetchOptions,
                })
              : mode === "forgot-password"
                ? await authClient.requestPasswordReset({
                    email,
                    redirectTo: `${window.location.origin}/auth/reset-password`,
                    fetchOptions,
                  })
                : await authClient.resetPassword({
                    newPassword: password,
                    token: route.resetToken ?? "",
                    fetchOptions,
                  })
      if (result.error) {
        setNotice({ key: authErrorMessage(result.error), tone: "error" })
        return
      }
      if (mode === "sign-in") {
        window.location.assign(route.returnTo)
      } else if (mode === "sign-up") {
        setRegistered(true)
        setPassword("")
        setConfirmation("")
        setNotice({ key: "verificationSent", tone: "success" })
      } else if (mode === "reset-password") {
        setPassword("")
        setConfirmation("")
        window.location.replace("/auth/sign-in?notice=password-reset")
      } else {
        setNotice({
          key: mode === "verify-email" ? "verificationSent" : "resetSent",
          tone: "success",
        })
      }
    } catch {
      setNotice({ key: "errorNetwork", tone: "error" })
    } finally {
      setPending(false)
    }
  }

  async function googleSignIn() {
    if (pending || !capabilities?.google) return
    setNotice(null)
    setPending(true)
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}${route.returnTo}`,
        errorCallbackURL: `${window.location.origin}/auth/sign-in`,
      })
      if (result.error)
        setNotice({ key: authErrorMessage(result.error), tone: "error" })
    } catch {
      setNotice({ key: "errorGoogle", tone: "error" })
    } finally {
      setPending(false)
    }
  }

  if (status === "active" && credentialsMode)
    return (
      <section className="auth-card auth-complete">
        <span className="status-icon">
          <ShieldCheckIcon size={32} aria-hidden />
        </span>
        <h1>{t.alreadySignedIn}</h1>
        <p>{t.privacyNote}</p>
        <a className="primary-link" href={route.returnTo}>
          {t.continueToAccount}
          <ArrowRightIcon size={20} aria-hidden />
        </a>
      </section>
    )

  const missingResetToken =
    mode === "reset-password" &&
    (!route.resetToken || route.hasError || notice?.key === "resetInvalid")

  return (
    <section className="auth-card">
      {!credentialsMode ? (
        <a className="back-link" href={authHref("sign-in", route.returnTo)}>
          <ArrowLeftIcon size={17} aria-hidden />
          {t.backToSignIn}
        </a>
      ) : null}
      {!credentialsMode ? (
        <span className="status-icon">
          {mode === "verified" && !route.hasError ? (
            <ShieldCheckIcon size={30} aria-hidden />
          ) : (
            <EnvelopeSimpleIcon size={30} aria-hidden />
          )}
        </span>
      ) : null}
      <div className="auth-heading">
        <h1>{titles[mode]}</h1>
        <p>{descriptions[mode]}</p>
      </div>
      {notice ? (
        <AuthNotice tone={notice.tone}>{t[notice.key]}</AuthNotice>
      ) : null}
      {capabilitiesFailed ? (
        <AuthNotice>
          {t.errorNetwork}{" "}
          <button className="text-action" onClick={refresh}>
            {t.retry}
          </button>
        </AuthNotice>
      ) : null}
      {missingResetToken && !notice ? (
        <AuthNotice>{t.resetInvalid}</AuthNotice>
      ) : null}
      {deliveryRequired && capabilities && !capabilities.emailDelivery ? (
        <AuthNotice>{t.emailUnavailable}</AuthNotice>
      ) : null}

      {credentialsMode ? (
        <div className="social-auth">
          <Button
            className="auth-button google-button"
            variant="outline"
            onClick={googleSignIn}
            disabled={pending || !capabilities?.google}
            aria-describedby={
              capabilities && !capabilities.google
                ? "google-availability"
                : undefined
            }
          >
            <GoogleLogoIcon size={22} weight="bold" aria-hidden />
            {t.continueGoogle}
          </Button>
          {capabilities && !capabilities.google ? (
            <p id="google-availability" className="field-hint">
              {t.googleUnavailable}
            </p>
          ) : null}
          <div className="auth-divider">
            <span>{t.orEmail}</span>
          </div>
        </div>
      ) : null}

      {mode === "verified" ? (
        <a
          className="primary-link"
          href={authHref(
            route.hasError ? "verify-email" : "sign-in",
            route.returnTo
          )}
        >
          {route.hasError ? t.resendVerification : t.signIn}
          <ArrowRightIcon size={20} aria-hidden />
        </a>
      ) : missingResetToken ? (
        <a className="primary-link" href="/auth/forgot-password">
          {t.sendResetLink}
          <ArrowRightIcon size={20} aria-hidden />
        </a>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            {mode === "sign-up" ? (
              <AuthField
                id="auth-name"
                name="name"
                label={t.fullName}
                autoComplete="name"
                maxLength={200}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            ) : null}
            {emailRequired ? (
              <AuthField
                id="auth-email"
                name="email"
                label={t.email}
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            ) : null}
            {passwordRequired ? (
              <PasswordField
                id="auth-password"
                name="password"
                label={mode === "reset-password" ? t.newPassword : t.password}
                hint={mode === "sign-in" ? undefined : t.passwordHint}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            ) : null}
            {mode === "sign-up" || mode === "reset-password" ? (
              <PasswordField
                id="auth-confirmation"
                name="confirmPassword"
                label={t.confirmPassword}
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            ) : null}
            {mode === "sign-in" ? (
              <div className="forgot-link">
                <a href="/auth/forgot-password">{t.forgotPassword}</a>
              </div>
            ) : null}
            <Button
              type="submit"
              className="auth-button"
              disabled={submitDisabled}
            >
              {pending ? t.pending : actions[mode]}
              <ArrowRightIcon size={20} aria-hidden />
            </Button>
          </fieldset>
        </form>
      )}

      {mode === "sign-in" && notice?.key === "errorUnverified" ? (
        <a
          className="verification-link"
          href={authHref("verify-email", route.returnTo)}
        >
          {t.resendVerification}
        </a>
      ) : null}
      {credentialsMode ? (
        <p className="auth-switch">
          {mode === "sign-in" ? t.noAccount : t.haveAccount}{" "}
          <a
            href={authHref(
              mode === "sign-in" ? "sign-up" : "sign-in",
              route.returnTo
            )}
          >
            {mode === "sign-in" ? t.signUp : t.signIn}
          </a>
        </p>
      ) : null}
    </section>
  )
}
