import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("isolates identical appointment/customer/idempotency IDs across regions, tenants and locations", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/sqlite-security-isolation.ts"], {
    encoding: "utf8", cwd: process.cwd(),
  });
  expect(output.trim()).toBe("regional tenant location isolation verified");
});
