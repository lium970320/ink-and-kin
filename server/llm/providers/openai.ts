import { requestModelList } from "../model-list";
import { requestScope } from "../request-signal";
import { configuredEffort, normalizeReasoningEffort } from "../reasoning";
import { providerResponseError, providerPayloadError, assertNoSafetyRefusal } from "../errors";
import { readOpenAiUsage } from "../provider-usage";
import { assertReasoningSupported, type ReasoningConfig } from "../reasoning";
import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { parseSSEData } from "../sse";

function toOpenAIContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private systemMessage?: string,
    public readonly maxAttempts = 3,
    private readonly reasoning?: ReasoningConfig,
    private readonly requestConfig: { thinking?: "enabled" | "disabled"; openCodeCompatibility?: boolean; xHighAlias?: "xhigh" | "max" } = {},
  ) {}

  get supportsReasoningEffort() { return this.requestConfig.thinking !== "disabled" && !this.requestConfig.openCodeCompatibility; }
  reportsAttempts = true;
  getConfigSummary(options?: LLMOptions) { return { baseUrl: this.baseUrl, model: this.model, reasoningEffort: configuredEffort(this.effectiveReasoning(options)) }; }
  private effectiveReasoning(options?: LLMOptions): ReasoningConfig | undefined {
    if (options?.disableThinking || this.requestConfig.thinking === "disabled" || this.requestConfig.openCodeCompatibility) return { mode: "default" };
    if (options?.reasoningEffort !== undefined) { const effort = normalizeReasoningEffort(options.reasoningEffort); return effort ? { mode: "effort", effort } : { mode: "default" }; }
    return options?.reasoning ?? this.reasoning;
  }
  readonly reasoningModes = ["effort"] as const;
  getModel(): string { return this.model; }
  listModels(options?: { signal?: AbortSignal }) {
    return requestModelList({ baseUrl: this.baseUrl, apiKey: this.apiKey, protocol: "openai", signal: options?.signal });
  }

  capabilities = {
    streaming: true,
    vision: true,
    tools: true,
    jsonMode: true,
  };

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private buildMessages(messages: LLMMessage[]): LLMMessage[] {
    return this.systemMessage
      ? [{ role: "system" as const, content: this.systemMessage }, ...messages]
      : messages;
  }

  private buildBody(messages: LLMMessage[], options: LLMOptions | undefined, stream: boolean) {
    const reasoning = this.effectiveReasoning(options);
    assertReasoningSupported(reasoning, this.reasoningModes);
    return JSON.stringify({
      model: this.model,
      messages: this.buildMessages(messages).map(m => ({
        role: m.role,
        content: toOpenAIContent(m.content),
      })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
      ...(this.requestConfig.thinking && !this.requestConfig.openCodeCompatibility ? { extra_body: { thinking: { type: options?.disableThinking ? "disabled" : this.requestConfig.thinking } } } : {}),
      ...(options?.reasoningMaxTokens && !options.disableThinking && !this.requestConfig.openCodeCompatibility ? { reasoning: { max_tokens: options.reasoningMaxTokens } } : reasoning?.mode === "effort" ? { reasoning_effort: reasoning.effort === "xhigh" ? this.requestConfig.xHighAlias ?? (this.name.toLowerCase() === "openai" ? "xhigh" : "max") : reasoning.effort } : {}),
      ...(!this.requestConfig.openCodeCompatibility && this.requestConfig.thinking !== "enabled" && reasoning?.mode !== "effort" && !options?.reasoningMaxTokens ? { ...(options?.frequencyPenalty !== undefined ? { frequency_penalty: options.frequencyPenalty } : {}), ...(options?.presencePenalty !== undefined ? { presence_penalty: options.presencePenalty } : {}) } : {}),
      ...(stream ? { stream: true, ...(options?.onUsage ? { stream_options: { include_usage: true } } : {}) } : {}),
    });
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const scope = requestScope(options?.signal, options?.requestTimeoutMs);
    try {
    const body = this.buildBody(messages, options, false); scope.check(); options?.onAttempt?.();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
      signal: scope.signal,
    });

    if (!response.ok) throw await providerResponseError(response);

    const data = await response.json();
    if (typeof data.model === "string") options?.onModel?.(data.model);
    if (data.error) throw providerPayloadError(data.error);
    const usage = readOpenAiUsage(data.usage);
    if (usage) options?.onUsage?.(usage);
    assertNoSafetyRefusal(data.choices?.[0]?.finish_reason, data.choices?.[0]?.message?.refusal);
    const value = data.choices?.[0]?.message?.content;
    return typeof value === "string" ? value : Array.isArray(value) ? value.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "").join("") : "";
    } finally { scope.close(); }
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const scope = requestScope(options?.signal, options?.requestTimeoutMs);
    try {
    const body = this.buildBody(messages, options, true); scope.check(); options?.onAttempt?.();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
      signal: scope.signal,
    });

    if (!response.ok) throw await providerResponseError(response);

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.model === "string") options?.onModel?.(parsed.model);
      if (parsed.error) throw providerPayloadError(parsed.error);
      const usage = readOpenAiUsage(parsed.usage);
      if (usage) options?.onUsage?.(usage);
      assertNoSafetyRefusal(parsed?.choices?.[0]?.finish_reason, parsed?.choices?.[0]?.delta?.refusal);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield { text: delta };
    }
    } finally { scope.close(); }
  }
}
