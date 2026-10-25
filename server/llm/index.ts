import { getLlmRequestContext, resolveUsageContext, scopeProvider } from "./usage-context";
import { UsageMeter, recordLlmUsage, safeRecordUsage, isCancelled, type UsageSink, type LlmUsageRecord } from "./usage";
import { mayRetryLLM, safeLLMError, LLMRequestError } from "./errors";
import { readReasoningConfig } from "./reasoning";
import { createUserConfiguredLlmProvider } from "./user-provider-factory";
import { ENV } from "../_core/env";
import type { LLMMessage, LLMOptions, LLMProvider, LLMStreamChunk, InvokeParams } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { XunfeiProvider } from "./providers/xunfei";
import { DifyProvider } from "./providers/dify";

const registry = new ProviderRegistry();

/**
 * Every provider is registered as a *factory* together with the
 * environment-derived configuration. That lets the same provider be rebuilt
 * with a user's own API key, base URL or model on top of these defaults.
 */
registry.registerFactory(
  "OpenAI",
  (cfg) =>
    new OpenAIProvider(
      "OpenAI",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.openai.com/v1",
      cfg.model ?? "gpt-4o",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.openaiApiKey,
    baseUrl: ENV.openaiBaseUrl,
    model: ENV.openaiModel,
    systemMessage: ENV.openaiSystemMessage || undefined,
  },
);

registry.registerFactory(
  "Atlas",
  (cfg) =>
    new OpenAIProvider(
      "Atlas",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.atlascloud.ai/v1",
      cfg.model ?? "google/gemini-3-flash-preview",
      cfg.systemMessage,
      1,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.atlasApiKey,
    baseUrl: ENV.atlasBaseUrl,
    model: ENV.atlasModel,
  },
);

registry.registerFactory(
  "CheaperInference",
  (cfg) =>
    new OpenAIProvider(
      "CheaperInference",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.cheaperinference.com/v1",
      cfg.model ?? "gpt-5.4-mini",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.cheaperInferenceApiKey,
    baseUrl: ENV.cheaperInferenceBaseUrl,
    model: ENV.cheaperInferenceModel,
  },
);

registry.registerFactory(
  "Kimi",
  (cfg) =>
    new OpenAIProvider(
      "Kimi",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.moonshot.cn/v1",
      cfg.model ?? "moonshot-v1-8k",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.kimiApiKey,
    baseUrl: ENV.kimiBaseUrl,
    model: ENV.kimiModel,
  },
);

registry.registerFactory(
  "Qwen",
  (cfg) =>
    new OpenAIProvider(
      "Qwen",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      cfg.model ?? "qwen-turbo",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.tongyiApiKey,
    baseUrl: ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: ENV.tongyiModel,
  },
);

registry.registerFactory(
  "DeepSeek",
  (cfg) =>
    new OpenAIProvider(
      "DeepSeek",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.deepseek.com/v1",
      cfg.model ?? "deepseek-chat",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.deepseekApiKey,
    baseUrl: ENV.deepseekBaseUrl,
    model: ENV.deepseekModel,
  },
);

registry.registerFactory(
  "Doubao",
  (cfg) =>
    new OpenAIProvider(
      "Doubao",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3",
      cfg.model ?? "",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.doubaoApiKey,
    baseUrl: ENV.doubaoBaseUrl,
    model: ENV.doubaoModel,
  },
);

registry.registerFactory(
  "302AI",
  (cfg) =>
    new OpenAIProvider(
      "302AI",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.302.ai/v1",
      cfg.model ?? "",
      cfg.systemMessage,
      3,
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV._302aiApiKey,
    baseUrl: "https://api.302.ai/v1",
  },
);

registry.registerFactory(
  "Claude",
  (cfg) =>
    new ClaudeProvider(
      cfg.apiKey ?? "",
      cfg.model ?? "claude-sonnet-4-6",
      cfg.baseUrl ?? "https://api.anthropic.com",
      readReasoningConfig(cfg.extra),
    ),
  {
    apiKey: ENV.claudeApiKey,
    baseUrl: ENV.claudeBaseUrl,
    model: ENV.claudeModel,
  },
);

registry.registerFactory(
  "Ollama",
  (cfg) => new OllamaProvider(cfg.baseUrl ?? "http://localhost:11434", cfg.model ?? "llama3"),
  {
    baseUrl: ENV.ollamaUrl,
    model: ENV.ollamaModel,
  },
);

