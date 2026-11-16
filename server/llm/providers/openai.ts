import { requestModelList } from "../model-list";
import { requestScope } from "../request-signal";
import { configuredEffort, normalizeReasoningEffort } from "../reasoning";
import { providerResponseError, providerPayloadError, assertNoSafetyRefusal } from "../errors";
import { readOpenAiUsage } from "../provider-usage";
import { assertReasoningSupported, type ReasoningConfig } from "../reasoning";
import { getTextContent, type LLMMessage, type LLMOptions, type LLMProvider, type LLMContentPart, type LLMInvokeDetailedResult, type LLMToolCall } from "../types";
import { parseSSEData } from "../sse";

function toOpenAIContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

function toOpenAIMessage(message: LLMMessage) {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: getTextContent(message.content) };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: getTextContent(message.content) || null,
      ...(message.reasoningContent !== undefined ? { reasoning_content: message.reasoningContent } : {}),
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: toOpenAIContent(message.content) };
}

function completionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(part => typeof part?.text === "string" ? part.text : "").join("");
}

function completionToolCalls(calls: unknown): LLMToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call, index) => {
    const name = call?.function?.name;
    if (typeof name !== "string" || !name.trim()) return [];
    const rawArgs = call.function.arguments;
    return [{
      id: typeof call.id === "string" && call.id ? call.id : `call_${index}`,
      name: name.trim(),
      arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {}),
    }];
  });
}

function detailedResult(text: string, finishReason: unknown, toolCalls: LLMToolCall[], reasoningContent: unknown): LLMInvokeDetailedResult {
  return {
    text,
    ...(typeof finishReason === "string" ? { finishReason } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(toolCalls.length && typeof reasoningContent === "string" ? { reasoningContent } : {}),
  };
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
      messages: this.buildMessages(messages).map(toOpenAIMessage),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      ...(options?.tools?.length ? {
        tools: options.tools.map(tool => ({ type: "function", function: tool })),
        ...(options.toolChoice ? {
          tool_choice: typeof options.toolChoice === "string"
            ? options.toolChoice
            : { type: "function", function: { name: options.toolChoice.name } },
        } : {}),
      } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
      ...(this.requestConfig.thinking && !this.requestConfig.openCodeCompatibility ? { extra_body: { thinking: { type: options?.disableThinking ? "disabled" : this.requestConfig.thinking } } } : {}),
      ...(options?.reasoningMaxTokens && !options.disableThinking && !this.requestConfig.openCodeCompatibility ? { reasoning: { max_tokens: options.reasoningMaxTokens } } : reasoning?.mode === "effort" ? { reasoning_effort: reasoning.effort === "xhigh" ? this.requestConfig.xHighAlias ?? (this.name.toLowerCase() === "openai" ? "xhigh" : "max") : reasoning.effort } : {}),
      ...(!this.requestConfig.openCodeCompatibility && this.requestConfig.thinking !== "enabled" && reasoning?.mode !== "effort" && !options?.reasoningMaxTokens ? { ...(options?.frequencyPenalty !== undefined ? { frequency_penalty: options.frequencyPenalty } : {}), ...(options?.presencePenalty !== undefined ? { presence_penalty: options.presencePenalty } : {}) } : {}),
      ...(stream ? { stream: true, ...(options?.onUsage ? { stream_options: { include_usage: true } } : {}) } : {}),
    });
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    return (await this.invokeDetailed(messages, options)).text;
  }

  async invokeDetailed(messages: LLMMessage[], options?: LLMOptions): Promise<LLMInvokeDetailedResult> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const scope = requestScope(options?.signal, options?.requestTimeoutMs);
    try {
      const body = this.buildBody(messages, options, options?.streamResponse === true);
      scope.check();
      options?.onAttempt?.();
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body,
        signal: scope.signal,
      });
      if (!response.ok) throw await providerResponseError(response);
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        return await this.readDetailedStream(response, options);
      }
      const data = await response.json();
      this.reportPayload(data, options);
      const choice = data.choices?.[0];
      const message = choice?.message;
      assertNoSafetyRefusal(choice?.finish_reason, message?.refusal);
      return detailedResult(completionText(message?.content), choice?.finish_reason, completionToolCalls(message?.tool_calls), message?.reasoning_content);
    } finally { scope.close(); }
  }

  private reportPayload(data: any, options?: LLMOptions) {
    if (typeof data.model === "string") options?.onModel?.(data.model);
    if (data.error) throw providerPayloadError(data.error);
    const usage = readOpenAiUsage(data.usage);
    if (usage) options?.onUsage?.(usage);
  }

  private async readDetailedStream(response: Response, options?: LLMOptions): Promise<LLMInvokeDetailedResult> {
    let text = "";
    let fallbackText = "";
    let finishReason: unknown;
    let reasoningContent: string | undefined;
    let fallbackReasoning: unknown;
    let fallbackCalls: LLMToolCall[] = [];
    const calls = new Map<number, LLMToolCall>();
    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") break;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      if (!data || typeof data !== "object") continue;
      this.reportPayload(data, options);
      const choice = data.choices?.[0];
      const delta = choice?.delta;
      const message = choice?.message;
      assertNoSafetyRefusal(choice?.finish_reason, delta?.refusal ?? message?.refusal);
      finishReason = choice?.finish_reason ?? finishReason;
      text += completionText(delta?.content);
      if (typeof delta?.reasoning_content === "string") {
        reasoningContent = (reasoningContent ?? "") + delta.reasoning_content;
      }
      if (message) {
        fallbackText = completionText(message.content);
        fallbackCalls = completionToolCalls(message.tool_calls);
        fallbackReasoning = message.reasoning_content;
      }
      if (!Array.isArray(delta?.tool_calls)) continue;
      delta.tool_calls.forEach((fragment: any, position: number) => {
        if (!fragment || typeof fragment !== "object") return;
        const index = Number.isSafeInteger(fragment.index) && fragment.index >= 0 ? fragment.index : position;
        const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof fragment.id === "string" && fragment.id) call.id = fragment.id;
        if (typeof fragment.function?.name === "string") call.name += fragment.function.name;
        if (typeof fragment.function?.arguments === "string") call.arguments += fragment.function.arguments;
        calls.set(index, call);
      });
    }
    const streamedCalls = Array.from(calls).sort(([a], [b]) => a - b).flatMap(([index, call]) => {
      const name = call.name.trim();
      return name ? [{ id: call.id || `call_${index}`, name, arguments: call.arguments || "{}" }] : [];
    });
    return detailedResult(text || fallbackText, finishReason, streamedCalls.length ? streamedCalls : fallbackCalls, reasoningContent ?? fallbackReasoning);
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const scope = requestScope(options?.signal, options?.requestTimeoutMs);
    try {
    const body = this.buildBody(messages, options, true); scope.check(); options?.onAttempt?.();
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
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
      this.reportPayload(parsed, options);
      assertNoSafetyRefusal(parsed?.choices?.[0]?.finish_reason, parsed?.choices?.[0]?.delta?.refusal);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield { text: delta };
    }
    } finally { scope.close(); }
  }
}
