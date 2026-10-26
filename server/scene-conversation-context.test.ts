import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./llm", () => ({ llmService: { invoke: mocked.invoke } }));

import * as db from "./db";
import { getContextHistory } from "./chat/context-state";
import { refreshSceneMemorySummary, extractSceneConfirmedFacts } from "./social/scene-memory-service";
import { buildSceneMemoryInstruction } from "./social/scene-memory";

/**
 * 场景会话上下文（第 4 批 4B）。
 *
 * 与自用版/净化同源候选的同名测试保持同一组断言，区别只在数据准备：
 * 书中人用手写迁移建表，测试不再运行时 ensure，而是直接复用已迁移的隔离库
 * （env INK_AND_KIN_SCENE_CONTEXT_TEST_DATABASE_URL，非 5434 端口）。
 */
const testUrl = process.env.INK_AND_KIN_SCENE_CONTEXT_TEST_DATABASE_URL;
const databaseSuite = testUrl ? describe : describe.skip;

function assertIsolatedDatabaseUrl(value: string): void {
  const url = new URL(value);
  const port = Number(url.port);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("测试数据库协议错误");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("测试数据库必须位于本机");
  if (!Number.isInteger(port) || port < 1 || port === 5434) throw new Error("测试数据库必须显式使用非 5434 端口");
  if (!name.startsWith("ink_and_kin_batch4")) throw new Error("测试数据库名称必须以 ink_and_kin_batch4 开头");
}

async function query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
  const database = await db.getDb();
  if (!database) throw new Error("测试数据库未连接");
  const result = await database.execute(sql.raw(statement));
  return result.rows as T[];
}

async function resetDatabase(): Promise<void> {
  await query("TRUNCATE messages, memories, chat_summaries, chat_deletion_backups, chat_context_states, scene_memory_states, personas, scenes, users RESTART IDENTITY CASCADE");
  await query("INSERT INTO users (id, username, name, \"passwordHash\") VALUES (1, 'u1', 'u1', 'x')");
  await query("INSERT INTO scenes (id, \"userId\", name) VALUES (7, 1, '测试场景')");
  await query("INSERT INTO personas (id, \"userId\", name, \"activeSceneId\") VALUES (1, 1, '测试人物', 7)");
}

async function message(role: "user" | "assistant", content: string, sceneId: number | null = 7): Promise<number> {
  const [row] = await query<{ id: number }>(
    "INSERT INTO messages (\"personaId\", \"userId\", role, content, \"sceneId\", mode) VALUES (1, 1, '" + role + "', '" + content + "', " + (sceneId === null ? "NULL" : sceneId) + ", '" + (sceneId === null ? "daily" : "scene") + "') RETURNING id",
  );
  return row.id;
}

