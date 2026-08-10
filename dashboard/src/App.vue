<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError, type Appointment, type Business, type Customer, type Slot } from "./services/api";

type Section = "overview" | "customers" | "availability" | "appointments";

const section = ref<Section>("overview");
const business = ref<Business>();
const apiOnline = ref(false);
const globalError = ref("");
const busy = ref(false);
const customerForm = ref({ name: "", phone: "+52999" });
const customer = ref<Customer>();
const serviceId = ref("");
const employeeId = ref("");
const date = ref(nextWeekday());
const slots = ref<Slot[]>([]);
const selectedSlot = ref<Slot>();
const createdAppointment = ref<Appointment>();
const lookupId = ref("");
const lookupResult = ref<Appointment>();

const selectedService = computed(() => business.value?.services.find((service) => service.id === serviceId.value));
const eligibleEmployees = computed(() => business.value?.employees.filter(
  (employee) => selectedService.value?.eligibleEmployeeIds.includes(employee.id),
) ?? []);

onMounted(async () => {
  try {
    const [health, profile] = await Promise.all([api.health(), api.business()]);
    apiOnline.value = health.status === "ok";
    business.value = profile;
    serviceId.value = profile.services[0]?.id ?? "";
    employeeId.value = profile.services[0]?.eligibleEmployeeIds[0] ?? "";
  } catch (error) {
    globalError.value = messageFor(error);
  }
});

function chooseSection(value: Section): void {
  section.value = value;
  globalError.value = "";
}

function onServiceChanged(): void {
  employeeId.value = selectedService.value?.eligibleEmployeeIds[0] ?? "";
  slots.value = [];
  selectedSlot.value = undefined;
}

async function saveCustomer(): Promise<void> {
  await run(async () => {
    customer.value = await api.findOrCreateCustomer(customerForm.value);
    section.value = "availability";
  });
}

