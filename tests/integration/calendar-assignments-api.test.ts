import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { BusinessCalendarAssignmentResolver } from "../../src/modules/integrations/calendar/business-calendar-assignment-resolver.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("calendar assignments API", () => {
  it("uses the location default, lets a professional override it, and restores fallback", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);
    const resolver = new BusinessCalendarAssignmentResolver(app.business);

    const defaultCalendar = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { calendarId: "branch@example.com" },
    });
    expect(defaultCalendar.statusCode).toBe(200);
    expect(defaultCalendar.json()).toMatchObject({ version: 2, defaultCalendarId: "branch@example.com" });
    await expect(resolver.resolve({
      tenantId: app.tenantId, locationId: "default", employeeId: "employee-1",
    })).resolves.toMatchObject({ ok: true, value: { calendarId: "branch@example.com", source: "location" } });

    const override = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/employee-1/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"2"' },
      payload: { calendarId: "professional@example.com" },
    });
    expect(override.statusCode).toBe(200);
    expect(override.json()).toMatchObject({
      version: 3,
      professionals: expect.arrayContaining([expect.objectContaining({
        professionalId: "employee-1", calendarId: "professional@example.com",
        effectiveCalendarId: "professional@example.com", source: "professional",
      })]),
    });
    await expect(resolver.resolve({
      tenantId: app.tenantId, locationId: "default", employeeId: "employee-1",
    })).resolves.toMatchObject({ ok: true, value: { calendarId: "professional@example.com", source: "professional" } });

    const fallback = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/employee-1/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"3"' },
      payload: { calendarId: null },
    });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json()).toMatchObject({ version: 4 });
    expect(fallback.json().professionals).toEqual(expect.arrayContaining([
      expect.objectContaining({ professionalId: "employee-1", effectiveCalendarId: "branch@example.com", source: "location" }),
    ]));
  });

  it("requires tenant_admin, valid IDs, existing assignments and fresh versions", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);

    expect((await server.inject({ method: "GET", url: "/api/admin/locations/default/calendars" })).statusCode).toBe(401);
    const invalid = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' }, payload: { calendarId: "bad id" },
    });
    expect(invalid.statusCode).toBe(400);
    const missing = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/missing/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' }, payload: { calendarId: "valid@example.com" },
    });
    expect(missing.statusCode).toBe(404);
    const first = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' }, payload: { calendarId: "valid@example.com" },
    });
    expect(first.statusCode).toBe(200);
    const stale = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/calendar",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' }, payload: { calendarId: null },
    });
    expect(stale.statusCode).toBe(409);
  });
});
