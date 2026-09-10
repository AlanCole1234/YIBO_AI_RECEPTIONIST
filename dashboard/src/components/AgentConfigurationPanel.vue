<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  api,
  ApiError,
  type AgentConfiguration,
  type AgentConfigurationPayload,
  type AgentToolName,
  type ReasoningEffort,
} from "../services/api";

defineProps<{ locale: "es-MX" | "en-US" }>();

type Step = "identity" | "conversation" | "abilities" | "instructions";
type VadPreset = "auto" | "fast" | "balanced" | "patient" | "custom";

const steps: Array<{ id: Step; number: string; label: string }> = [
  { id: "identity", number: "01", label: "Identity" },
  { id: "conversation", number: "02", label: "Conversation" },
  { id: "abilities", number: "03", label: "Actions" },
  { id: "instructions", number: "04", label: "Instructions" },
];
const models = [
  { value: "gpt-realtime-2.1", label: "GPT Realtime 2.1", note: "Best conversational quality" },
  { value: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 Mini", note: "Lower cost" },
];
const voices = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const reasoningEfforts: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const locales = [
  ["es-MX", "Español · México"], ["es-US", "Español · Estados Unidos"],
  ["es-ES", "Español · España"], ["en-US", "English · United States"],
  ["en-GB", "English · United Kingdom"], ["pt-BR", "Português · Brasil"],
];
const vadPresets: Record<Exclude<VadPreset, "custom">, AgentConfiguration["conversation"]["turnDetection"]> = {
  auto: { silenceDurationMs: 800 },
  fast: { threshold: 0.58, prefixPaddingMs: 240, silenceDurationMs: 380 },
  balanced: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 600 },
  patient: { threshold: 0.44, prefixPaddingMs: 420, silenceDurationMs: 1000 },
};
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const apiKeyConfigured = ref(false);
const configuration = ref<AgentConfiguration>();
const recommended = ref<AgentConfiguration>();
const availableTools = ref<AgentConfigurationPayload["availableTools"]>([]);
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
  if (caught instanceof ApiError) return `Could not save the configuration (${caught.code}).`;
  return caught instanceof Error ? caught.message : "Could not load the configuration.";
}
</script>

