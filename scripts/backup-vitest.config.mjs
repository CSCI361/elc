export default {
  test: {
    include: ["scripts/backup-rehearsal.test.ts"],
    testTimeout: 90000,
    hookTimeout: 90000,
    maxWorkers: 1,
  },
}