registry.registerFactory(
  "xunfei",
  (cfg) =>
    new XunfeiProvider(
      cfg.appId ?? "",
      cfg.apiKey ?? "",
      cfg.apiSecret ?? "",
      cfg.model ?? "v3.5",
    ),
  {
    appId: ENV.xunfeiAppId,
    apiKey: ENV.xunfeiApiKey,
    apiSecret: ENV.xunfeiApiSecret,
    model: ENV.xunfeiModelVersion,
  },
);

registry.registerFactory(
  "dify",
  (cfg) => new DifyProvider(cfg.apiKey ?? "", cfg.baseUrl ?? ""),
  {
    apiKey: ENV.difyApiKey,
    baseUrl: ENV.difyUrl,
  },
);

registry.setDefault(ENV.defaultLlmProvider);

for (const [name, baseUrl] of [["Grok", "https://api.x.ai/v1"], ["Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"], ["DeepSeek-Flash", "https://api.deepseek.com/v1"], ["DeepSeek-Pro", "https://api.deepseek.com/v1"]]) {
  registry.registerFactory(name, cfg => createUserConfiguredLlmProvider({ providerName: name, apiKey: cfg.apiKey || "", baseUrl: cfg.baseUrl || baseUrl, model: cfg.model, extraConfig: cfg.extra }) ?? new OpenAIProvider(name, "", baseUrl, "", undefined, 3, undefined, name === "DeepSeek-Flash" ? { thinking: "disabled" } : {}), name.startsWith("DeepSeek-") ? { apiKey: ENV.deepseekApiKey, baseUrl: ENV.deepseekBaseUrl } : {});
}
export type UserInvokeParams = InvokeParams & { userId: number; personaId?: number; route?: string; purpose?: string; provider?: LLMProvider };
export class LLMService {
  constructor(private providerRegistry = registry, private usageSink: UsageSink = recordLlmUsage, private userProviderResolver?: (params: { userId: number; providerName?: string }) => Promise<LLMProvider | undefined>) {}
  async invoke(params: InvokeParams): Promise<string> {
    const ambient = getLlmRequestContext();
    const context = { ...ambient, ...params.options?.usageContext, userId: params.options?.usageContext?.userId ?? ambient?.userId };
    if (context.userId !== undefined) return this.invokeForUser({ ...params, userId: context.userId, personaId: context.personaId, route: context.route, purpose: context.purpose });
    const provider = this.providerRegistry.get(params.options?.provider);
    if (!provider) throw new Error("No LLM provider available. Configure a provider first.");
    return this.invokeWithProvider(provider, params);
  }
  private checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new LLMRequestError("cancelled"); }
  private waitRetry(delay: number, signal?: AbortSignal) {
    this.checkAbort(signal);
    return new Promise<void>((resolve, reject) => { const cleanup = () => signal?.removeEventListener("abort", abort); const timer = setTimeout(() => { cleanup(); resolve(); }, delay); const abort = () => { clearTimeout(timer); cleanup(); reject(new LLMRequestError("cancelled")); }; signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); });
  }
  private async invokeUntracked(provider: LLMProvider, params: InvokeParams): Promise<string> {
    if (!provider.isConfigured()) throw new LLMRequestError("invalid_request");
    const attempts = Math.min(3, Math.max(1, Math.floor(provider.maxAttempts ?? 3)));
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { this.checkAbort(params.options?.signal); if (!provider.reportsAttempts) params.options?.onAttempt?.(); const text = await provider.invoke(params.messages, params.options); this.checkAbort(params.options?.signal); return text; }
      catch (error) { if (attempt + 1 >= attempts || !mayRetryLLM(error, params.options?.signal)) throw error; await this.waitRetry(200 * 2 ** attempt, params.options?.signal); }
    }
    throw new LLMRequestError("unknown");
  }
  private async *streamUntracked(provider: LLMProvider, params: InvokeParams): AsyncGenerator<LLMStreamChunk> {
    if (!provider.isConfigured()) throw new LLMRequestError("invalid_request");
    if (!provider.stream) { const text = await this.invokeUntracked(provider, params); if (text) yield { text }; return; }
    const attempts = Math.min(3, Math.max(1, Math.floor(provider.maxAttempts ?? 3)));
    for (let attempt = 0; attempt < attempts; attempt++) {
      let emitted = false;
      try { this.checkAbort(params.options?.signal); if (!provider.reportsAttempts) params.options?.onAttempt?.(); for await (const chunk of provider.stream(params.messages, params.options)) { this.checkAbort(params.options?.signal); if (chunk.text) emitted = true; yield chunk; } this.checkAbort(params.options?.signal); return; }
      catch (error) { if (emitted || attempt + 1 >= attempts || !mayRetryLLM(error, params.options?.signal)) throw error; await this.waitRetry(200 * 2 ** attempt, params.options?.signal); }
    }
  }
  private meteredParams(provider: LLMProvider, params: InvokeParams, streaming: boolean) {
    const context = resolveUsageContext(provider, params.options?.usageContext);
    const options = { ...params.options, usageContext: { ...context, purpose: params.options?.purpose ?? context.purpose }, purpose: params.options?.purpose ?? context.purpose as LLMOptions["purpose"] };
    const summary = provider.getConfigSummary?.(options);
    const meter = new UsageMeter(options.usageContext, params.messages, provider.getProviderName?.(options) ?? provider.name, summary?.model ?? provider.getModel?.(options), streaming, params.options?.provider, summary?.reasoningEffort, provider.getRelayId?.());
    return { meter, params: { ...params, options: { ...options,
      onRoute: route => { meter.observeRoute(route); params.options?.onRoute?.(route); },
      onAttempt: () => { meter.startAttempt(); params.options?.onAttempt?.(); },
      onUsage: usage => { meter.observeUsage(usage); params.options?.onUsage?.(usage); },
      onModel: model => { meter.observeModel(model); params.options?.onModel?.(model); },
    } } as InvokeParams };
  }
  async invokeWithProvider(provider: LLMProvider, params: InvokeParams): Promise<string> {
    const observed = this.meteredParams(provider, params, false); let status: LlmUsageRecord["status"] = "failed"; let errorKind: LlmUsageRecord["error"] = "provider_error";
    try { const text = await this.invokeUntracked(provider, observed.params); observed.meter.observeText(text); status = "success"; errorKind = undefined; return text; }
    catch (error) { if (isCancelled(error, params.options?.signal)) { status = "cancelled"; errorKind = "cancelled"; } throw safeLLMError(error, params.options?.signal); }
    finally { await safeRecordUsage(this.usageSink, observed.meter.finish(status, errorKind)); }
  }
  async *streamWithProvider(provider: LLMProvider, params: InvokeParams): AsyncGenerator<LLMStreamChunk> {
    const observed = this.meteredParams(provider, params, true); let status: LlmUsageRecord["status"] = "cancelled"; let errorKind: LlmUsageRecord["error"] = "consumer_closed";
    try { for await (const chunk of this.streamUntracked(provider, observed.params)) { observed.meter.observeText(chunk.text); yield chunk; } this.checkAbort(params.options?.signal); status = "success"; errorKind = undefined; }
    catch (error) { status = isCancelled(error, params.options?.signal) ? "cancelled" : "failed"; errorKind = status === "cancelled" ? "cancelled" : "provider_error"; throw safeLLMError(error, params.options?.signal); }
    finally { await safeRecordUsage(this.usageSink, observed.meter.finish(status, errorKind)); }
  }
  private async providerForUser(params: UserInvokeParams) {
    const resolve = this.userProviderResolver ?? (async (input: { userId: number; providerName?: string }) => (await import("./user-provider")).resolveProviderForUser(input));
    const provider = params.provider ?? await resolve({ userId: params.userId, providerName: params.options?.provider });
    if (!provider) throw new LLMRequestError("invalid_request");
    return scopeProvider(provider, { userId: params.userId });
  }
  async invokeForUser(params: UserInvokeParams) {
    const provider = await this.providerForUser(params);
    return this.invokeWithProvider(provider, { ...params, options: { ...params.options, usageContext: { ...getLlmRequestContext(), ...params.options?.usageContext, userId: params.userId, ...(params.personaId !== undefined ? { personaId: params.personaId } : {}), ...(params.route !== undefined ? { route: params.route } : {}), ...(params.purpose !== undefined ? { purpose: params.purpose } : {}) } } });
  }
  async *streamForUser(params: UserInvokeParams): AsyncGenerator<LLMStreamChunk> {
    const provider = await this.providerForUser(params);
    yield* this.streamWithProvider(provider, { ...params, options: { ...params.options, usageContext: { ...getLlmRequestContext(), ...params.options?.usageContext, userId: params.userId, ...(params.personaId !== undefined ? { personaId: params.personaId } : {}), ...(params.route !== undefined ? { route: params.route } : {}), ...(params.purpose !== undefined ? { purpose: params.purpose } : {}) } } });
  }
  getRegistry() { return this.providerRegistry; }
}
export const llmService = new LLMService();
export { registry };
export type { LLMMessage, LLMOptions, InvokeParams, LLMProvider, LLMStreamChunk };
