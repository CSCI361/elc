import { useId, useRef, useState, type KeyboardEvent } from "react"
import { useEventText } from "./messages"
import { money, type Seat } from "./policies"

export function SeatMap({
  seats,
  selected,
  onSelect,
  disabled = false,
  admin = false,
}: {
  seats: readonly Seat[]
  selected: readonly string[]
  onSelect: (seat: Seat) => void
  disabled?: boolean
  admin?: boolean
}) {
  const { t, locale } = useEventText()
  const helpId = useId()
  const titleId = useId()
  const refs = useRef(new Map<string, SVGGElement>())
  const [focusId, setFocusId] = useState<string | null>(null)
  const sections = [...new Set(seats.map((seat) => seat.section))]
  const rows = [...new Set(seats.map((seat) => seat.row))]
  function keyDown(event: KeyboardEvent<SVGGElement>, seat: Seat) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      activate(seat)
      return
    }
    const index = seats.findIndex((value) => value.id === seat.id)
    let target: Seat | undefined
    if (event.key === "ArrowRight") target = seats[(index + 1) % seats.length]
    if (event.key === "ArrowLeft")
      target = seats[(index - 1 + seats.length) % seats.length]
    if (event.key === "ArrowDown" || event.key === "ArrowUp")
      target = seats.find(
        (value) =>
          value.section === seat.section &&
          value.number === seat.number &&
          rows.indexOf(value.row) ===
            rows.indexOf(seat.row) + (event.key === "ArrowDown" ? 1 : -1)
      )
    if (event.key === "Home") target = seats[0]
    if (event.key === "End") target = seats.at(-1)
    if (target) {
      event.preventDefault()
      setFocusId(target.id)
      refs.current.get(target.id)?.focus()
    }
  }
  function unavailable(seat: Seat) {
    return (
      disabled ||
      (admin
        ? seat.state === "held" || seat.state === "sold"
        : seat.state !== "available" || !seat.enabled || !seat.ticketTypeId)
    )
  }
  function activate(seat: Seat) {
    if (!unavailable(seat)) onSelect(seat)
  }
  return (
    <section className="seat-picker" aria-labelledby={titleId}>
      <h3 id={titleId}>{t("seatMap")}</h3>
      <p id={helpId}>{t(admin ? "seatAdmin" : "seatHelp")}</p>
      <div className="seat-legend">
        {(
          ["available", "selected", "held", "sold", "unavailable"] as const
        ).map((state) => (
          <span key={state}>
            <i data-state={state} />
            {t(state)}
          </span>
        ))}
      </div>
      <div className="seat-map-scroll">
        <svg
          className="seat-map"
          viewBox={`0 0 ${sections.length * 340 + 24} ${rows.length * 42 + 132}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={helpId}
        >
          <rect
            className="stage"
            x="30"
            y="4"
            width={sections.length * 340 - 36}
            height="30"
            rx="5"
          />
          <text x={sections.length * 170 + 12} y="24" textAnchor="middle">
            {t("stage")}
          </text>
          {sections.map((section, sectionIndex) => (
            <text
              className="seat-section-label"
              key={section}
              x={sectionIndex * 340 + 178}
              y="62"
              textAnchor="middle"
            >
              {section}
            </text>
          ))}
          {seats.map((seat) => {
            const x =
              sections.indexOf(seat.section) * 340 +
              (Number(seat.number) - 1) * 38 +
              46
            const y = rows.indexOf(seat.row) * 42 + 100
            const state = selected.includes(seat.id) ? "selected" : seat.state
            const label = `${seat.section}, ${t("row")} ${seat.row}, ${t("seat")} ${seat.number}, ${t(state)}, ${seat.priceMinor === null ? "" : money(seat.priceMinor, locale)}${seat.accessible ? `, ${t("accessible")}` : ""}`
            return (
              <g
                key={seat.id}
                ref={(node) => {
                  if (node) refs.current.set(seat.id, node)
                  else refs.current.delete(seat.id)
                }}
                role="button"
                aria-label={label}
                aria-pressed={selected.includes(seat.id)}
                aria-disabled={unavailable(seat)}
                tabIndex={(focusId ?? seats[0]?.id) === seat.id ? 0 : -1}
                data-state={state}
                data-seat-id={seat.id}
                onFocus={() => setFocusId(seat.id)}
                onClick={() => activate(seat)}
                onKeyDown={(event) => keyDown(event, seat)}
              >
                <rect x={x - 15} y={y - 17} width="30" height="32" rx="7" />
                <text x={x} y={y + 4} textAnchor="middle">
                  {seat.row}
                  {seat.number}
                </text>
                {seat.accessible ? (
                  <circle
                    cx={x + 12}
                    cy={y - 14}
                    r="4"
                    className="accessible-dot"
                  />
                ) : null}
                <title>{label}</title>
              </g>
            )
          })}
        </svg>
      </div>
      <p className="selection-count" role="status">
        {t("selected")}: {selected.length}
        {selected.length
          ? ` · ${seats
              .filter((seat) => selected.includes(seat.id))
              .map((seat) => `${seat.section} ${seat.row}${seat.number}`)
              .join(", ")}`
          : ""}
      </p>
    </section>
  )
}
