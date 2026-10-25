import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { registry } from "../llm";
import { getDefaultLlmConfig, getLlmConfigsByUserId, getPersistentLlmUsageDetails, getPersistentLlmUsageSnapshot } from "../db";
import { getLlmUsageDetails, getLlmUsageSnapshot } from "../llm/usage";
import { listUserLlmProviders } from "../llm-management";

const usageQuery = z.object({
  from: z.string().optional(), to: z.string().optional(),
  userId: z.number().int().positive().optional(), personaId: z.number().int().positive().optional(),
  route: z.string().max(128).optional(), provider: z.string().max(64).optional(),
  purpose: z.string().max(64).optional(), success: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).optional();
function optionalDate(value?: string) {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}


export const systemRouter = router({
  operationsDiagnostics: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [persisted, config, configs, providers] = await Promise.all([
      getPersistentLlmUsageSnapshot({ userId }).catch(() => null),
      getDefaultLlmConfig(userId), getLlmConfigsByUserId(userId), listUserLlmProviders(userId),
    ]);
    const usage = persisted ?? { ...getLlmUsageSnapshot(new Date(), { userId }), source: "in-memory-runtime" };
    const extra = (config?.extraConfig ?? {}) as Record<string, unknown>;
    const fallbackProvider = typeof extra.fallbackProvider === "string" ? extra.fallbackProvider : null;
    return {
      generatedAt: new Date().toISOString(),
      runtime: { nodeEnv: process.env.NODE_ENV ?? "development" },
      llm: {
        defaultProvider: config?.providerName ?? registry.getDefaultName() ?? null,
        fallbackProvider, providers, usage,
        dynamicDeepSeekRouting: configs.some(item => (item.extraConfig as Record<string, unknown> | null)?.deepseekDynamicRouting === true),
        budget: { status: "unconfigured", recommendation: "尚未配置用户软额度。" },
        economy: { level: "normal", recommendation: "本批未启用自动省额度策略。" },
      },
      troubleshooting: {
        summary: { errors: 0, warnings: persisted ? 1 : 2 },
        items: [
          { id: "batch2-scope", scope: "迁移范围", tone: "warn", title: "本页已接通模型配置与用量", detail: "图片、平台、语音等其他模块的诊断尚未迁移；其下方占位信息不代表运行状态。", recommendation: "本批以模型用量与路由信息为准。" },
          ...(!persisted ? [{ id: "usage-memory", scope: "模型用量", tone: "warn", title: "正在显示进程内记录", detail: "持久记录暂不可用，内存记录有容量上限，不能代表完整历史。", recommendation: "检查数据库迁移及连接后刷新。" }] : []),
        ],
      },
    };
  }),
  llmUsageDetails: protectedProcedure.input(usageQuery).query(async ({ ctx, input }) => {
    const query: Partial<NonNullable<z.infer<typeof usageQuery>>> = input ?? {};
    const filters = {
      ...query,
      userId: ctx.user.role === "admin" ? query.userId ?? ctx.user.id : ctx.user.id,
      from: optionalDate(query.from), to: optionalDate(query.to), limit: query.limit ?? 50,
    };
    const persisted = await getPersistentLlmUsageDetails(filters).catch(() => null);
    return persisted ?? getLlmUsageDetails({ ...filters, from: filters.from?.toISOString(), to: filters.to?.toISOString() });
  }),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /**
   * What this server can do.
   *
   * The client uses it to decide whether to stream a reply or to fall back
   * to the ordinary request — without having to discover the answer by
   * making a request that fails.
   */
  capabilities: publicProcedure.query(() => ({
    streaming: true,
    /** The provider that would be used when the client does not choose one. */
    defaultProvider: registry.getDefaultName() || null,
    providers: registry.list().filter((p) => p.configured).map((p) => p.name),
  })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await notifyOwner(input, ctx.user.id);
      return {
        success: result.delivered,
        channel: result.channel,
        ...(result.reason ? { reason: result.reason } : {}),
      } as const;
    }),
});
