import type { ReasoningConfig, ReasoningEffort } from "./reasoning";
import type { UserUsageContext } from "./usage-context";
export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
};

export type LLMOptions = {
  maxTokens?: number;
  temperature?: number;
  provider?: string;
  /** Cancels an in-flight request (used by the streaming route). */
  signal?: AbortSignal;
  usageContext?: UserUsageContext;
  purpose?: LLMPurpose;
  reasoningEffort?: ReasoningEffort | null;
  reasoning?: ReasoningConfig;
  disableThinking?: boolean;
  reasoningMaxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  requestTimeoutMs?: number;
  onRoute?: (route: LLMRouteInfo) => void;
  onModel?: (model: string) => void;
  onUsage?: (usage: LLMTokenUsage) => void;
  onAttempt?: () => void;
};

/**
 * What a provider is able to do.
 *
 * The capability flags exist so a caller can fail loudly instead of silently
 * degrading: before this existed, sending an image to Ollama or Dify quietly
 * dropped the image and answered from the text alone.
 */
export interface LLMCapabilities {
  /** Supports token-by-token streaming. */
  streaming: boolean;
  /** Understands `image_url` content parts. */
  vision: boolean;
  /** Supports function/tool calling. */
  tools: boolean;
  /** Supports a native structured-JSON output mode. */
  jsonMode: boolean;
}

export const NO_CAPABILITIES: LLMCapabilities = {
  streaming: false,
  vision: false,
  tools: false,
  jsonMode: false,
};

export type LLMStreamChunk = { text: string };

export type InvokeParams = {
  messages: LLMMessage[];
  options?: LLMOptions;
};

export type InvokeResult = string;

export interface LLMProvider {
  name: string;
  maxAttempts?: number;
  listModels?(options?: { signal?: AbortSignal }): Promise<LLMModelInfo[]>;
  supportsReasoningEffort?: boolean;
  reportsAttempts?: boolean;
  getRelayId?(): number | undefined;
  getModel?(options?: LLMOptions): string;
  getProviderName?(options?: LLMOptions): string;
  getConfigSummary?(options?: LLMOptions): { baseUrl?: string; model?: string; reasoningEffort?: string };
  /** Declared once at construction; every provider must set it. */
  capabilities: LLMCapabilities;
  isConfigured(): boolean;
  invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  /** Optional: yields text incrementally. */
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
}

export function getTextContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => (p as { type: "text"; text: string }).text).join("\n");
}

/** True when the message carries at least one non-text part. */
export function hasNonTextContent(content: string | LLMContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some(p => p.type !== "text");
}

export type LLMPurpose = "chat" | "media_reply" | "source_recall" | "roleplay" | "reflection" | "proactive" | "voice_policy" | "tts_enrichment" | "persona_analysis" | "skill_pipeline" | "graduation" | "memory_extract" | "diary" | "utility" | "scene_image_prompt" | "scene_image_synopsis" | "scene_memory_summary";
export type LLMTokenUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };

export type LLMModelInfo = { id: string; ownedBy?: string; created?: number };

export type LLMRouteInfo = { provider: string; model?: string; relayId?: number; reasoningEffort?: string };
