export type LLMFailureKind = "transient" | "rate_limit" | "network" | "auth" | "permission" | "invalid_request" | "safety" | "cancelled" | "unknown";
const RETRYABLE = new Set<LLMFailureKind>(["transient", "rate_limit", "network"]);
const MESSAGES: Record<LLMFailureKind, string> = {
  transient: "模型服务暂时不可用，请稍后重试。", rate_limit: "模型服务请求受限，请稍后重试。",
  network: "无法连接模型服务，请检查网络后重试。", auth: "模型服务认证失败，请检查自己的密钥配置。",
  permission: "模型服务未授权此请求，请检查账户权限。", invalid_request: "模型请求或配置不兼容，请检查模型与推理设置。",
  safety: "模型服务拒绝了此请求，请调整请求内容。", cancelled: "模型请求已取消。", unknown: "模型调用失败，请检查配置后重试。",
};
export class LLMRequestError extends Error {
  constructor(public readonly kind: LLMFailureKind, public readonly status?: number) {
    super(MESSAGES[kind]); this.name = kind === "cancelled" ? "AbortError" : "LLMRequestError";
  }
}
/** 先识别不可换站类别，避免网关500正文中的拒绝被当作瞬态错误。正文只在内存分类，不向UI/日志转发。 */
export function classifyLLMError(error: unknown, signal?: AbortSignal): LLMFailureKind {
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return "cancelled";
  if (error instanceof LLMRequestError) return error.kind;
  const data = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const text = [data.code, data.type, error instanceof Error ? error.message : ""].filter(value => typeof value === "string").join(" ").toLowerCase();
  const status = typeof data.status === "number" ? data.status : Number(text.match(/(?:error|status|http)[: ]+(\d{3})\b/i)?.[1] ?? text.match(/^([45]\d{2})\b/)?.[1]);
  if (/sensitive_words_detected|policy_block(?:ed)?|content[_ -]?filter|safety|policy[_ -]?(?:violation|reject)|moderation|refusal|refused|prohibited|安全|内容审核/.test(text)) return "safety";
  if (status === 401 || /invalid[_ -]?(?:api[_ -]?)?key|authentication|unauthorized|认证失败/.test(text)) return "auth";
  if (status === 403 || /permission|forbidden|access[_ -]?denied|insufficient_account_balance|no_available_accounts|insufficient_quota|billing/.test(text)) return "permission";
  if ([400, 404, 405, 413, 415, 422].includes(status) || /invalid[_ -]?(?:request|parameter)|unsupported|not found|deprecated|not configured|不支持|不兼容/.test(text)) return "invalid_request";
  if (status === 429 || /rate[_ -]?limit|too many requests/.test(text)) return "rate_limit";
  if (/econnreset|econnrefused|etimedout|enotfound|eai_again|socket hang up|fetch failed|failed to fetch|network error|networkerror|timed out|timeout/.test(text)) return "network";
  if ([408, 425, 500, 502, 503, 504, 529].includes(status) || /overloaded|server_error|api_error|internal_error|temporar(?:y|ily)|service unavailable/.test(text)) return "transient";
  return "unknown";
}
export function mayRetryLLM(error: unknown, signal?: AbortSignal): boolean { return RETRYABLE.has(classifyLLMError(error, signal)); }
export function safeLLMError(error: unknown, signal?: AbortSignal): LLMRequestError {
  if (signal?.aborted) return new LLMRequestError("cancelled");
  if (error instanceof LLMRequestError) return error;
  const safe = new LLMRequestError(classifyLLMError(error, signal));
  const data = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const description = [data.code, data.type, error instanceof Error ? error.message : ""].join(" ");
  if (safe.kind === "permission" && /insufficient_account_balance|no_available_accounts/i.test(description)) {
    safe.message = "模型服务账户余额或可用账户不足，请检查账户配置。";
  }
  return safe;
}
export async function providerResponseError(response: Response): Promise<LLMRequestError> {
  let text = "";
  try { text = await response.text(); } catch { /* 状态码仍可分类。 */ }
  return safeLLMError(Object.assign(new Error(text), { status: response.status }));
}

/** 供应商成功响应/流中的错误对象仍须走相同分类，不能被当作空回答后换站。 */
export function providerPayloadError(error: unknown): LLMRequestError {
  const data = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return safeLLMError(Object.assign(new Error(typeof data.message === "string" ? data.message : ""), {
    code: data.code, type: data.type, status: data.status,
  }));
}
export function assertNoSafetyRefusal(reason: unknown, refusal?: unknown) {
  if ((typeof refusal === "string" && refusal.length > 0) || reason === "content_filter" || reason === "refusal") throw new LLMRequestError("safety");
}
