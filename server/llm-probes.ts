import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { llmService } from "./llm";
import { resolveSingleProviderForUser } from "./llm/user-provider";
import { LLMRequestError, safeLLMError } from "./llm/errors";
import type { LLMOptions, LLMProvider } from "./llm/types";

export const llmProbeInput = z.object({
  providerName: z.string().trim().min(1).max(64),
  relayId: z.number().int().positive().optional(),
  apiKey: z.string().max(512).optional(),
  baseUrl: z.string().trim().max(512).refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "API 地址必须为不含内嵌凭据的 HTTP 或 HTTPS 地址。").optional(),
  model: z.string().trim().max(128).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable().optional(),
});
type ProbeInput = z.infer<typeof llmProbeInput>;

/** 每次请求独立超时；探测不经过备用站，也不读写站点健康状态。 */
function probeProvider(provider: LLMProvider, maxAttempts: number): LLMProvider {
  return new Proxy(provider, {
    get(target, key) {
      if (key === "maxAttempts") return maxAttempts;
      if (key === "invoke") return async (messages: Parameters<LLMProvider["invoke"]>[0], options?: LLMOptions) => {
        const timeout = AbortSignal.timeout(120_000);
        const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        try {
          return await target.invoke(messages, { ...options, signal });
        } catch (error) {
          if (timeout.aborted && !options?.signal?.aborted) throw new LLMRequestError("network");
          throw safeLLMError(error, options?.signal);
        }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function testUserLlmConnection(userId: number, input: ProbeInput) {
  const resolved = await resolveSingleProviderForUser({ userId, ...input });
  const provider = probeProvider(resolved.provider, resolved.maxAttempts);
  const started = Date.now();
  let model = provider.getConfigSummary?.()?.model ?? null;
  const reply = await llmService.invokeWithProvider(provider, {
    messages: [{ role: "user", content: "请只回复 OK。" }],
    options: { maxTokens: 64, temperature: 0, provider: input.providerName,
      usageContext: { userId, route: "settings.testConnection", purpose: "utility" },
      onModel: value => { model = value; },
    },
  });
  if (!reply.trim()) throw new TRPCError({ code: "BAD_GATEWAY", message: "模型没有返回可验证的文本回复。" });
  return { success: true as const, providerName: input.providerName, model,
    replyVerified: true as const, durationMs: Date.now() - started,
    reflectsCurrentChatRoute: resolved.reflectsCurrentChatRoute, relayEnabled: resolved.relayEnabled };
}

export async function listUserLlmModels(userId: number, input: ProbeInput) {
  const { provider } = await resolveSingleProviderForUser({ userId, ...input, allowEmptyModel: true });
  if (!provider.listModels) throw new TRPCError({ code: "BAD_REQUEST", message: "该提供商暂不支持模型列表查询，请手动填写模型名。" });
  const received = await provider.listModels();
  const models = Array.from(new Map(received.filter(model => typeof model.id === "string" && model.id.trim())
    .map(model => [model.id, model])).values());
  return { providerName: input.providerName, models: models.slice(0, 200), truncated: models.length > 200 };
}
