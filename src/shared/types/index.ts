export type TenantId = string;
export type CustomerId = string;

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
