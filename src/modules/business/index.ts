export { BusinessDirectoryService } from "./application/business-directory-service.js";
export { BusinessCatalogService } from "./application/business-catalog-service.js";
export type {
  BusinessCatalogError,
  LocationCalendarSnapshot,
  LocationTransferSnapshot,
  LocationPolicySnapshot,
  ProfessionalCatalogSnapshot,
  ProfessionalUsageReader,
  ServiceCatalogMutation,
  ServiceCatalogSnapshot,
} from "./application/business-catalog-service.js";
export type {
  BusinessDirectory,
  BusinessLookupError,
  BusinessLocationContext,
  BusinessProfile,
  EditableBusinessConfiguration,
  LegacyBusinessProfileV1,
  EmployeeDefinition,
  OpeningHoursRule,
  ServiceDefinition,
  VersionedBusinessConfiguration,
} from "./application/contracts.js";
export type {
  BusinessRepository,
  SaveBusinessConfigurationResult,
  StoredBusinessConfiguration,
} from "./ports/business-repository.js";
export { InMemoryBusinessRepository } from "./infrastructure/in-memory-business-repository.js";
export {
  MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  SLOT_INCREMENT_MINUTES,
  validateMultiLocationBusiness,
  isValidCalendarId,
  isValidTransferDestination,
  resolvedAiCapabilities,
} from "./domain/multi-location-business.js";
export { validateMoney } from "./domain/money.js";
export type { Money } from "./domain/money.js";
export {
  isBusinessConfigurationV2,
  upgradeBusinessProfile,
} from "./domain/upgrade-business-profile.js";
export type { VersionedBusinessProfile } from "./domain/upgrade-business-profile.js";
export type {
  BusinessConfigurationV2,
  LocationAddress,
  LocationClosure,
  LocationDefinition,
  LocationProfessionalAssignment,
  LocationSchedulingPolicy,
  LocationTransferDestination,
  LocationAiCapabilities,
  LocationServiceAssignment,
  MultiLocationBusinessValidationError,
  ProfessionalDefinition,
  TenantServiceDefinition,
} from "./domain/multi-location-business.js";

export { changesBookedCalendarRoute } from "./domain/protected-calendar-routes.js";
export type { CalendarRouteReference } from "./domain/protected-calendar-routes.js";