<template>
  <section class="agent-config agent-config-v2" aria-labelledby="agent-config-title">
    <div class="config-intro">
      <div>
        <p class="config-kicker">02 · AGENT SETTINGS</p>
        <h2 id="agent-config-title">Fine-tune how YIBO talks.</h2>
        <p>Listen first, change one thing, then test again. Settings are saved for this business and apply to the next conversation.</p>
      </div>
      <div :class="['connection-chip', { ready: apiKeyConfigured }]">
        <i></i>{{ apiKeyConfigured ? "API ready" : "API key needed" }}
      </div>
    </div>

    <div v-if="loading" class="config-state"><i></i>Preparing settings…</div>
    <div v-else-if="!configuration" class="config-state error-state">{{ error }}</div>

    <form v-else @submit.prevent="save">
      <nav class="config-steps" aria-label="Configuration steps">
        <button v-for="(item, index) in steps" :key="item.id" type="button"
          :class="{ active: step === item.id, complete: index < currentStep }" @click="selectStep(item.id)">
          <small>{{ item.number }}</small><span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="config-layout">
        <div class="config-stage">
          <section v-if="step === 'identity'" class="step-panel">
            <div class="step-heading"><span>01</span><div><h3>Conversation personality</h3><p>Choose the model, voice, and language callers will hear.</p></div></div>
            <div class="field-grid">
              <label>Conversation model<select v-model="configuration.conversation.model"><option v-for="model in models" :key="model.value" :value="model.value">{{ model.label }} — {{ model.note }}</option></select><small>Sets the approximate quality, speed, and cost of each turn.</small></label>
              <label>YIBO voice<select v-model="configuration.voice"><option v-for="voice in voices" :key="voice" :value="voice">{{ voice[0]?.toUpperCase() }}{{ voice.slice(1) }}</option></select><small>This is the sound callers will hear. Marin and Cedar are good starting points.</small></label>
              <label>Language and region<select v-model="configuration.locale"><option v-for="candidate in locales" :key="candidate[0]" :value="candidate[0]">{{ candidate[1] }}</option></select><small>Adjusts pronunciation, vocabulary, dates, and times.</small></label>
              <label>Reasoning<select v-model="configuration.conversation.reasoningEffort"><option v-for="effort in reasoningEfforts" :key="effort" :value="effort">{{ effort }}</option></select><small>More reasoning adds latency and cost; minimal is recommended.</small></label>
            </div>
            <label class="token-control"><span>Maximum response length <output>{{ configuration.conversation.maxOutputTokens }} tokens</output></span><input v-model.number="configuration.conversation.maxOutputTokens" type="range" min="64" max="4096" step="64"><small>This is a ceiling, not a target. A normal response can use much less.</small></label>
          </section>

          <section v-else-if="step === 'conversation'" class="step-panel">
            <div class="step-heading"><span>02</span><div><h3>Conversation pacing</h3><p>Control when YIBO understands that you have finished speaking.</p></div></div>
            <div class="preset-grid">
              <button v-for="preset in (['auto','fast','balanced','patient'] as const)" :key="preset" type="button" :class="{ selected: vadPreset === preset }" @click="applyVad(preset)"><i>{{ preset === 'auto' ? '✦' : preset === 'fast' ? '⚡' : preset === 'balanced' ? '◉' : '◌' }}</i><strong>{{ {auto:'Automatic',fast:'Fast',balanced:'Balanced',patient:'Patient'}[preset] }}</strong><small>{{ preset === 'auto' ? 'Uses provider-managed values.' : preset === 'fast' ? 'Responds quickly in quiet environments.' : preset === 'balanced' ? 'A good starting point for a phone receptionist.' : 'Allows longer pauses before responding.' }}</small></button>
            </div>
            <details class="advanced"><summary>Advanced settings <span>{{ vadPreset === 'custom' ? 'Custom' : 'Optional' }}</span></summary><p>Change these only after listening to real conversations.</p><div class="advanced-grid">
              <label>Sensitivity <output>{{ configuration.conversation.turnDetection.threshold ?? 0.5 }}</output><input v-model.number="configuration.conversation.turnDetection.threshold" type="range" min="0" max="1" step="0.01"></label>
              <label>Audio before speech <output>{{ configuration.conversation.turnDetection.prefixPaddingMs ?? 300 }} ms</output><input v-model.number="configuration.conversation.turnDetection.prefixPaddingMs" type="range" min="0" max="1000" step="20"></label>
              <label>End-of-turn silence <output>{{ configuration.conversation.turnDetection.silenceDurationMs ?? 600 }} ms</output><input v-model.number="configuration.conversation.turnDetection.silenceDurationMs" type="range" min="100" max="2000" step="50"></label>
            </div></details>
          </section>

          <section v-else-if="step === 'abilities'" class="step-panel">
            <div class="step-heading"><span>03</span><div><h3>Capabilities and limits</h3><p>The model can request these actions; ToolExecutor still validates and executes them.</p></div></div>
            <div class="permission-flow"><span>Model<small>requests</small></span><b>→</b><span class="gate">ToolExecutor<small>validates</small></span><b>→</b><span>YIBO<small>executes</small></span></div>
            <div class="tool-grid"><button v-for="tool in availableTools" :key="tool.name" type="button" :class="{ enabled: configuration.enabledTools.includes(tool.name) }" @click="toggleTool(tool.name)"><i>{{ tool.icon || '•' }}</i><span><small>{{ tool.kind === 'consult' ? 'Read only' : tool.kind === 'mutate' ? 'Changes data' : 'External action' }}</small><strong>{{ tool.title || tool.name }}</strong><p>{{ tool.help || tool.description }}</p><em>Safe route: {{ tool.route || 'Backend validation' }}</em></span><b></b></button></div>
            <p class="security-note">The model never receives direct database access. Tenant, call, and customer arrive as trusted system context.</p>
          </section>

          <section v-else class="step-panel">
            <div class="step-heading"><span>04</span><div><h3>Core instructions</h3><p>Describe YIBO's role, tone, and limits with clear rules.</p></div></div>
            <label class="prompt-field">Active instructions<textarea v-model="configuration.instructions" rows="12"></textarea><small>Do not include secrets or personal data. {{ configuration.instructions.length }} characters.</small></label>
          </section>

          <div class="step-actions"><button type="button" :disabled="currentStep === 0" @click="move(-1)">← Previous</button><span>Step {{ currentStep + 1 }} of 4</span><button type="button" :disabled="currentStep === 3" @click="move(1)">Next →</button></div>
        </div>

        <aside class="agent-preview">
          <small>PREVIEW</small><div class="voice-orb"><i></i><i></i><i></i><i></i><i></i></div>
          <h3>{{ configuration.conversation.model.replace('gpt-', 'GPT ') }}</h3><p>Voice <strong>{{ configuration.voice }}</strong> · {{ configuration.locale }}</p>
          <blockquote>“{{ configuration.locale.startsWith('en') ? "Hello, I'm YIBO. How can I help?" : 'Hola, soy YIBO. ¿En qué puedo ayudarte?' }}”</blockquote>
          <button type="button" class="preview-button" @click="playVoicePreview">{{ speechPlaying ? '■ Stop preview' : '▶ Listen to a free preview' }}</button>
          <small class="preview-note">Uses your browser's local voice. It does not use the API and does not exactly represent the OpenAI voice.</small>
          <dl><div><dt>Response</dt><dd>{{ configuration.conversation.maxOutputTokens }} max tokens</dd></div><div><dt>Capabilities</dt><dd>{{ activeToolCount }} active</dd></div><div><dt>Protection</dt><dd>Trusted context</dd></div></dl>
        </aside>
      </div>

      <p v-if="error" class="config-error" role="alert">{{ error }}</p>
      <footer class="config-actions"><div><strong>{{ saved ? 'Settings saved' : 'Applies to the next conversation' }}</strong><small>The active runtime does not change in the middle of a call.</small></div><button type="button" class="restore" @click="restoreRecommended">Restore recommended</button><button class="save" :disabled="saving">{{ saving ? 'Saving…' : 'Save settings' }}</button></footer>
    </form>
  </section>
