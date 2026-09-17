<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { createAppointmentEditor, appointmentTime } from "../services/appointment-editor";
import { priceText } from "../services/catalog-editor";
const props = defineProps<{ initialCustomerId?: string; initialAppointmentId?: string }>();
const editor = createAppointmentEditor(); const { state } = editor;
const day = ref("");
const location = computed(() => state.locations.find(item => item.id === state.locationId));
const time = (value: string) => appointmentTime(value, location.value?.timezone ?? "UTC");
onMounted(async () => {
  state.customerId = props.initialCustomerId ?? ""; state.appointmentId = props.initialAppointmentId ?? "";
  if (await editor.load() && state.appointmentId) await editor.lookup();
});
</script>
<template>
  <section class="appointment-admin">
    <h2>Appointment administration</h2>
    <p>Look up an appointment or list a customer’s upcoming confirmed appointments at a location.</p>
    <p v-if="state.error" role="alert">{{ state.error }}</p><p v-if="state.message" role="status">{{ state.message }}</p>
    <button v-if="!state.locations.length" :disabled="state.busy" @click="editor.load()">Load locations</button>
    <fieldset :disabled="state.busy">
      <legend>Find appointments</legend>
      <label>Location<select v-model="state.locationId" @change="editor.clear()"><option v-for="item in state.locations" :key="item.id" :value="item.id">{{ item.name }}{{ item.active ? '' : ' (inactive)' }}</option></select></label>
      <form @submit.prevent="editor.list()"><label>Customer ID<input v-model="state.customerId" required></label><button :disabled="!state.locationId">List customer appointments</button></form>
      <form @submit.prevent="editor.lookup()"><label>Appointment ID<input v-model="state.appointmentId" required></label><button :disabled="!state.locationId">Find appointment</button></form>
      <p v-if="state.listed && !state.appointments.length">No upcoming confirmed appointments found.</p>
      <ul><li v-for="item in state.appointments" :key="item.id"><button type="button" @click="editor.lookup(item.id)">{{ item.serviceNameSnapshot }} · {{ time(item.startAt) }} · {{ item.status }}</button></li></ul>
    </fieldset>
    <article v-if="state.selected">
      <h3>{{ state.selected.serviceNameSnapshot }}</h3>
      <dl><dt>Appointment</dt><dd>{{ state.selected.id }}</dd><dt>Customer</dt><dd>{{ state.selected.customerId }}</dd><dt>Location</dt><dd>{{ location?.name }} · {{ location?.timezone }}</dd><dt>Professional</dt><dd>{{ state.selected.employeeId }}</dd><dt>Time</dt><dd>{{ time(state.selected.startAt) }} – {{ time(state.selected.endAt) }}</dd><dt>Price at booking</dt><dd>{{ priceText({ amountMinor: state.selected.priceAmountMinor, currency: state.selected.priceCurrency }) }} {{ state.selected.priceCurrency }}</dd><dt>Status</dt><dd>{{ state.selected.status }}</dd></dl>
      <p>Cancellation notice: {{ location?.minimumCancellationNoticeMinutes }} minutes. Rescheduling notice: {{ location?.minimumRescheduleNoticeMinutes }} minutes. The server rechecks the policy and availability when you confirm.</p>
      <fieldset v-if="state.selected.status === 'CONFIRMED'" :disabled="state.busy">
        <legend>Change appointment</legend>
        <button type="button" @click="state.pending = { kind: 'cancel' }">Cancel appointment…</button>
        <form @submit.prevent="editor.availability(day)"><label>New date at this location<input v-model="day" type="date" required @change="state.slots = []; state.pending = undefined"></label><button>Find reschedule slots</button></form>
        <p>Rescheduling keeps the same service and professional. Only available slots are offered.</p>
        <button v-for="slot in state.slots" :key="slot.startAt" type="button" @click="state.pending = { kind: 'reschedule', startAt: slot.startAt }">{{ time(slot.startAt) }}</button>
        <div v-if="state.pending" class="confirmation"><p>{{ state.pending.kind === 'cancel' ? 'Cancel this appointment?' : `Reschedule this appointment to ${time(state.pending.startAt!)}?` }}</p><button type="button" @click="editor.confirm()">Confirm {{ state.pending.kind === 'cancel' ? 'cancellation' : 'reschedule' }}</button><button type="button" @click="state.pending = undefined">Keep appointment</button></div>
      </fieldset>
    </article>
  </section>
</template>
<style scoped>
.appointment-admin{max-width:1000px;margin:auto}.appointment-admin fieldset,.appointment-admin article{border:1px solid #b9c3cd;border-radius:12px;padding:22px;margin:20px 0}.appointment-admin label{display:grid;gap:6px;margin:12px 0}.appointment-admin input,.appointment-admin select{padding:10px}.appointment-admin button{margin:6px}.appointment-admin dt{font-weight:bold}.appointment-admin dd{margin:0 0 12px;overflow-wrap:anywhere}.confirmation{border:1px solid #b9c3cd;padding:14px}.appointment-admin [role=alert]{color:#7b2424}.appointment-admin [role=status]{color:#24613c}
</style>
