import { describe, expect, it, vi } from "vitest";
import { createSourceLibraryService } from "./service";
import type { PreparedSource, SourceDocument } from "./core";
import type { SourceCandidate, SourceLibraryRepository } from "./repository";

function fixture() {
  const owners = new Map([[11, 1], [12, 1], [22, 2]]);
  const documents = new Map<number, SourceDocument>();
  const chunks = new Map<number, SourceCandidate[]>();
  let nextDocumentId = 1;
  let nextChunkId = 1;
  const scopedDocuments = (userId: number, personaId: number) => Array.from(documents.values())
    .filter(document => document.userId === userId && document.personaId === personaId);
  const scopedChunks = (userId: number, personaId: number) => scopedDocuments(userId, personaId)
    .flatMap(document => chunks.get(document.id) ?? []);
  const repo: SourceLibraryRepository = {
    ownsPersona: async (userId, personaId) => owners.get(personaId) === userId,
    listDocuments: async (userId, personaId) => scopedDocuments(userId, personaId),
    getDocument: async (userId, personaId, id) => scopedDocuments(userId, personaId).find(document => document.id === id) ?? null,
    saveDocument: async (userId, personaId, prepared, replaceId) => {
      const old = replaceId === undefined ? undefined : scopedDocuments(userId, personaId).find(document => document.id === replaceId);
      if (replaceId !== undefined && !old) throw new Error("测试仓库不允许跨归属替换。");
      const id = replaceId ?? nextDocumentId++;
      const { chunks: preparedChunks, ...metadata } = prepared;
      const document: SourceDocument = {
        ...metadata, id, userId, personaId, chunkCount: preparedChunks.length,
        createdAt: old?.createdAt ?? new Date("2026-10-25T00:00:00Z"), updatedAt: new Date("2026-10-25T01:00:00Z"),
      };
      documents.set(id, document);
      chunks.set(id, preparedChunks.map(chunk => ({ ...chunk, id: nextChunkId++, documentId: id, sourceTitle: document.title })));
      return document;
    },
    deleteDocument: async (userId, personaId, id) => {
      if (!scopedDocuments(userId, personaId).some(document => document.id === id)) return false;
      documents.delete(id);
      chunks.delete(id);
      return true;
    },
    searchCandidates: async (userId, personaId, terms) => scopedChunks(userId, personaId).filter(chunk =>
      terms.some(term => `${chunk.chapterTitle}\n${chunk.content}`.toLowerCase().includes(term))),
    neighborCandidates: async () => [],
    getChunk: async (userId, personaId, id) => scopedChunks(userId, personaId).find(chunk => chunk.id === id) ?? null,
    listChunkMetadata: async (userId, personaId) => scopedChunks(userId, personaId).map(chunk => ({
      documentId: chunk.documentId, chapterTitle: chunk.chapterTitle, tokenEstimate: chunk.tokenEstimate, keywords: chunk.keywords,
    })),
  };
  const calls = {
    list: vi.spyOn(repo, "listDocuments"), get: vi.spyOn(repo, "getDocument"), save: vi.spyOn(repo, "saveDocument"),
    delete: vi.spyOn(repo, "deleteDocument"), search: vi.spyOn(repo, "searchCandidates"),
    neighbors: vi.spyOn(repo, "neighborCandidates"), metadata: vi.spyOn(repo, "listChunkMetadata"),
  };
  return { service: createSourceLibraryService(repo), repo, calls, documents, chunks };
}

function uploadInput(content: string, personaId = 11, fileName = "旅记.txt") {
  return { personaId, fileName, fileContent: Buffer.from(content, "utf8").toString("base64") };
}

function candidate(id: number, chunkIndex = id - 1): SourceCandidate {
  return { id, documentId: 1, sourceTitle: "旅记", chapterTitle: "启程", chunkIndex,
    content: "灯塔的地图。", startOffset: chunkIndex * 10, endOffset: chunkIndex * 10 + 6,
    keywords: ["灯塔", "地图"], tokenEstimate: 4 };
}

