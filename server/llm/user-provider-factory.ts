import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { DifyProvider } from "./providers/dify";
import { readReasoningConfig, type ReasoningConfig } from "./reasoning";
import { deepSeekProviderForPurpose } from "./deepseek-routing";
import type { LLMOptions, LLMProvider, LLMPurpose } from "./types";
export type UserProviderConfig = { providerName: string; apiKey?: string | null; baseUrl?: string | null; model?: string | null; systemMessage?: string | null; extraConfig?: unknown; relayId?: number };
const DEFAULTS: Record<string, [string, string]> = {
  openai: ["https://api.openai.com/v1", "gpt-4o"], claude: ["https://api.anthropic.com", "claude-sonnet-4-6"],
  deepseek: ["https://api.deepseek.com/v1", "deepseek-chat"], "deepseek-flash": ["https://api.deepseek.com/v1", "deepseek-v4-flash"], "deepseek-pro": ["https://api.deepseek.com/v1", "deepseek-v4-pro"],
  kimi: ["https://api.moonshot.cn/v1", "moonshot-v1-8k"], qwen: ["https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-turbo"],
  doubao: ["https://ark.cn-beijing.volces.com/api/v3", ""], "302ai": ["https://api.302.ai/v1", ""],
  atlas: ["https://api.atlascloud.ai/v1", "google/gemini-3-flash-preview"], cheaperinference: ["https://api.cheaperinference.com/v1", "gpt-5.4-mini"],
  gemini: ["https://generativelanguage.googleapis.com/v1beta/openai", ""], grok: ["https://api.x.ai/v1", ""],
};
export function isOpenCodeZenEndpoint(baseUrl?: string) { if (!baseUrl) return false; try { const url = new URL(baseUrl); return (url.hostname === "opencode.ai" || url.hostname.endsWith(".opencode.ai")) && /^\/zen(?:\/|$)/.test(url.pathname); } catch { return false; } }
function optionsPurpose(options?: LLMOptions) { return (options?.purpose ?? options?.usageContext?.purpose) as LLMPurpose | undefined; }
export function createUserConfiguredLlmProvider(config: UserProviderConfig, reasoning = readReasoningConfig(config.extraConfig), dynamic = false): LLMProvider | undefined {
  const key = config.providerName.toLowerCase();
  if (dynamic && key === "deepseek") {
    const choose = (options?: LLMOptions) => createUserConfiguredLlmProvider({ ...config, providerName: deepSeekProviderForPurpose(optionsPurpose(options)) }, reasoning)!;
    return { name: "DeepSeek", supportsReasoningEffort: true, reportsAttempts: true, capabilities: { streaming: true, vision: true, tools: true, jsonMode: true },
      isConfigured: () => !!config.apiKey, getModel: options => choose(options).getModel!(), getProviderName: options => choose(options).name,
      getConfigSummary: options => choose(options).getConfigSummary!(options), getRelayId: () => config.relayId,
      listModels: options => choose().listModels!(options),
      invoke: (messages, options) => choose(options).invoke(messages, options), stream: (messages, options) => choose(options).stream!(messages, options) };
  }
  let provider: LLMProvider;
  if (key === "ollama") { if (!config.baseUrl || !config.model) return undefined; provider = new OllamaProvider(config.baseUrl, config.model); }
  else {
    if (!config.apiKey) return undefined;
    const defaults = DEFAULTS[key]; const baseUrl = config.baseUrl || defaults?.[0]; const model = config.model || defaults?.[1] || "";
    if (!baseUrl) return undefined;
    if (key === "claude") provider = new ClaudeProvider(config.apiKey, model, baseUrl, reasoning);
    else if (key === "dify") provider = new DifyProvider(config.apiKey, baseUrl);
    else {
      const deepseek = key.startsWith("deepseek"); const flash = key === "deepseek-flash";
      provider = new OpenAIProvider(config.providerName, config.apiKey, baseUrl, model, config.systemMessage || undefined, key === "atlas" ? 1 : 3,
        reasoning, { ...(deepseek ? { thinking: flash ? "disabled" : "enabled", openCodeCompatibility: isOpenCodeZenEndpoint(baseUrl) } : {}), xHighAlias: key === "openai" ? "xhigh" : "max" });
    }
  }
  if (config.relayId !== undefined) { const id = config.relayId; const base = provider; provider = new Proxy(base, { get(target, key) { if (key === "getRelayId") return () => id; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } }); }
  if (reasoning && reasoning.mode !== "default" && !(provider instanceof OpenAIProvider) && !provider.supportsReasoningEffort) throw new Error("当前提供商不支持推理程度设置。");
  return provider;
}
