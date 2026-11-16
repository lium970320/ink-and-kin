import { createHash } from "node:crypto";

type ProviderConfig = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type EmbeddingProviderConfig = ProviderConfig & { dimensions?: number };
export type RerankProviderConfig = ProviderConfig & { topN?: number };

function boundedInteger(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function resolveConfig(kind: "EMBEDDING" | "RERANK", overrides: ProviderConfig) {
  const { env } = process;
  const enabled = overrides.enabled ?? env[kind + "_ENABLED"]?.trim().toLowerCase() === "true";
  const apiKey = (overrides.apiKey ?? env[kind + "_API_KEY"] ?? "").trim();
  const baseUrl = (overrides.baseUrl ?? env[kind + "_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const model = (overrides.model ?? env[kind + "_MODEL"] ?? "").trim() ||
    (kind === "EMBEDDING" ? "text-embedding-3-small" : "bge-reranker-v2-m3");
  const timeoutMs = boundedInteger(overrides.timeoutMs ?? Number(env[kind + "_TIMEOUT_MS"]),
    kind === "EMBEDDING" ? 12_000 : 8_000, 1_000, 30_000);
  return {
    enabled: Boolean(enabled && apiKey && /^https?:\/\//i.test(baseUrl)),
    apiKey, baseUrl, model, timeoutMs, fetchImpl: overrides.fetchImpl ?? fetch,
  };
}

export function resolveEmbeddingConfig(overrides: EmbeddingProviderConfig = {}) {
  const cfg = resolveConfig("EMBEDDING", overrides);
  const dimensions = boundedInteger(overrides.dimensions ?? Number(process.env.EMBEDDING_DIMENSIONS),
    0, 0, 8_192);
  // 相同模型名在不同服务商、尺寸或账号下的向量不一定可比较。
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([cfg.baseUrl, cfg.model, dimensions, cfg.apiKey]))
    .digest("hex");
  return { ...cfg, dimensions, fingerprint };
}

function isEmbedding(value: unknown, dimensions: number): value is number[] {
  return Array.isArray(value) && value.length >= 4 && value.length <= 8_192 &&
    (!dimensions || value.length === dimensions) &&
    value.every(item => typeof item === "number" && Number.isFinite(item)) &&
    value.some(item => item !== 0);
}

async function post(cfg: ReturnType<typeof resolveConfig>, endpoint: "embeddings" | "rerank", body: object) {
  const url = cfg.baseUrl.endsWith("/" + endpoint) ? cfg.baseUrl : cfg.baseUrl + "/" + endpoint;
  try {
    const response = await cfg.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
      redirect: "error",
    });
    if (response.ok) return await response.json();
    console.warn(`[Retrieval] ${endpoint} 返回 ${response.status}，使用本地排序`);
  } catch {
    console.warn(`[Retrieval] ${endpoint} 请求失败，使用本地排序`);
  }
  return null;
}

export async function embedTexts(texts: string[], overrides?: EmbeddingProviderConfig) {
  const cfg = resolveEmbeddingConfig(overrides);
  if (!cfg.enabled || texts.length === 0) return null;
  const result: Array<number[] | null> = new Array(texts.length).fill(null);
  // 固定批大小，让新向量可以逐步补齐而不阻塞整章导入。
  for (let offset = 0; offset < texts.length; offset += 32) {
    const input = texts.slice(offset, offset + 32).map(text => text.replace(/\s+/g, " ").trim().slice(0, 6000));
    const payload = await post(cfg, "embeddings", {
      model: cfg.model,
      input,
      ...(cfg.dimensions ? { dimensions: cfg.dimensions } : {}),
    }) as { data?: Array<{ index?: unknown; embedding?: unknown } | null> } | null;
    if (!Array.isArray(payload?.data)) return null;
    payload.data.forEach((entry, index) => {
      if (!entry || !isEmbedding(entry.embedding, cfg.dimensions)) return;
      const position = entry.index === undefined ? index : entry.index;
      if (typeof position === "number" && Number.isInteger(position) && position >= 0 && position < input.length) {
        result[offset + position] = entry.embedding;
      }
    });
  }
  return result;
}

export async function rerankDocuments(query: string, documents: string[], overrides: RerankProviderConfig = {}) {
  const cfg = resolveConfig("RERANK", overrides);
  if (!cfg.enabled || !query.trim() || documents.length < 2) return null;
  const payload = await post(cfg, "rerank", {
    model: cfg.model,
    query: query.slice(0, 1200),
    documents: documents.map(document => document.slice(0, 2400)),
    top_n: boundedInteger(overrides.topN ?? documents.length, documents.length, 1, documents.length),
  }) as { results?: unknown; data?: unknown } | null;
  const rows = payload?.results ?? payload?.data;
  if (!Array.isArray(rows)) return null;
  const scores = new Map<number, number>();
  for (const row of rows) {
    const index = row?.index;
    const score = row?.relevance_score ?? row?.score;
    if (Number.isInteger(index) && index >= 0 && index < documents.length &&
      typeof score === "number" && Number.isFinite(score)) {
      scores.set(index, score);
    }
  }
  return scores.size ? scores : null;
}

export function isRerankConfigured(overrides?: RerankProviderConfig) {
  return resolveConfig("RERANK", overrides ?? {}).enabled;
}
