import type {
  BusinessConfigurationV2,
  OpeningHoursRule,
  ProfessionalDefinition,
  TenantServiceDefinition,
} from "../modules/business/index.js";

export const DEMO_TENANT_ID = "tenant-yibo-demo";

export const DEVELOPMENT_OPENING_HOURS: OpeningHoursRule[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek: dayOfWeek as 1 | 2 | 3 | 4 | 5,
  startTime: "09:00",
  endTime: "18:00",
}));

const services = (locale: "es-MX" | "en-US"): TenantServiceDefinition[] => [{
  id: "consultation",
  name: locale === "es-MX" ? "Consulta" : "Consultation",
  description: locale === "es-MX" ? "Consulta general" : "General consultation",
  durationMinutes: 30,
  bufferMinutes: 0,
  active: true,
}, {
  id: "cleaning",
  name: locale === "es-MX" ? "Limpieza" : "Cleaning",
  description: locale === "es-MX" ? "Limpieza dental" : "Dental cleaning",
  durationMinutes: 45,
  bufferMinutes: 0,
  active: true,
}];

const professionals = (region: "MX" | "US"): ProfessionalDefinition[] => region === "MX"
  ? [
      { id: "employee-1", displayName: "Dra. Ana", active: true },
      { id: "employee-2", displayName: "Dr. Carlos", active: true },
    ]
  : [
      { id: "employee-us-1", displayName: "Dr. Alex", active: true },
      { id: "employee-us-2", displayName: "Dr. Taylor", active: true },
    ];

const developmentBusiness = (input: {
  region: "MX" | "US";
  tenantId: string;
  businessId: string;
  name: string;
  timezone: string;
  locale: "es-MX" | "en-US";
  calledNumber: string;
}): BusinessConfigurationV2 => {
  const tenantProfessionals = professionals(input.region);
  return {
    schemaVersion: 2,
    region: input.region,
    tenantId: input.tenantId,
    businessId: input.businessId,
    name: input.name,
    active: true,
    services: services(input.locale),
    professionals: tenantProfessionals,
    locations: [{
      id: "default",
      name: input.name,
      active: true,
      address: {
        line1: "Pending configuration",
        city: "Pending configuration",
        countryCode: input.region,
      },
      timezone: input.timezone,
      locale: input.locale,
      calledNumbers: [input.calledNumber],
      openingHours: structuredClone(DEVELOPMENT_OPENING_HOURS),
      closures: [],
      policies: {
        defaultServiceId: "consultation",
        slotIncrementMinutes: 15,
        minimumLeadTimeMinutes: 0,
        maximumBookingHorizonDays: 365,
        maximumResults: 20,
        minimumCancellationNoticeMinutes: 0,
        minimumRescheduleNoticeMinutes: 0,
        concurrentCapacity: 1,
      },
      services: ["consultation", "cleaning"].map((serviceId) => ({
        serviceId,
        active: true,
        priceAmountMinor: 0,
        priceCurrency: input.region === "MX" ? "MXN" : "USD",
      })),
      professionals: tenantProfessionals.map((professional, index) => ({
        professionalId: professional.id,
        active: professional.active,
        serviceIds: index === 0 ? ["consultation", "cleaning"] : ["consultation"],
        openingHours: [],
      })),
    }],
  };
};

export const DEVELOPMENT_BUSINESS = developmentBusiness({
  region: "MX",
  tenantId: DEMO_TENANT_ID,
  businessId: "business-yibo-demo",
  name: "YIBO Demo Clinic",
  timezone: "America/Merida",
  locale: "es-MX",
  calledNumber: "+529991000000",
});

export const DEVELOPMENT_US_BUSINESS = developmentBusiness({
  region: "US",
  tenantId: "tenant-yibo-demo-us",
  businessId: "business-yibo-demo-us",
  name: "YIBO US Demo Clinic",
  timezone: "America/Chicago",
  locale: "en-US",
  calledNumber: "+15125550100",
});
