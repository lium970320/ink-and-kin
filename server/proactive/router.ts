import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { proactiveRepository, requestAmbient } from "./index";
import { validateSettings } from "./policy";
import { qqService } from "../channels/qq";
import type { ProactiveQqConsent } from "./types";

const personaInput = z.object({ personaId: z.number().int().positive() });
const jobInput = personaInput.extend({ jobId: z.number().int().positive() });
const settingsInput = z.object({
  enabled: z.boolean(), times: z.array(z.string()).max(8), stylePrompt: z.string().max(2000),
  timeZone: z.string().min(1).max(100), quietHours: z.string().max(20),
  maxPerLocalDay: z.number().int().min(1).max(10), minIntervalMinutes: z.number().int().min(5).max(1440),
  delivery: z.enum(["web", "qq"]), ambientEnabled: z.boolean(),
}).strict();
export const proactiveRouter = router({
  getSettings: protectedProcedure.input(personaInput).query(({ctx,input}) => proactiveRepository.getPolicy(ctx.user.id,input.personaId)),
  saveSettings: protectedProcedure.input(personaInput.extend({expectedRevision:z.number().int().nonnegative(),settings:settingsInput})).mutation(async ({ctx,input}) => {
    let settings;
    try { settings=validateSettings(input.settings); } catch { throw new TRPCError({code:"BAD_REQUEST",message:"主动消息的时间、时区或频率设置无效。"}); }
    let consent: ProactiveQqConsent|null=null;
    if(settings.enabled && settings.delivery==="qq") {
      const {config}=await qqService.prepareOutbound(ctx.user.id);
      if(config.personaId!==input.personaId) throw new TRPCError({code:"PRECONDITION_FAILED",message:"请选择当前已验证QQ私聊绑定的同一人物。"});
      consent={configId:config.id,generation:config.generation,targetId:config.targetId};
    }
    return proactiveRepository.savePolicy(ctx.user.id,input.personaId,input.expectedRevision,settings,consent);
  }),
  list: protectedProcedure.input(personaInput).query(({ctx,input})=>proactiveRepository.list(ctx.user.id,input.personaId)),
  createFollowup: protectedProcedure.input(personaInput.extend({topic:z.string().trim().min(1).max(500),dueAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}),operationId:z.string().uuid()})).mutation(async ({ctx,input})=>{
    const now=Date.now(), dueAt=new Date(input.dueAt),expiresAt=new Date(input.expiresAt);
    if(dueAt.getTime()<=now || dueAt.getTime()>now+366*86400000 || expiresAt<=dueAt || expiresAt.getTime()-dueAt.getTime()>86400000) {
      throw new TRPCError({code:"BAD_REQUEST",message:"请设置未来一年内的回访时间，并将过期时间设在到期后24小时内。"});
    }
    const policy=await proactiveRepository.getPolicy(ctx.user.id,input.personaId);
    if(!policy.enabled) throw new TRPCError({code:"PRECONDITION_FAILED",message:"请先保存并开启主动消息。"});
    return proactiveRepository.enqueue(ctx.user.id,input.personaId,{policyRevision:policy.revision,kind:"followup",triggerKey:"followup:"+input.operationId.toLowerCase(),topic:input.topic,dueAt,expiresAt});
  }),
  cancel: protectedProcedure.input(jobInput).mutation(async ({ctx,input})=>({cancelled:await proactiveRepository.cancel(ctx.user.id,input.personaId,input.jobId)})),
  markRead: protectedProcedure.input(jobInput).mutation(async ({ctx,input})=>{await proactiveRepository.markRead(ctx.user.id,input.personaId,input.jobId);return {success:true};}),
  acknowledgeUnknown: protectedProcedure.input(jobInput).mutation(async ({ctx,input})=>({acknowledged:await proactiveRepository.acknowledgeUnknown(ctx.user.id,input.personaId,input.jobId)})),
  requestAmbient: protectedProcedure.input(personaInput).mutation(({ctx,input})=>requestAmbient(ctx.user.id,input.personaId)),
});
