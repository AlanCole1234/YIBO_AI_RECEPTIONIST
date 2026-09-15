/** Explicit live check: model/tool protocol is real; appointment results are simulated. */
import { writeFile } from 'node:fs/promises';
import { OpenAIRealtimeAdapter } from '../../src/modules/conversation/index.js';
import { AGENT_TOOL_DEFINITIONS } from '../../src/modules/agents/index.js';

const affirmative = ['Yes.', 'Yeah.', 'Yep.', 'Sure.', "That's fine.", 'Go ahead.', 'Book it.', 'Yes please.'];
const ambiguous = ['Maybe.', 'I think so.', 'Hold on.', 'Wait.', 'Let me check.', 'Actually...', 'Give me one second.', 'Let me think.'];
const count = process.argv.includes('--matrix') ? 150 : Number(process.env.YIBO_CONFIRMATION_CASES ?? 16);
if (![16, 150].includes(count)) throw new Error('Use 16 smoke cases or the 150-case matrix');
if (!process.env.OPENAI_API_KEY) throw new Error('Project API key is required');
const cases = Array.from({ length: count }, (_, i) => {
  if (count === 16) return { utterance: [...affirmative, ...ambiguous][i]!, confirm: i < 8, failBooking: false };
  if (i < 50) return { utterance: 'Yes.', confirm: true, failBooking: false };
  if (i < 75) return { utterance: affirmative[(i - 50) % 8]!, confirm: true, failBooking: false };
  if (i < 100) return { utterance: ambiguous[(i - 75) % 8]!, confirm: false, failBooking: false };
  return { utterance: affirmative[(i - 100) % 8]!, confirm: true, failBooking: i >= 125 };
});
const slot = '2026-09-21T16:30:00.000Z';
const results: Record<string, unknown>[] = [];
async function run(index: number) {
  const scenario = cases[index]!;
  const calls: string[] = [];
  const texts: string[] = [];
  const trace: unknown[] = [];
  let confirmed = false;
  let bookingCount = 0;
  let responseUsedTool = false;
  let responseHasText = false;
  const started = performance.now();
  const adapter = new OpenAIRealtimeAdapter({ apiKey: process.env.OPENAI_API_KEY!, mode: 'text', logger: { error: (message, details) => trace.push({ atMs: Math.round(performance.now() - started), message, details }), info: (message, details) => trace.push({ atMs: Math.round(performance.now() - started), message, details }) } });
  const session = await adapter.openSession({ conversationId: `live-confirmation-${index}`, agent: {
    instructions: `Continue an existing scheduling conversation in English. Caller identity and service have already been collected. Service is Consultation, provider is employee-1, timezone America/Denver. The checked available slot is Monday September 21, 2026 at 10:30 AM, canonical startAt ${slot}. Your last spoken message was: "Monday at 10:30 AM is available. Would you like me to book that?" The next user message is the caller's answer. Do not ask for the date again. Do not reinterpret hesitation as confirmation. Use confirm_appointment then create_appointment only for clear explicit acceptance. For a hold request acknowledge briefly and wait. After booking, explain the returned success or failure briefly and wait.`,
    locale: 'en-US', conversation: { model: process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1', maxOutputTokens: 512, reasoningEffort: 'minimal', turnDetection: {} },
    tools: AGENT_TOOL_DEFINITIONS.filter(t => ['check_availability', 'confirm_appointment', 'create_appointment'].includes(t.name)),
  } });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void session.close(); }, 45000);
  let failure: string | undefined;
  try {
    await session.sendText(scenario.utterance);
    for await (const event of session.events()) {
      if (event.type === 'assistant.response_created') { responseUsedTool = false; responseHasText = false; }
      if (event.type === 'error') throw new Error(`${event.code}: ${event.message}`);
      if (event.type === 'assistant.transcript' && event.final) { texts.push(event.text); responseHasText = true; }
      if (event.type === 'tool.call') {
        responseUsedTool = true;
        calls.push(event.name);
        if (calls.length > 8) throw new Error('Tool loop exceeded eight calls');
        const args = event.arguments as Record<string, unknown>;
        if (event.name === 'check_availability') {
          await session.sendToolResult({ toolCallId: event.toolCallId, ok: true, data: { earliestSlotUtc: slot, earliestSlotDisplay: 'Monday, September 21 at 10:30 AM', earliestSlot: { employeeId: 'employee-1', startAt: slot }, requestedTimeAvailable: true } });
        } else if (event.name === 'confirm_appointment') {
          if (args.employeeId !== 'employee-1' || args.startAt !== slot) throw new Error('Confirmation slot changed');
          confirmed = true;
          await session.sendToolResult({ toolCallId: event.toolCallId, ok: true, data: { confirmationRecorded: true, startAt: slot } });
        } else if (event.name === 'create_appointment') {
          if (!confirmed || args.employeeId !== 'employee-1' || args.startAt !== slot) throw new Error('Booking lacked exact prior confirmation');
          bookingCount++;
          await session.sendToolResult(scenario.failBooking
            ? { toolCallId: event.toolCallId, ok: false, error: { code: 'CALENDAR_SYNC_FAILED', message: 'Could not complete the booking. Explain the failure and ask whether the caller wants to try again.', retryable: false } }
            : { toolCallId: event.toolCallId, ok: true, data: { appointment: { id: `simulated-${index}`, status: 'CONFIRMED', employeeId: 'employee-1', startAt: slot } } });
        }
      }
      if (event.type === 'assistant.response_done' && !responseUsedTool && responseHasText) break;
    }
    if (timedOut) throw new Error('No completed text continuation within 45 seconds');
    if (!texts.length) throw new Error('No assistant response text');
    if (scenario.confirm && (bookingCount !== 1 || calls.filter(n => n === 'confirm_appointment').length !== 1)) throw new Error(`Expected one confirmation and booking; got ${calls.join(', ')}`);
    if (!scenario.confirm && (confirmed || bookingCount)) throw new Error('Ambiguous response authorized booking');
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally { clearTimeout(timer); await session.close(); }
  const result = { index, ...scenario, passed: !failure, elapsedMs: Math.round(performance.now() - started), calls, texts, trace, ...(failure ? { failure } : {}) };
  results.push(result);
  await writeFile('docs/reliability/live-confirmation-results.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ index, utterance: scenario.utterance, passed: !failure, elapsedMs: result.elapsedMs, ...(failure ? { failure } : {}) }));
}
const indices = process.argv.includes('--yes-please') ? [7] : cases.map((_, i) => i);
for (const index of indices) {
  const caseStarted = performance.now();
  await run(index);
  if (String(results.at(-1)?.failure ?? '').includes('credit_balance_exhausted')) break;
  // Stay below the observed 40,000 TPM account limit; do not mask failed cases.
  if (index !== indices.at(-1)) await new Promise(resolve => setTimeout(resolve, Math.max(0, 10000 - (performance.now() - caseStarted))));
}
await writeFile('docs/reliability/live-confirmation-results.json', JSON.stringify(results.sort((a,b) => Number(a.index)-Number(b.index)), null, 2) + '\n');
if (results.some(r => !r.passed)) process.exitCode = 1;
