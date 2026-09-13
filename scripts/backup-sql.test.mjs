import assert from "node:assert/strict"
import test from "node:test"
import { prepareRestoreStatements } from "./lib/backup-sql.mjs"

await test("orders table creation and final rows ahead of transition guards", () => {
  const statements = prepareRestoreStatements(`PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE child(id TEXT REFERENCES parent(id));
INSERT INTO child VALUES('a;semicolon');
CREATE TRIGGER guard BEFORE INSERT ON child BEGIN SELECT RAISE(ABORT,'transition only'); END;
CREATE TABLE parent(id TEXT PRIMARY KEY);
INSERT INTO parent VALUES('a;semicolon');
CREATE UNIQUE INDEX unique_child ON child(id);`)
  assert.equal(statements.length, 7)
  assert.match(statements[1], /^CREATE TABLE child/)
  assert.match(statements[2], /^CREATE TABLE parent/)
  assert.match(statements[3], /^INSERT INTO child/)
  assert.match(statements[4], /^INSERT INTO parent/)
  assert.match(statements[5], /^CREATE UNIQUE INDEX/)
  assert.match(statements[6], /^CREATE TRIGGER guard/)
  assert.ok(statements[3].includes("a;semicolon"))
})
for (const sql of [
  "DROP TABLE users;",
  "DELETE FROM users;",
  "UPDATE users SET name='changed';",
  "PRAGMA foreign_keys=OFF;",
  "INSERT INTO users VALUES('x');",
]) {
  await test(`rejects unsupported restore SQL: ${sql}`, () =>
    assert.throws(() => prepareRestoreStatements(sql)))
}
