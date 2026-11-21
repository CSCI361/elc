import {
  createEventInvitationSchema,
  eventDetailResponseSchema,
  eventInvitationListSchema,
  eventInvitationMutationSchema,
  eventStaffListSchema,
  eventStaffMutationSchema,
  permissionSchema,
  replaceEventStaffSchema,
  type EventApi,
  type EventInvitation,
  type EventStaff,
  type Permission,
} from "@elc/shared"
import { EnvelopeSimpleIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import {
  EventApiError,
  segment,
  useCommand,
  useResource,
  useServerNow,
} from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Field, SectionLoading } from "@/events/ui"
import { useAccessText, type AccessMessageKey } from "./messages"
import "./access.css"

function Pagination({
  cursor,
  next,
  change,
}: {
  cursor: string
  next: string | null
  change: (value: string) => void
}) {
  const { t } = useAccessText()
  return (
    <div className="event-pagination">
      {cursor ? (
        <button
          type="button"
          className="text-action"
          onClick={() => change("")}
        >
          {t("first")}
        </button>
      ) : null}
      {next ? (
        <button
          type="button"
          className="text-action"
          onClick={() => change(next)}
        >
          {t("more")}
        </button>
      ) : null}
    </div>
  )
}

function StaffForm({
  eventId,
  revision,
  staff,
  onSaved,
  onReload,
}: {
  eventId: string
  revision: number
  staff?: EventStaff
  onSaved: () => void
  onReload: () => void
}) {
  const { t } = useAccessText()
  const { t: eventText } = useEventText()
  const [permissions, setPermissions] = useState<Permission[]>(
    staff?.permissions ?? []
  )
  const command = useCommand()
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = replaceEventStaffSchema.safeParse({
      requestId: "validate",
      expectedRevision: revision,
      email: form.get("email"),
      permissions,
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(eventId)}/staff`,
      eventStaffMutationSchema,
      {
        expectedRevision: revision,
        email: parsed.data.email,
        permissions: parsed.data.permissions,
      },
      "PATCH"
    )
    if (result) onSaved()
  }
  return (
    <form onSubmit={save} className="access-form">
      {command.error instanceof EventApiError &&
      command.error.code === "NOT_FOUND" ? (
        <AuthNotice>{t("staffMissing")}</AuthNotice>
      ) : command.error ? (
        <EventError error={command.error} retry={onReload} />
      ) : null}
      <fieldset disabled={command.pending}>
        <Field
          label={t("email")}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          defaultValue={staff?.email ?? ""}
          readOnly={Boolean(staff)}
        />
        <fieldset className="permission-options">
          <legend>{t("permissions")}</legend>
          {permissionSchema.options.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) =>
                  setPermissions((current) =>
                    event.target.checked
                      ? [...current, permission]
                      : current.filter((value) => value !== permission)
                  )
                }
              />
              <span>{t(permission)}</span>
            </label>
          ))}
        </fieldset>
        {!permissions.length ? (
          <p className="field-hint">{t("revokeHint")}</p>
        ) : null}
        <div className="event-actions">
          <Button type="submit">
            {command.pending ? eventText("loading") : t("save")}
          </Button>
          {permissions.length ? (
            <button
              type="button"
              className="text-action"
              onClick={() => setPermissions([])}
            >
              {t("revokeAll")}
            </button>
          ) : null}
        </div>
      </fieldset>
    </form>
  )
}

function StaffPanel({
  eventId,
  onSaved,
}: {
  eventId: string
  onSaved: () => void
}) {
  const { t } = useAccessText()
  const [cursor, setCursor] = useState("")
  const resource = useResource(
    `/events/${segment(eventId)}/staff?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    eventStaffListSchema
  )
  const reload = () => {
    setCursor("")
    resource.reload()
  }
  if (resource.error)
    return <EventError error={resource.error} retry={reload} />
  if (!resource.data) return <SectionLoading />
  const { data } = resource
  return (
    <section className="event-panel">
      <h2>{t("staff")}</h2>
      <p>{t("staffHint")}</p>
      <p className="field-hint">{t("explicitHint")}</p>
      {!data.items.length ? (
        <EmptyState
          icon={UsersThreeIcon}
          title={t("noStaff")}
          hint={t("noStaffHint")}
          inline
        />
      ) : null}
      <details className="access-new" open={data.items.length === 0}>
        <summary>{t("addStaff")}</summary>
        <StaffForm
          key={`new:${data.revision}`}
          eventId={eventId}
          revision={data.revision}
          onSaved={onSaved}
          onReload={reload}
        />
      </details>
      {data.items.map((staff) => (
        <details
          className="access-record"
          key={`${staff.userId}:${data.revision}`}
        >
          <summary>
            <strong>{staff.name}</strong>
            <span>{staff.email}</span>
            <small>
              {staff.permissions.length
                ? staff.permissions
                    .map((permission) => t(permission))
                    .join(" · ")
                : t("noPermissions")}
            </small>
          </summary>
          <StaffForm
            eventId={eventId}
            revision={data.revision}
            staff={staff}
            onSaved={onSaved}
            onReload={reload}
          />
        </details>
      ))}
      <Pagination cursor={cursor} next={data.nextCursor} change={setCursor} />
    </section>
  )
}