databaseSuite("新开本段对话的场景边界", () => {
  beforeAll(async () => {
    assertIsolatedDatabaseUrl(testUrl!);
    process.env.DATABASE_URL = testUrl!;
    await resetDatabase();
  }, 60_000);

  beforeEach(async () => {
    mocked.invoke.mockReset();
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    const database = await db.getDb();
    await (database as unknown as { $client?: { end?: () => Promise<void> } } | null)?.$client?.end?.();
  }, 30_000);

  it("旧场景消息仍可查看但不进入生成；短期缓存清空、事实与场景保留，新消息可用", async () => {
    const oldUser = await message("user", "旧剧情甲");
    const oldAssistant = await message("assistant", "旧回复乙");
    await db.setSceneMessagesContextOverride(1, 1, 7, [oldUser], true);
    await db.setSceneMessagesContextOverride(1, 1, 7, [oldAssistant], false);
    await db.upsertSceneMemoryState(1, 1, 7, {
      cache: {
        version: 1, summary: "旧摘要", openThreads: [{ id: "thread-1", summary: "旧待续事件", status: "open" }],
        pinnedFacts: [{ id: "fact-1", fact: "已确认场景事实", source: "user" }],
        recentMessageIds: [oldUser, oldAssistant], updatedAt: new Date().toISOString(),
      },
    });
    const originalId = (await db.getSceneMemoryStateSnapshot(1, 1, 7)).stateId;
    const cutoff = await db.startNewPersonaConversationContext(1, 1);
    expect(cutoff).toBe(oldAssistant);
    const state = await db.getSceneMemoryStateSnapshot(1, 1, 7);
    expect(state.stateId).not.toBe(originalId);
    expect(state.storyState?.turn).toBe(0);
    expect(state.cache?.summary).toBeNull();
    expect(state.cache?.openThreads).toEqual([]);
    expect(state.cache?.recentMessageIds).toEqual([]);
    expect(state.cache?.pinnedFacts.map(fact => fact.fact)).toEqual(["已确认场景事实"]);
    expect(buildSceneMemoryInstruction({ turn: state.storyState?.turn ?? 0, cache: state.cache })).toContain("从当前输入重新开场");
    expect((await query<{ activeSceneId: number | null }>("SELECT \"activeSceneId\" FROM personas WHERE id=1"))[0].activeSceneId).toBe(7);
    expect(await db.countSceneAssistantMessages(1, 1, 7)).toBe(0);
    expect(await db.getSceneConversationMessagesBySceneId(1, 1, 7)).toEqual([]);
    expect(await db.getSceneMessagesForImageContext(1, 1, 7)).toEqual([]);
    const history = await db.getSceneMessageContextManagement(1, 1, 7);
    expect(history.startAfterMessageId).toBe(cutoff);
    expect(history.messages.map(item => item.content)).toEqual(["旧剧情甲", "旧回复乙"]);
    expect(history.messages.map(item => item.effectiveInContext)).toEqual([false, false]);
    expect(history.messages.map(item => item.contextOverride)).toEqual([null, null]);

    const newUser = await message("user", "新剧情丙");
    await message("assistant", "新回复丁");
    expect((await db.getSceneConversationMessagesBySceneId(1, 1, 7)).map(item => item.id)).toContain(newUser);
    expect((await db.getSceneConversationMessagesBySceneId(1, 1, 7)).map(item => item.content)).toEqual(["新剧情丙", "新回复丁"]);
    expect((await db.getSceneMessagesForImageContext(1, 1, 7)).map(item => item.content)).toEqual(["新剧情丙", "新回复丁"]);
    expect(await db.countSceneAssistantMessages(1, 1, 7)).toBe(1);
    expect((await db.getSceneMessageContextManagement(1, 1, 7)).messages.map(item => item.effectiveInContext)).toEqual([false, false, true, true]);
    await db.setSceneMessagesContextOverride(1, 1, 7, [oldUser], true);
    expect((await db.getSceneConversationMessagesBySceneId(1, 1, 7)).map(item => item.content)).toEqual(["旧剧情甲", "新剧情丙", "新回复丁"]);
    expect((await db.getSceneMessagesForImageContext(1, 1, 7)).map(item => item.content)).toEqual(["旧剧情甲", "新剧情丙", "新回复丁"]);
    expect((await db.getSceneMessageContextManagement(1, 1, 7)).messages.map(item => item.effectiveInContext)).toEqual([true, false, true, true]);
  });

  it("摘要和事实只读取新段场景消息，日常历史也继续遵守同一边界", async () => {
    await message("user", "旧剧情保密");
    await message("assistant", "旧回复保密");
    await message("user", "旧日常保密", null);
    await db.startNewPersonaConversationContext(1, 1);
    expect(await refreshSceneMemorySummary({ personaId: 1, userId: 1, sceneId: 7 })).toBeNull();
    expect(await extractSceneConfirmedFacts({ personaId: 1, userId: 1, sceneId: 7 })).toEqual([]);
    expect(mocked.invoke).not.toHaveBeenCalled();
    await message("user", "新剧情起点");
    await message("assistant", "新剧情回应");
    await message("user", "新剧情约定");
    const dailyId = await message("user", "新日常消息", null);
    mocked.invoke.mockImplementation(async ({ messages }: { messages: Array<{ content: string }> }) =>
      messages[0].content.includes("剧情事实归档员") ? '["新事实"]' : "新摘要",
    );
    expect(await refreshSceneMemorySummary({ personaId: 1, userId: 1, sceneId: 7 })).toBe("新摘要");
    expect((await extractSceneConfirmedFacts({ personaId: 1, userId: 1, sceneId: 7 })).map(fact => fact.fact)).toEqual(["新事实"]);
    const prompts = mocked.invoke.mock.calls.map(call => JSON.stringify(call[0]?.messages ?? []));
    expect(prompts.every(prompt => !prompt.includes("旧剧情保密") && !prompt.includes("旧回复保密"))).toBe(true);
    expect(prompts.some(prompt => prompt.includes("新剧情起点"))).toBe(true);
    // 日常生成窗口：只含日常消息、只认同一个起点；场景消息绝不串进日常上下文。
    const dailyHistory = await getContextHistory(1, 1, 50);
    expect(dailyHistory.history.map(item => item.id)).toContain(dailyId);
    expect(dailyHistory.history.every(item => item.content !== "旧日常保密")).toBe(true);
    expect(dailyHistory.history.every(item => (item as { sceneId?: number | null }).sceneId == null)).toBe(true);
  });

  it("重置前已启动的摘要在模型返回后不能恢复旧摘要或旧待续事件", async () => {
    await message("user", "旧剧情等待摘要");
    await db.upsertSceneMemoryState(1, 1, 7, {
      cache: {
        version: 1, summary: "原有摘要", openThreads: [{ id: "old", summary: "旧待续", status: "open" }],
        pinnedFacts: [{ id: "fact", fact: "应保留事实", source: "user" }],
        recentMessageIds: [], updatedAt: new Date().toISOString(),
      },
    });
    let resolveModel!: (value: string) => void;
    mocked.invoke.mockImplementation(() => new Promise<string>(resolve => { resolveModel = resolve; }));
    const pending = refreshSceneMemorySummary({ personaId: 1, userId: 1, sceneId: 7 });
    await vi.waitFor(() => expect(mocked.invoke).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const originalId = (await db.getSceneMemoryStateSnapshot(1, 1, 7)).stateId;
    await db.startNewPersonaConversationContext(1, 1);
    resolveModel("迟到的旧摘要");
    await pending;
    const state = await db.getSceneMemoryStateSnapshot(1, 1, 7);
    expect(state.stateId).not.toBe(originalId);
    expect(state.cache?.summary).toBeNull();
    expect(state.cache?.openThreads).toEqual([]);
    expect(state.cache?.pinnedFacts.map(fact => fact.fact)).toEqual(["应保留事实"]);
  });
});
