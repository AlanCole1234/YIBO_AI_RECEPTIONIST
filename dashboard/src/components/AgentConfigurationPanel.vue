<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  api,
  ApiError,
  type AgentConfiguration,
  type AgentToolName,
  type ReasoningEffort,
} from "../services/api";

const props = defineProps<{ locale: "es-MX" | "en-US" }>();

type Step = "identity" | "conversation" | "abilities" | "instructions";
type VadPreset = "auto" | "fast" | "balanced" | "patient" | "custom";

const steps: Array<{ id: Step; number: string; es: string; en: string }> = [
  { id: "identity", number: "01", es: "Identidad", en: "Identity" },
  { id: "conversation", number: "02", es: "Conversación", en: "Conversation" },
  { id: "abilities", number: "03", es: "Acciones", en: "Actions" },
  { id: "instructions", number: "04", es: "Instrucciones", en: "Instructions" },
];
const models = [
  { value: "gpt-realtime-2.1", label: "GPT Realtime 2.1", note: "Mejor calidad conversacional" },
  { value: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 Mini", note: "Menor costo" },
];
const voices = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const reasoningEfforts: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const locales = [
  ["es-MX", "Español · México"], ["es-US", "Español · Estados Unidos"],
  ["es-ES", "Español · España"], ["en-US", "English · United States"],
  ["en-GB", "English · United Kingdom"], ["pt-BR", "Português · Brasil"],
];
const vadPresets: Record<Exclude<VadPreset, "custom">, AgentConfiguration["conversation"]["turnDetection"]> = {
  auto: {},
  fast: { threshold: 0.58, prefixPaddingMs: 240, silenceDurationMs: 380 },
  balanced: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 600 },
  patient: { threshold: 0.44, prefixPaddingMs: 420, silenceDurationMs: 1000 },
};
const toolCopy: Record<AgentToolName, { title: string; help: string; route: string; icon: string }> = {
  check_availability: { title: "Consultar disponibilidad", help: "Revisa servicios, profesionales y horarios libres. No modifica datos.", route: "Scheduling", icon: "⌕" },
  create_appointment: { title: "Crear citas", help: "Propone una cita; YIBO valida identidad, disponibilidad e idempotencia.", route: "Appointments", icon: "+" },
  cancel_appointment: { title: "Cancelar citas", help: "Sólo cancela citas que pertenecen al cliente verificado.", route: "Appointments", icon: "×" },
  transfer_to_human: { title: "Transferir a una persona", help: "Solicita una transferencia al destino configurado por el negocio.", route: "HumanTransferPort", icon: "↗" },
};

const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const apiKeyConfigured = ref(false);
const configuration = ref<AgentConfiguration>();
const recommended = ref<AgentConfiguration>();
const availableTools = ref<Array<{ name: AgentToolName; kind: "consult" | "mutate" | "external" }>>([]);
const step = ref<Step>("identity");
const speechPlaying = ref(false);

const currentStep = computed(() => steps.findIndex((candidate) => candidate.id === step.value));
const vadPreset = computed<VadPreset>(() => {
  const value = configuration.value?.conversation.turnDetection;
  if (!value) return "auto";
  for (const [key, preset] of Object.entries(vadPresets)) {
    if (sameVad(value, preset)) return key as Exclude<VadPreset, "custom">;
  }
  return "custom";
});
const activeToolCount = computed(() => configuration.value?.enabledTools.length ?? 0);
const isSpanish = computed(() => props.locale === "es-MX");

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const payload = await api.agentConfiguration();
    recommended.value = clone(payload.recommended);
    configuration.value = clone(payload.current ?? payload.recommended);
    availableTools.value = payload.availableTools;
    apiKeyConfigured.value = payload.secrets.apiKeyConfigured;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

function selectStep(next: Step): void { step.value = next; }
function move(offset: number): void {
  const next = steps[Math.max(0, Math.min(steps.length - 1, currentStep.value + offset))];
  if (next) step.value = next.id;
}

function applyVad(preset: Exclude<VadPreset, "custom">): void {
  if (!configuration.value) return;
  configuration.value.conversation.turnDetection = { ...vadPresets[preset] };
}

