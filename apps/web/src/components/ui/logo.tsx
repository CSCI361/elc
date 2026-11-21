export function Logo({ className = "brand-logo" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 47 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.6 15H14.4A6.4 6.4 0 1 0 12.53 19.53" />
        <path d="M20.5 2.6V21.4" />
        <path d="M37.03 10.47A6.4 6.4 0 1 0 37.03 19.53" />
      </g>
      <circle cx="43.4" cy="19.6" r="2.4" fill="var(--brand)" />
    </svg>
  )
}
