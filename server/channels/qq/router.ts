import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, rateLimit, router } from "../../_core/trpc";
import { QqError } from "./core";
import type { QqService } from "./service";

async function result<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof QqError) throw new TRPCError({ code: error.code, message: error.message });
    // 不返回密钥、请求头、上游响应体或数据库驱动原始异常。
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "QQ 操作未完成，请检查配置或稍后重试。" });
  }
}

export function createQqRouter(service: QqService) {
  const write = protectedProcedure.use(rateLimit({ name: "qq-config-write", limit: 20, windowMs: 60_000, scope: "user" }));
  const version = z.object({ expectedGeneration: z.number().int().positive().nullable() });
  return router({
    config: protectedProcedure.query(({ ctx }) => result(() => service.read(ctx.user.id))),
    save: write.input(version.extend({
      apiBaseUrl: z.string().min(1).max(2048), botId: z.string().min(1).max(24), targetId: z.string().min(1).max(24),
      personaId: z.number().int().positive(), apiToken: z.string().max(512).optional(),
      receiveToken: z.string().max(512).optional(), webhookSecret: z.string().max(512).optional(),
      clearApiToken: z.boolean().optional(), clearReceiveToken: z.boolean().optional(),
    })).mutation(({ ctx, input }) => result(() => service.save(ctx.user.id, input))),
    start: write.input(version).mutation(({ ctx, input }) => result(async () => {
      await service.start(ctx.user.id, input.expectedGeneration);
      return service.read(ctx.user.id);
    })),
    stop: write.input(version).mutation(({ ctx, input }) => result(async () => {
      await service.stop(ctx.user.id, input.expectedGeneration);
      return service.read(ctx.user.id);
    })),
    deliveries: protectedProcedure.query(({ ctx }) => result(() => service.dependencies.repository.recentDeliveries(ctx.user.id))),
  });
}
