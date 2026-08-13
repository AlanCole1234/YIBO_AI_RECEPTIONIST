import type { BusinessProfile, OpeningHoursRule } from "../modules/business/index.js";

export const DEMO_TENANT_ID = "tenant-yibo-demo";

export const DEVELOPMENT_OPENING_HOURS: OpeningHoursRule[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek: dayOfWeek as 1 | 2 | 3 | 4 | 5,
  startTime: "09:00",
  endTime: "18:00",
}));

export const DEVELOPMENT_BUSINESS: BusinessProfile = {
  region: "MX",
  tenantId: DEMO_TENANT_ID,
  businessId: "business-yibo-demo",
  name: "YIBO Demo Clinic",
  timezone: "America/Merida",
  locale: "es-MX",
  active: true,
  calledNumbers: ["+529991000000"],
  employees: [
    { id: "employee-1", displayName: "Dra. Ana", active: true },
    { id: "employee-2", displayName: "Dr. Carlos", active: true },
  ],
  services: [
    {
      id: "consultation",
      name: "Consulta",
      durationMinutes: 30,
      bufferMinutes: 0,
      eligibleEmployeeIds: ["employee-1", "employee-2"],
    },
    {
      id: "cleaning",
      name: "Limpieza",
      durationMinutes: 45,
      bufferMinutes: 0,
      eligibleEmployeeIds: ["employee-1"],
    },
  ],
  openingHours: DEVELOPMENT_OPENING_HOURS,
};

export const DEVELOPMENT_US_BUSINESS: BusinessProfile = {
  ...DEVELOPMENT_BUSINESS,
  region: "US",
  tenantId: "tenant-yibo-demo-us",
  businessId: "business-yibo-demo-us",
  name: "YIBO US Demo Clinic",
  timezone: "America/Chicago",
  locale: "en-US",
  calledNumbers: ["+15125550100"],
  employees: [
    { id: "employee-us-1", displayName: "Dr. Alex", active: true },
    { id: "employee-us-2", displayName: "Dr. Taylor", active: true },
  ],
  services: [
    {
      id: "consultation",
      name: "Consultation",
      durationMinutes: 30,
      bufferMinutes: 0,
      eligibleEmployeeIds: ["employee-us-1", "employee-us-2"],
    },
    {
      id: "cleaning",
      name: "Cleaning",
      durationMinutes: 45,
      bufferMinutes: 0,
      eligibleEmployeeIds: ["employee-us-1"],
    },
  ],
};
