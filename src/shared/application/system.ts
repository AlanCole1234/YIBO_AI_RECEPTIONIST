export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(scope: "appointment" | "customer" | "call" | "calendar-event" | "idempotency" | "audit"): string;
}
