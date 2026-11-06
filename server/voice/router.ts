import { z } from "zod";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { getVoiceConfig, saveVoiceConfig } from "./config";
import { voiceFailure } from "./service";
import { voiceOperations } from "../media/operations";
const operation = z.object({ operationId: z.string().uuid() });
export const voiceConfigRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    try { return await getVoiceConfig(ctx.user.id); } catch (error) { voiceFailure(error); }
  }),
  save: protectedProcedure.input(z.object({
    expectedRevision: z.number().int().nonnegative(),
    settings: z.object({ asrEnabled: z.boolean(), baseUrl: z.string().max(2000), model: z.string().max(160),
      timeoutMs: z.number().int().min(1000).max(120000), ttsEnabled: z.boolean() }),
    apiKey: z.string().max(512).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    try {
      const value = await saveVoiceConfig(ctx.user.id, input.expectedRevision, input.settings, input.apiKey);
      voiceOperations.cancelUser(ctx.user.id);
      return value;
    } catch (error) { voiceFailure(error); }
  }),
  cancelOperation: protectedProcedure.input(operation).mutation(({ ctx, input }) => {
    voiceOperations.cancel(ctx.user.id, input.operationId); return { cancelled: true };
  }),
});
