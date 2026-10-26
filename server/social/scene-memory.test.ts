import { describe, expect, it } from "vitest";
import {
  appendSceneMemoryRecentMessages,
  buildInitialSceneMemoryCache,
  buildInitialSceneMemoryStoryState,
  buildSceneMemoryInstruction,
  normalizeSceneMemoryCache,
  normalizeSceneMemoryStoryState,
  SCENE_MEMORY_LIMITS,
} from "./scene-memory";

describe("场景记忆缓存契约", () => {
  it("新建场景记忆从第 0 回合开始，并要求有效的 sceneKey", () => {
    const state = buildInitialSceneMemoryStoryState("scene:23", "2026-08-16T00:00:00.000Z");
    expect(state).toEqual({
      sceneKey: "scene:23",
      turn: 0,
      startedAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
      lastMessageId: null,
      lastExitAt: null,
    });
    expect(() => buildInitialSceneMemoryStoryState("   ")).toThrow("requires a scene key");
  });

  it("拒绝结构不完整的故事进度，保留合法的 lastMessageId 和 lastExitAt", () => {
    expect(normalizeSceneMemoryStoryState(null)).toBeNull();
    expect(normalizeSceneMemoryStoryState({ sceneKey: "", turn: 1, startedAt: "x", updatedAt: "x" })).toBeNull();
    expect(normalizeSceneMemoryStoryState({ sceneKey: "scene:1", turn: -1, startedAt: "x", updatedAt: "x" })).toBeNull();
    expect(normalizeSceneMemoryStoryState({
      sceneKey: "scene:1",
      turn: 4,
      startedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
      lastMessageId: 88,
      lastExitAt: "2026-08-16T01:00:00.000Z",
    })).toMatchObject({ sceneKey: "scene:1", turn: 4, lastMessageId: 88, lastExitAt: "2026-08-16T01:00:00.000Z" });
  });

  it("归一化缓存时按上限截断摘要、线程、事实和最近消息", () => {
    const cache = normalizeSceneMemoryCache({
      summary: "前情提要".repeat(600),
      openThreads: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, summary: `线索${i}`, status: "open" })),
      pinnedFacts: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, fact: `事实${i}`, source: "user" })),
      recentMessageIds: [0, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      updatedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(cache?.version).toBe(1);
    expect(cache?.summary?.length).toBeLessThanOrEqual(SCENE_MEMORY_LIMITS.summaryMaxChars + 1);
    expect(cache?.openThreads).toHaveLength(SCENE_MEMORY_LIMITS.openThreadsMax);
    expect(cache?.pinnedFacts).toHaveLength(SCENE_MEMORY_LIMITS.pinnedFactsMax);
    expect(cache?.recentMessageIds).toHaveLength(SCENE_MEMORY_LIMITS.recentMessageIdsMax);
    expect(cache?.recentMessageIds.at(-1)).toBe(14);
  });

  it("丢弃无效线程与事实，并把非法消息 id 过滤掉", () => {
    const cache = normalizeSceneMemoryCache({
      summary: "  ",
      openThreads: [null, { id: "  ", summary: "没有 id" }, { id: "ok", summary: "有效线索", status: "resolved" }],
      pinnedFacts: [{ id: "", fact: "" }, { id: "f1", fact: "他答应了明早送伞", source: "user" }],
      recentMessageIds: ["bad" as unknown as number, 7, 8],
      updatedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(cache).toMatchObject({
      summary: null,
      openThreads: [{ id: "ok", summary: "有效线索", status: "resolved" }],
      pinnedFacts: [{ id: "f1", fact: "他答应了明早送伞", source: "user" }],
      recentMessageIds: [7, 8],
    });
  });

  it("非法或缺失缓存返回 null，初始缓存是空的安全结构", () => {
    expect(normalizeSceneMemoryCache(null)).toBeNull();
    expect(normalizeSceneMemoryCache([])).toBeNull();
    const empty = buildInitialSceneMemoryCache("2026-08-16T00:00:00.000Z");
    expect(empty).toEqual({
      version: 1,
      summary: null,
      openThreads: [],
      pinnedFacts: [],
      recentMessageIds: [],
      updatedAt: "2026-08-16T00:00:00.000Z",
    });
  });

  it("追加最近消息时保持上限并只保留合法 id", () => {
    const base = buildInitialSceneMemoryCache("2026-08-16T00:00:00.000Z");
    const next = appendSceneMemoryRecentMessages(base, [0, 3, 5], "2026-08-16T01:00:00.000Z");
    expect(next.recentMessageIds).toEqual([3, 5]);
    expect(next.updatedAt).toBe("2026-08-16T01:00:00.000Z");
    const capped = appendSceneMemoryRecentMessages(next, Array.from({ length: 20 }, (_, i) => i + 10), "2026-08-16T02:00:00.000Z");
    expect(capped.recentMessageIds).toHaveLength(SCENE_MEMORY_LIMITS.recentMessageIdsMax);
    expect(capped.recentMessageIds.at(-1)).toBe(29);
  });

  it("把记忆缓存压缩成续写指令；空缓存首回合不注入", () => {
    expect(buildSceneMemoryInstruction({
      turn: 0,
      cache: buildInitialSceneMemoryCache("2026-08-16T00:00:00.000Z"),
    })).toBe("");

    const instruction = buildSceneMemoryInstruction({
      turn: 5,
      cache: {
        version: 1,
        summary: "两人已经进入山寺，主持答应明早带他们去看后山。",
        openThreads: [
          { id: "t1", summary: "明早去后山看日出", status: "open" },
          { id: "t2", summary: "旧事已了", status: "resolved" },
        ],
        pinnedFacts: [{ id: "f1", fact: "小岚怕黑", source: "user" }],
        recentMessageIds: [101, 102],
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    });
    expect(instruction).toContain("第 6 个回复回合");
    expect(instruction).toContain("两人已经进入山寺");
    expect(instruction).toContain("明早去后山看日出");
    expect(instruction).not.toContain("旧事已了");
    expect(instruction).toContain("小岚怕黑");
    expect(instruction).toContain("不要重新开场");
  });

});
