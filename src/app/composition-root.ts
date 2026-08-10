import {
  AppointmentServiceImpl,
  InMemoryAppointmentConcurrencyGuard,
  InMemoryAppointmentRepository,
  type AppointmentService,
  type CustomerReader,
} from "../modules/appointments/index.js";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessDirectory,
} from "../modules/business/index.js";
import {
  DefaultCustomerService,
  InMemoryCustomerRepository,
  type CustomerService,
} from "../modules/customers/index.js";
import { InMemoryCalendarAdapter } from "../modules/integrations/index.js";
import {
  SchedulingServiceImpl,
  type ConfirmedAppointmentReader,
  type EmployeeWorkingHoursProvider,
  type SchedulingService,
} from "../modules/scheduling/index.js";
import { DEVELOPMENT_BUSINESS, DEVELOPMENT_OPENING_HOURS, DEMO_TENANT_ID } from "./development-fixtures.js";

export interface YiboApplication {
  tenantId: string;
  business: BusinessDirectory;
  customers: CustomerService;
  scheduling: SchedulingService;
  appointments: AppointmentService;
}

export function createDevelopmentApplication(): YiboApplication {
  const business = new BusinessDirectoryService(new InMemoryBusinessRepository([DEVELOPMENT_BUSINESS]));
  const customerRepository = new InMemoryCustomerRepository();
  let customerSequence = 1;
  const customers = new DefaultCustomerService(
    customerRepository,
    () => `customer-${customerSequence++}`,
  );

  const customerReader: CustomerReader = {
    exists: async (tenantId, customerId) =>
      (await customerRepository.findById(tenantId, customerId)) !== null,
  };
  const workingHours: EmployeeWorkingHoursProvider = {
    getWorkingHours: async ({ tenantId, employeeId }) => {
      if (tenantId !== DEMO_TENANT_ID) return [];
      const employee = DEVELOPMENT_BUSINESS.employees.find((candidate) => candidate.id === employeeId);
      return employee?.active ? DEVELOPMENT_OPENING_HOURS.map((rule) => ({ ...rule })) : [];
    },
  };
  const confirmedAppointments: ConfirmedAppointmentReader = {
    findConfirmedIntervals: async () => [],
  };
  const calendar = new InMemoryCalendarAdapter();
  const scheduling = new SchedulingServiceImpl(
    business,
    workingHours,
    confirmedAppointments,
    calendar,
  );
  const appointmentRepository = new InMemoryAppointmentRepository();
  let appointmentSequence = 1;
  const appointments = new AppointmentServiceImpl(
    appointmentRepository,
    customerReader,
    business,
    scheduling,
    calendar,
    new InMemoryAppointmentConcurrencyGuard(),
    () => `appointment-${appointmentSequence++}`,
  );

  return { tenantId: DEMO_TENANT_ID, business, customers, scheduling, appointments };
}