function toggleTool(name: AgentToolName): void {
  if (!configuration.value) return;
  const active = configuration.value.enabledTools.includes(name);
  configuration.value.enabledTools = active
    ? configuration.value.enabledTools.filter((candidate) => candidate !== name)
    : [...configuration.value.enabledTools, name];
}

function restoreRecommended(): void {
  if (recommended.value) configuration.value = clone(recommended.value);
  saved.value = false;
}

async function save(): Promise<void> {
  if (!configuration.value) return;
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    const result = await api.updateAgentConfiguration(configuration.value);
    configuration.value = clone(result.configuration);
    saved.value = true;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    saving.value = false;
  }
}

function playVoicePreview(): void {
  if (!("speechSynthesis" in window) || !configuration.value) return;
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    speechPlaying.value = false;
    return;
  }
  const sample = configuration.value.locale.startsWith("en")
    ? "Hello, I'm YIBO. How can I help you today?"
    : "Hola, soy YIBO. ¿En qué puedo ayudarte hoy?";
  const utterance = new SpeechSynthesisUtterance(sample);
  utterance.lang = configuration.value.locale;
  const language = utterance.lang.slice(0, 2).toLowerCase();
  utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith(language)) ?? null;
  utterance.onend = () => { speechPlaying.value = false; };
  utterance.onerror = () => { speechPlaying.value = false; };
  speechPlaying.value = true;
  window.speechSynthesis.speak(utterance);
}

function sameVad(
  left: AgentConfiguration["conversation"]["turnDetection"],
  right: AgentConfiguration["conversation"]["turnDetection"],
): boolean {
  return left.threshold === right.threshold
    && left.prefixPaddingMs === right.prefixPaddingMs
    && left.silenceDurationMs === right.silenceDurationMs;
}

function clone(value: AgentConfiguration): AgentConfiguration { return structuredClone(value); }
function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) return `No se pudo guardar la configuración (${caught.code}).`;
  return caught instanceof Error ? caught.message : "No se pudo cargar la configuración.";
}
</script>

