import { z } from "zod";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import { getSceneImageConfig, saveSceneImageSettings, saveSceneImageRelay, deleteSceneImageRelay } from "./config";
import { uploadSceneImageReference } from "./assets";
import { cancelSceneImageJob, cancelSceneImageOperation, getSceneImageJob, listSceneImageRelayModels, testSceneImageRelay } from "./service";
const revision = z.number().int().min(0).max(2147483646);
const relayInput = z.object({
  expectedRevision:revision, id:z.number().int().positive().nullish(), relayName:z.string().max(128),
  priority:z.number().int().min(-10000).max(10000), enabled:z.boolean(), apiKey:z.string().max(2048).nullish(),
  baseUrl:z.string().max(2048), model:z.string().max(160), protocol:z.enum(["auto","openai","google_gemini","comfyui"]),
  size:z.string().max(32), timeoutMs:z.number().int().min(30000).max(600000), formalReferenceEnabled:z.boolean(),
  workflowJson:z.string().max(512*1024).nullish(), extraConfig:z.record(z.string(),z.unknown()).nullish(),
});
export const sceneImageConfigRouter=router({
  get:protectedProcedure.query(({ctx})=>getSceneImageConfig(ctx.user.id)),
  save:protectedProcedure.input(z.object({
    expectedRevision:revision,enabled:z.boolean().optional(),priorityStrategy:z.enum(["comfyui_first","relay_first","comfyui_only","relay_only"]).optional(),
    comfyPromptTemplate:z.string().max(16000).nullable().optional(),cooldownMinutes:z.number().int().min(0).max(1440).optional(),maxPerHour:z.number().int().min(0).max(100).optional(),
    userReferenceKey:z.string().max(512).nullable().optional(),personaReferenceKeys:z.array(z.string().max(512)).max(8).optional(),
    activePersonaReferenceKey:z.string().max(512).nullable().optional(),promptRewriteRelayId:z.number().int().positive().nullable().optional(),
  })).mutation(({ctx,input})=>{const {expectedRevision,...settings}=input;return saveSceneImageSettings(ctx.user.id,expectedRevision,settings);}),
  saveRelay:protectedProcedure.input(relayInput).mutation(({ctx,input})=>saveSceneImageRelay(ctx.user.id,input.expectedRevision,input)),
  deleteRelay:protectedProcedure.input(z.object({expectedRevision:revision,id:z.number().int().positive()}))
    .mutation(({ctx,input})=>deleteSceneImageRelay(ctx.user.id,input.expectedRevision,input.id)),
  uploadReference:protectedProcedure.use(rateLimit(RATE_LIMITS.llm)).input(z.object({fileContent:z.string().min(4).max(15_000_000),mimeType:z.enum(["image/png","image/jpeg","image/webp"])}))
    .mutation(({ctx,input})=>uploadSceneImageReference(ctx.user.id,input.fileContent,input.mimeType)),
  listRelayModels:protectedProcedure.use(rateLimit(RATE_LIMITS.llm)).input(relayInput)
    .mutation(({ctx,input})=>listSceneImageRelayModels(ctx.user.id,input.expectedRevision,input)),
  testRelay:protectedProcedure.use(rateLimit(RATE_LIMITS.llm)).input(relayInput.extend({operationId:z.string().uuid(),testMode:z.enum(["neutral","scene"]).default("neutral"),scenePrompt:z.string().max(12000).optional()}))
    .mutation(({ctx,input})=>testSceneImageRelay(ctx.user.id,input)),
  job:protectedProcedure.input(z.object({id:z.string().uuid()})).query(({ctx,input})=>getSceneImageJob(ctx.user.id,input.id)),
  cancelJob:protectedProcedure.input(z.object({id:z.string().uuid()})).mutation(({ctx,input})=>cancelSceneImageJob(ctx.user.id,input.id)),
  cancelOperation:protectedProcedure.input(z.object({operationId:z.string().uuid()})).mutation(({ctx,input})=>cancelSceneImageOperation(ctx.user.id,input.operationId)),
});
