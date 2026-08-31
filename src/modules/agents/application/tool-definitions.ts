import type { AgentToolDefinition } from "./contracts.js";

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "check_availability",
    description: "Find real clinic-calendar appointment slots. Use dateExpression for natural caller phrases. service is an optional patient-facing choice such as Cleaning or Consultation; omit it to use the clinic's configured default appointment type. Never ask for or expose an internal service ID. When the caller asks about an exact time, include requestedStartAt as an ISO datetime. Results are verified, privacy-safe, and sorted earliest first.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        service: { type: "string", minLength: 1, description: "Optional patient-facing service choice, for example Cleaning or Consultation." },
        employeeId: { type: "string", minLength: 1 },
        dateExpression: { type: "string", minLength: 1, description: "A supported natural date phrase from the caller." },
        rangeStart: { type: "string", format: "date-time" },
        rangeEnd: { type: "string", format: "date-time" },
        requestedStartAt: { type: "string", format: "date-time", description: "Optional exact appointment time the caller asked about." },
      },
    },
  },
  {
    name: "create_appointment",
    description: "Create an appointment for the verified customer in this call. Use the patient-facing service name, not an internal service ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["employeeId", "startAt"],
      properties: {
        service: { type: "string", minLength: 1, description: "Patient-facing service choice: Cleaning or Consultation. Omit only when the clinic default was already selected." },
        employeeId: { type: "string", minLength: 1 },
        startAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "update_customer",
    description: "Save the verified caller's first and last name and best callback phone number. Use only after collecting both values one question at a time.",
    inputSchema: { type: "object", additionalProperties: false, required: ["name", "phone"], properties: {
      name: { type: "string", minLength: 3 }, phone: { type: "string", minLength: 7 },
    } },
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
