<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type Appointment, type Customer, type DirectoryCustomer, type DirectoryProfessional } from "../services/api";

const props = defineProps<{ readOnly?: boolean; timezone?: string }>();
const emit = defineEmits<{ selected: [customer: Customer] }>();
const customers = ref<DirectoryCustomer[]>([]); const professionals = ref<DirectoryProfessional[]>([]);
const selected = ref<DirectoryCustomer>(); const history = ref<Appointment[]>([]);
const search = ref(""); const professionalId = ref(""); const showCreate = ref(false);
const busy = ref(false); const error = ref("");
const draft = ref({ name: "", phone: "+52", email: "", preferredLanguage: "es-MX", emailOptIn: true });
const filtered = computed(() => { const needle = search.value.trim().toLowerCase(); return customers.value.filter((customer) =>
  (!professionalId.value || customer.professionalIds.includes(professionalId.value))
  && (!needle || [customer.name, customer.phone, customer.email].some((value) => value?.toLowerCase().includes(needle)))); });
const activeProfessional = computed(() => professionals.value.find(({ id }) => id === professionalId.value));

async function load() { busy.value = true; error.value = ""; try {
  const directory = await api.officeDirectory(); customers.value = directory.customers; professionals.value = directory.professionals;
  if (selected.value) selected.value = customers.value.find(({ id }) => id === selected.value?.id);
} catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not load the patient directory."; }
finally { busy.value = false; } }
async function choose(customer: DirectoryCustomer) { selected.value = customer; emit("selected", customer);
  history.value = (await api.customerHistory(customer.id)).appointments; }
async function create() { if (props.readOnly) return; busy.value = true; error.value = ""; try {
  const created = await api.findOrCreateCustomer({ name: draft.value.name, phone: draft.value.phone,
    ...(draft.value.email ? { email: draft.value.email } : {}), preferredLanguage: draft.value.preferredLanguage,
    emailOptIn: draft.value.emailOptIn }); showCreate.value = false; await load();
  const entry = customers.value.find(({ id }) => id === created.id); if (entry) await choose(entry);
} catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not save the patient."; }
finally { busy.value = false; } }
const doctorName = (id: string) => professionals.value.find((professional) => professional.id === id)?.name ?? id;
const dateText = (value?: string) => value ? new Intl.DateTimeFormat("en", { timeZone: props.timezone ?? "UTC", dateStyle: "medium" }).format(new Date(value)) : "—";
onMounted(load);
</script>

<template>
  <section class="directory">
    <header class="directory-heading"><div><p class="eyebrow">Patient directory</p><h2>Everyone in one place</h2><p>Search the complete patient book, see each doctor’s patients and open appointment history.</p></div>
      <div class="directory-totals"><strong>{{ customers.length }}</strong><span>patients</span><strong>{{ professionals.filter(item => item.active).length }}</strong><span>professionals</span></div></header>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div class="directory-toolbar panel"><label class="search-field">Search patients<input v-model="search" placeholder="Name, phone or email"></label>
      <label>Doctor<select v-model="professionalId"><option value="">All doctors</option><option v-for="doctor in professionals" :key="doctor.id" :value="doctor.id">{{ doctor.name }} · {{ doctor.patientIds.length }} patients</option></select></label>
      <button type="button" :disabled="busy" @click="load">Refresh</button><button v-if="!readOnly" type="button" class="primary" @click="showCreate = !showCreate">+ New patient</button></div>
    <form v-if="showCreate" class="patient-create panel" @submit.prevent="create"><div><p class="eyebrow">New patient</p><h3>Add to the directory</h3></div>
      <label>Name<input v-model="draft.name" required></label><label>Phone<input v-model="draft.phone" required></label>
      <label>Email<input v-model="draft.email" type="email"></label><label>Preferred language<input v-model="draft.preferredLanguage"></label>
      <label class="consent"><input v-model="draft.emailOptIn" type="checkbox">Send appointment emails</label><button class="primary" :disabled="busy">Save patient</button></form>
    <div class="directory-layout">
      <div class="patient-book panel"><div class="book-heading"><div><h3>{{ activeProfessional?.name ?? 'All patients' }}</h3><p>{{ filtered.length }} visible records</p></div><span>Name · contact · care team · activity</span></div>
        <button v-for="patient in filtered" :key="patient.id" type="button" :class="['patient-row', { active: selected?.id === patient.id }]" @click="choose(patient)">
          <span class="patient-avatar">{{ (patient.name || patient.phone).slice(0, 1).toUpperCase() }}</span><span class="patient-identity"><strong>{{ patient.name || 'Unnamed patient' }}</strong><small>{{ patient.phone }}<template v-if="patient.email"> · {{ patient.email }}</template></small></span>
          <span class="care-team"><small>Care team</small><b>{{ patient.professionalIds.length ? patient.professionalIds.map(doctorName).join(', ') : 'Not assigned yet' }}</b></span>
          <span class="patient-activity"><small>{{ patient.appointmentCount }} appointments</small><b>{{ patient.nextAppointmentAt ? `Next ${dateText(patient.nextAppointmentAt)}` : patient.lastAppointmentAt ? `Last ${dateText(patient.lastAppointmentAt)}` : 'No visits yet' }}</b></span><span aria-hidden="true">›</span>
        </button><div v-if="!filtered.length" class="directory-empty">No patients match these filters.</div></div>
      <aside class="doctor-roster panel"><p class="eyebrow">Care teams</p><h3>Doctors & patients</h3>
        <button v-for="doctor in professionals" :key="doctor.id" type="button" :class="{ active: professionalId === doctor.id }" @click="professionalId = professionalId === doctor.id ? '' : doctor.id">
          <span class="doctor-avatar">{{ doctor.name.split(' ').map(part => part[0]).slice(0,2).join('') }}</span><span><strong>{{ doctor.name }}</strong><small>{{ doctor.patientIds.length }} patients</small></span><b>{{ doctor.active ? 'Active' : 'Inactive' }}</b></button>
      </aside>
    </div>
    <aside v-if="selected" class="patient-drawer"><button class="drawer-close" @click="selected = undefined">×</button><p class="eyebrow">Patient record</p><h2>{{ selected.name || 'Unnamed patient' }}</h2><p>{{ selected.phone }}<template v-if="selected.email"> · {{ selected.email }}</template></p>
      <div class="drawer-facts"><span><small>Care team</small><strong>{{ selected.professionalIds.length ? selected.professionalIds.map(doctorName).join(', ') : 'Not assigned' }}</strong></span><span><small>Appointments</small><strong>{{ selected.appointmentCount }}</strong></span></div>
      <h3>Appointment history</h3><ol><li v-for="item in history" :key="item.id"><span>{{ dateText(item.startAt) }}</span><strong>{{ item.serviceNameSnapshot }}</strong><small>{{ doctorName(item.employeeId) }} · {{ item.outcomeStatus ?? item.status }}</small></li><li v-if="!history.length">No appointments recorded.</li></ol></aside>
  </section>
