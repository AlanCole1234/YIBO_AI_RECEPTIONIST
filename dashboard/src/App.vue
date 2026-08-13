<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError, type Appointment, type Business, type Customer, type Slot } from "./services/api";
import { messages, supportedLocale, type MessageKey } from "./i18n";

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
const locale = computed(() => supportedLocale(business.value?.locale));
const copy = computed(() => messages[locale.value]);
const navItems = computed(() => [
  ["overview", copy.value.overview], ["customers", copy.value.customers],
  ["availability", copy.value.availability], ["appointments", copy.value.appointments],
] as Array<[Section, string]>);
const phonePlaceholder = computed(() => locale.value === "en-US" ? "+15125550123" : "+529991234567");
const t = (key: MessageKey): string => copy.value[key];

onMounted(async () => {
  try {
    const [health, profile] = await Promise.all([api.health(), api.business()]);
    apiOnline.value = health.status === "ok";
    business.value = profile;
    serviceId.value = profile.services[0]?.id ?? "";
    employeeId.value = profile.services[0]?.eligibleEmployeeIds[0] ?? "";
    customerForm.value.phone = profile.region === "US" ? "+1" : "+52";
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
  if (error instanceof ApiError) return `${t("operationFailed")} (${error.code}).`;
  return t("apiConnectionFailed");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    timeZone: business.value?.timezone ?? "America/Merida",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function slotTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
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

function statusLabel(status: string): string {
  if (status === "CONFIRMED") return locale.value === "en-US" ? "Confirmed" : "Confirmada";
  if (status === "CANCELLED") return locale.value === "en-US" ? "Cancelled" : "Cancelada";
  if (status === "FAILED") return locale.value === "en-US" ? "Failed" : "Fallida";
  return status === "PENDING_CONFIRMATION"
    ? (locale.value === "en-US" ? "Pending confirmation" : "Pendiente de confirmación")
    : status;
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">Y</span><div><strong>YIBO</strong><small>Development console</small></div></div>
      <nav aria-label="Navegación principal">
        <button v-for="item in navItems"
          :key="item[0]" :class="{ active: section === item[0] }" @click="chooseSection(item[0])">
          <span class="nav-dot"></span>{{ item[1] }}
        </button>
      </nav>
      <div class="sidebar-status"><span :class="['status-dot', { online: apiOnline }]"></span>{{ apiOnline ? t('apiConnected') : t('apiOffline') }}</div>
    </aside>

    <main>
      <header><div><p class="eyebrow">{{ t('localEnvironment') }}</p><h1>{{ business?.name ?? 'YIBO Demo Clinic' }}</h1></div><span class="timezone">{{ business?.timezone ?? 'America/Merida' }}</span></header>
      <p v-if="globalError" class="alert" role="alert">{{ globalError }}</p>

      <section v-if="section === 'overview'" class="view">
        <div class="section-heading"><div><p class="eyebrow">{{ t('overview') }}</p><h2>{{ t('operationalConfiguration') }}</h2></div><span class="pill success">{{ t('systemReady') }}</span></div>
        <div class="metric-grid">
          <article><span>{{ t('services') }}</span><strong>{{ business?.services.length ?? '—' }}</strong><small>{{ t('configured') }}</small></article>
          <article><span>{{ t('professionals') }}</span><strong>{{ business?.employees.length ?? '—' }}</strong><small>{{ t('active') }}</small></article>
          <article><span>{{ t('timezone') }}</span><strong class="metric-text">{{ business?.timezone ?? '—' }}</strong><small>{{ t('sourceOfTruth') }}</small></article>
        </div>
        <div class="two-column">
          <article class="panel"><h3>{{ t('availableServices') }}</h3><div v-for="service in business?.services" :key="service.id" class="list-row"><div><strong>{{ service.name }}</strong><small>{{ service.id }}</small></div><span>{{ service.durationMinutes }} min</span></div></article>
          <article class="panel"><h3>{{ t('businessHours') }}</h3><div v-for="hours in business?.openingHours" :key="hours.dayOfWeek" class="list-row"><strong>{{ copy.days[hours.dayOfWeek] }}</strong><span>{{ hours.startTime }} — {{ hours.endTime }}</span></div></article>
        </div>
      </section>

      <section v-else-if="section === 'customers'" class="view narrow">
        <div class="section-heading"><div><p class="eyebrow">{{ t('customers') }}</p><h2>{{ t('findOrCreateCustomer') }}</h2><p>{{ t('customerIdentityHelp') }}</p></div></div>
        <form class="panel form-card" @submit.prevent="saveCustomer">
          <label>{{ t('name') }}<input v-model="customerForm.name" autocomplete="name" :placeholder="t('namePlaceholder')" /></label>
          <label>{{ t('phone') }}<input v-model="customerForm.phone" required autocomplete="tel" :placeholder="phonePlaceholder" /></label>
          <button class="primary" :disabled="busy">{{ busy ? t('processing') : t('findCreateCustomerButton') }}</button>
        </form>
        <article v-if="customer" class="result-card success-card"><span class="result-label">{{ t('activeCustomer') }}</span><h3>{{ customer.name || t('unnamed') }}</h3><p>{{ customer.phone }}</p><code>{{ customer.id }}</code></article>
      </section>

      <section v-else-if="section === 'availability'" class="view">
        <div class="section-heading"><div><p class="eyebrow">{{ t('availability') }}</p><h2>{{ t('findTime') }}</h2><p>{{ t('timesShownIn') }} {{ business?.timezone }}.</p></div><span v-if="customer" class="pill">{{ t('customer') }}: {{ customer.id }}</span></div>
        <div class="panel filters">
          <label>{{ t('service') }}<select v-model="serviceId" @change="onServiceChanged"><option v-for="service in business?.services" :key="service.id" :value="service.id">{{ service.name }} · {{ service.durationMinutes }} min</option></select></label>
          <label>{{ t('professional') }}<select v-model="employeeId"><option v-for="employee in eligibleEmployees" :key="employee.id" :value="employee.id">{{ employee.displayName }}</option></select></label>
          <label>{{ t('date') }}<input v-model="date" type="date" /></label>
          <button class="primary" :disabled="busy" @click="checkAvailability">{{ t('search') }}</button>
        </div>
        <div v-if="slots.length" class="slots"><button v-for="slot in slots" :key="`${slot.employeeId}-${slot.startAt}`" :class="['slot', { selected: selectedSlot?.startAt === slot.startAt }]" @click="selectedSlot = slot"><strong>{{ slotTime(slot.startAt) }}</strong><small>{{ slotTime(slot.endAt) }}</small></button></div>
        <div v-else class="empty"><strong>{{ t('selectFilters') }}</strong><span>{{ t('slotsAppearHere') }}</span></div>
        <div v-if="selectedSlot" class="booking-bar"><div><span>{{ t('selectedTime') }}</span><strong>{{ formatDateTime(selectedSlot.startAt) }}</strong></div><button class="primary" :disabled="!customer || busy" @click="createAppointment">{{ customer ? t('createAppointment') : t('createCustomerFirst') }}</button></div>
      </section>

      <section v-else class="view">
        <div class="section-heading"><div><p class="eyebrow">{{ t('appointments') }}</p><h2>{{ t('appointmentInspection') }}</h2></div></div>
        <article v-if="createdAppointment" class="result-card success-card featured"><span class="result-label">{{ t('confirmedAppointment') }}</span><h3>{{ createdAppointment.id }}</h3><p>{{ formatDateTime(createdAppointment.startAt) }} — {{ slotTime(createdAppointment.endAt) }}</p><span class="pill success">{{ statusLabel(createdAppointment.status) }}</span><small>{{ t('externalEvent') }}: {{ createdAppointment.externalCalendarEventId }}</small></article>
        <form class="panel lookup" @submit.prevent="findAppointment"><label>{{ t('appointmentId') }}<input v-model="lookupId" placeholder="appointment-1" /></label><button class="primary" :disabled="busy">{{ t('searchAppointment') }}</button></form>
        <article v-if="lookupResult" class="panel details"><div><span>ID</span><strong>{{ lookupResult.id }}</strong></div><div><span>{{ t('customer') }}</span><strong>{{ lookupResult.customerId }}</strong></div><div><span>{{ t('service') }}</span><strong>{{ lookupResult.serviceId }}</strong></div><div><span>{{ t('professional') }}</span><strong>{{ lookupResult.employeeId }}</strong></div><div><span>{{ t('start') }}</span><strong>{{ formatDateTime(lookupResult.startAt) }}</strong></div><div><span>{{ t('status') }}</span><strong>{{ statusLabel(lookupResult.status) }}</strong></div></article>
      </section>
    </main>
  </div>
</template>
