<script setup lang="ts">
import { ref } from "vue";

defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{ submit: [credentials: { email: string; password: string }] }>();

const email = ref("");
const password = ref("");

function submit(): void {
  emit("submit", { email: email.value.trim(), password: password.value });
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="login-title">
      <div class="brand auth-brand"><span class="brand-mark">Y</span><div><strong>YIBO</strong><small>Operations workspace</small></div></div>
      <p class="eyebrow">Protected administration</p>
      <h1 id="login-title">Welcome back</h1>
      <p>Sign in with the administrator account assigned to this business.</p>
      <p v-if="error" class="alert" role="alert">
        {{ error === 'SESSION_EXPIRED' ? 'Your session expired. Sign in again.' : error === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.' : 'Authentication is unavailable right now.' }}
      </p>
      <form @submit.prevent="submit">
        <label>Email<input v-model="email" type="email" autocomplete="username" required /></label>
        <label>Password<input v-model="password" type="password" autocomplete="current-password" minlength="12" required /></label>
        <button class="primary" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <small class="auth-note">The session credential remains in a secure HttpOnly cookie and is never exposed to this page.</small>
    </section>
  </main>
</template>