describe("原文服务的归属与上传闭环", () => {
  it("所有服务入口先拒绝他人的角色，不读取、解析或保存其资料", async () => {
    const { service, calls } = fixture();
    const operations = [
      () => service.list(2, 11), () => service.upload(2, uploadInput("正文")),
      () => service.delete(2, 11, 1), () => service.search(2, 11, "地图"),
      () => service.overview(2, 11), () => service.context(2, 11, "原文内容"),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });

  it("上传保存完整原文，包括旧摘要截断点之后的尾文，且用户和角色始终来自调用参数", async () => {
    const { service, calls, chunks } = fixture();
    const content = `启程。\n${"甲".repeat(52000)}\n末尾标记：灯塔航线。`;
    const document = await service.upload(1, uploadInput(content));
    const prepared = calls.save.mock.calls[0][2] as PreparedSource;
    let reconstructed = "";
    for (const chunk of prepared.chunks) reconstructed += chunk.content.slice(Math.max(0, reconstructed.length - chunk.startOffset));
    expect(reconstructed).toBe(content);
    expect(prepared.chunks.at(-1)?.content).toContain("末尾标记：灯塔航线。");
    expect(document).toMatchObject({ userId: 1, personaId: 11, byteSize: Buffer.byteLength(content), chunkCount: prepared.chunks.length });
    expect(prepared.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(chunks.get(document.id)).toHaveLength(prepared.chunks.length);
    expect((await service.list(1, 12))).toEqual([]);
    await service.upload(2, uploadInput("另一个账号的资料。", 22));
    expect(await service.list(1, 11)).toHaveLength(1);
  });

  it("坏 base64、无效正文和不属于当前角色的替换都不会调用保存或破坏旧资料", async () => {
    const { service, calls, documents, chunks } = fixture();
    const original = await service.upload(1, uploadInput("地图在灯塔。"));
    const oldChunks = chunks.get(original.id);
    calls.save.mockClear();
    for (const fileContent of ["", "!!!!", "YQ", "YQ==\n", "data:text/plain;base64,YQ=="]) {
      await expect(service.upload(1, { personaId: 11, fileName: "新稿.txt", fileContent, replaceId: original.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(service.upload(1, { ...uploadInput("\0"), replaceId: original.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(service.upload(1, { ...uploadInput("新稿", 12), replaceId: original.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.upload(1, { ...uploadInput("新稿"), replaceId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.save).not.toHaveBeenCalled();
    expect(documents.get(original.id)).toEqual(original);
    expect(chunks.get(original.id)).toEqual(oldChunks);
  });

  it("成功替换后不再检索旧文，删除同时清除可检索资料并拒绝重复删除", async () => {
    const { service, chunks } = fixture();
    const original = await service.upload(1, uploadInput("地图在灯塔。"));
    await expect(service.delete(1, 12, original.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.upload(1, { ...uploadInput("背包在山谷。", 11, "新稿.md"), replaceId: original.id });
    expect(await service.list(1, 11)).toHaveLength(1);
    expect(await service.search(1, 11, "灯塔")).toEqual([]);
    expect(await service.search(1, 11, "山谷")).toHaveLength(1);
    expect(await service.delete(1, 11, original.id)).toEqual({ success: true });
    expect(chunks.has(original.id)).toBe(false);
    expect(await service.search(1, 11, "山谷")).toEqual([]);
    await expect(service.delete(1, 11, original.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("检索、总览与聊天证据合同", () => {
  it("合并真实种子与相邻块，重复片段只返回一次且结果至多八条", async () => {
    const { service, calls } = fixture();
    calls.search.mockResolvedValue([candidate(1), candidate(2)]);
    calls.neighbors.mockResolvedValue([
      { ...candidate(1), seedRank: 0, distanceFromSeed: 0 },
      { ...candidate(3), content: "未直接命中查询的相邻说明。", seedRank: 0, distanceFromSeed: 1 },
      { ...candidate(3), seedRank: 1, distanceFromSeed: 1 },
      { ...candidate(2), seedRank: 1, distanceFromSeed: 0 },
    ]);
    const result = await service.search(1, 11, "灯塔");
    expect(result.map(hit => hit.id)).toEqual([1, 3, 2]);
    expect(result[1].content).toContain("相邻说明");
    expect(calls.search).toHaveBeenCalledWith(1, 11, expect.arrayContaining(["灯塔"]));
    expect(calls.neighbors).toHaveBeenCalledWith(1, 11, expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]));
    calls.search.mockResolvedValue(Array.from({ length: 12 }, (_, index) => candidate(index + 1)));
    calls.neighbors.mockResolvedValue([]);
    const bounded = await service.search(1, 11, "灯塔");
    expect(bounded).toHaveLength(8);
    expect(new Set(bounded.map(hit => hit.id)).size).toBe(8);
  });

  it("overview 提供现有抽屉需要的来源、章节、估算规模、关键词与搜索别名", async () => {
    const { service } = fixture();
    const book = await service.upload(1, uploadInput("# 启程\n灯塔有地图。\n# 归来\n背包在山谷。", 11, "旅记.md"));
    await service.upload(1, uploadInput("灯塔设定。", 11, "设定.txt"));
    await service.upload(2, uploadInput("其他账号的原文。", 22));
    const overview = await service.overview(1, 11, "灯塔");
    expect(overview.stats).toMatchObject({ sourceCount: 2, chunkCount: 3, chapterCount: 3, tokenEstimate: expect.any(Number) });
    expect(overview.stats.tokenEstimate).toBeGreaterThan(0);
    expect(overview.topKeywords).toContain("灯塔");
    expect(overview.sources).toEqual(expect.arrayContaining([expect.objectContaining({
      id: book.id, title: "旅记", sourceType: "md", originalName: "旅记.md", createdAt: expect.any(Date), updatedAt: expect.any(Date),
      chunkCount: 2, chapterCount: 2, tokenEstimate: expect.any(Number), topKeywords: expect.any(Array),
      chapters: expect.arrayContaining([expect.objectContaining({ title: "启程", chunkCount: 1 }), expect.objectContaining({ title: "归来", chunkCount: 1 })]),
    })]));
    expect(overview.search.query).toBe("灯塔");
    expect(overview.search.results.length).toBeGreaterThan(0);
    for (const hit of overview.search.results) expect(hit.sourceId).toBe(hit.documentId);
  });

  it("短追问只使用调用者明确提供的最近两条用户问题，不自行读取其他历史", async () => {
    const { service, calls } = fixture();
    await service.upload(1, uploadInput("灯塔有地图。"));
    const context = await service.context(1, 11, "后来呢？", ["不可检索旧记录", "灯塔", "地图"]);
    const terms = calls.search.mock.calls.at(-1)![2];
    expect(terms).toEqual(expect.arrayContaining(["灯塔", "地图"]));
    expect(terms.join(" ")).not.toContain("旧");
    expect(context?.instruction).toContain("不可信引文数据");
    expect(JSON.parse(context!.evidence).entries[0].excerpt).toContain("灯塔有地图。");
    const withoutHistory = await service.context(1, 11, "后来呢？");
    expect(calls.search.mock.calls.at(-1)![2]).not.toContain("灯塔");
    expect(JSON.parse(withoutHistory!.evidence)).toMatchObject({ status: "no_matching_excerpt", entries: [] });
  });

  it("区分无需资料上下文、没有上传来源和已有来源但没有命中", async () => {
    const { service, calls } = fixture();
    expect(await service.context(1, 11, "今天过得怎样？")).toBeNull();
    const absent = await service.context(1, 11, "原文里有海港吗？");
    expect(JSON.parse(absent!.evidence)).toEqual({ type: "source_library_evidence", status: "no_uploaded_source", entries: [] });
    expect(calls.search).not.toHaveBeenCalled();
    await service.upload(1, uploadInput("地图在灯塔。"));
    const missed = await service.context(1, 11, "海港在哪里？");
    expect(JSON.parse(missed!.evidence)).toEqual({ type: "source_library_evidence", status: "no_matching_excerpt", entries: [] });
    expect(missed!.instruction).toContain("资料不足时说明无法确认");
  });
});
