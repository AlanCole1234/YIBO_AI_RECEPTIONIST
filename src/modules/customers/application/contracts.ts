import type {
  CustomerId,
  Result,
  TenantId,
} from "../../../shared/types/index.js";
import type { Customer } from "../domain/Customer.js";

export interface FindOrCreateCustomerByPhoneCommand {
  tenantId: TenantId;
  phone: string;
  name?: string;
  email?: string;
}

export interface UpdateCustomerCommand {
  tenantId: TenantId;
  customerId: CustomerId;
  phone?: string;
  name?: string;
  email?: string;
}

export type CustomerError =
  | { code: "CUSTOMER_NOT_FOUND" }
  | { code: "PHONE_ALREADY_EXISTS" }
  | { code: "VALIDATION_ERROR"; field: "tenantId" | "phone" | "email" | "update"; message: string };

export interface CustomerService {
  findOrCreateByPhone(
    command: FindOrCreateCustomerByPhoneCommand,
  ): Promise<Result<Customer, CustomerError>>;

  updateCustomer(
    command: UpdateCustomerCommand,
  ): Promise<Result<Customer, CustomerError>>;
}