</template>

<style scoped>
.directory{position:relative}.directory-heading{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:22px}.directory-heading p:last-child{max-width:650px;color:var(--muted)}.directory-totals{display:grid;grid-template-columns:auto auto;gap:2px 10px;align-items:end;padding:16px 22px;border:1px solid var(--line);border-radius:18px 6px;background:#fffaf2}.directory-totals strong{font:500 28px/1 Georgia,serif;color:var(--blue-deep)}.directory-totals span{padding-bottom:3px;color:var(--muted);font-size:11px}.directory-toolbar{display:grid;grid-template-columns:1.5fr 1fr auto auto;align-items:end;gap:12px;padding:16px 18px}.directory-toolbar button{min-height:42px}.patient-create{display:grid;grid-template-columns:1.2fr repeat(4,1fr) auto;align-items:end;gap:12px;margin:14px 0}.patient-create h3{margin:0}.consent{display:flex;align-items:center;gap:8px}.consent input{width:auto}.directory-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;margin-top:16px}.patient-book,.doctor-roster{padding:0;overflow:hidden}.book-heading{display:flex;justify-content:space-between;align-items:end;padding:20px 22px;border-bottom:1px solid var(--line)}.book-heading h3{margin:0}.book-heading p,.book-heading>span{margin:4px 0 0;color:var(--muted);font-size:11px}.patient-row{width:100%;display:grid;grid-template-columns:42px minmax(180px,1.3fr) minmax(160px,1fr) minmax(150px,.9fr) 12px;gap:13px;align-items:center;padding:14px 20px;border:0;border-bottom:1px solid #e4ddd2;text-align:left;color:var(--text);background:transparent}.patient-row:hover,.patient-row.active{background:#edf2fa}.patient-avatar,.doctor-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:14px 7px;color:#fff;background:var(--blue);font:600 16px Georgia,serif}.patient-identity,.care-team,.patient-activity{display:grid;gap:4px}.patient-row small{color:var(--muted);font-size:10px}.patient-row b{font-size:11px}.doctor-roster{padding:20px}.doctor-roster h3{margin-bottom:12px}.doctor-roster>button{width:100%;display:grid;grid-template-columns:38px 1fr auto;gap:10px;align-items:center;padding:11px 4px;border:0;border-bottom:1px solid #e4ddd2;text-align:left;background:transparent}.doctor-roster>button.active{margin:0 -10px;width:calc(100% + 20px);padding-inline:14px;background:#e8eef8}.doctor-roster span{display:grid;gap:2px}.doctor-roster small{color:var(--muted)}.doctor-roster b{color:#50705a;font-size:9px;text-transform:uppercase}.directory-empty{padding:50px;text-align:center;color:var(--muted)}.patient-drawer{position:fixed;z-index:30;right:24px;top:96px;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 120px);overflow:auto;padding:28px;border:1px solid var(--line);border-radius:24px 7px 20px;background:#fffaf2;box-shadow:0 25px 80px #24304c38}.drawer-close{position:absolute;right:16px;top:14px;border:0;background:transparent;font-size:25px}.drawer-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:22px 0}.drawer-facts span{display:grid;gap:5px;padding:13px;background:#edf2f8;border-radius:10px}.drawer-facts small{color:var(--muted)}.patient-drawer ol{padding:0;list-style:none}.patient-drawer li{display:grid;grid-template-columns:90px 1fr;gap:3px 12px;padding:12px 0;border-bottom:1px solid var(--line)}.patient-drawer li span{grid-row:1/3;color:var(--muted)}.patient-drawer li small{color:var(--muted)}@media(max-width:1000px){.directory-toolbar,.patient-create{grid-template-columns:1fr 1fr}.directory-layout{grid-template-columns:1fr}.doctor-roster{display:grid;grid-template-columns:repeat(2,1fr);gap:0 18px}.doctor-roster>p,.doctor-roster>h3{grid-column:1/-1}}@media(max-width:700px){.directory-heading{align-items:flex-start;flex-direction:column}.directory-toolbar,.patient-create{grid-template-columns:1fr}.patient-row{grid-template-columns:38px 1fr 12px}.care-team,.patient-activity{grid-column:2}.doctor-roster{grid-template-columns:1fr}}
</style>
