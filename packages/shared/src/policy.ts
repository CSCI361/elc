/** Academic-release defaults recorded in docs/architecture-decisions.md. */
export const policy = Object.freeze({
  currency: "KZT" as const,
  currencyMinorUnitScale: 2,
  defaultLocale: "kk" as const,
  defaultTimeZone: "Asia/Almaty",
  activationFeeMinor: 500_000,
  processingFeeBasisPoints: 300,
  reservationDurationMs: 10 * 60 * 1_000,
  defaultTicketsPerOrder: 6,
  payoutDelayMs: 7 * 24 * 60 * 60 * 1_000,
  privateInvitationLifetimeMs: 7 * 24 * 60 * 60 * 1_000,
  defaultCampaignPercent: 10,
  defaultCampaignRedemptionLimit: 100,
  offlineSnapshotLifetimeMs: 4 * 60 * 60 * 1_000,
  offlineEventEndGraceMs: 2 * 60 * 60 * 1_000,
  acknowledgedScanRetentionMs: 24 * 60 * 60 * 1_000,
  unsynchronizedScanRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  supportFileMaxBytes: 5 * 1_024 * 1_024,
  supportFilesPerMessage: 3,
  defaultReportDays: 30,
  maxReportDays: 180,
  historyRetentionDays: 180,
  logsAndBackupsRetentionDays: 30,
})

export const supportedLocales = ["kk", "ru", "en"] as const
export const supportMimeTypes = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const

export const demoVenue = Object.freeze({
  id: "elc-demo-hall",
  capacity: 80,
  sections: [
    { id: "premium", name: "Premium", priceMinor: 500_000 },
    { id: "standard", name: "Standard", priceMinor: 300_000 },
  ],
  rows: ["A", "B", "C", "D", "E"],
  seatsPerRow: 8,
  accessibleSeatLabels: ["A1", "A8"],
})
