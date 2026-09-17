<script setup lang="ts">
import { onMounted } from "vue";
import { createCalendarEditor, calendarStatusLabel } from "../services/calendar-editor";
const emit = defineEmits<{ saved: [] }>();
const editor = createCalendarEditor();
const { state } = editor;
async function save() { if (await editor.save()) emit("saved"); }
async function selectLocation(event: Event) {
  const select = event.target as HTMLSelectElement;
  await editor.load(select.value);
  // A failed read keeps the previous snapshot; keep the visible selection aligned.
  select.value = state.snapshot?.locationId ?? "";
}
onMounted(() => editor.load());
</script>

<template>
  <section class="calendar-settings" aria-labelledby="calendar-title">
    <h2 id="calendar-title">Calendar mappings</h2>
    <p>A professional’s override takes priority. Without an override, their appointments use the location’s default calendar.</p>
    <p>Changing a mapping does not move existing Google events. Review existing bookings before changing their calendar route; later changes to those bookings may require staff help.</p>
    <p v-if="state.error" role="alert">{{ state.error }}</p>
    <p v-if="state.saved" role="status">Mapping saved. Use Verify saved mappings to refresh access status.</p>
    <button v-if="!state.snapshot || state.conflict" type="button" :disabled="state.busy" @click="editor.load()">{{ state.conflict ? 'Discard draft and reload mappings' : 'Load mappings' }}</button>
    <fieldset v-if="state.snapshot" :disabled="state.busy || Boolean(state.draft) || state.conflict">
      <legend>Saved mappings · version {{ state.snapshot.version }}</legend>
      <label>Location<select :value="state.snapshot.locationId" @change="selectLocation"><option v-for="location in state.locations" :key="location.id" :value="location.id">{{ location.name }}{{ location.active ? '' : ' (inactive)' }}</option></select></label>
      <button type="button" @click="editor.load()">Verify saved mappings</button>
      <p>Verification checks access only; it does not create an appointment or test a booking. Status reflects the last check.</p>
      <h3>Location default</h3>
      <p class="identifier">{{ state.snapshot.defaultCalendarId ?? 'No default calendar' }}</p>
      <p>{{ calendarStatusLabel(state.snapshot.defaultCalendarStatus) }}</p>
      <button type="button" @click="editor.edit()">Edit location calendar</button>
      <h3>Assigned professionals</h3>
      <p v-if="!state.snapshot.professionals.length">Assign professionals under Services & professionals first.</p>
      <article v-for="professional in state.snapshot.professionals" :key="professional.professionalId">
        <h4>{{ professional.displayName }}</h4>
        <p>Override: <span class="identifier">{{ professional.calendarId ?? 'None — use location default' }}</span></p>
        <p>Effective calendar: <span class="identifier">{{ professional.effectiveCalendarId ?? 'Not configured' }}</span></p>
        <p>Source: {{ professional.source === 'professional' ? 'Professional override' : professional.source === 'location' ? 'Location fallback' : 'Unconfigured' }} · {{ calendarStatusLabel(professional.effectiveCalendarStatus) }}</p>
        <button type="button" @click="editor.edit(professional.professionalId)">Edit professional override</button>
      </article>
    </fieldset>
    <form v-if="state.draft" @submit.prevent="save">
      <fieldset :disabled="state.busy">
        <legend>{{ state.draft.professionalId ? 'Professional calendar override' : 'Location default calendar' }}</legend>
        <label>Google Calendar ID<input v-model="state.draft.calendarId" autocomplete="off" spellcheck="false"></label>
        <p>{{ state.draft.professionalId ? 'Leave blank to remove this override and use the location default.' : 'Leave blank to remove the location default. Professionals without overrides will have no configured calendar.' }}</p>
        <p>Use the calendar ID from Google Calendar settings. New mappings must pass the server’s access check before saving.</p>
        <div class="actions"><button :disabled="state.conflict">{{ state.busy ? 'Saving…' : 'Save mapping' }}</button><button type="button" @click="state.draft = undefined; state.error = ''">Discard draft</button></div>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.calendar-settings{max-width:1000px;margin:auto}.calendar-settings fieldset{border:1px solid #b9c3cd;border-radius:12px;padding:22px;margin:20px 0}.calendar-settings label{display:grid;gap:6px;margin-bottom:14px}.calendar-settings input,.calendar-settings select{width:100%;box-sizing:border-box;padding:10px}.calendar-settings article{padding:18px 0;border-top:1px solid #b9c3cd}.identifier{overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:10px}.calendar-settings [role=alert]{padding:14px;background:#fff0ef;color:#7b2424;border:1px solid #cf8b83}.calendar-settings [role=status]{color:#24613c}
</style>
