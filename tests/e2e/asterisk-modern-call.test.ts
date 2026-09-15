import { describe, expect, it, vi } from "vitest";
import { buildApplication } from "../../src/bootstrap/build-application.js";
import { DEVELOPMENT_US_BUSINESS } from "../../src/app/development-fixtures.js";
import { ScriptedConversationRuntime } from "../../src/modules/conversation/index.js";
import { AsteriskTelephonyGateway, AsteriskRtpVoiceMediaGateway, type AsteriskMediaClient, type AsteriskEvent } from "../../src/modules/telephony/index.js";

class Ari implements AsteriskMediaClient {
  handler?: (event:AsteriskEvent)=>Promise<void>;
  answer=vi.fn(async()=>{}); hangup=vi.fn(async()=>{}); transfer=vi.fn(async()=>{});
  createMixingBridge=vi.fn(async()=>({bridgeId:"bridge"}));
  addChannelsToBridge=vi.fn(async()=>{});destroyBridge=vi.fn(async()=>{});
  createExternalMedia=vi.fn(async()=>({channelId:"external"}));
  onEvent(handler:(event:AsteriskEvent)=>Promise<void>){this.handler=handler;}
  async emit(event:AsteriskEvent){await this.handler?.(event);}
}
const event=(to:string):AsteriskEvent=>({type:"CHANNEL_ENTERED_APPLICATION",channelId:"caller",callerNumber:"+12025550199",dialedNumber:to,occurredAt:"2026-09-15T12:00:00Z"});
function fixture(){
 const ari=new Ari();const voice=new AsteriskRtpVoiceMediaGateway(ari,{host:"127.0.0.1",portStart:50120,portEnd:50125,logger:()=>{}});
 const telephony=new AsteriskTelephonyGateway(ari,()=>"integrated-call",voice);
 const runtime=new ScriptedConversationRuntime();
 const app=buildApplication({environment:{},tenantId:DEVELOPMENT_US_BUSINESS.tenantId,businesses:[DEVELOPMENT_US_BUSINESS],telephonyGateway:telephony,voiceGateway:voice,runtime});
 return {ari,voice,telephony,runtime,app};
}
describe("modern Asterisk integration",()=>{
 it("resolves trusted DID/location, uses current agent tools and terminates one session",async()=>{
  const {ari,telephony,runtime,app}=fixture();
  try {
   await Promise.all([ari.emit(event(DEVELOPMENT_US_BUSINESS.locations[0]!.calledNumbers[0]!)),ari.emit(event(DEVELOPMENT_US_BUSINESS.locations[0]!.calledNumbers[0]!))]);
   expect(runtime.sessions).toHaveLength(1);expect(ari.answer).toHaveBeenCalledTimes(1);
   expect(runtime.openedInputs[0]!.agent.channel).toBe("phone");
   expect(runtime.openedInputs[0]!.agent.tools.some(t=>t.name==="enable_developer_test_mode")).toBe(false);
   const records=await app.callHistory.listByTenant(app.tenantId,10);
   expect(records[0]).toMatchObject({locationId:DEVELOPMENT_US_BUSINESS.locations[0]!.id,state:"IN_CONVERSATION"});
   runtime.latestSession.emit({type:"tool.call",toolCallId:"catalog",name:"get_service_information",arguments:{}});
   await vi.waitFor(()=>expect(runtime.latestSession.receivedToolResults).toHaveLength(1));
   expect(runtime.latestSession.receivedToolResults[0]!.ok).toBe(true);
   runtime.latestSession.emit({type:"closed",reason:"completed"});
   await vi.waitFor(()=>expect(ari.hangup).toHaveBeenCalledWith("caller"));
   expect(ari.destroyBridge).toHaveBeenCalledWith("bridge");expect(ari.hangup).toHaveBeenCalledWith("external");
   expect(runtime.latestSession.closeCount).toBe(1);
   expect((await app.callHistory.listByTenant(app.tenantId,10))[0]!.state).toBe("COMPLETED");
  } finally {await telephony.close();}
 });
 it("rejects an unknown DID before allocating media or starting Realtime",async()=>{
  const {ari,telephony,runtime}=fixture();
  try {await ari.emit(event("+12025550123"));expect(ari.createMixingBridge).not.toHaveBeenCalled();expect(runtime.sessions).toHaveLength(0);expect(ari.hangup).toHaveBeenCalledWith("caller");}
  finally {await telephony.close();}
 });
});
