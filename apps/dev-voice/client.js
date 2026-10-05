const log = document.querySelector("#log");
const micButton = document.querySelector("#mic");
const stopButton = document.querySelector("#stop");
const voiceOrb = document.querySelector("#voiceOrb");
const orbStatus = document.querySelector("#orbStatus");
const socket = new WebSocket(`ws://${location.host}/voice`);
socket.binaryType = "arraybuffer";

let context;
let stream;
let source;
let processor;
let playbackAt = 0;
let pendingAudio;
let playback;

socket.addEventListener("open", () => { line("harness.connected"); setOrb("idle", "En espera", "Lista para comenzar"); });
socket.addEventListener("close", () => { line("harness.disconnected"); setOrb("idle", "Desconectado", "Reinicia el servidor para continuar"); });
socket.addEventListener("message", ({ data }) => {
  if (typeof data !== "string") {
    playPcm16(data, pendingAudio);
    pendingAudio = undefined;
    return;
  }
  const message = JSON.parse(data);
  if (message.type === "audio.chunk") pendingAudio = message;
  else if (message.type === "playback.clear") clearPlayback(message.requestId);
  else line(data);
});

micButton.addEventListener("click", async () => {
  context ??= new AudioContext();
  await context.resume();
  setOrb("connecting", "Conectando…", "Solicitando acceso al micrófono");
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
  source = context.createMediaStreamSource(stream);
  processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = ({ inputBuffer }) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const samples = inputBuffer.getChannelData(0).slice();
    socket.send(samples.buffer);
  };
  source.connect(processor);
  processor.connect(context.destination);
  socket.send(JSON.stringify({ type: "mic.start", sampleRate: context.sampleRate, channels: 1 }));
  micButton.disabled = true;
  stopButton.disabled = false;
  setOrb("listening", "Escuchando", "Habla con naturalidad; puedes interrumpir a YIBO");
});

stopButton.addEventListener("click", stopMicrophone);
document.querySelector("#interrupt").addEventListener("click", () => socket.send(JSON.stringify({ type: "interrupt" })));
document.querySelector("#close").addEventListener("click", () => {
  stopMicrophone();
  socket.send(JSON.stringify({ type: "close" }));
  setOrb("idle", "Sesión cerrada", "Recarga la página para iniciar otra llamada");
});
document.querySelector("#wav").addEventListener("change", async ({ target }) => {
  const file = target.files?.[0];
  if (!file) return;
  context ??= new AudioContext();
  await context.resume();
  socket.send(JSON.stringify({ type: "fixture.next", name: file.name }));
  socket.send(await file.arrayBuffer());
});

function stopMicrophone() {
  processor?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  processor = source = stream = undefined;
  micButton.disabled = false;
  stopButton.disabled = true;
  line("microphone.stopped");
  setOrb("idle", "Micrófono pausado", "YIBO ya no recibe audio");
}

function playPcm16(arrayBuffer, metadata) {
  if (!metadata?.assistantTurnId) return;
  context ??= new AudioContext();
  const pcm = new Int16Array(arrayBuffer);
  const buffer = context.createBuffer(1, pcm.length, 24_000);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  playbackAt = Math.max(playbackAt, context.currentTime + 0.02);
  if (!playback || playback.assistantTurnId !== metadata.assistantTurnId) {
    playback = { assistantTurnId: metadata.assistantTurnId, startedAt: playbackAt, nodes: [] };
  }
  node.start(playbackAt);
  setOrb("speaking", "YIBO está hablando", "Puedes interrumpir su respuesta en cualquier momento");
  playback.nodes.push(node);
  playback.sequence = metadata.sequence;
  node.onended = () => {
    if (playback?.assistantTurnId !== metadata.assistantTurnId) return;
    playback.nodes = playback.nodes.filter((candidate) => candidate !== node);
    if (playback.nodes.length === 0) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "playback.idle", sequence: playback.sequence }));
      playback = undefined;
      setOrb(stream ? "listening" : "idle", stream ? "Escuchando" : "En espera", stream ? "Tu turno" : "El micrófono está apagado");
    }
  };
  playbackAt += buffer.duration;
}

function clearPlayback(requestId) {
  const now = context?.currentTime ?? 0;
  const current = playback;
  current?.nodes.forEach((node) => {
    try { node.stop(); } catch { /* already stopped */ }
  });
  playback = undefined;
  playbackAt = now;
  setOrb(stream ? "listening" : "idle", stream ? "Interrupción detectada" : "Respuesta detenida", stream ? "YIBO te está escuchando" : "Audio detenido");
  socket.send(JSON.stringify({
    type: "playback.cleared",
    requestId,
    active: Boolean(current),
    assistantTurnId: current?.assistantTurnId ?? "unknown",
    audioEndMs: current ? Math.max(0, Math.round((now - current.startedAt) * 1000)) : 0,
  }));
}

function line(value) {
  log.textContent += `${value}\n`;
  log.scrollTop = log.scrollHeight;
}

function setOrb(state, title, detail) {
  voiceOrb.classList.remove("listening", "speaking", "connecting");
  if (state !== "idle") voiceOrb.classList.add(state);
  orbStatus.innerHTML = `<b>${title}</b>${detail}`;
}
