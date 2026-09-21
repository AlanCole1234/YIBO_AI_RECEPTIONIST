<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type RealtimeModelPricing } from "../services/api";
import {
  addRealtimeUsage,
  emptyRealtimeSessionUsage,
  estimateRealtimeCost,
} from "../services/realtime-cost";
import { previewBlockReason } from "../services/voice-preview";
const props = defineProps<{ expectedTenantId?: string }>();
const previewMetadata = ref<Record<string, unknown>>();
const previewBlocked = computed(() => previewBlockReason(props.expectedTenantId, previewMetadata.value));

type LabState = "connecting" | "idle" | "listening" | "speaking" | "closed" | "error";
type AudioContextConstructor = typeof AudioContext;
type Playback = { assistantTurnId: string; startedAt: number; nodes: AudioBufferSourceNode[] };
type AudioMetadata = { type: "audio.chunk"; assistantTurnId: string; bytes: number };

const state = ref<LabState>("connecting");
const events = ref<string[]>([]);
const sessionUsed = ref(false);
const sessionUsage = ref(emptyRealtimeSessionUsage());
const selectedPricing = ref<RealtimeModelPricing>();
const elapsedSeconds = ref(0);
let sessionStartedAt: number | undefined;
let sessionEndedAt: number | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let socket: WebSocket | undefined;
let context: AudioContext | undefined;
let stream: MediaStream | undefined;
let source: MediaStreamAudioSourceNode | undefined;
let processor: ScriptProcessorNode | undefined;
let pendingAudio: AudioMetadata | undefined;
let playbackAt = 0;
let playback: Playback | undefined;
let playbackChain = Promise.resolve();
let announcedAssistantTurnId: string | undefined;

const connected = ref(false);
const aiSessionConnected = ref(false);
const calendarToolsAvailable = ref(false);
const clinicTimezone = ref("Loading…");
const calendarStatus = ref<"connected" | "needs setup" | "unavailable">("unavailable");
const microphoneActive = computed(() => state.value === "listening" || state.value === "speaking");
const estimatedCost = computed(() => estimateRealtimeCost(sessionUsage.value, selectedPricing.value));
const estimatedCostPerMinute = computed(() => elapsedSeconds.value >= 5 && estimatedCost.value !== null
  ? estimatedCost.value / elapsedSeconds.value * 60
  : null);
const elapsedLabel = computed(() => `${String(Math.floor(elapsedSeconds.value / 60)).padStart(2, "0")}:${String(elapsedSeconds.value % 60).padStart(2, "0")}`);
const textTokens = computed(() => sessionUsage.value.inputTextTokens + sessionUsage.value.outputTextTokens);
const audioTokens = computed(() => sessionUsage.value.inputAudioTokens + sessionUsage.value.outputAudioTokens);
const statusCopy = computed(() => ({
  connecting: ["Connecting your studio", "Preparing the audio channel"],
  idle: ["Ready when you are", "The microphone is off"],
  listening: ["YIBO is listening", "Speak naturally; you can interrupt too"],
  speaking: ["YIBO is responding", "Try speaking over YIBO to test interruption"],
  closed: ["Session ended", "Reload to start a new conversation"],
  error: ["Studio unavailable", "Check that pnpm dev is still running"],
}[state.value]));

onMounted(() => {
  connect();
  void loadDeveloperReadiness();
  clockTimer = setInterval(updateElapsed, 1_000);
});
onBeforeUnmount(() => {
  stopMicrophone(false);
  stopPlayback();
  socket?.close();
  void context?.close();
  if (clockTimer) clearInterval(clockTimer);
});