<template>
  <section class="agent-config" aria-labelledby="agent-config-title">
    <div class="config-intro">
      <div>
        <p class="config-kicker">AGENTE DE CONVERSACIÓN</p>
        <h2 id="agent-config-title">Diseña cómo habla y actúa YIBO</h2>
        <p>Una guía paso a paso. Los cambios se guardan para este negocio y se aplican a la siguiente conversación.</p>
      </div>
      <div :class="['connection-chip', { ready: apiKeyConfigured }]">
        <i></i>{{ apiKeyConfigured ? "API lista" : "Falta API key" }}
      </div>
    </div>

    <div v-if="loading" class="config-state"><i></i>Preparando la configuración…</div>
    <div v-else-if="!configuration" class="config-state error-state">{{ error }}</div>

    <form v-else @submit.prevent="save">
      <nav class="config-steps" aria-label="Pasos de configuración">
        <button v-for="(item, index) in steps" :key="item.id" type="button"
          :class="{ active: step === item.id, complete: index < currentStep }" @click="selectStep(item.id)">
          <small>{{ item.number }}</small><span>{{ isSpanish ? item.es : item.en }}</span>
        </button>
      </nav>

      <div class="config-layout">
        <div class="config-stage">
          <section v-if="step === 'identity'" class="step-panel">
            <div class="step-heading"><span>01</span><div><h3>Personalidad de la conversación</h3><p>Elige el modelo, la voz y el idioma que escuchará quien llama.</p></div></div>
            <div class="field-grid">
              <label>Modelo de conversación<select v-model="configuration.conversation.model"><option v-for="model in models" :key="model.value" :value="model.value">{{ model.label }} — {{ model.note }}</option></select><small>Define la calidad, velocidad y costo aproximado de cada turno.</small></label>
              <label>Voz de YIBO<select v-model="configuration.voice"><option v-for="voice in voices" :key="voice" :value="voice">{{ voice[0]?.toUpperCase() }}{{ voice.slice(1) }}</option></select><small>Es el timbre que escuchará el caller. Marin y Cedar son buenos puntos de partida.</small></label>
              <label>Idioma y región<select v-model="configuration.locale"><option v-for="candidate in locales" :key="candidate[0]" :value="candidate[0]">{{ candidate[1] }}</option></select><small>Ajusta pronunciación, vocabulario, fechas y horarios.</small></label>
              <label>Razonamiento<select v-model="configuration.conversation.reasoningEffort"><option v-for="effort in reasoningEfforts" :key="effort" :value="effort">{{ effort }}</option></select><small>Más razonamiento agrega latencia y consumo; mínimo es el recomendado.</small></label>
            </div>
            <label class="token-control"><span>Extensión máxima <output>{{ configuration.conversation.maxOutputTokens }} tokens</output></span><input v-model.number="configuration.conversation.maxOutputTokens" type="range" min="64" max="4096" step="64"><small>Es un techo, no una meta. Una respuesta normal puede usar mucho menos.</small></label>
          </section>

          <section v-else-if="step === 'conversation'" class="step-panel">
            <div class="step-heading"><span>02</span><div><h3>Ritmo de la charla</h3><p>Controla cuándo YIBO entiende que terminaste de hablar.</p></div></div>
            <div class="preset-grid">
              <button v-for="preset in (['auto','fast','balanced','patient'] as const)" :key="preset" type="button" :class="{ selected: vadPreset === preset }" @click="applyVad(preset)"><i>{{ preset === 'auto' ? '✦' : preset === 'fast' ? '⚡' : preset === 'balanced' ? '◉' : '◌' }}</i><strong>{{ {auto:'Automático',fast:'Ágil',balanced:'Equilibrado',patient:'Paciente'}[preset] }}</strong><small>{{ preset === 'auto' ? 'Usa los valores administrados por el proveedor.' : preset === 'fast' ? 'Responde pronto en ambientes silenciosos.' : preset === 'balanced' ? 'Punto de partida para recepción telefónica.' : 'Tolera pausas largas antes de responder.' }}</small></button>
            </div>
            <details class="advanced"><summary>Ajustes avanzados <span>{{ vadPreset === 'custom' ? 'Personalizados' : 'Opcional' }}</span></summary><p>Cámbialos sólo después de escuchar conversaciones reales.</p><div class="advanced-grid">
              <label>Sensibilidad <output>{{ configuration.conversation.turnDetection.threshold ?? 0.5 }}</output><input v-model.number="configuration.conversation.turnDetection.threshold" type="range" min="0" max="1" step="0.01"></label>
              <label>Audio previo <output>{{ configuration.conversation.turnDetection.prefixPaddingMs ?? 300 }} ms</output><input v-model.number="configuration.conversation.turnDetection.prefixPaddingMs" type="range" min="0" max="1000" step="20"></label>
              <label>Silencio de cierre <output>{{ configuration.conversation.turnDetection.silenceDurationMs ?? 600 }} ms</output><input v-model.number="configuration.conversation.turnDetection.silenceDurationMs" type="range" min="100" max="2000" step="50"></label>
            </div></details>
          </section>

          <section v-else-if="step === 'abilities'" class="step-panel">
            <div class="step-heading"><span>03</span><div><h3>Capacidades y límites</h3><p>El modelo puede solicitar estas acciones; ToolExecutor sigue validando y ejecutando.</p></div></div>
            <div class="permission-flow"><span>Modelo<small>propone</small></span><b>→</b><span class="gate">ToolExecutor<small>valida</small></span><b>→</b><span>YIBO<small>ejecuta</small></span></div>
            <div class="tool-grid"><button v-for="tool in availableTools" :key="tool.name" type="button" :class="{ enabled: configuration.enabledTools.includes(tool.name) }" @click="toggleTool(tool.name)"><i>{{ toolCopy[tool.name].icon }}</i><span><small>{{ tool.kind === 'consult' ? 'Sólo lectura' : tool.kind === 'mutate' ? 'Modifica datos' : 'Acción externa' }}</small><strong>{{ toolCopy[tool.name].title }}</strong><p>{{ toolCopy[tool.name].help }}</p><em>Ruta segura: {{ toolCopy[tool.name].route }}</em></span><b></b></button></div>
            <p class="security-note">El modelo nunca recibe acceso directo a la base de datos. Tenant, llamada y cliente llegan como contexto confiable del sistema.</p>
          </section>

          <section v-else class="step-panel">
            <div class="step-heading"><span>04</span><div><h3>Instrucciones maestras</h3><p>Describe el rol, tono y límites de YIBO con reglas claras.</p></div></div>
            <label class="prompt-field">Instrucciones activas<textarea v-model="configuration.instructions" rows="12"></textarea><small>No incluyas secretos ni datos personales. {{ configuration.instructions.length }} caracteres.</small></label>
          </section>

          <div class="step-actions"><button type="button" :disabled="currentStep === 0" @click="move(-1)">← Anterior</button><span>Paso {{ currentStep + 1 }} de 4</span><button type="button" :disabled="currentStep === 3" @click="move(1)">Siguiente →</button></div>
        </div>

        <aside class="agent-preview">
          <small>VISTA PREVIA</small><div class="voice-orb"><i></i><i></i><i></i><i></i><i></i></div>
          <h3>{{ configuration.conversation.model.replace('gpt-', 'GPT ') }}</h3><p>Voz <strong>{{ configuration.voice }}</strong> · {{ configuration.locale }}</p>
          <blockquote>“{{ configuration.locale.startsWith('en') ? "Hello, I'm YIBO. How can I help?" : 'Hola, soy YIBO. ¿En qué puedo ayudarte?' }}”</blockquote>
          <button type="button" class="preview-button" @click="playVoicePreview">{{ speechPlaying ? '■ Detener referencia' : '▶ Escuchar referencia gratis' }}</button>
          <small class="preview-note">Usa la voz local del navegador. No consume API y no representa exactamente la voz OpenAI.</small>
          <dl><div><dt>Respuesta</dt><dd>{{ configuration.conversation.maxOutputTokens }} tokens máx.</dd></div><div><dt>Capacidades</dt><dd>{{ activeToolCount }} activas</dd></div><div><dt>Protección</dt><dd>Contexto confiable</dd></div></dl>
        </aside>
      </div>

      <p v-if="error" class="config-error" role="alert">{{ error }}</p>
      <footer class="config-actions"><div><strong>{{ saved ? 'Configuración guardada' : 'Se aplicará a la próxima conversación' }}</strong><small>El runtime activo no cambia a mitad de una llamada.</small></div><button type="button" class="restore" @click="restoreRecommended">Restaurar recomendado</button><button class="save" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar configuración' }}</button></footer>
    </form>
  </section>
