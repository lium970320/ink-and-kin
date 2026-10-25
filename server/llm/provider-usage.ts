import type { LLMTokenUsage } from "./types";
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function readOpenAiUsage(value: unknown): LLMTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const result = { inputTokens: count(usage.prompt_tokens ?? usage.input_tokens), outputTokens: count(usage.completion_tokens ?? usage.output_tokens), totalTokens: count(usage.total_tokens) };
  return Object.values(result).some(value => value !== undefined) ? result : undefined;
}
export function readClaudeUsage(value: unknown): LLMTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const baseInput = count(usage.input_tokens);
  const result = {
    inputTokens: [baseInput, count(usage.cache_creation_input_tokens), count(usage.cache_read_input_tokens)].some(value => value !== undefined) ? (baseInput ?? 0) + (count(usage.cache_creation_input_tokens) ?? 0) + (count(usage.cache_read_input_tokens) ?? 0) : undefined,
    outputTokens: count(usage.output_tokens),
  };
  return Object.values(result).some(value => value !== undefined) ? result : undefined;
}