function connect(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.hostname}:4317/voice`);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    connected.value = true;
    state.value = "idle";
    addEvent("Voice studio connected");
  });
  socket.addEventListener("close", () => {
    connected.value = false;
    finishClock();
    if (state.value !== "closed") state.value = "error";
    addEvent("Connection closed");
  });
  socket.addEventListener("error", () => {
    connected.value = false;
    state.value = "error";
    addEvent("Could not connect to the voice lab");
  });
  socket.addEventListener("message", ({ data }) => {
    if (typeof data !== "string") {
      queuePcm16(data as ArrayBuffer, pendingAudio);
      pendingAudio = undefined;
      return;
    }
    const message = JSON.parse(data) as Record<string, unknown>;
    if (message.type === "voice.lab.ready") {
      previewMetadata.value = message;
      return;
    }
    if (message.type === "audio.chunk") {
      pendingAudio = message as unknown as AudioMetadata;
      if (pendingAudio.assistantTurnId !== announcedAssistantTurnId) {
        announcedAssistantTurnId = pendingAudio.assistantTurnId;
        addEvent("YIBO audio received");
      }
    }
    else if (message.type === "playback.clear") clearPlayback(String(message.requestId ?? ""));
    else observeEvent(message);
  });
}

async function loadDeveloperReadiness(): Promise<void> {
  try {
    const [business, calendar, configuration] = await Promise.all([
      api.business(), api.googleCalendarStatus(), api.agentConfiguration(),
    ]);
    clinicTimezone.value = business.timezone;
    calendarStatus.value = calendar.connected ? "connected" : calendar.configured ? "needs setup" : "unavailable";
    const activeConfiguration = configuration.current ?? configuration.recommended;
    const enabledTools = activeConfiguration.enabledTools;
    selectedPricing.value = configuration.modelCapabilities.find(({ id }) => id === activeConfiguration.conversation.model)?.pricing;
    calendarToolsAvailable.value = enabledTools.includes("check_availability") && enabledTools.includes("create_appointment");
  } catch {
    clinicTimezone.value = "Unavailable";
    calendarStatus.value = "unavailable";
  }
}

async function startMicrophone(): Promise<void> {
  const activeSocket = socket;
  if (!connected.value || !activeSocket || previewBlocked.value) return;
  try {
    const activeContext = await resumeAudioContext();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
    source = activeContext.createMediaStreamSource(stream);
    processor = activeContext.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (activeSocket.readyState !== WebSocket.OPEN) return;
      activeSocket.send(inputBuffer.getChannelData(0).slice().buffer);
    };
    source.connect(processor);
    processor.connect(activeContext.destination);
    activeSocket.send(JSON.stringify({ type: "mic.start", sampleRate: activeContext.sampleRate, channels: 1 }));
    sessionUsed.value = true;
    state.value = "listening";
    addEvent("Microphone enabled");
  } catch (error) {
    state.value = "error";
    addEvent(error instanceof Error ? error.message : "Could not open the microphone");
  }
}

function stopMicrophone(log = true): void {
  processor?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  processor = undefined;
  source = undefined;
  stream = undefined;
  if (state.value !== "closed" && state.value !== "error") state.value = "idle";
  if (log) addEvent("Microphone paused");
}

function interrupt(): void {
  if (!connected.value || !sessionUsed.value) return;
  socket?.send(JSON.stringify({ type: "interrupt" }));
  addEvent("Interruption requested");
}

function closeSession(): void {
  stopMicrophone(false);
  stopPlayback();
  if (connected.value && sessionUsed.value) socket?.send(JSON.stringify({ type: "close" }));
  state.value = "closed";
  finishClock();
  aiSessionConnected.value = false;
  addEvent("Session closed");
}

async function sendFixture(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !connected.value || previewBlocked.value) return;
  await resumeAudioContext();
  socket?.send(JSON.stringify({ type: "fixture.next", name: file.name }));
  socket?.send(await file.arrayBuffer());
  sessionUsed.value = true;
  addEvent(`WAV enviado · ${file.name}`);
  input.value = "";
}

function queuePcm16(arrayBuffer: ArrayBuffer, metadata?: AudioMetadata): void {
  playbackChain = playbackChain
    .catch(() => undefined)
    .then(() => playPcm16(arrayBuffer, metadata))
    .catch((error: unknown) => {
      state.value = "error";
      addEvent(`Audio playback error: ${error instanceof Error ? error.message : "unknown error"}`);
    });
}

async function playPcm16(arrayBuffer: ArrayBuffer, metadata?: AudioMetadata): Promise<void> {
  if (!metadata?.assistantTurnId) return;
  const activeContext = await resumeAudioContext();
  const pcm = new Int16Array(arrayBuffer);
  if (pcm.length === 0) return;
  const buffer = activeContext.createBuffer(1, pcm.length, 24_000);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) channel[index] = (pcm[index] ?? 0) / 0x8000;
  const node = activeContext.createBufferSource();
  node.buffer = buffer;
  node.connect(activeContext.destination);
  playbackAt = Math.max(playbackAt, activeContext.currentTime + 0.02);
  if (!playback || playback.assistantTurnId !== metadata.assistantTurnId) {
    playback = { assistantTurnId: metadata.assistantTurnId, startedAt: playbackAt, nodes: [] };
  }
  node.start(playbackAt);
  state.value = "speaking";
  if (playback.nodes.length === 0) addEvent("Playing YIBO response");
  playback.nodes.push(node);
  node.onended = () => {
    if (playback?.assistantTurnId !== metadata.assistantTurnId) return;
    playback.nodes = playback.nodes.filter((candidate) => candidate !== node);
    if (playback.nodes.length === 0) {
      playback = undefined;
      state.value = stream ? "listening" : "idle";
    }
  };
  playbackAt += buffer.duration;
}

async function resumeAudioContext(): Promise<AudioContext> {
  context ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextConstructor }).webkitAudioContext)();
  if (!context.onstatechange) {
    context.onstatechange = () => addEvent(`Browser audio ${context?.state ?? "unavailable"}`);
  }
  if (context.state !== "running") await context.resume();
  if (context.state !== "running") throw new Error(`Browser audio is ${context.state}`);
  return context;
}

function clearPlayback(requestId: string): void {
  const now = context?.currentTime ?? 0;
  const current = playback;
  stopPlayback();
  if (state.value !== "closed") state.value = stream ? "listening" : "idle";
  socket?.send(JSON.stringify({
    type: "playback.cleared",
    requestId,
    active: Boolean(current),
    assistantTurnId: current?.assistantTurnId ?? "unknown",
    audioEndMs: current ? Math.max(0, Math.round((now - current.startedAt) * 1000)) : 0,
  }));
  addEvent("Previous audio stopped");
}

function stopPlayback(): void {
  playback?.nodes.forEach((node) => {
    try { node.stop(); } catch { /* Playback already ended. */ }
  });
  playback = undefined;
  playbackAt = context?.currentTime ?? 0;
}

function observeEvent(message: Record<string, unknown>): void {
  const name = typeof message.event === "string" ? message.event : typeof message.type === "string" ? message.type : "Evento recibido";
  const labels: Record<string, string> = {
    "harness.connected": "Voice studio connected",
    "conversation.opened": "Conversation started",
    "microphone.started": "Audio connected",
    "audio.in": "YIBO is listening",
    "audio.out": "YIBO is speaking",
    "conversation.interrupted": "Response interrupted",
    "conversation.closed": "Conversation closed",
    error: "An error occurred",
  };
  if (name === "conversation.opened") {
    aiSessionConnected.value = true;
    sessionUsage.value = emptyRealtimeSessionUsage();
    sessionStartedAt = Date.now();
    sessionEndedAt = undefined;
    updateElapsed();
  }
  if (name === "conversation.closed") {
    aiSessionConnected.value = false;
    finishClock();
  }
  if (name === "usage") {
    sessionUsage.value = addRealtimeUsage(sessionUsage.value, message);
    addEvent(`Usage updated · ${formatUsd(estimatedCost.value)}`);
    return;
  }
  if (name === "assistant.transcript" && typeof message.transcript === "string") {
    addEvent(`YIBO said: ${message.transcript}`);
    return;
  }
  if (name === "realtime.tool.requested" || name === "realtime.tool.completed" || name === "realtime.tool.failed") {
    const tool = typeof message.name === "string" ? message.name.replaceAll("_", " ") : "tool";
    addEvent(`${labels[name] ?? name}: ${tool}`);
    return;
  }
  if (name === "audio.in" || name === "audio.out") return;
  addEvent(labels[name] ?? name);
}

function updateElapsed(): void {
  if (!sessionStartedAt) return;
  elapsedSeconds.value = Math.max(0, Math.floor(((sessionEndedAt ?? Date.now()) - sessionStartedAt) / 1_000));
}

function finishClock(): void {
  if (!sessionStartedAt || sessionEndedAt) return;
  sessionEndedAt = Date.now();
  updateElapsed();
}

function formatUsd(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value > 0 && value < 0.0001) return "< US$0.0001";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6,
  }).format(value);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function addEvent(value: string): void {
  const timestamp = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  events.value = [`${timestamp} · ${value}`, ...events.value].slice(0, 6);
}
</script>

<template>
  <section class="voice-lab voice-lab-v2" aria-labelledby="voice-lab-title">
    <div class="lab-copy">
      <div class="lab-kicker"><span></span> LIVE TEST</div>
      <h2 id="voice-lab-title">Talk to your agent<br><em>before publishing it.</em></h2>
      <p>Preview the saved agent settings through Voice Lab. Unsaved edits are not included. This is a browser voice test, not a phone call. Starting the microphone or sending a WAV uses OpenAI and may incur charges.</p>
      <p v-if="previewBlocked" role="status">{{ previewBlocked }}</p>
      <p v-else>Saved model: {{ previewMetadata?.model }} · Voice: {{ previewMetadata?.voice }}</p>
      <div class="privacy"><span>Audio is not saved</span><span>Transcript is off</span><span class="cost">May use credits</span></div>
    </div>

    <div class="lab-experience">
      <div :class="['live-orb', state]"><div class="wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="live-status"><small>AGENT STATUS</small><strong>{{ statusCopy[0] }}</strong><span>{{ statusCopy[1] }}</span></div>
      <div class="lab-controls">
        <button class="start" :disabled="Boolean(previewBlocked) || !connected || microphoneActive || state === 'closed'" @click="startMicrophone">● Start Voice Test</button>
        <button :disabled="!microphoneActive" @click="stopMicrophone()">Pause microphone</button>
        <button :disabled="!sessionUsed || state === 'closed'" @click="interrupt">Interrupt YIBO</button>
        <button class="close" :disabled="!sessionUsed || state === 'closed'" @click="closeSession">End Voice Test</button>
      </div>
      <label class="fixture"><input type="file" accept="audio/wav,.wav" :disabled="Boolean(previewBlocked) || !connected || state === 'closed'" @change="sendFixture"><i>↥</i><span><strong>Use a WAV phrase</strong><small>Replay exactly the same audio to compare configurations.</small></span></label>

      <section class="live-cost" aria-live="polite" aria-label="Estimated live session cost">
        <header>
          <span><small>ESTIMATED SESSION COST</small><strong>{{ formatUsd(estimatedCost) }}</strong></span>
          <b :class="{ active: aiSessionConnected }"><i></i>{{ aiSessionConnected ? 'LIVE' : sessionUsed ? 'FINAL' : 'WAITING' }}</b>
        </header>
        <div class="cost-metrics">
          <span><small>Duration</small><strong>{{ elapsedLabel }}</strong></span>
          <span><small>Audio tokens</small><strong>{{ formatTokens(audioTokens) }}</strong></span>
          <span><small>Text/context tokens</small><strong>{{ formatTokens(textTokens) }}</strong></span>
          <span><small>Tool calls</small><strong>{{ formatTokens(sessionUsage.toolCalls) }}</strong></span>
          <span><small>Current pace</small><strong>{{ estimatedCostPerMinute === null ? '—' : `${formatUsd(estimatedCostPerMinute)}/min` }}</strong></span>
        </div>
        <footer>
          <span>Calculated after each model response from reported usage. Provider billing remains authoritative.</span>
          <a v-if="selectedPricing" :href="selectedPricing.sourceUrl" target="_blank" rel="noreferrer">{{ previewMetadata?.model }} rates · {{ selectedPricing.verifiedAt }}</a>
        </footer>
      </section>
    </div>

    <aside class="test-readiness" aria-label="Voice test readiness">
      <span :class="{ ready: connected }">{{ connected ? '✓' : '○' }} Microphone channel {{ connected ? 'ready' : 'connecting' }}</span>
      <span :class="{ ready: aiSessionConnected }">{{ aiSessionConnected ? '✓' : '○' }} AI session {{ aiSessionConnected ? 'connected' : 'starts with the test' }}</span>
      <span :class="{ ready: calendarToolsAvailable }">{{ calendarToolsAvailable ? '✓' : '○' }} Calendar tools {{ calendarToolsAvailable ? 'available' : 'not available' }}</span>
      <span :class="{ ready: calendarStatus === 'connected' }">{{ calendarStatus === 'connected' ? '✓' : '○' }} Google Calendar {{ calendarStatus }}</span>
      <span>◷ Clinic timezone: <strong>{{ clinicTimezone }}</strong></span>
    </aside>

    <div class="lab-events">
      <div><span><i></i> Recent activity</span><small>No audio content</small></div>
      <ol><li v-for="event in events" :key="event">{{ event }}</li><li v-if="events.length === 0">Waiting for the voice lab…</li></ol>
    </div>
    <p class="credit-note">The OpenAI session starts only when you enable the microphone or send a WAV. Opening this screen does not use credits.</p>
  </section>
</template>

<style scoped>
.voice-lab{--red:#e24e5d;--red2:#9d2c3e;--cream:#f5ecdc;--black:#151214;position:relative;display:grid;grid-template-columns:minmax(330px,.83fr) minmax(520px,1.35fr);gap:28px;padding:42px clamp(28px,4vw,58px) 30px;color:var(--cream);border:1px solid #3b3034;border-radius:5px 38px 7px 24px;background:radial-gradient(circle at 14% 110%,#5e2634 0,transparent 34%),linear-gradient(145deg,#171315,#22191d);box-shadow:0 22px 70px #0008,9px 11px 0 #7e2938;overflow:hidden;isolation:isolate}.voice-lab:before{content:"";position:absolute;width:260px;height:260px;right:-110px;top:-170px;border:36px solid #e24e5d;border-radius:47% 53% 39% 61%;transform:rotate(18deg);opacity:.75;z-index:-1}.lab-copy{align-self:center}.lab-kicker{display:flex;align-items:center;gap:9px;color:#f0ae78;font-size:10px;font-weight:850;letter-spacing:.18em}.lab-kicker span{width:25px;height:2px;background:var(--red)}h2{margin:15px 0 17px;color:#fff8ee;font:500 clamp(38px,4.2vw,62px)/.91 "Iowan Old Style",Georgia,serif;letter-spacing:-.055em}h2 em{color:#f09a79;font-weight:500}.lab-copy>p{max-width:590px;color:#bfaeb2;line-height:1.55}.privacy{display:flex;flex-wrap:wrap;gap:7px;margin-top:23px}.privacy span{padding:7px 9px;border:1px solid #58454b;border-radius:99px;color:#c8b8bc;font-size:9px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.privacy .cost{color:#eec485;border-color:#74532e;background:#392a1d}.lab-experience{display:grid;grid-template-columns:150px 1fr;gap:15px 23px;align-content:center;padding:20px 0}.live-orb{grid-row:1/3;width:142px;height:156px;display:grid;place-items:center;border-radius:47% 53% 44% 56%;background:radial-gradient(circle,#642837,#2c1d22 65%);box-shadow:0 0 0 1px #7e3b4b,7px 9px 0 #0b090a;transition:.3s;animation:creature 5s ease-in-out infinite}.live-orb.listening{background:radial-gradient(circle,#b33e51,#4b202b 67%);box-shadow:0 0 55px #df46554d,7px 9px 0 #0b090a}.live-orb.speaking{background:radial-gradient(circle,#d46148,#702b35 67%);box-shadow:0 0 62px #ef805e55,7px 9px 0 #0b090a}.live-orb.connecting{opacity:.55}.live-orb.error,.live-orb.closed{filter:saturate(.25);opacity:.7}.wave{height:54px;display:flex;align-items:center;gap:4px}.wave i{width:4px;height:18px;border-radius:8px;background:#f5d5b0;animation:wave 1.15s ease-in-out infinite}.wave i:nth-child(2),.wave i:nth-child(6){height:31px;animation-delay:.1s}.wave i:nth-child(3),.wave i:nth-child(5){height:43px;animation-delay:.2s}.wave i:nth-child(4){height:54px;animation-delay:.3s}.live-status{display:grid;align-content:end}.live-status small{color:#8f7b81;font-size:8px;letter-spacing:.15em}.live-status strong{margin-top:6px;color:#fff4e9;font:500 20px/1.1 Georgia,serif}.live-status span{margin-top:3px;color:#a9969b;font-size:11px}.lab-controls{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px}.lab-controls button{min-height:45px;padding:10px 12px;border:1px solid #58454b;border-radius:5px 13px 6px 10px;color:#e7dadd;background:#2b2024;font-weight:700;font-size:12px;transition:.18s}.lab-controls button:hover:not(:disabled){transform:translateY(-2px);border-color:#c56b78}.lab-controls .start{color:#fff8ef;border-color:#ff8e96;background:var(--red);box-shadow:4px 5px 0 #721f30}.lab-controls .close{grid-column:1/-1;min-height:36px;background:transparent}.lab-controls button:disabled{cursor:not-allowed;opacity:.28}.fixture{grid-column:2;position:relative;display:flex;align-items:center;gap:12px;padding:11px 13px;border:1px dashed #72535b;border-radius:14px 4px 12px 5px;color:#d9c9cc;background:#231a1e;cursor:pointer}.fixture input{position:absolute;inset:0;opacity:0;cursor:pointer}.fixture i{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:50%;color:#211417;background:#f0ae78;font-style:normal;font-size:19px}.fixture span{display:grid}.fixture small{color:#9e898f;font-weight:400}.lab-events{grid-column:1/-1;display:grid;grid-template-columns:220px 1fr;gap:17px;margin-top:3px;padding-top:17px;border-top:1px solid #3d3034}.lab-events>div{display:flex;justify-content:space-between;align-items:flex-start;flex-direction:column;color:#bdaeb1;font-size:10px;text-transform:uppercase;letter-spacing:.11em}.lab-events>div i{display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:50%;background:#e24e5d;box-shadow:0 0 0 4px #e24e5d16}.lab-events>div small{color:#66565b;font-size:8px}.lab-events ol{min-height:51px;display:grid;grid-template-columns:repeat(3,1fr);gap:4px 17px;margin:0;padding:0;list-style:none;color:#8f7d82;font:10px/1.45 ui-monospace,SFMono-Regular,monospace}.lab-events li:first-child{color:#e8a3a9}.credit-note{grid-column:1/-1;margin:0;color:#b88b60;font-size:10px;text-align:right}@keyframes wave{50%{transform:scaleY(.38)}}@keyframes creature{0%,100%{border-radius:47% 53% 44% 56%;transform:rotate(-2deg)}45%{border-radius:54% 46% 57% 43%;transform:rotate(2deg) translateY(-3px)}75%{border-radius:43% 57% 48% 52%;transform:rotate(-4deg) translateY(2px)}}@media(max-width:1050px){.voice-lab{grid-template-columns:1fr}.lab-experience{grid-template-columns:140px 1fr}.lab-events{grid-column:1}.fixture{grid-column:2}.credit-note{grid-column:1}}@media(max-width:680px){.voice-lab{padding:31px 21px 24px}.lab-experience{grid-template-columns:1fr;text-align:center}.live-orb{grid-row:auto;margin:auto}.live-status{text-align:center}.lab-controls{grid-template-columns:1fr}.lab-controls .close,.fixture{grid-column:1}.lab-events{grid-template-columns:1fr}.lab-events>div{flex-direction:row}.lab-events ol{grid-template-columns:1fr}.credit-note{text-align:left}}@media(prefers-reduced-motion:reduce){.live-orb,.wave i{animation:none!important}}
</style>

<style scoped>
.live-cost{grid-column:1/-1;margin-top:4px;padding:15px 17px;border:1px solid #b8d1ef;border-radius:8px 22px 8px 15px;background:linear-gradient(135deg,#f7fbff,#eaf4ff);box-shadow:4px 5px 0 #c7e3ff}.live-cost header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.live-cost header>span{display:grid;gap:3px}.live-cost header small{color:#7187ae;font-size:8px;font-weight:850;letter-spacing:.13em}.live-cost header strong{color:#153b91;font:500 30px/1 Georgia,serif}.live-cost header>b{display:flex;align-items:center;gap:6px;padding:5px 8px;color:#7789a8;border:1px solid #c6d7ed;border-radius:999px;font-size:8px;letter-spacing:.1em}.live-cost header>b i{width:6px;height:6px;border-radius:50%;background:#9caac0}.live-cost header>b.active{color:#167047;border-color:#a9d6bb;background:#e5f5ea}.live-cost header>b.active i{background:#24a568;box-shadow:0 0 0 4px #24a5681b}.cost-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:13px;border-block:1px solid #cedeef}.cost-metrics>span{display:grid;gap:3px;padding:10px 11px;border-right:1px solid #d7e5f3}.cost-metrics>span:last-child{border-right:0}.cost-metrics small{color:#7b8eae;font-size:8px;text-transform:uppercase;letter-spacing:.07em}.cost-metrics strong{color:#223d75;font-size:13px}.live-cost footer{display:flex;justify-content:space-between;gap:15px;padding-top:10px;color:#7c8eab;font-size:9px;line-height:1.35}.live-cost footer a{flex:none;color:#2354d7;font-weight:750;text-decoration:none}.live-cost footer a:hover{text-decoration:underline}@media(max-width:900px){.cost-metrics{grid-template-columns:repeat(2,1fr)}.cost-metrics>span{border-bottom:1px solid #d7e5f3}.cost-metrics>span:last-child{grid-column:1/-1}.live-cost footer{display:grid}}@media(max-width:680px){.live-cost{text-align:left}.cost-metrics{grid-template-columns:1fr 1fr}.live-cost header strong{font-size:26px}}
</style>

<style scoped>
.test-readiness{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;padding:12px 0 2px;border-top:1px solid #d0e0f3;color:#62779f;font-size:10px}.test-readiness span{padding:6px 8px;border-radius:999px;background:#edf6ff}.test-readiness .ready{color:#1d6b45;background:#e5f5e8}.test-readiness strong{color:inherit}
</style>

<style scoped>
/* Azul mineral: una conversación luminosa, no una consola tecnológica. */
.voice-lab{--red:#2354d7;--red2:#153b9f;--cream:#fff;--black:#10214d;color:#142655;border-color:#a9c9ef;border-radius:5px 42px 7px 24px;background:linear-gradient(108deg,#214fc8 0 41%,#ffffff 41%);box-shadow:0 24px 70px #1a4c9b20,9px 11px 0 #9ed0ff}.voice-lab:before{right:-105px;top:-178px;border-color:#79bdff;opacity:.6}.lab-copy{padding-right:10%}.lab-kicker{color:#bce0ff}.lab-kicker span{background:#fff}.lab-copy h2{color:#fff}.lab-copy h2 em{color:#acd7ff}.lab-copy>p{color:#cfdeff}.privacy span{color:#dce8ff;border-color:#ffffff42;background:#ffffff0d}.privacy .cost{color:#fff;border-color:#ffffff5c;background:#ffffff18}.live-orb{background:radial-gradient(circle,#4e87ee,#204fbf 67%);box-shadow:0 0 0 1px #9dcaff,7px 9px 0 #c6e3ff}.live-orb.listening{background:radial-gradient(circle,#7cbcff,#2356d1 68%);box-shadow:0 0 55px #5eaeff62,7px 9px 0 #c6e3ff}.live-orb.speaking{background:radial-gradient(circle,#ffffff,#71b4ff 54%,#2254cb 75%);box-shadow:0 0 62px #6eb8ff66,7px 9px 0 #c6e3ff}.wave i{background:#fff}.live-orb.speaking .wave i{background:#1746b8}.live-status small{color:#8698bd}.live-status strong{color:#122a68}.live-status span{color:#7182a6}.lab-controls button{color:#254071;border-color:#bfd3ee;background:#f1f7ff}.lab-controls button:hover:not(:disabled){border-color:#4f84df;background:#e7f2ff}.lab-controls .start{color:#fff;border-color:#1946ba;background:#2354d7;box-shadow:4px 5px 0 #aad4ff}.lab-controls .close{color:#5d719a;background:transparent}.fixture{color:#284171;border-color:#81afe5;background:#edf6ff}.fixture i{color:#fff;background:#2354d7}.fixture small{color:#7184a8}.lab-events{border-color:#d0e0f3}.lab-events>div{color:#62779f}.lab-events>div i{background:#2354d7;box-shadow:0 0 0 4px #2354d715}.lab-events>div small{color:#9aaccc}.lab-events ol{color:#788aaa}.lab-events li:first-child{color:#2354d7}.credit-note{color:#6680ac}@media(max-width:1050px){.voice-lab{background:linear-gradient(155deg,#214fc8 0 37%,#fff 37%)}.lab-copy{padding:0 0 40px}}@media(max-width:680px){.voice-lab{background:#fff}.lab-copy{margin:-31px -21px 10px;padding:31px 21px 36px;background:#214fc8}.voice-lab:before{display:none}}
</style>
