export default {
  test: {
    include: ["scripts/backup-rehearsal.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
}
