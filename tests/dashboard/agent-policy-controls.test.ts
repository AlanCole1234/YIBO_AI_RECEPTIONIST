import { describe, expect, it } from "vitest";
import { buildApplication } from "../../src/bootstrap/index.js";
import {
  prioritizeCollectionField,
  setConfirmationRequired,
  setToolEnabled,
} from "../../dashboard/src/services/agent-policy-controls.js";
import type { AgentConfiguration } from "../../dashboard/src/services/api.js";

async function configuration(): Promise<AgentConfiguration> {
  const app = buildApplication();
  return structuredClone(await app.agentConfiguration.get(app.tenantId)) as unknown as AgentConfiguration;
}

describe("dashboard agent policy controls", () => {
  it("keeps global and channel tools aligned and cleans dependent policies", async () => {
    const value = await configuration();
    value.toolPolicies.limits.perTool.create_appointment = 3;
    setConfirmationRequired(value, "create_appointment", true);

    setToolEnabled(value, "create_appointment", "mutate", false);

    expect(value.enabledTools).not.toContain("create_appointment");
    expect(value.toolPolicies.channels.phone.enabledTools).not.toContain("create_appointment");
    expect(value.toolPolicies.channels.voice_lab.enabledTools).not.toContain("create_appointment");
    expect(value.toolPolicies.confirmations.requiredFor).not.toContain("create_appointment");
    expect(value.toolPolicies.limits.perTool).not.toHaveProperty("create_appointment");
  });

  it("turns off parallel execution when enabling a mutation", async () => {
    const value = await configuration();
    setToolEnabled(value, "create_appointment", "mutate", false);
    value.toolPolicies.channels.phone.parallelToolCalls = true;
    value.toolPolicies.channels.voice_lab.parallelToolCalls = true;

    setToolEnabled(value, "create_appointment", "mutate", true);

    expect(value.toolPolicies.channels.phone.parallelToolCalls).toBe(false);
    expect(value.toolPolicies.channels.voice_lab.parallelToolCalls).toBe(false);
  });

  it("changes collection priority without losing or duplicating required fields", async () => {
    const value = await configuration();
    prioritizeCollectionField(value, "service");
    expect(value.behavior.dataCollectionOrder[0]).toBe("service");
    expect(new Set(value.behavior.dataCollectionOrder)).toEqual(new Set(["full_name", "phone_number", "service"]));
  });
});
