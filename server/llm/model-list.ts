import { LLMRequestError, providerResponseError, safeLLMError } from "./errors";
import { requestScope } from "./request-signal";
import type { LLMModelInfo } from "./types";

function modelsEndpoint(baseUrl: string, suffix: string): string {
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    url.pathname = url.pathname.replace(/\/+$/, "") + suffix;
    return url.toString();
  } catch { throw new LLMRequestError("invalid_request"); }
}

export async function requestModelList(params: {
  baseUrl: string;
  apiKey?: string;
  protocol: "openai" | "claude" | "ollama";
  signal?: AbortSignal;
}): Promise<LLMModelInfo[]> {
  if (params.protocol !== "ollama" && !params.apiKey) throw new LLMRequestError("auth");
  const suffix = params.protocol === "claude" ? "/v1/models" : params.protocol === "ollama" ? "/api/tags" : "/models";
  const endpoint = modelsEndpoint(params.baseUrl, suffix);
  const url = params.protocol === "claude" ? `${endpoint}?limit=1000` : endpoint;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.protocol === "claude") {
    headers["x-api-key"] = params.apiKey!;
    headers["anthropic-version"] = "2023-06-01";
  } else if (params.protocol === "openai") headers.Authorization = `Bearer ${params.apiKey}`;
  const scope = requestScope(params.signal, 15000);
  try {
    scope.check();
    const response = await fetch(url, { method: "GET", headers, signal: scope.signal });
    if (!response.ok) throw await providerResponseError(response);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new LLMRequestError("invalid_request"); }
    if (!payload || typeof payload !== "object") throw new LLMRequestError("invalid_request");
    const object = payload as Record<string, unknown>;
    const items = params.protocol === "ollama" ? object.models : object.data;
    if (!Array.isArray(items)) throw new LLMRequestError("invalid_request");
    const unique = new Map<string, LLMModelInfo>();
    for (const item of items.slice(0, 1000)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = params.protocol === "ollama" ? record.name ?? record.model : record.id;
      if (typeof id !== "string" || !id.trim() || id.length > 256) continue;
      const created = typeof record.created === "number" ? record.created
        : typeof record.created_at === "string" ? Date.parse(record.created_at) / 1000 : undefined;
      unique.set(id.trim(), {
        ...unique.get(id.trim()),
        id: id.trim(),
        ...(typeof record.owned_by === "string" ? { ownedBy: record.owned_by } : {}),
        ...(typeof created === "number" && Number.isFinite(created) ? { created: Math.floor(created) } : {}),
      });
    }
    return Array.from(unique.values());
  } catch (error) {
    throw safeLLMError(error, params.signal);
  } finally { scope.close(); }
}
