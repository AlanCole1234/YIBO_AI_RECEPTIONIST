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
        requestedStartAt: { type: "string", format: "date-time", description: "Optional exact appointment time. Copy a returned slot's startAt unchanged whenever possible. If constructing from a caller saying 3 PM, send 2026-09-02T15:00 without Z; never label a local clock time as UTC." },
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
        startAt: { type: "string", format: "date-time", description: "Copy the accepted calendar slot's startAt exactly. Never reconstruct it as UTC or use the server timezone." },
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
    name: "reschedule_appointment",
    description: "Reschedule an appointment owned by the verified customer in this call. Use a previously confirmed appointment ID and an exact verified available slot. Never reconstruct a local time as UTC.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["appointmentId", "startAt"],
      properties: {
        appointmentId: { type: "string", minLength: 1 },
        startAt: { type: "string", format: "date-time", description: "Copy the accepted availability slot startAt unchanged." },
      },
    },
  },
  {
    name: "transfer_to_human",
    description: "Transfer this call to the business's configured human destination.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "enable_developer_test_mode",
    description: "Enable local Developer Test Mode. This is only available to a server-authorized local developer session; never claim it is enabled unless this tool succeeds.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "delete_test_appointments",
    description: "Delete only test appointments created during this authorized Developer Test Mode session. Never use this for normal patient appointments.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];
