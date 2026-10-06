import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("booking compensation ownership", () => {
  it("does not delete a recovered and rescheduled event after losing the confirmation fence", () => {
    expect(run("confirmation")).toEqual({
      staleCode: "APPOINTMENT_VERSION_CONFLICT", status: "CONFIRMED",
      startAt: "2030-08-10T17:00:00.000Z", eventCount: 1, deletes: 0,
    });
  });

  it("does not roll back a newer event when the stale caller hangs up after linking it", () => {
    expect(run("hangup")).toEqual({
      staleCode: "APPOINTMENT_VERSION_CONFLICT", status: "CONFIRMED",
      startAt: "2030-08-10T17:00:00.000Z", eventCount: 1, deletes: 0,
    });
  });

  it("keeps the durable compensation flag and skips deletion if the fence is lost during inspection", () => {
    expect(run("inspection")).toEqual({
      staleCode: "APPOINTMENT_VERSION_CONFLICT", status: "PENDING_CONFIRMATION",
      compensationRequired: true, eventCount: 1, deletes: 0,
    });
  });

  it("does not refresh the inspected ETag when the event changes before compensation", () => {
    expect(run("etag")).toEqual({
      staleCode: "CALENDAR_SYNC_FAILED", status: "PENDING_CONFIRMATION",
      compensationRequired: true, eventCount: 1, deletes: 0,
    });
  });
});

function run(scenario: string) {
  const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/sqlite-stale-compensation.ts", scenario], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
  });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}
