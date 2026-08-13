export type { Customer } from "./domain/Customer.js";
export type { CustomerRepository } from "./ports/CustomerRepository.js";
export type {
  CustomerError,
  CustomerService,
  FindOrCreateCustomerByPhoneCommand,
  UpdateCustomerCommand,
} from "./application/contracts.js";
export { DefaultCustomerService } from "./application/DefaultCustomerService.js";
export { InMemoryCustomerRepository } from "./infrastructure/InMemoryCustomerRepository.js";