</template>

<style scoped>
.agent-config{--ac-bg:#07151c;--ac-panel:#0c2029;--ac-line:#24444e;--ac-mint:#5ee8c4;--ac-amber:#f6c85f;--ac-ink:#eaf7f4;color:var(--ac-ink);background:linear-gradient(145deg,#091a21,#061117);border:1px solid var(--ac-line);clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px);overflow:hidden;box-shadow:0 30px 80px #0007}.config-intro{display:flex;justify-content:space-between;gap:30px;padding:42px 46px 32px;background:radial-gradient(circle at 80% 0,#133c3c 0,transparent 35%)}.config-intro h2{margin:0 0 10px;color:#fff;font-size:clamp(28px,4vw,48px);text-transform:none;text-shadow:none}.config-intro p:not(.config-kicker){max-width:680px;color:#91afb3}.config-kicker{color:var(--ac-mint);font:700 11px/1 monospace;letter-spacing:.2em}.connection-chip{height:max-content;display:flex;align-items:center;gap:8px;padding:10px 13px;background:#321d22;border:1px solid #6a3d45;color:#ff9b9b;font:700 11px/1 monospace;text-transform:uppercase}.connection-chip i{width:7px;height:7px;border-radius:50%;background:currentColor}.connection-chip.ready{background:#12352e;border-color:#296958;color:var(--ac-mint)}.config-state{min-height:300px;display:grid;place-content:center;gap:15px;color:#91afb3}.config-state i{width:38px;height:38px;border:3px solid var(--ac-line);border-top-color:var(--ac-mint);border-radius:50%;animation:spin 1s linear infinite}.error-state{color:#ff9a9a}.config-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:0;padding:0 46px;border-bottom:1px solid var(--ac-line)}.config-steps button{display:flex;gap:10px;align-items:center;padding:17px 12px;border:0;border-bottom:3px solid transparent;background:transparent;color:#6f8e93;text-align:left}.config-steps button small{color:#52747a;font-family:monospace}.config-steps button.active{color:#fff;border-color:var(--ac-mint);background:#0d242c}.config-steps button.complete small{color:var(--ac-mint)}.config-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px}.config-stage{padding:40px 42px 24px;min-width:0}.step-panel{animation:enter .24s ease-out}.step-heading{display:flex;gap:16px;align-items:flex-start;margin-bottom:28px}.step-heading>span{width:45px;height:45px;display:grid;place-items:center;flex:none;background:var(--ac-mint);color:#06201a;font-weight:900;border-radius:14px 4px 14px 5px}.step-heading h3{margin:0 0 5px;color:#fff;font:700 25px/1.1 inherit}.step-heading p{margin:0;color:#84a1a6}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.field-grid label,.token-control,.advanced-grid label,.prompt-field{display:grid;gap:8px;color:#d9e8e6;font-weight:700}.field-grid small,.token-control small,.prompt-field small{color:#729196;font-weight:400;line-height:1.4}.field-grid select,.prompt-field textarea{width:100%;border:1px solid #31545e;background:#08171d;color:#eaf7f4;padding:13px;border-radius:9px}.field-grid select:focus,.prompt-field textarea:focus{outline:2px solid #5ee8c455;border-color:var(--ac-mint)}.token-control{margin-top:24px;padding:18px;background:#0b1d24;border-left:4px solid var(--ac-amber)}.token-control>span{display:flex;justify-content:space-between}.token-control output,.advanced output{color:var(--ac-mint)}input[type=range]{accent-color:var(--ac-mint)}.preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.preset-grid button{display:grid;grid-template-columns:38px 1fr;text-align:left;gap:10px;padding:15px;border:1px solid var(--ac-line);border-radius:12px;background:#0a1b22;color:#dcecea}.preset-grid button i{grid-row:1/3;width:34px;height:34px;display:grid;place-items:center;background:#16323a;color:var(--ac-mint);font-style:normal;border-radius:10px}.preset-grid button small{color:#779499;line-height:1.4}.preset-grid button.selected{border-color:var(--ac-mint);background:#102d2c;box-shadow:inset 4px 0 0 var(--ac-mint)}.advanced{margin-top:22px;border:1px solid var(--ac-line);background:#09191f;padding:15px}.advanced summary{display:flex;justify-content:space-between;color:#cde0dd;cursor:pointer;font-weight:700}.advanced summary span{color:var(--ac-amber);font-size:11px}.advanced>p{color:#78969a}.advanced-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.advanced-grid label{padding:12px;background:#0d2229}.advanced-grid output{font-size:12px}.permission-flow{display:flex;align-items:center;justify-content:center;margin:0 0 24px}.permission-flow span{display:grid;padding:11px 20px;border:1px solid var(--ac-line);background:#0a1b22;text-align:center}.permission-flow small{color:#759297}.permission-flow b{color:var(--ac-mint);padding:0 8px}.permission-flow .gate{border-color:var(--ac-mint);background:#13342f;color:var(--ac-mint)}.tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tool-grid button{display:grid;grid-template-columns:38px 1fr 36px;gap:12px;padding:16px;text-align:left;border:1px solid var(--ac-line);background:#091a21;color:#dbe9e7;border-radius:13px}.tool-grid button>i{width:36px;height:36px;display:grid;place-items:center;background:#173039;color:#91adb1;border-radius:10px;font:normal 22px/1 inherit}.tool-grid button span{display:grid;gap:3px}.tool-grid button span>small{color:#708e93;text-transform:uppercase;font-size:9px;letter-spacing:.08em}.tool-grid button p{margin:5px 0;color:#7e9b9f;font-size:12px;line-height:1.45}.tool-grid button em{color:#557b7e;font-size:10px;font-style:normal}.tool-grid button>b{width:34px;height:20px;padding:3px;border-radius:20px;background:#293e43}.tool-grid button>b:after{content:"";display:block;width:14px;height:14px;border-radius:50%;background:#73878a;transition:.2s}.tool-grid button.enabled{border-color:#397b6d;background:#102722}.tool-grid button.enabled>i{background:#17473d;color:var(--ac-mint)}.tool-grid button.enabled>b{background:#269c82}.tool-grid button.enabled>b:after{transform:translateX(14px);background:#fff}.security-note{padding:14px;border:1px solid #315063;background:#0e1e2a;color:#8ca6ae;font-size:12px}.prompt-field textarea{min-height:280px;resize:vertical;line-height:1.65}.step-actions{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:18px;border-top:1px solid var(--ac-line)}.step-actions button{border:0;background:transparent;color:var(--ac-mint);padding:8px}.step-actions button:disabled{opacity:.25}.step-actions span{color:#66868b;font-size:11px}.agent-preview{padding:38px 24px;border-left:1px solid var(--ac-line);background:linear-gradient(180deg,#0d2229,#08171d);text-align:center}.agent-preview>small:first-child{color:#68898e;letter-spacing:.17em}.voice-orb{width:112px;height:112px;margin:28px auto 20px;display:flex;align-items:center;justify-content:center;gap:4px;border-radius:38px;background:radial-gradient(circle,#236858,#102a2b 65%);box-shadow:0 0 0 7px #173139,0 0 45px #37d4b32e}.voice-orb i{width:4px;height:36px;background:var(--ac-mint);border-radius:5px;animation:wave 1.2s ease-in-out infinite}.voice-orb i:nth-child(2),.voice-orb i:nth-child(4){height:22px;animation-delay:.18s}.voice-orb i:first-child,.voice-orb i:last-child{height:12px;animation-delay:.32s}.agent-preview h3{margin:0 0 5px;color:#fff;text-transform:capitalize}.agent-preview>p{color:#759399}.agent-preview blockquote{margin:22px 0 12px;padding:15px;background:#142b33;color:#c8dbd9;text-align:left;border-radius:14px;line-height:1.5}.preview-button{width:100%;border:1px solid #397165;background:#13362f;color:var(--ac-mint);padding:10px;border-radius:10px;font-weight:700}.preview-note{display:block;margin:8px 0 20px;color:#627f83;line-height:1.4}.agent-preview dl{display:grid;gap:0;text-align:left}.agent-preview dl div{display:flex;justify-content:space-between;padding:10px 3px;border-bottom:1px solid #203940}.agent-preview dt{color:#78979b}.agent-preview dd{margin:0;color:#b6cecb}.config-error{margin:0 42px 15px;padding:12px 14px;border:1px solid #7a3b45;background:#301b21;color:#ffaaaa}.config-actions{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:16px 42px;border-top:1px solid var(--ac-line);background:#08171df2;backdrop-filter:blur(14px)}.config-actions>div{display:grid;margin-right:auto}.config-actions small{color:#69888d}.config-actions button{padding:11px 15px;border-radius:9px;font-weight:700}.restore{border:1px solid #31515a;background:transparent;color:#a9c4c2}.save{border:0;background:var(--ac-mint);color:#062019}.save:disabled{opacity:.55}@keyframes spin{to{transform:rotate(360deg)}}@keyframes enter{from{opacity:0;transform:translateY(7px)}}@keyframes wave{50%{transform:scaleY(.45)}}@media(max-width:1050px){.config-layout{grid-template-columns:1fr}.agent-preview{border-left:0;border-top:1px solid var(--ac-line)}.advanced-grid{grid-template-columns:1fr}.agent-preview dl{max-width:500px;margin:auto}}@media(max-width:700px){.config-intro{padding:28px 22px;flex-direction:column}.connection-chip{width:max-content}.config-steps{padding:0;overflow:auto}.config-steps button{min-width:130px}.config-stage{padding:28px 20px 20px}.field-grid,.preset-grid,.tool-grid{grid-template-columns:1fr}.permission-flow{font-size:11px}.permission-flow span{padding:9px}.config-actions{padding:14px 20px;flex-wrap:wrap}.config-actions>div{width:100%}.config-actions button{flex:1}}
</style>

<style scoped>
/* Segunda escena en azul y blanco: clara, silenciosa y fácil de recorrer. */
.agent-config{--ac-bg:#fff;--ac-panel:#fff;--ac-line:#c8daf1;--ac-mint:#2354d7;--ac-amber:#76bfff;--ac-ink:#17254a;color:#17254a;border-color:#b9d2ee;border-radius:5px 36px 7px 22px;background:#fff;box-shadow:0 24px 70px #214d941d,9px 10px 0 #9fd0ff}.config-intro{min-height:190px;padding:38px 5% 30px;background:linear-gradient(132deg,#fff 0 76%,#d9ecff 76%)}.config-intro:before{width:185px;height:185px;right:9%;top:-128px;border-color:#2354d7;opacity:.82}.config-intro:after{width:185px;height:7px;left:5%;bottom:24px;background:#76bfff}.config-intro h2{color:#102a68}.config-intro p:not(.config-kicker){color:#697b9e}.config-kicker{color:#2354d7}.connection-chip{color:#2354d7;border-color:#a9c7ea;background:#edf5ff}.connection-chip.ready{color:#1c7047;border-color:#afd8c1;background:#e6f6ed}.config-steps{padding:0 5%;border-color:#c9d9ee;background:#e8f2ff}.config-steps button{color:#7181a2}.config-steps button small{color:#8193b6}.config-steps button.active{color:#fff;border-color:#2354d7;background:#2354d7}.config-steps button.active small{color:#dceaff}.config-steps button.complete small{color:#2354d7}.config-layout{background:#fff}.config-stage{padding:39px 5% 25px}.step-heading>span{color:#fff;background:#2354d7;box-shadow:4px 5px 0 #9dccff}.step-heading h3{color:#15306e}.step-heading p{color:#7484a3}.field-grid label,.token-control,.advanced-grid label,.prompt-field{color:#31456f}.field-grid small,.token-control small,.prompt-field small{color:#7b8baa}.field-grid select,.prompt-field textarea{color:#182750;border-color:#b8cce7;background:#fbfdff}.field-grid select:focus,.prompt-field textarea:focus{border-color:#2354d7;box-shadow:0 0 0 4px #2354d713}.token-control{border-color:#2354d7;background:#e8f2ff}.token-control output,.advanced output{color:#2354d7}input[type=range]{accent-color:#2354d7}.preset-grid button{color:#243964;border-color:#c6d7ed;background:#f8fbff}.preset-grid button i{color:#2354d7;background:#e4f0ff}.preset-grid button small{color:#7789aa}.preset-grid button.selected{border-color:#3c70df;background:#e1edff;box-shadow:inset 5px 0 0 #2354d7}.advanced{border-color:#c5d6ec;background:#edf4fc}.advanced summary{color:#31456e}.advanced summary span{color:#2354d7}.advanced>p{color:#7b8dab}.advanced-grid label{background:#fff}.permission-flow span{color:#344971;border-color:#c3d4eb;background:#f3f8ff}.permission-flow small{color:#8292b0}.permission-flow b{color:#2354d7}.permission-flow .gate{color:#fff;border-color:#173b9c;background:#2354d7}.permission-flow .gate small{color:#d5e5ff}.tool-grid button{color:#2e416b;border-color:#c2d4ea;background:#f9fcff}.tool-grid button>i{color:#2354d7;background:#e4f0ff}.tool-grid button span>small{color:#7b8dab}.tool-grid button p{color:#6f81a2}.tool-grid button em{color:#6080b1}.tool-grid button>b{background:#d3dfed}.tool-grid button.enabled{border-color:#5885e4;background:#e5efff}.tool-grid button.enabled>i{color:#fff;background:#2354d7}.tool-grid button.enabled>b{background:#2354d7}.security-note{color:#345d7a;border-color:#afd1e8;border-left-color:#338ed0;background:#e6f5ff}.step-actions{border-color:#d5e1f1}.step-actions button{color:#2354d7}.step-actions span{color:#8291ad}.agent-preview{margin:24px 20px 36px -3px;color:#fff;border-radius:29px 6px 22px 7px;background:linear-gradient(155deg,#14358d,#2354d7 70%,#4b8cf2);box-shadow:8px 9px 0 #9fd1ff}.agent-preview>small:first-child{color:#c3d8ff}.voice-orb{background:radial-gradient(circle,#77bcff,#2354d7 68%);box-shadow:0 0 0 7px #4d7add,8px 9px 0 #0f2b70}.voice-orb i{background:#fff}.agent-preview h3{color:#fff}.agent-preview>p{color:#d1e1ff}.agent-preview blockquote{color:#15306b;background:#e4f2ff}.preview-button{color:#fff;border-color:#9ac8ff;background:#1746bd}.preview-button:hover{background:#2860d8}.preview-note{color:#bdd3fa}.agent-preview dl div{border-color:#ffffff26}.agent-preview dt{color:#c6d9fa}.agent-preview dd{color:#fff}.config-error{color:#8b2b3d;border-color:#e2aab4;background:#fff0f2}.config-actions{margin:0 3% 17px 5%;border-color:#c7d8ed;background:#f3f8ffee}.config-actions strong{color:#27406c}.config-actions small{color:#7889a8}.restore{color:#506b9d;border-color:#b7cbe6}.save{color:#fff;background:#2354d7;box-shadow:4px 5px 0 #9bcaff}.save:hover:not(:disabled){box-shadow:2px 3px 0 #9bcaff}@media(max-width:700px){.config-intro{background:#fff}.config-intro:before{opacity:.35}}
</style>

<style scoped>
/* Nocturne: la prueba es protagonista; la configuración queda como segundo acto. */
.agent-config{color:#2b2425;border:1px solid #cfc2b3;border-radius:5px 34px 7px 21px;background:#f4ecdf;box-shadow:0 24px 70px #0006,9px 10px 0 #712434}.config-intro{min-height:190px;align-items:center;padding:38px 5% 30px;background:linear-gradient(132deg,#20191c 0 76%,#4f2430 76%)}.config-intro:before{width:180px;height:180px;right:9%;top:-126px;border:25px solid #df4b59;opacity:.7}.config-intro:after{width:180px;height:7px;left:5%;bottom:24px;background:#f0a071}.config-intro h2{max-width:620px;color:#fff7ed;font-size:clamp(36px,4vw,54px)}.config-intro p:not(.config-kicker){max-width:680px;color:#bba9ae}.config-kicker{color:#f0a071}.connection-chip{color:#efb8bf;border-color:#793a48;background:#3b2028}.connection-chip.ready{color:#cbd6c5;border-color:#66715f;background:#293027}.config-steps{padding:0 5%;border-color:#d0c4b6;background:#ded3c6}.config-steps button{color:#776a64}.config-steps button.active{color:#3b272e;border-color:#df4b59;background:#f4ecdf}.config-steps button.complete small{color:#b02f44}.config-layout{grid-template-columns:minmax(0,1fr) 310px;background:#f4ecdf}.config-stage{padding:39px 5% 25px}.step-heading>span{background:#df4b59;box-shadow:4px 5px 0 #7c2333}.step-heading h3{color:#3d2930}.field-grid select,.prompt-field textarea{background:#fffaf2}.token-control{border-color:#df4b59;background:#e6dacb}.token-control output,.advanced output{color:#a02f42}input[type=range]{accent-color:#df4b59}.preset-grid button{background:#f9f3e9}.preset-grid button i{color:#9f3042;background:#efd9dc}.preset-grid button.selected{border-color:#bd4457;background:#f0dadd;box-shadow:inset 5px 0 0 #df4b59}.advanced{background:#e8ded1}.permission-flow .gate{border-color:#4d2630;background:#4d2630}.permission-flow b{color:#b42e44}.tool-grid button{background:#faf4ea}.tool-grid button>i{color:#a42e43;background:#f0dade}.tool-grid button.enabled{border-color:#bc5768;background:#efdadd}.tool-grid button.enabled>i{background:#a52f43}.security-note{border-color:#adb9a8;border-left-color:#71806f;background:#dfe6da}.agent-preview{margin:24px 20px 36px -3px;border-radius:27px 6px 21px 7px;background:linear-gradient(155deg,#271c20,#4c2530 70%,#752d3f);box-shadow:8px 9px 0 #e36b70;transform:none}.voice-orb{background:radial-gradient(circle,#d75b69,#6f2939 68%);box-shadow:0 0 0 7px #66313e,8px 9px 0 #170f12}.voice-orb i{background:#f4c092}.agent-preview blockquote{background:#f2d9bc}.preview-button{border-color:#c46f7d;background:#762d3f}.config-actions{margin:0 3% 17px 5%;background:#eee4d7ee}.save{background:#df4b59;box-shadow:4px 5px 0 #7c2333}.save:hover:not(:disabled){box-shadow:2px 3px 0 #7c2333}@media(max-width:1050px){.config-layout{grid-template-columns:1fr}.agent-preview{margin:8px 8% 40px}}@media(max-width:700px){.config-intro{padding:31px 23px 46px;background:#21191c}.config-intro h2{font-size:38px}.agent-preview{margin:8px 22px 34px}.config-actions{margin:0}}
</style>

<style scoped>
/* Dirección editorial de YIBO: cálida, táctil y deliberadamente imperfecta. */
.agent-config {
  --ac-bg: #fbf7ef;
  --ac-panel: #fffdf8;
  --ac-line: #d7ccbe;
  --ac-mint: #8d3448;
  --ac-amber: #d39a4a;
  --ac-ink: #28231f;
  color: var(--ac-ink);
  background: #fbf7ef;
  border: 1px solid #d1c5b7;
  border-radius: 8px 46px 9px 26px;
  clip-path: none;
  box-shadow: 12px 16px 0 #d9cfc2, 0 35px 90px #5c3e2d20;
  overflow: hidden;
}

.config-intro {
  position: relative;
  min-height: 225px;
  align-items: flex-end;
  padding: 48px 6% 38px;
  overflow: hidden;
  background: #f8f1e7;
  isolation: isolate;
}
.config-intro::before {
  content: "";
  position: absolute;
  width: 245px;
  height: 245px;
  right: 7%;
  top: -135px;
  border: 28px solid #e6b25f;
  border-radius: 48% 52% 43% 57%;
  transform: rotate(19deg);
  z-index: -1;
}
.config-intro::after {
  content: "";
  position: absolute;
  width: 230px;
  height: 10px;
  left: 5%;
  bottom: 20px;
  background: #8d3448;
  clip-path: polygon(0 28%, 100% 0, 96% 65%, 3% 100%);
  transform: rotate(-1.2deg);
  z-index: -1;
}
.config-intro h2 {
  max-width: 720px;
  color: #31272a;
  font: 500 clamp(39px, 5vw, 64px)/.98 "Iowan Old Style", Georgia, serif;
  letter-spacing: -.055em;
}
.config-intro p:not(.config-kicker) { max-width: 620px; color: #6b625b; font-size: 15px; line-height: 1.55; }
.config-kicker { color: #8d3448; letter-spacing: .18em; }
.connection-chip { color: #823847; border: 1px solid #c88c97; border-radius: 999px; background: #f3dfe2; }
.connection-chip.ready { color: #405043; border-color: #a6b5a2; background: #dfe6db; }

.config-steps { padding: 0 6%; border-color: #d7ccbe; background: #f2ebe1; }
.config-steps button { color: #81766d; border-radius: 16px 16px 0 0; }
.config-steps button small { color: #9a8b81; }
.config-steps button.active { color: #3e2930; border-color: #8d3448; background: #fffaf2; }
.config-steps button.complete small { color: #8d3448; }

.config-layout { grid-template-columns: minmax(0, 1fr) 320px; background: #fffaf2; }
.config-stage { padding: 45px 5% 28px 6%; }
.step-heading>span { color: #fff8ef; background: #8d3448; border-radius: 48% 41% 53% 38%; box-shadow: 4px 5px 0 #e4b45f; transform: rotate(-5deg); }
.step-heading h3 { color: #3d2930; font: 500 29px/1.1 "Iowan Old Style", Georgia, serif; }
.step-heading p { color: #786e66; }

.field-grid label, .token-control, .advanced-grid label, .prompt-field { color: #453d37; }
.field-grid small, .token-control small, .prompt-field small { color: #81766d; }
.field-grid select, .prompt-field textarea { color: #2e2925; border: 1px solid #bfb2a4; border-radius: 7px 17px 7px 12px; background: #fffdf8; }
.field-grid select:focus, .prompt-field textarea:focus { border-color: #8d3448; box-shadow: 0 0 0 4px #8d344814; }
.token-control { padding: 18px 20px; border-left: 5px solid #d39a4a; border-radius: 0 16px 16px 0; background: #efe6da; }
.token-control output, .advanced output { color: #8d3448; }
input[type=range] { accent-color: #8d3448; }

.preset-grid button { color: #37302b; border-color: #d2c7ba; border-radius: 7px 19px 7px 13px; background: #fbf7f0; }
.preset-grid button:nth-child(even) { transform: translateY(8px); }
.preset-grid button i { color: #8d3448; background: #f0dfe1; }
.preset-grid button small { color: #80756c; }
.preset-grid button.selected { border-color: #8d3448; background: #f4e4e6; box-shadow: inset 5px 0 0 #8d3448; }
.advanced { border-color: #d2c7ba; border-radius: 7px 18px 7px 13px; background: #f0e9df; }
.advanced summary { color: #453b35; }
.advanced summary span { color: #8d3448; }
.advanced>p { color: #81766d; }
.advanced-grid label { background: #fffaf3; }

.permission-flow span { color: #4b423c; border-color: #ccbfb1; background: #f5eee4; }
.permission-flow small { color: #8a7e74; }
.permission-flow b { color: #8d3448; }
.permission-flow .gate { color: #fff7ee; border-color: #4a2630; background: #4a2630; }
.permission-flow .gate small { color: #d8bdc3; }
.tool-grid button { color: #403833; border-color: #d1c5b7; border-radius: 7px 20px 7px 14px; background: #fbf7ef; }
.tool-grid button>i { color: #8d3448; background: #f1e0e2; }
.tool-grid button span>small { color: #927f76; }
.tool-grid button p { color: #766c64; }
.tool-grid button em { color: #8d736d; }
.tool-grid button>b { background: #d6cec4; }
.tool-grid button>b::after { background: #8f867f; }
.tool-grid button.enabled { border-color: #9e5665; background: #f3e2e4; }
.tool-grid button.enabled>i { color: #fff8ef; background: #8d3448; }
.tool-grid button.enabled>b { background: #8d3448; }
.security-note { color: #566057; border-color: #b9c2b4; border-left: 5px solid #728075; background: #e6ebe2; }

.prompt-field textarea { min-height: 310px; }
.step-actions { border-color: #d8cec0; }
.step-actions button { color: #8d3448; }
.step-actions span { color: #887d74; }

.agent-preview {
  position: relative;
  margin: 28px 24px 40px -4px;
  padding: 40px 25px 30px;
  color: #fff8ef;
  border: 0;
  border-radius: 33px 7px 25px 8px;
  background: linear-gradient(160deg, #3e2b31, #4f2934 68%, #6b3040);
  box-shadow: 10px 12px 0 #e0b05d;
  transform: rotate(.35deg);
}
.agent-preview>small:first-child { color: #cbb7bb; }
.voice-orb { background: radial-gradient(circle, #ac4c60, #6d2f3e 68%); box-shadow: 0 0 0 7px #6c3a46, 9px 11px 0 #2f2226; }
.voice-orb i { background: #f1c671; }
.agent-preview h3 { color: #fff8ef; font: 500 25px/1.1 "Iowan Old Style", Georgia, serif; }
.agent-preview>p { color: #d6bdc2; }
.agent-preview blockquote { color: #352a28; border-radius: 5px 18px 7px 14px; background: #f4dfb9; font-family: "Iowan Old Style", Georgia, serif; font-size: 17px; }
.preview-button { width: auto; color: #fff4e8; border-color: #bd7c89; border-radius: 999px; background: #6c3040; }
.preview-button:hover { background: #84394d; }
.preview-note { color: #bda5aa; }
.agent-preview dl div { border-color: #ffffff1a; }
.agent-preview dt { color: #c8b0b5; }
.agent-preview dd { color: #fff4e8; }

.config-error { color: #6d2836; border-color: #c88f99; background: #f2dcdf; }
.config-actions { margin: 0 3% 18px 6%; padding: 15px 18px; border: 1px solid #d2c6b9; border-radius: 18px 6px 16px 7px; background: #f7f1e8ee; box-shadow: 0 12px 30px #61443219; }
.config-actions strong { color: #433a35; }
.config-actions small { color: #857970; }
.restore { color: #6c4f52; border-color: #bdaeb0; background: transparent; }
.save { color: #fff8ef; background: #8d3448; box-shadow: 4px 5px 0 #4a2630; }
.save:hover:not(:disabled) { transform: translate(2px, 2px); box-shadow: 2px 3px 0 #4a2630; }

@media(max-width:1050px) {
  .config-layout { grid-template-columns: 1fr; }
  .agent-preview { margin: 10px 8% 45px; }
}
@media(max-width:700px) {
  .agent-config { border-radius: 6px 27px 7px 18px; box-shadow: 6px 9px 0 #d9cfc2; }
  .config-intro { min-height: auto; padding: 36px 25px 50px; }
  .config-intro h2 { font-size: 40px; }
  .config-intro::before { opacity: .45; }
  .preset-grid button:nth-child(even) { transform: none; }
  .agent-preview { display: block; margin: 10px 24px 38px; }
  .config-actions { margin: 0; border-width: 1px 0 0; border-radius: 0; }
}
</style>
