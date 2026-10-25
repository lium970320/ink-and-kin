import { requestModelList } from "../model-list";
import { readClaudeUsage } from "../provider-usage";
import { assertNoSafetyRefusal, classifyLLMError, providerPayloadError, safeLLMError } from "../errors";
import { configuredEffort, normalizeReasoningEffort, type ReasoningConfig } from "../reasoning";
import { requestScope } from "../request-signal";
import { parseSSEData } from "../sse";
import { getTextContent, type LLMMessage, type LLMOptions, type LLMProvider, type LLMContentPart } from "../types";
const CLAUDE_THINKING_BUDGET: Record<string, number> = { low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 16384 };
export function resolveClaudeOutputEffort(reasoningEffort?: string, model?: string): string {
  const key = reasoningEffort?.trim().toLowerCase();
  if (!key || ["off", "none", "disabled", "false", "0"].includes(key)) return "high";
  if (key === "low" || key === "medium" || key === "high") return key;
  const name = model ?? "";
  const opusTier = /opus/i.test(name);

  const opus47Plus = /opus-(?:4-7|[5-9]|\d{2,})/i.test(name);
  if (key === "xhigh") {
    if (opus47Plus) return "xhigh";
    return opusTier ? "max" : "high";
  }
  if (key === "max") return opusTier ? "max" : "high";
  return "high";
}


export function resolveClaudeThinkingMode(model: string): "adaptive" | "legacy" | "unknown" {
  const matched = /claude-(?:opus|sonnet|haiku|fable)-(\d+)/i.exec(model ?? "");
  if (!matched) return "unknown";
  const major = Number(matched[1]);
  if (!Number.isFinite(major)) return "unknown";
  return major >= 5 ? "adaptive" : "legacy";
}

export function resolveClaudeThinkingBudget(reasoningEffort?: string): number | undefined {
  const key = reasoningEffort?.trim().toLowerCase();
  if (!key) return undefined;
  if (["off", "none", "disabled", "false", "0"].includes(key)) return undefined;
  return CLAUDE_THINKING_BUDGET[key] ?? CLAUDE_THINKING_BUDGET.medium;
}


