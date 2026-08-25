const log = document.querySelector("#log");
const micButton = document.querySelector("#mic");
const stopButton = document.querySelector("#stop");
const socket = new WebSocket(`ws://${location.host}/voice`);
socket.binaryType = "arraybuffer";

let context;
let stream;
let source;
let processor;
let playbackAt = 0;
let pendingAudio;
let playback;

socket.addEventListener("open", () => line("harness.connected"));
socket.addEventListener("close", () => line("harness.disconnected"));
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
});

stopButton.addEventListener("click", stopMicrophone);
document.querySelector("#interrupt").addEventListener("click", () => socket.send(JSON.stringify({ type: "interrupt" })));
document.querySelector("#close").addEventListener("click", () => socket.send(JSON.stringify({ type: "close" })));
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
  playback.nodes.push(node);
  node.onended = () => {
    if (playback?.assistantTurnId !== metadata.assistantTurnId) return;
    playback.nodes = playback.nodes.filter((candidate) => candidate !== node);
    if (playback.nodes.length === 0) playback = undefined;
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
