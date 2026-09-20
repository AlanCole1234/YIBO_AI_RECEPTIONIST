import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("atomically protects SQLite historical, pending and failed routes in versioned and unversioned saves", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/sqlite-booked-calendar-routes.ts"], { encoding: "utf8", cwd: process.cwd() });
  expect(JSON.parse(output.trim())).toEqual({ passed: true });
});
