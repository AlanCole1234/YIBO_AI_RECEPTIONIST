import { randomUUID } from "node:crypto";
import {
  AppointmentServiceImpl,
  InMemoryAppointmentConcurrencyGuard,
  type AppointmentService,
  type CustomerReader,
} from "../modules/appointments/index.js";
import { BusinessDirectoryService, type BusinessDirectory, type BusinessProfile } from "../modules/business/index.js";
import { DefaultCustomerService, type CustomerService } from "../modules/customers/index.js";
import { SchedulingServiceImpl, type EmployeeWorkingHoursProvider, type SchedulingService } from "../modules/scheduling/index.js";
import { SqliteAppointmentRepository } from "../infrastructure/database/sqlite-appointment-repository.js";
import { SqliteBusinessRepository } from "../infrastructure/database/sqlite-business-repository.js";
import { SqliteCalendarAdapter } from "../infrastructure/database/sqlite-calendar-adapter.js";
import { SqliteCustomerRepository } from "../infrastructure/database/sqlite-customer-repository.js";
import { migrateDatabase, openRegionalDatabase, seedBusiness } from "../infrastructure/database/regional-database.js";
import type { RegionId } from "../shared/types/identifiers.js";
import { DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS } from "./development-fixtures.js";
import type { YiboApplication } from "./composition-root.js";

export interface LocalAccessContext {
  region: RegionId;
  tenantId: string;
}

export function localAccessContext(environment = process.env): LocalAccessContext {
  const region = environment.YIBO_REGION?.toUpperCase() ?? "MX";
  if (region !== "MX" && region !== "US") throw new Error("YIBO_REGION must be MX or US");
  const defaultTenant = region === "MX" ? DEVELOPMENT_BUSINESS.tenantId : DEVELOPMENT_US_BUSINESS.tenantId;
  return { region, tenantId: environment.YIBO_TENANT_ID?.trim() || defaultTenant };
}

export function createLocalApplication(context = localAccessContext()): YiboApplication {
  const profile = fixtureFor(context);
  const database = openRegionalDatabase(context.region);
  migrateDatabase(database);
  seedBusiness(database, profile);

  const business = new BusinessDirectoryService(new SqliteBusinessRepository(database, context.region));
  const customerRepository = new SqliteCustomerRepository(database, context.region);
  const customers = new DefaultCustomerService(customerRepository, () => `customer-${randomUUID()}`);
  const appointmentRepository = new SqliteAppointmentRepository(database, context.region);
  const calendar = new SqliteCalendarAdapter(database, context.region);

  const customerReader: CustomerReader = {
    exists: async (tenantId, customerId) => (await customerRepository.findById(tenantId, customerId)) !== null,
  };
  const workingHours: EmployeeWorkingHoursProvider = {
    getWorkingHours: async ({ tenantId, employeeId }) => {
      const result = await business.getBusinessProfile(tenantId);
      if (!result.ok || !result.value.employees.some((employee) => employee.id === employeeId && employee.active)) return [];
      return result.value.openingHours.map((rule) => ({ ...rule }));
    },
  };
  const scheduling: SchedulingService = new SchedulingServiceImpl(
    business, workingHours, appointmentRepository, calendar,
  );
  const appointments: AppointmentService = new AppointmentServiceImpl(
    appointmentRepository, customerReader, business, scheduling, calendar,
    new InMemoryAppointmentConcurrencyGuard(), () => `appointment-${randomUUID()}`,
  );
  return { tenantId: context.tenantId, business, customers, scheduling, appointments };
}

function fixtureFor(context: LocalAccessContext): BusinessProfile {
  const profile = context.region === "MX" ? DEVELOPMENT_BUSINESS : DEVELOPMENT_US_BUSINESS;
  if (context.tenantId !== profile.tenantId) {
    throw new Error(`Unknown local tenant ${context.tenantId} for region ${context.region}`);
  }
  return profile;
}