function content(value: string | LLMContentPart[]) { return typeof value === "string" ? value : value.map(part => part.type === "text" ? { type: "text", text: part.text } : { type: "image", source: { type: "url", url: part.url } }); }
export class ClaudeProvider implements LLMProvider {
  name = "Claude"; supportsReasoningEffort = true; reportsAttempts = true;
  capabilities = { streaming: true, vision: true, tools: true, jsonMode: false };
  constructor(private apiKey: string, private model: string, private baseUrl: string, private reasoning?: ReasoningConfig) {}
  getModel() { return this.model; }
  listModels(options?: { signal?: AbortSignal }) {
    return requestModelList({ baseUrl: this.baseUrl, apiKey: this.apiKey, protocol: "claude", signal: options?.signal });
  }
  getConfigSummary(options?: LLMOptions) { return { baseUrl: this.baseUrl, model: this.model, reasoningEffort: configuredEffort(this.effectiveReasoning(options)) }; }
  isConfigured() { return !!this.apiKey; }
  private effectiveReasoning(options?: LLMOptions): ReasoningConfig | undefined {
    if (options?.disableThinking) return { mode: "default" };
    if (options?.reasoningEffort !== undefined) { const effort = normalizeReasoningEffort(options.reasoningEffort); return effort ? { mode: "effort", effort } : { mode: "default" }; }
    return options?.reasoning ?? this.reasoning;
  }
  private buildBody(messages: LLMMessage[], options: LLMOptions | undefined, stream: boolean, adaptive: boolean) {
    const reasoning = this.effectiveReasoning(options);
    const budget = reasoning?.mode === "budget" ? reasoning.budgetTokens : resolveClaudeThinkingBudget(configuredEffort(reasoning));
    let system = ""; const filtered: LLMMessage[] = [];
    for (const message of messages) { if (message.role === "system") system += (system ? String.fromCharCode(10) : "") + getTextContent(message.content); else filtered.push(message); }
    return JSON.stringify({ model: this.model, max_tokens: budget ? Math.max(options?.maxTokens ?? 4096, budget + 1024) : options?.maxTokens ?? 4096,
      ...(budget ? adaptive ? { thinking: { type: "adaptive" }, output_config: { effort: resolveClaudeOutputEffort(configuredEffort(reasoning), this.model) } } : { thinking: { type: "enabled", budget_tokens: budget } } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}), ...(stream ? { stream: true } : {}), system: system || undefined, messages: filtered.map(message => ({ role: message.role, content: content(message.content) })) });
  }
  private async post(messages: LLMMessage[], options: LLMOptions | undefined, stream: boolean, scope: ReturnType<typeof requestScope>) {
    const reasoning = this.effectiveReasoning(options); let adaptive = resolveClaudeThinkingMode(this.model) === "adaptive";
    const send = () => { const body = this.buildBody(messages, options, stream, adaptive); scope.check(); options?.onAttempt?.(); return fetch(`${this.baseUrl.replace(/\/+$/, "")}/v1/messages`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body, signal: scope.signal }); };
    let response = await send();
    if (!response.ok) {
      const text = await response.text(); const error = Object.assign(new Error(text), { status: response.status });
      const kind = classifyLLMError(error, options?.signal);
      const hasThinking = reasoning && reasoning.mode !== "default";
      const wantsAdaptive = /requires? adaptive|thinking.type.*adaptive|only supports? adaptive/i.test(text);
      const wantsLegacy = /(?:unsupported|does not support).*adaptive|requires?.*(?:enabled|budget_tokens)/i.test(text);
      if (response.status === 400 && hasThinking && kind !== "safety" && kind !== "auth" && kind !== "permission" && ((!adaptive && wantsAdaptive) || (adaptive && wantsLegacy))) {
        adaptive = !adaptive; response = await send();
        if (!response.ok) throw safeLLMError(Object.assign(new Error(await response.text()), { status: response.status }), options?.signal);
      } else throw safeLLMError(error, options?.signal);
    }
    return response;
  }
  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const scope = requestScope(options?.signal, options?.requestTimeoutMs ?? 120000);
    try {
      const response = await this.post(messages, options, false, scope); const data = await response.json();
      if (typeof data.model === "string") options?.onModel?.(data.model);
      const usage = readClaudeUsage(data.usage); if (usage) options?.onUsage?.(usage);
      if (data.error) throw providerPayloadError(data.error); assertNoSafetyRefusal(data.stop_reason);
      return Array.isArray(data.content) ? data.content.filter((block: { type?: string; text?: unknown }) => block.type === "text" && typeof block.text === "string").map((block: { text: string }) => block.text).join("") : "";
    } finally { scope.close(); }
  }
  async *stream(messages: LLMMessage[], options?: LLMOptions) {
    const scope = requestScope(options?.signal, options?.requestTimeoutMs ?? 120000);
    try {
      const response = await this.post(messages, options, true, scope);
      for await (const payload of parseSSEData(response)) {
        if (payload === "[DONE]") return;
        let parsed; try { parsed = JSON.parse(payload); } catch { continue; }
        if (!parsed || typeof parsed !== "object") continue;
        if (typeof parsed.message?.model === "string") options?.onModel?.(parsed.message.model);
        const usage = readClaudeUsage(parsed.type === "message_start" ? parsed.message?.usage : parsed.usage); if (usage) options?.onUsage?.(usage);
        if (parsed.error) throw providerPayloadError(parsed.error); assertNoSafetyRefusal(parsed.delta?.stop_reason ?? parsed.message?.stop_reason);
        if (parsed.type === "content_block_delta" && typeof parsed.delta?.text === "string" && parsed.delta.text) yield { text: parsed.delta.text };
      }
    } finally { scope.close(); }
  }
}