function InvitationRecord({
  invitation,
  eventId,
  revision,
  canInvite,
  onSaved,
  onReload,
}: {
  invitation: EventInvitation
  eventId: string
  revision: number
  canInvite: boolean
  onSaved: (notice: AccessMessageKey) => void
  onReload: () => void
}) {
  const { locale, t } = useAccessText()
  const command = useCommand()
  async function change(action: "reissue" | "revoke") {
    const result = await command.send(
      `/events/${segment(eventId)}/invitations/${segment(invitation.id)}/${action}`,
      eventInvitationMutationSchema,
      { expectedRevision: revision }
    )
    if (result) onSaved(result.deliveryQueued ? "queued" : "revokedNotice")
  }
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  return (
    <article className="invitation-record">
      <strong>{invitation.email}</strong>
      <span className="invitation-state">{t(invitation.state)}</span>
      <p>
        {t(invitation.acceptedAt ? "acceptedOn" : "deadline")}:{" "}
        <time dateTime={invitation.acceptedAt ?? invitation.expiresAt}>
          {date.format(new Date(invitation.acceptedAt ?? invitation.expiresAt))}
        </time>
      </p>
      {command.error ? (
        <EventError error={command.error} retry={onReload} />
      ) : null}
      <div className="event-actions">
        {canInvite && invitation.state !== "revoked" ? (
          <Button
            variant="outline"
            type="button"
            disabled={command.pending}
            onClick={() => void change("reissue")}
          >
            {t("reissue")}
          </Button>
        ) : null}
        {invitation.state === "pending" || invitation.state === "accepted" ? (
          <button
            type="button"
            className="text-action"
            disabled={command.pending}
            onClick={() => void change("revoke")}
          >
            {t("revoke")}
          </button>
        ) : null}
      </div>
    </article>
  )
}

function InvitationsPanel({
  event,
  onSaved,
}: {
  event: EventApi
  onSaved: (notice: AccessMessageKey) => void
}) {
  const { t } = useAccessText()
  const { t: eventText } = useEventText()
  const [cursor, setCursor] = useState("")
  const resource = useResource(
    `/events/${segment(event.id)}/invitations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    eventInvitationListSchema
  )
  const command = useCommand()
  const now = useServerNow()
  const canInvite =
    event.visibility === "private" &&
    !event.cancelledAt &&
    !event.suspendedAt &&
    Date.parse(event.endsAt) > now
  const reload = () => {
    setCursor("")
    resource.reload()
  }
  async function create(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    if (!resource.data) return
    const parsed = createEventInvitationSchema.safeParse({
      requestId: "validate",
      expectedRevision: resource.data.revision,
      email: new FormData(submission.currentTarget).get("email"),
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(event.id)}/invitations`,
      eventInvitationMutationSchema,
      {
        expectedRevision: parsed.data.expectedRevision,
        email: parsed.data.email,
      }
    )
    if (result) onSaved("queued")
  }
  if (resource.error)
    return <EventError error={resource.error} retry={reload} />
  if (!resource.data) return <SectionLoading />
  return (
    <section className="event-panel">
      <h2>{t("invitations")}</h2>
      <p>{t("invitationHint")}</p>
      {!canInvite ? (
        <p className="event-inline-note">{t("privateOnly")}</p>
      ) : (
        <>
          {event.publicationState !== "published" ? (
            <p className="field-hint">{t("publishFirst")}</p>
          ) : null}
          <form onSubmit={create} className="access-form">
            <fieldset disabled={command.pending}>
              <Field
                label={t("email")}
                name="email"
                type="email"
                required
                maxLength={254}
              />
              <Button type="submit">
                {command.pending ? eventText("loading") : t("invite")}
              </Button>
            </fieldset>
          </form>
        </>
      )}
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      <p className="field-hint">{t("reissueHint")}</p>
      {!resource.data.items.length ? (
        <EmptyState
          icon={EnvelopeSimpleIcon}
          title={t("noInvitations")}
          inline
        />
      ) : null}
      {resource.data.items.map((invitation) => (
        <InvitationRecord
          key={`${invitation.id}:${resource.data!.revision}`}
          invitation={invitation}
          eventId={event.id}
          revision={resource.data!.revision}
          canInvite={canInvite}
          onSaved={onSaved}
          onReload={reload}
        />
      ))}
      <Pagination
        cursor={cursor}
        next={resource.data.nextCursor}
        change={setCursor}
      />
    </section>
  )
}

export function EventAccessPage({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  const { t } = useAccessText()
  const { t: eventText } = useEventText()
  const detail = useResource(
    `/events/${segment(eventId)}/preview`,
    eventDetailResponseSchema
  )
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<AccessMessageKey | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (notice) statusRef.current?.focus()
  }, [notice, version])
  const saved = (message: AccessMessageKey) => {
    setNotice(message)
    setVersion((value) => value + 1)
  }
  if (detail.error)
    return <EventError error={detail.error} retry={detail.reload} />
  if (!detail.data)
    return (
      <div className="events-page access-page">
        <h1>{t("title")}</h1>
        <SectionLoading rows={3} />
      </div>
    )
  if (detail.data.event.organizerId !== account?.user.id)
    return <AuthNotice>{t("ownerOnly")}</AuthNotice>
  return (
    <div className="events-page access-page">
      <div className="event-page-heading">
        <div>
          <h1>{t("title")}</h1>
        </div>
        <button
          type="button"
          className="text-action"
          onClick={() => {
            setNotice(null)
            detail.reload()
            setVersion((value) => value + 1)
          }}
        >
          {eventText("reload")}
        </button>
      </div>
      {notice ? (
        <p
          className="access-success"
          role="status"
          tabIndex={-1}
          ref={statusRef}
        >
          {t(notice)}
        </p>
      ) : null}
      <div className="access-grid">
        <StaffPanel
          key={`staff:${version}`}
          eventId={eventId}
          onSaved={() => saved("saved")}
        />
        <InvitationsPanel
          key={`invitations:${version}`}
          event={detail.data.event}
          onSaved={saved}
        />
      </div>
    </div>
  )
}
