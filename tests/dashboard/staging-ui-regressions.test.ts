import { readFileSync } from "node:fs";
import ts from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Customer, type api } from "../../dashboard/src/services/api.js";
import * as unsavedChanges from "../../dashboard/src/services/unsaved-changes.js";
import { messages } from "../../dashboard/src/i18n.js";
import { appointmentErrorMessage } from "../../dashboard/src/services/appointment-editor.js";
import { DefaultCustomerService, InMemoryCustomerRepository } from "../../src/modules/customers/index.js";

// Execute the actual SFC setup handlers, without mounting unrelated panels or
// starting network/lifecycle work. No handler is copied into the tests.
function setup<T>(file: string, modules: Record<string, unknown>): T {
  const { descriptor } = parse(readFileSync(new URL(`../../dashboard/src/${file}`, import.meta.url), "utf8"));
  const script = compileScript(descriptor, { id: file });
  const javascript = ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { default?: { setup: (props: object, context: object) => T } } };
  const require = (name: string): unknown => {
    if (name === "vue") return { ...vue, onMounted() {}, onUnmounted() {}, provide() {} };
    if (name in modules) return modules[name];
    if (name.endsWith(".vue")) return {};
    throw new Error(`Unexpected setup dependency: ${name}`);
  };
  new Function("require", "module", "exports", javascript)(require, module, module.exports);
  return module.exports.default!.setup({}, { expose() {} });
}

afterEach(() => vi.unstubAllGlobals());

type AppState = {
  connectGoogleCalendar: () => Promise<void>;
  busy: vue.Ref<boolean>;
  globalError: vue.Ref<string>;
  leaveGuard: ReturnType<typeof unsavedChanges.createUnsavedChanges>;
};
function connectFixture() {
  const origin = "https://staging.example.test";
  const target = "https://accounts.google.com/o/oauth2/v2/auth?synthetic-test";
  const client = { googleCalendarConnect: vi.fn(async () => ({ url: target })) };
  const beforeUnload = { preventDefault: vi.fn(), returnValue: undefined };
  let app: AppState;
  const window = { confirm: vi.fn(() => false), alert: vi.fn(), location: { origin, assign: vi.fn(() => {
    app.leaveGuard.beforeUnload(beforeUnload as unknown as BeforeUnloadEvent);
  }) } };
  vi.stubGlobal("window", window);
  app = setup<AppState>("App.vue", {
    "./services/api": { api: client, ApiError },
    "./services/admin-session": { createAdminSession: () => ({ state: {} }) },
    "./services/unsaved-changes": unsavedChanges,
    "./i18n": { messages },
  });
  return { app, client, window, beforeUnload, origin, target };
}

describe("staging Google Connect navigation", () => {
  it("finishes the busy request before navigation so the real leave guard does not cancel OAuth", async () => {
    const { app, client, window, beforeUnload, origin, target } = connectFixture();
    await app.connectGoogleCalendar();
    expect(client.googleCalendarConnect).toHaveBeenCalledWith(origin);
    expect(window.location.assign).toHaveBeenCalledOnce();
    expect(window.location.assign).toHaveBeenCalledWith(target);
    expect(beforeUnload.preventDefault).not.toHaveBeenCalled();
    expect(app.busy.value).toBe(false);
  });
  it("still protects a pending request and ignores a second Connect click", async () => {
    const { app, client, window, target } = connectFixture();
    let resolve!: (value: { url: string }) => void;
    client.googleCalendarConnect.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = app.connectGoogleCalendar();
    const closing = { preventDefault: vi.fn(), returnValue: undefined };
    app.leaveGuard.beforeUnload(closing as unknown as BeforeUnloadEvent);
    expect(closing.preventDefault).toHaveBeenCalledOnce();
    await app.connectGoogleCalendar();
    expect(client.googleCalendarConnect).toHaveBeenCalledOnce();
    expect(window.location.assign).not.toHaveBeenCalled();
    resolve({ url: target }); await pending;
    expect(window.location.assign).toHaveBeenCalledOnce();
    expect(app.busy.value).toBe(false);
  });
  it("shows a failed Connect request without navigating", async () => {
    const { app, client, window } = connectFixture();
    client.googleCalendarConnect.mockRejectedValueOnce(new ApiError("GOOGLE_CONFIGURATION_REQUIRED", 409));
    await app.connectGoogleCalendar();
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(app.globalError.value).toContain("GOOGLE_CONFIGURATION_REQUIRED");
    expect(app.busy.value).toBe(false);
  });
  it("preserves an editor when the owner declines discarding unsaved changes", async () => {
    const { app, client, window } = connectFixture();
    app.leaveGuard.register({ dirty: () => true, busy: () => false });
    await app.connectGoogleCalendar();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(client.googleCalendarConnect).not.toHaveBeenCalled();
  });
});

type OfficeState = {
  customerDraft: vue.Ref<{ name: string; phone: string; email: string; preferredLanguage: string; emailOptIn: boolean }>;
  customer: vue.Ref<Customer | undefined>;
  saveCustomer: () => Promise<void>;
  error: vue.Ref<string>;
};
function officeFixture() {
  const service = new DefaultCustomerService(new InMemoryCustomerRepository(), () => "synthetic-customer");
  const client = {
    findOrCreateCustomer: vi.fn(async (input: Parameters<typeof api.findOrCreateCustomer>[0]) => {
      const result = await service.findOrCreateByPhone({ ...input, tenantId: "synthetic-tenant" });
      if (!result.ok) throw new ApiError(result.error.code, 400);
      return result.value;
    }),
    customerHistory: vi.fn(async () => ({ appointments: [] })),
  };
  const office = setup<OfficeState>("components/OfficeWorkspace.vue", {
    "../services/api": { api: client, ApiError }, "../services/appointment-editor": { appointmentErrorMessage },
  });
  office.customerDraft.value = { name: "Synthetic acceptance", phone: "+1 (202) 555-0183", email: "", preferredLanguage: "en", emailOptIn: false };
  return { office, client };
}

describe("office quick booking optional email", () => {
  it.each(["", "   "])("selects a customer with a blank optional email (%j) through existing validation", async email => {
    const { office, client } = officeFixture(); office.customerDraft.value.email = email;
    await office.saveCustomer();
    expect(client.findOrCreateCustomer.mock.calls[0]![0]).not.toHaveProperty("email");
    expect(office.customer.value).toMatchObject({ id: "synthetic-customer", phone: "+12025550183", emailOptIn: false });
    expect(office.customer.value).not.toHaveProperty("email");
    expect(office.error.value).toBe("");
  });
  it("preserves a supplied email, language and opt-out through the existing customer service", async () => {
    const { office } = officeFixture(); office.customerDraft.value.email = " guest@example.test ";
    await office.saveCustomer();
    expect(office.customer.value).toMatchObject({ email: "guest@example.test", preferredLanguage: "en", emailOptIn: false });
  });
  it("shows invalid customer input instead of silently rejecting the form", async () => {
    const { office, client } = officeFixture(); office.customerDraft.value.phone = "invalid";
    await expect(office.saveCustomer()).resolves.toBeUndefined();
    expect(office.customer.value).toBeUndefined();
    expect(client.customerHistory).not.toHaveBeenCalled();
    expect(office.error.value).toMatch(/phone|email/i);
  });
});
