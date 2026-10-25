export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ReasoningConfig = { mode: "default" } | { mode: "effort"; effort: ReasoningEffort } | { mode: "budget"; budgetTokens: number };
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export function extraObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && REASONING_EFFORTS.includes(value.trim().toLowerCase() as ReasoningEffort)) return value.trim().toLowerCase() as ReasoningEffort;
  throw new Error("推理程度无效，请选择low/medium/high/xhigh或默认。");
}
export function readReasoningConfig(extra: unknown): ReasoningConfig | undefined {
  const object = extraObject(extra);
  if (Object.hasOwn(object, "reasoningEffort")) { const effort = normalizeReasoningEffort(object.reasoningEffort); return effort ? { mode: "effort", effort } : { mode: "default" }; }
  const value = extraObject(object.reasoning);
  if (!Object.keys(value).length) return undefined;
  if (value.mode === "default") return { mode: "default" };
  if (value.mode === "effort") { const effort = normalizeReasoningEffort(value.effort); if (effort) return { mode: "effort", effort }; }
  if (value.mode === "budget" && Number.isInteger(value.budgetTokens) && Number(value.budgetTokens) >= 1024 && Number(value.budgetTokens) <= 32768) return { mode: "budget", budgetTokens: Number(value.budgetTokens) };
  throw new Error("推理配置无效。");
}
export function resolveReasoningConfig(providerExtra: unknown, relayExtra?: unknown): ReasoningConfig | undefined {
  const relay = extraObject(relayExtra);
  if (relay.reasoningEffort !== undefined && relay.reasoningEffort !== null) return readReasoningConfig(relay);
  if (Object.hasOwn(relay, "reasoning") && relay.reasoning !== null) return readReasoningConfig(relay);
  return readReasoningConfig(providerExtra);
}
export function configuredEffort(config?: ReasoningConfig): ReasoningEffort | undefined { return config?.mode === "effort" ? config.effort : undefined; }
export function assertReasoningSupported(config: ReasoningConfig | undefined, modes: readonly string[] = []) {
  if (config && config.mode !== "default" && !modes.includes(config.mode)) throw new Error("当前提供商不支持此推理配置。");
}