</template>

<style scoped>
.agent-config{--ac-bg:#07151c;--ac-panel:#0c2029;--ac-line:#24444e;--ac-mint:#5ee8c4;--ac-amber:#f6c85f;--ac-ink:#eaf7f4;color:var(--ac-ink);background:linear-gradient(145deg,#091a21,#061117);border:1px solid var(--ac-line);clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px);overflow:hidden;box-shadow:0 30px 80px #0007}.config-intro{display:flex;justify-content:space-between;gap:30px;padding:42px 46px 32px;background:radial-gradient(circle at 80% 0,#133c3c 0,transparent 35%)}.config-intro h2{margin:0 0 10px;color:#fff;font-size:clamp(28px,4vw,48px);text-transform:none;text-shadow:none}.config-intro p:not(.config-kicker){max-width:680px;color:#91afb3}.config-kicker{color:var(--ac-mint);font:700 11px/1 monospace;letter-spacing:.2em}.connection-chip{height:max-content;display:flex;align-items:center;gap:8px;padding:10px 13px;background:#321d22;border:1px solid #6a3d45;color:#ff9b9b;font:700 11px/1 monospace;text-transform:uppercase}.connection-chip i{width:7px;height:7px;border-radius:50%;background:currentColor}.connection-chip.ready{background:#12352e;border-color:#296958;color:var(--ac-mint)}.config-state{min-height:300px;display:grid;place-content:center;gap:15px;color:#91afb3}.config-state i{width:38px;height:38px;border:3px solid var(--ac-line);border-top-color:var(--ac-mint);border-radius:50%;animation:spin 1s linear infinite}.error-state{color:#ff9a9a}.config-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:0;padding:0 46px;border-bottom:1px solid var(--ac-line)}.config-steps button{display:flex;gap:10px;align-items:center;padding:17px 12px;border:0;border-bottom:3px solid transparent;background:transparent;color:#6f8e93;text-align:left}.config-steps button small{color:#52747a;font-family:monospace}.config-steps button.active{color:#fff;border-color:var(--ac-mint);background:#0d242c}.config-steps button.complete small{color:var(--ac-mint)}.config-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px}.config-stage{padding:40px 42px 24px;min-width:0}.step-panel{animation:enter .24s ease-out}.step-heading{display:flex;gap:16px;align-items:flex-start;margin-bottom:28px}.step-heading>span{width:45px;height:45px;display:grid;place-items:center;flex:none;background:var(--ac-mint);color:#06201a;font-weight:900;border-radius:14px 4px 14px 5px}.step-heading h3{margin:0 0 5px;color:#fff;font:700 25px/1.1 inherit}.step-heading p{margin:0;color:#84a1a6}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.field-grid label,.token-control,.advanced-grid label,.prompt-field{display:grid;gap:8px;color:#d9e8e6;font-weight:700}.field-grid small,.token-control small,.prompt-field small{color:#729196;font-weight:400;line-height:1.4}.field-grid select,.prompt-field textarea{width:100%;border:1px solid #31545e;background:#08171d;color:#eaf7f4;padding:13px;border-radius:9px}.field-grid select:focus,.prompt-field textarea:focus{outline:2px solid #5ee8c455;border-color:var(--ac-mint)}.token-control{margin-top:24px;padding:18px;background:#0b1d24;border-left:4px solid var(--ac-amber)}.token-control>span{display:flex;justify-content:space-between}.token-control output,.advanced output{color:var(--ac-mint)}input[type=range]{accent-color:var(--ac-mint)}.preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.preset-grid button{display:grid;grid-template-columns:38px 1fr;text-align:left;gap:10px;padding:15px;border:1px solid var(--ac-line);border-radius:12px;background:#0a1b22;color:#dcecea}.preset-grid button i{grid-row:1/3;width:34px;height:34px;display:grid;place-items:center;background:#16323a;color:var(--ac-mint);font-style:normal;border-radius:10px}.preset-grid button small{color:#779499;line-height:1.4}.preset-grid button.selected{border-color:var(--ac-mint);background:#102d2c;box-shadow:inset 4px 0 0 var(--ac-mint)}.advanced{margin-top:22px;border:1px solid var(--ac-line);background:#09191f;padding:15px}.advanced summary{display:flex;justify-content:space-between;color:#cde0dd;cursor:pointer;font-weight:700}.advanced summary span{color:var(--ac-amber);font-size:11px}.advanced>p{color:#78969a}.advanced-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.advanced-grid label{padding:12px;background:#0d2229}.advanced-grid output{font-size:12px}.permission-flow{display:flex;align-items:center;justify-content:center;margin:0 0 24px}.permission-flow span{display:grid;padding:11px 20px;border:1px solid var(--ac-line);background:#0a1b22;text-align:center}.permission-flow small{color:#759297}.permission-flow b{color:var(--ac-mint);padding:0 8px}.permission-flow .gate{border-color:var(--ac-mint);background:#13342f;color:var(--ac-mint)}.tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tool-grid button{display:grid;grid-template-columns:38px 1fr 36px;gap:12px;padding:16px;text-align:left;border:1px solid var(--ac-line);background:#091a21;color:#dbe9e7;border-radius:13px}.tool-grid button>i{width:36px;height:36px;display:grid;place-items:center;background:#173039;color:#91adb1;border-radius:10px;font:normal 22px/1 inherit}.tool-grid button span{display:grid;gap:3px}.tool-grid button span>small{color:#708e93;text-transform:uppercase;font-size:9px;letter-spacing:.08em}.tool-grid button p{margin:5px 0;color:#7e9b9f;font-size:12px;line-height:1.45}.tool-grid button em{color:#557b7e;font-size:10px;font-style:normal}.tool-grid button>b{width:34px;height:20px;padding:3px;border-radius:20px;background:#293e43}.tool-grid button>b:after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:#73878a;transition:.2s}.tool-grid button.enabled{border-color:#397b6d;background:#102722}.tool-grid button.enabled>i{background:#17473d;color:var(--ac-mint)}.tool-grid button.enabled>b{background:#269c82}.tool-grid button.enabled>b:after{transform:translateX(14px);background:#fff}.security-note{padding:14px;border:1px solid #315063;background:#0e1e2a;color:#8ca6ae;font-size:12px}.prompt-field textarea{min-height:280px;resize:vertical;line-height:1.65}.step-actions{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:18px;border-top:1px solid var(--ac-line)}.step-actions button{border:0;background:transparent;color:var(--ac-mint);padding:8px}.step-actions button:disabled{opacity:.25}.step-actions span{color:#66868b;font-size:11px}.agent-preview{padding:38px 24px;border-left:1px solid var(--ac-line);background:linear-gradient(180deg,#0d2229,#08171d);text-align:center}.agent-preview>small:first-child{color:#68898e;letter-spacing:.17em}.voice-orb{width:112px;height:112px;margin:28px auto 20px;display:flex;align-items:center;justify-content:center;gap:4px;border-radius:38px;background:radial-gradient(circle,#236858,#102a2b 65%);box-shadow:0 0 0 7px #173139,0 0 45px #37d4b32e}.voice-orb i{width:4px;height:36px;background:var(--ac-mint);border-radius:5px;animation:wave 1.2s ease-in-out infinite}.voice-orb i:nth-child(2),.voice-orb i:nth-child(4){height:22px;animation-delay:.18s}.voice-orb i:first-child,.voice-orb i:last-child{height:12px;animation-delay:.32s}.agent-preview h3{margin:0 0 5px;color:#fff;text-transform:capitalize}.agent-preview>p{color:#759399}.agent-preview blockquote{margin:22px 0 12px;padding:15px;background:#142b33;color:#c8dbd9;text-align:left;border-radius:14px;line-height:1.5}.preview-button{width:100%;border:1px solid #397165;background:#13362f;color:var(--ac-mint);padding:10px;border-radius:10px;font-weight:700}.preview-note{display:block;margin:8px 0 20px;color:#627f83;line-height:1.4}.agent-preview dl{display:grid;gap:0;text-align:left}.agent-preview dl div{display:flex;justify-content:space-between;padding:10px 3px;border-bottom:1px solid #203940}.agent-preview dt{color:#78979b}.agent-preview dd{margin:0;color:#b6cecb}.config-error{margin:0 42px 15px;padding:12px 14px;border:1px solid #7a3b45;background:#301b21;color:#ffaaaa}.config-actions{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:16px 42px;border-top:1px solid var(--ac-line);background:#08171df2;backdrop-filter:blur(14px)}.config-actions>div{display:grid;margin-right:auto}.config-actions small{color:#69888d}.config-actions button{padding:11px 15px;border-radius:9px;font-weight:700}.restore{border:1px solid #31515a;background:transparent;color:#a9c4c2}.save{border:0;background:var(--ac-mint);color:#062019}.save:disabled{opacity:.55}@keyframes spin{to{transform:rotate(360deg)}}@keyframes enter{from{opacity:0;transform:translateY(7px)}}@keyframes wave{50%{transform:scaleY(.45)}}@media(max-width:1050px){.config-layout{grid-template-columns:1fr}.agent-preview{border-left:0;border-top:1px solid var(--ac-line)}.advanced-grid{grid-template-columns:1fr}.agent-preview dl{max-width:500px;margin:auto}}@media(max-width:700px){.config-intro{padding:28px 22px;flex-direction:column}.connection-chip{width:max-content}.config-steps{padding:0;overflow:auto}.config-steps button{min-width:130px}.config-stage{padding:28px 20px 20px}.field-grid,.preset-grid,.tool-grid{grid-template-columns:1fr}.permission-flow{font-size:11px}.permission-flow span{padding:9px}.config-actions{padding:14px 20px;flex-wrap:wrap}.config-actions>div{width:100%}.config-actions button{flex:1}}
</style>