async function checkAvailability(): Promise<void> {
  if (!serviceId.value || !employeeId.value || !date.value) return;
  await run(async () => {
    const rangeStart = `${date.value}T00:00:00.000Z`;
    const next = new Date(`${date.value}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    slots.value = (await api.availability({
      serviceId: serviceId.value,
      employeeId: employeeId.value,
      rangeStart,
      rangeEnd: next.toISOString(),
    })).slots;
    selectedSlot.value = undefined;
  });
}

async function createAppointment(): Promise<void> {
  if (!customer.value || !selectedSlot.value) return;
  await run(async () => {
    createdAppointment.value = await api.createAppointment({
      customerId: customer.value!.id,
      serviceId: serviceId.value,
      employeeId: selectedSlot.value!.employeeId,
      startAt: selectedSlot.value!.startAt,
    });
    lookupId.value = createdAppointment.value.id;
    await checkAvailability();
    section.value = "appointments";
  });
}

async function findAppointment(): Promise<void> {
  if (!lookupId.value.trim()) return;
  await run(async () => { lookupResult.value = await api.appointment(lookupId.value.trim()); });
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  globalError.value = "";
  try { await action(); } catch (error) { globalError.value = messageFor(error); } finally { busy.value = false; }
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return `No se pudo completar la operación (${error.code}).`;
  return "No se pudo conectar con la API local.";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: business.value?.timezone ?? "America/Merida",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function slotTime(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: business.value?.timezone ?? "America/Merida",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function nextWeekday(): string {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  while (value.getDay() === 0 || value.getDay() === 6) value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">Y</span><div><strong>YIBO</strong><small>Development console</small></div></div>
      <nav aria-label="Navegación principal">
        <button v-for="item in ([['overview','Resumen'],['customers','Clientes'],['availability','Disponibilidad'],['appointments','Citas']] as const)"
          :key="item[0]" :class="{ active: section === item[0] }" @click="chooseSection(item[0])">
          <span class="nav-dot"></span>{{ item[1] }}
        </button>
      </nav>
      <div class="sidebar-status"><span :class="['status-dot', { online: apiOnline }]"></span>{{ apiOnline ? 'API conectada' : 'API sin conexión' }}</div>
    </aside>

    <main>
      <header><div><p class="eyebrow">ENTORNO LOCAL</p><h1>{{ business?.name ?? 'YIBO Demo Clinic' }}</h1></div><span class="timezone">{{ business?.timezone ?? 'America/Merida' }}</span></header>
      <p v-if="globalError" class="alert" role="alert">{{ globalError }}</p>

      <section v-if="section === 'overview'" class="view">
        <div class="section-heading"><div><p class="eyebrow">RESUMEN</p><h2>Configuración operativa</h2></div><span class="pill success">Sistema listo</span></div>
        <div class="metric-grid">
          <article><span>Servicios</span><strong>{{ business?.services.length ?? '—' }}</strong><small>configurados</small></article>
          <article><span>Profesionales</span><strong>{{ business?.employees.length ?? '—' }}</strong><small>activos</small></article>
          <article><span>Zona horaria</span><strong class="metric-text">{{ business?.timezone ?? '—' }}</strong><small>fuente de verdad</small></article>
        </div>
        <div class="two-column">
          <article class="panel"><h3>Servicios disponibles</h3><div v-for="service in business?.services" :key="service.id" class="list-row"><div><strong>{{ service.name }}</strong><small>{{ service.id }}</small></div><span>{{ service.durationMinutes }} min</span></div></article>
          <article class="panel"><h3>Horario de atención</h3><div v-for="hours in business?.openingHours" :key="hours.dayOfWeek" class="list-row"><strong>{{ dayNames[hours.dayOfWeek] }}</strong><span>{{ hours.startTime }} — {{ hours.endTime }}</span></div></article>
        </div>
      </section>

      <section v-else-if="section === 'customers'" class="view narrow">
        <div class="section-heading"><div><p class="eyebrow">CLIENTES</p><h2>Buscar o crear cliente</h2><p>El teléfono identifica al cliente dentro del negocio demo.</p></div></div>
        <form class="panel form-card" @submit.prevent="saveCustomer">
          <label>Nombre<input v-model="customerForm.name" autocomplete="name" placeholder="María López" /></label>
          <label>Teléfono<input v-model="customerForm.phone" required autocomplete="tel" placeholder="+529991234567" /></label>
          <button class="primary" :disabled="busy">{{ busy ? 'Procesando…' : 'Buscar / Crear cliente' }}</button>
        </form>
        <article v-if="customer" class="result-card success-card"><span class="result-label">CLIENTE ACTIVO</span><h3>{{ customer.name || 'Sin nombre' }}</h3><p>{{ customer.phone }}</p><code>{{ customer.id }}</code></article>
      </section>

      <section v-else-if="section === 'availability'" class="view">
        <div class="section-heading"><div><p class="eyebrow">DISPONIBILIDAD</p><h2>Encontrar un horario</h2><p>Las horas se muestran en {{ business?.timezone }}.</p></div><span v-if="customer" class="pill">Cliente: {{ customer.id }}</span></div>
        <div class="panel filters">
          <label>Servicio<select v-model="serviceId" @change="onServiceChanged"><option v-for="service in business?.services" :key="service.id" :value="service.id">{{ service.name }} · {{ service.durationMinutes }} min</option></select></label>
          <label>Profesional<select v-model="employeeId"><option v-for="employee in eligibleEmployees" :key="employee.id" :value="employee.id">{{ employee.displayName }}</option></select></label>
          <label>Fecha<input v-model="date" type="date" /></label>
          <button class="primary" :disabled="busy" @click="checkAvailability">Consultar</button>
        </div>
        <div v-if="slots.length" class="slots"><button v-for="slot in slots" :key="`${slot.employeeId}-${slot.startAt}`" :class="['slot', { selected: selectedSlot?.startAt === slot.startAt }]" @click="selectedSlot = slot"><strong>{{ slotTime(slot.startAt) }}</strong><small>{{ slotTime(slot.endAt) }}</small></button></div>
        <div v-else class="empty"><strong>Selecciona los filtros y consulta</strong><span>Los horarios disponibles aparecerán aquí.</span></div>
        <div v-if="selectedSlot" class="booking-bar"><div><span>Horario seleccionado</span><strong>{{ formatDateTime(selectedSlot.startAt) }}</strong></div><button class="primary" :disabled="!customer || busy" @click="createAppointment">{{ customer ? 'Crear cita' : 'Primero crea un cliente' }}</button></div>
      </section>

      <section v-else class="view">
        <div class="section-heading"><div><p class="eyebrow">CITAS</p><h2>Inspección de cita</h2></div></div>
        <article v-if="createdAppointment" class="result-card success-card featured"><span class="result-label">CITA CONFIRMADA</span><h3>{{ createdAppointment.id }}</h3><p>{{ formatDateTime(createdAppointment.startAt) }} — {{ slotTime(createdAppointment.endAt) }}</p><span class="pill success">{{ createdAppointment.status }}</span><small>Evento externo: {{ createdAppointment.externalCalendarEventId }}</small></article>
        <form class="panel lookup" @submit.prevent="findAppointment"><label>ID de la cita<input v-model="lookupId" placeholder="appointment-1" /></label><button class="primary" :disabled="busy">Consultar cita</button></form>
        <article v-if="lookupResult" class="panel details"><div><span>ID</span><strong>{{ lookupResult.id }}</strong></div><div><span>Cliente</span><strong>{{ lookupResult.customerId }}</strong></div><div><span>Servicio</span><strong>{{ lookupResult.serviceId }}</strong></div><div><span>Profesional</span><strong>{{ lookupResult.employeeId }}</strong></div><div><span>Inicio</span><strong>{{ formatDateTime(lookupResult.startAt) }}</strong></div><div><span>Estado</span><strong>{{ lookupResult.status }}</strong></div></article>
      </section>
    </main>
  </div>
</template>
