import type { AgentToolDefinition } from "./contracts.js";

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "check_availability",
    description: "Find available appointment slots for a service in an absolute time range.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["serviceId", "rangeStart", "rangeEnd"],
      properties: {
        serviceId: { type: "string", minLength: 1 },
        employeeId: { type: "string", minLength: 1 },
        rangeStart: { type: "string", format: "date-time" },
        rangeEnd: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "create_appointment",
    description: "Create an appointment for the verified customer in this call.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["serviceId", "employeeId", "startAt"],
      properties: {
        serviceId: { type: "string", minLength: 1 },
        employeeId: { type: "string", minLength: 1 },
        startAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "cancel_appointment",
    description: "Cancel an appointment owned by the verified customer in this call.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["appointmentId"],
      properties: { appointmentId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "transfer_to_human",
    description: "Transfer this call to the business's configured human destination.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];
