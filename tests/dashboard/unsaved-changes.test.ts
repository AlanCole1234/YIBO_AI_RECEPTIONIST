import { describe, expect, it, vi } from "vitest";
import { createUnsavedChanges } from "../../dashboard/src/services/unsaved-changes.js";

describe("UI-009 leave protection", () => {
  it("leaves clean editors without asking", () => {
    const ask = vi.fn(); const guard = createUnsavedChanges(ask, vi.fn());
    guard.register({ dirty: () => false, busy: () => false });
    expect(guard.allowLeave()).toBe(true); expect(ask).not.toHaveBeenCalled();
  });
  it.each([false, true])("honors discard confirmation %s without changing the draft", choice => {
    const draft = { name: "Unsaved clinic" }; const ask = vi.fn(() => choice);
    const guard = createUnsavedChanges(ask, vi.fn());
    guard.register({ dirty: () => Boolean(draft.name), busy: () => false });
    expect(guard.allowLeave()).toBe(choice); expect(ask).toHaveBeenCalledTimes(1);
    expect(draft.name).toBe("Unsaved clinic");
  });
  it("blocks leaving during a save, even if discard would be accepted", () => {
    const ask = vi.fn(() => true); const notify = vi.fn(); const guard = createUnsavedChanges(ask, notify);
    guard.register({ dirty: () => true, busy: () => true });
    expect(guard.allowLeave()).toBe(false); expect(ask).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledOnce();
  });
  it("warns for tab close/reload while dirty or busy and releases after saving", () => {
    let dirty = true; let busy = false; const guard = createUnsavedChanges(vi.fn(), vi.fn());
    guard.register({ dirty: () => dirty, busy: () => busy });
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    guard.beforeUnload(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.returnValue).toBe("");
    dirty = false; busy = true; guard.beforeUnload(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    busy = false; guard.beforeUnload(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });
  it("unregisters destroyed editors so they do not block later navigation", () => {
    const guard = createUnsavedChanges(() => false, vi.fn());
    const remove = guard.register({ dirty: () => true, busy: () => false });
    expect(guard.allowLeave()).toBe(false); remove(); expect(guard.allowLeave()).toBe(true);
  });
});
