<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type Appointment, type Business, type Customer, type GoogleCalendarStatus, type Slot } from "./services/api";
import { createAdminSession } from "./services/admin-session";
import { messages, type MessageKey } from "./i18n";
import AgentConfigurationPanel from "./components/AgentConfigurationPanel.vue";
import AgentVoiceLab from "./components/AgentVoiceLab.vue";
import AdminLogin from "./components/AdminLogin.vue";

type Section = "overview" | "agent" | "customers" | "availability" | "appointments" | "settings";
const timezones = [
  { value: "America/Denver", label: "Mountain Time (El Paso)" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Phoenix", label: "Arizona Time" },
];

const section = ref<Section>("overview");
const adminSession = createAdminSession();
const auth = adminSession.state;
const business = ref<Business>();
const apiOnline = ref(false);
const googleCalendar = ref<GoogleCalendarStatus>({ configured: false, connected: false });
const calendarNeedsReconnect = ref(new URLSearchParams(window.location.search).get("calendar") === "failed");
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
const timezone = ref("America/Denver");

const selectedService = computed(() => business.value?.services.find((service) => service.id === serviceId.value));
const eligibleEmployees = computed(() => business.value?.employees.filter(
  (employee) => selectedService.value?.eligibleEmployeeIds.includes(employee.id),
) ?? []);
// The dashboard is intentionally English even if an older business profile has a Spanish locale.
const locale = computed(() => "en-US" as const);
const copy = computed(() => messages[locale.value]);
const navItems = computed(() => ([
  ["overview", copy.value.overview], ["agent", copy.value.agent], ["customers", copy.value.customers],
  ["availability", copy.value.availability], ["appointments", copy.value.appointments], ["settings", "Settings"],
] as Array<[Section, string]>).filter(([candidate]) => canAccessSection(candidate)));
const phonePlaceholder = computed(() => locale.value === "en-US" ? "+15125550123" : "+529991234567");
const t = (key: MessageKey): string => copy.value[key];

onMounted(async () => {
  await adminSession.restore();
  if (auth.phase === "authenticated") await loadWorkspace();
});

onUnmounted(() => adminSession.dispose());

async function loadWorkspace(): Promise<void> {
  try {
    const [health, profile, calendarStatus] = await Promise.all([
      api.health(),
      api.business(),
      adminSession.can("tenant_admin") ? api.googleCalendarStatus() : Promise.resolve({ configured: false, connected: false }),
    ]);
    apiOnline.value = health.status === "ok";
    business.value = profile;
    googleCalendar.value = calendarStatus;
    serviceId.value = profile.services[0]?.id ?? "";
    employeeId.value = profile.services[0]?.eligibleEmployeeIds[0] ?? "";
    timezone.value = profile.timezone;
    customerForm.value.phone = profile.region === "US" ? "+1" : "+52";
  } catch (error) {
    globalError.value = messageFor(error);
  }
}

async function login(credentials: { email: string; password: string }): Promise<void> {
  if (await adminSession.login(credentials)) await loadWorkspace();
}

async function logout(): Promise<void> {
  await adminSession.logout();
  section.value = "overview";
  business.value = undefined;
  customer.value = undefined;
}

function canAccessSection(candidate: Section): boolean {
  return !["agent", "settings"].includes(candidate) || adminSession.can("tenant_admin");
}

function chooseSection(value: Section): void {
  if (!canAccessSection(value)) return;
  section.value = value;
  globalError.value = "";
}

async function connectGoogleCalendar(): Promise<void> {
  await run(async () => { window.location.assign((await api.googleCalendarConnect(window.location.origin)).url); });
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
    const rangeStart = zonedDayStart(date.value, business.value?.timezone ?? "America/Denver");
    const next = new Date(`${date.value}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    slots.value = (await api.availability({
      serviceId: serviceId.value,
      employeeId: employeeId.value,
      rangeStart,
      rangeEnd: zonedDayStart(next.toISOString().slice(0, 10), business.value?.timezone ?? "America/Denver"),
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

async function saveTimezone(): Promise<void> {
  await run(async () => {
    business.value = await api.updateBusinessTimezone(timezone.value);
    slots.value = [];
    selectedSlot.value = undefined;
  });
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

function zonedDayStart(day: string, timeZone: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const localMidnight = Date.UTC(year, month - 1, date, 0, 0, 0);
  let instant = localMidnight;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const rendered = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    instant = localMidnight - (rendered - instant);
  }
  return new Date(instant).toISOString();
}

function nextWeekday(): string {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  while (value.getDay() === 0 || value.getDay() === 6) value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

function statusLabel(status: string): string {
  if (status === "CONFIRMED") return "Confirmed";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "FAILED") return "Failed";
  return status === "PENDING_CONFIRMATION" ? "Pending confirmation" : status;
}
</script>

<template>
  <main v-if="auth.phase === 'loading'" class="auth-shell" aria-live="polite">
    <section class="auth-card auth-loading"><span class="brand-mark">Y</span><h1>Opening your workspace…</h1></section>
  </main>
  <AdminLogin v-else-if="auth.phase === 'anonymous'" :busy="auth.busy" :error="auth.error" @submit="login" />
  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">Y</span><div><strong>YIBO</strong><small>Welcome studio</small></div></div>
      <nav aria-label="Main navigation">
        <button v-for="item in navItems"
          :key="item[0]" :class="{ active: section === item[0] }" @click="chooseSection(item[0])">
          <span class="nav-dot"></span>{{ item[1] }}
        </button>
      </nav>
      <div class="sidebar-account">
        <div><strong>{{ auth.principal?.subject }}</strong><small>{{ auth.principal?.roles.includes('tenant_admin') ? 'Tenant admin' : 'Operator' }}</small></div>
        <button type="button" :disabled="auth.busy" @click="logout">Sign out</button>
      </div>
      <div class="sidebar-status"><span :class="['status-dot', { online: apiOnline }]"></span>{{ apiOnline ? t('apiConnected') : t('apiOffline') }}</div>
    </aside>

    <main>
      <header v-if="section !== 'agent' && section !== 'overview'"><div><p class="eyebrow">{{ t('localEnvironment') }}</p><h1>{{ business?.name ?? 'YIBO Demo Clinic' }}</h1></div><span class="timezone">{{ business?.timezone ?? 'America/Merida' }}</span></header>
      <p v-if="globalError" class="alert" role="alert">{{ globalError }}</p>

      <section v-if="section === 'overview'" class="view home-view">
        <div class="home-intro">
          <div><p class="eyebrow">{{ t('localEnvironment') }}</p><h1>{{ business?.name ?? 'YIBO Demo Clinic' }}</h1><p>{{ t('homeSubtitle') }}</p></div>
          <div class="home-actions"><span class="pill success">{{ t('systemReady') }}</span><button class="primary" @click="chooseSection('agent')">{{ t('testAgent') }} <span aria-hidden="true">→</span></button></div>
        </div>
        <div class="home-dashboard">
          <section class="home-snapshot" aria-labelledby="home-status-title">
            <div class="home-snapshot-heading"><div><p class="eyebrow">{{ t('overview') }}</p><h2 id="home-status-title">{{ t('operationalConfiguration') }}</h2></div><span class="timezone">{{ business?.timezone ?? 'America/Merida' }}</span></div>
            <div class="home-metrics">
              <article><span>{{ t('services') }}</span><strong>{{ business?.services.length ?? '—' }}</strong><small>{{ t('configured') }}</small></article>
              <article><span>{{ t('professionals') }}</span><strong>{{ business?.employees.length ?? '—' }}</strong><small>{{ t('active') }}</small></article>
              <article><span>{{ t('timezone') }}</span><strong class="metric-text">{{ business?.timezone ?? '—' }}</strong><small>{{ t('sourceOfTruth') }}</small></article>
            </div>
          </section>
          <article class="home-calendar">
            <div class="calendar-mark" aria-hidden="true"><span></span><b>31</b></div>
            <div><p class="eyebrow">Google Calendar</p><h3>{{ googleCalendar.connected ? 'Connected' : googleCalendar.configured ? t('calendarSetup') : t('calendarMissing') }}</h3><p v-if="googleCalendar.connected">{{ t('calendarReadyHelp') }}</p><p v-else-if="googleCalendar.configured">{{ t('calendarSetupHelp') }}</p><p v-else>{{ t('calendarMissingHelp') }}</p></div>
            <span v-if="googleCalendar.connected" class="pill success">Connected</span><button v-else-if="googleCalendar.configured" class="primary" :disabled="busy" @click="connectGoogleCalendar">{{ calendarNeedsReconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar' }}</button><span v-else class="pill">{{ t('notConfigured') }}</span>
          </article>
        </div>
        <div class="two-column home-details">
          <article class="panel"><h3>{{ t('availableServices') }}</h3><div v-for="service in business?.services" :key="service.id" class="list-row"><div><strong>{{ service.name }}</strong><small>{{ service.id }}</small></div><span>{{ service.durationMinutes }} min</span></div></article>
          <article class="panel"><h3>{{ t('businessHours') }}</h3><div v-for="hours in business?.openingHours" :key="hours.dayOfWeek" class="list-row"><strong>{{ copy.days[hours.dayOfWeek] }}</strong><span>{{ hours.startTime }} — {{ hours.endTime }}</span></div></article>
        </div>
      </section>

      <section v-else-if="section === 'agent'" class="view agent-view">
        <AgentVoiceLab />
        <AgentConfigurationPanel :locale="locale" />
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

      <section v-else-if="section === 'appointments'" class="view">
        <div class="section-heading"><div><p class="eyebrow">{{ t('appointments') }}</p><h2>{{ t('appointmentInspection') }}</h2></div></div>
        <article v-if="createdAppointment" class="result-card success-card featured"><span class="result-label">{{ t('confirmedAppointment') }}</span><h3>{{ createdAppointment.id }}</h3><p>{{ formatDateTime(createdAppointment.startAt) }} — {{ slotTime(createdAppointment.endAt) }}</p><span class="pill success">{{ statusLabel(createdAppointment.status) }}</span><small>{{ t('externalEvent') }}: {{ createdAppointment.externalCalendarEventId }}</small></article>
        <form class="panel lookup" @submit.prevent="findAppointment"><label>{{ t('appointmentId') }}<input v-model="lookupId" placeholder="appointment-1" /></label><button class="primary" :disabled="busy">{{ t('searchAppointment') }}</button></form>
        <article v-if="lookupResult" class="panel details"><div><span>ID</span><strong>{{ lookupResult.id }}</strong></div><div><span>{{ t('customer') }}</span><strong>{{ lookupResult.customerId }}</strong></div><div><span>{{ t('service') }}</span><strong>{{ lookupResult.serviceId }}</strong></div><div><span>{{ t('professional') }}</span><strong>{{ lookupResult.employeeId }}</strong></div><div><span>{{ t('start') }}</span><strong>{{ formatDateTime(lookupResult.startAt) }}</strong></div><div><span>{{ t('status') }}</span><strong>{{ statusLabel(lookupResult.status) }}</strong></div></article>
      </section>

      <section v-else-if="section === 'settings'" class="view narrow">
        <div class="section-heading"><div><p class="eyebrow">Business settings</p><h2>Time zone</h2><p>Choose the local time YIBO should use for availability, appointments, Google Calendar, and AI scheduling conversations.</p></div></div>
        <form class="panel form-card" @submit.prevent="saveTimezone">
          <label>Business time zone
            <select v-model="timezone">
              <option v-for="option in timezones" :key="option.value" :value="option.value">{{ option.label }} — {{ option.value }}</option>
            </select>
          </label>
          <p class="settings-help">For El Paso, choose <strong>Mountain Time (El Paso)</strong>. YIBO uses IANA time zones, so daylight saving time is handled automatically.</p>
          <button class="primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save time zone' }}</button>
        </form>
      </section>
    </main>
  </div>
</template>
