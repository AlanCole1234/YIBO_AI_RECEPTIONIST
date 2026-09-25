import type { AgentConfiguration, AgentToolName } from "./api.js";

export type ToolKind = "consult" | "mutate" | "external";

export function setToolEnabled(
  configuration: AgentConfiguration,
  name: AgentToolName,
  kind: ToolKind,
  enabled: boolean,
): void {
  configuration.enabledTools = enabled
    ? unique([...configuration.enabledTools, name])
    : configuration.enabledTools.filter((candidate) => candidate !== name);
  for (const channel of Object.values(configuration.toolPolicies.channels)) {
    channel.enabledTools = enabled
      ? unique([...channel.enabledTools, name])
      : channel.enabledTools.filter((candidate) => candidate !== name);
    if (enabled && kind !== "consult") channel.parallelToolCalls = false;
  }
  if (!enabled) {
    delete configuration.toolPolicies.limits.perTool[name];
    configuration.toolPolicies.confirmations.requiredFor = configuration.toolPolicies.confirmations.requiredFor
      .filter((candidate) => candidate !== name);
  }
}

export function setConfirmationRequired(configuration: AgentConfiguration, name: AgentToolName, required: boolean): void {
  const values = configuration.toolPolicies.confirmations.requiredFor;
  configuration.toolPolicies.confirmations.requiredFor = required
    ? unique([...values, name])
    : values.filter((candidate) => candidate !== name);
}

export function prioritizeCollectionField(
  configuration: AgentConfiguration,
  selected: AgentConfiguration["behavior"]["dataCollectionOrder"][number],
): void {
  const order = [...configuration.behavior.dataCollectionOrder];
  const previousIndex = order.indexOf(selected);
  [order[0], order[previousIndex]] = [order[previousIndex]!, order[0]!];
  configuration.behavior.dataCollectionOrder = order;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];
