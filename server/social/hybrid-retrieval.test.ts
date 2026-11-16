import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEmbeddingConfig } from "../llm/retrieval-providers";
import { hybridRankCandidates, scoreCandidatesBm25 } from "./hybrid-retrieval";

const candidates = [
  { id: 1, item: 1, content: "航船停在海港，等待风暴结束。", title: "航海日志" },
  { id: 2, item: 2, content: "高塔与青铜钥匙在另一条小路尽头。", title: "赤铜回廊" },
  { id: 3, item: 3, content: "验证内容同义召回，文本没有原始查询词。", embedding: [1, 0, 0, 0] },
];

afterEach(() => vi.unstubAllEnvs());

describe("混合检索", () => {
  it("BM25 识别中文专名且没有匹配的记录得 0 分", () => {
    const scores = scoreCandidatesBm25("请问赤铜回廊", candidates);
    expect(scores.map(row => row.score > 0)).toEqual([false, true, false]);
    expect(scores[1].matchedTerms.some(term => "赤铜回廊".includes(term))).toBe(true);
  });

  it("默认只使用本地 BM25，且不同供应商命名空间分离", async () => {
    vi.stubEnv("EMBEDDING_ENABLED", "false");
    vi.stubEnv("RERANK_ENABLED", "false");
    const unexpected = vi.fn();
    const result = await hybridRankCandidates("赤铜回廊", candidates, {
      limit: 4, embeddingConfig: { fetchImpl: unexpected }, rerankConfig: { fetchImpl: unexpected },
    });
    expect(result.map(row => row.item)).toEqual([2]);
    expect(unexpected).not.toHaveBeenCalled();
    const a = resolveEmbeddingConfig({ baseUrl: "https://a.invalid/v1", apiKey: "fixture", model: "model" });
    const b = resolveEmbeddingConfig({ baseUrl: "https://b.invalid/v1", apiKey: "fixture", model: "model" });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("融合稀疏和缓存向量，持久化本轮计算向量，按选配的服务结果重排", async () => {
    const embeddings = vi.fn(async () => Response.json({
      data: [{ index: 1, embedding: [0.8, 0.2, 0, 0] }, { index: 0, embedding: [1, 0, 0, 0] }],
    }));
    const rerank = vi.fn(async () => Response.json({ results: [
      { index: 1, relevance_score: 4 }, { index: 0, relevance_score: -1 },
    ] }));
    const onVectors = vi.fn(async () => {});
    const result = await hybridRankCandidates("赤铜回廊", candidates, {
      limit: 5,
      embeddingConfig: { enabled: true, baseUrl: "https://embeddings.invalid/v1", apiKey: "fixture", dimensions: 4, fetchImpl: embeddings },
      rerankConfig: { enabled: true, baseUrl: "https://rerank.invalid/v1", apiKey: "fixture", fetchImpl: rerank },
      onVectors,
    });
    expect(result.map(row => row.item)).toEqual([3, 2]);
    expect(result[0]).toMatchObject({ sparseScore: 0, denseScore: 1 });
    expect(onVectors).toHaveBeenCalledWith([{ id: 2, embedding: [0.8, 0.2, 0, 0] }], expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(embeddings).toHaveBeenCalledTimes(1);
    expect(rerank).toHaveBeenCalledTimes(1);
  });

  it("向量请求失败时维持本地排序，且不输出服务商返回的正文", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await hybridRankCandidates("赤铜回廊", candidates, {
        limit: 4,
        embeddingConfig: { enabled: true, baseUrl: "https://embeddings.invalid/v1", apiKey: "fixture",
          fetchImpl: async () => new Response("敏感响应示例", { status: 502 }) },
        rerankConfig: { enabled: false },
      });
      expect(result.map(row => row.item)).toEqual([2]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("敏感响应示例");
    } finally {
      warn.mockRestore();
    }
  });
});
