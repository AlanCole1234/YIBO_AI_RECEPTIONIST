export type SupportedLocale = "es-MX" | "en-US";

export const messages = {
  "es-MX": {
    overview: "Resumen", customers: "Clientes", availability: "Disponibilidad", appointments: "Citas",
    apiConnected: "API conectada", apiOffline: "API sin conexión", localEnvironment: "Entorno local",
    operationalConfiguration: "Configuración operativa", systemReady: "Sistema listo",
    services: "Servicios", configured: "configurados", professionals: "Profesionales", active: "activos",
    timezone: "Zona horaria", sourceOfTruth: "fuente de verdad", availableServices: "Servicios disponibles",
    businessHours: "Horario de atención", findOrCreateCustomer: "Buscar o crear cliente",
    customerIdentityHelp: "El teléfono identifica al cliente dentro del negocio.", name: "Nombre", phone: "Teléfono",
    processing: "Procesando…", findCreateCustomerButton: "Buscar / Crear cliente", activeCustomer: "Cliente activo",
    unnamed: "Sin nombre", findTime: "Encontrar un horario", timesShownIn: "Las horas se muestran en",
    customer: "Cliente", service: "Servicio", professional: "Profesional", date: "Fecha", search: "Consultar",
    selectFilters: "Selecciona los filtros y consulta", slotsAppearHere: "Los horarios disponibles aparecerán aquí.",
    selectedTime: "Horario seleccionado", createAppointment: "Crear cita", createCustomerFirst: "Primero crea un cliente",
    appointmentInspection: "Inspección de cita", confirmedAppointment: "Cita confirmada", externalEvent: "Evento externo",
    appointmentId: "ID de la cita", searchAppointment: "Consultar cita", start: "Inicio", status: "Estado",
    operationFailed: "No se pudo completar la operación", apiConnectionFailed: "No se pudo conectar con la API local.",
    namePlaceholder: "María López",
    days: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  },
  "en-US": {
    overview: "Overview", customers: "Customers", availability: "Availability", appointments: "Appointments",
    apiConnected: "API connected", apiOffline: "API offline", localEnvironment: "Local environment",
    operationalConfiguration: "Operational configuration", systemReady: "System ready",
    services: "Services", configured: "configured", professionals: "Professionals", active: "active",
    timezone: "Time zone", sourceOfTruth: "source of truth", availableServices: "Available services",
    businessHours: "Business hours", findOrCreateCustomer: "Find or create customer",
    customerIdentityHelp: "The phone number identifies the customer within the business.", name: "Name", phone: "Phone",
    processing: "Processing…", findCreateCustomerButton: "Find / Create customer", activeCustomer: "Active customer",
    unnamed: "Unnamed", findTime: "Find an available time", timesShownIn: "Times are shown in",
    customer: "Customer", service: "Service", professional: "Professional", date: "Date", search: "Search",
    selectFilters: "Select the filters and search", slotsAppearHere: "Available times will appear here.",
    selectedTime: "Selected time", createAppointment: "Create appointment", createCustomerFirst: "Create a customer first",
    appointmentInspection: "Appointment details", confirmedAppointment: "Confirmed appointment", externalEvent: "External event",
    appointmentId: "Appointment ID", searchAppointment: "Find appointment", start: "Start", status: "Status",
    operationFailed: "The operation could not be completed", apiConnectionFailed: "Could not connect to the local API.",
    namePlaceholder: "Jane Smith",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
} as const;

export type MessageKey = Exclude<keyof typeof messages["es-MX"], "days">;

export function supportedLocale(locale?: string): SupportedLocale {
  return locale?.toLowerCase().startsWith("en") ? "en-US" : "es-MX";
}
