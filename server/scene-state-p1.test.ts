import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./llm", () => ({ llmService: { invoke: mocked.invoke } }));

import * as db from "./db";
import {
  refreshSceneMemoryAndFacts,
  refreshSceneMemorySummary,
} from "./social/scene-memory-service";

/**
 * 场景状态 P1 回归（第 4 批 4B）。
 *
 * 与净化同源候选的同名测试保持同一组断言；数据准备改为复用已迁移的隔离库
 * （env INK_AND_KIN_P1_TEST_DATABASE_URL，非 5434 端口），不再运行时 ensure 建表。
 * 书中人没有 persona_runtime_states，剧情进度直接落在 scene_memory_states.storyState。
 */
const testUrl = process.env.INK_AND_KIN_P1_TEST_DATABASE_URL;
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
  await query("DROP TRIGGER IF EXISTS fail_scene_delete ON scenes");
  await query("DROP FUNCTION IF EXISTS p1_reject_scene_delete()");
  await query("TRUNCATE messages, chat_context_states, chat_deletion_backups, scene_memory_states, personas, scenes, users RESTART IDENTITY CASCADE");
  await query("INSERT INTO users (id, username, name, \"passwordHash\") VALUES (1, 'u1', 'u1', 'x'), (2, 'u2', 'u2', 'x')");
}

async function seedScene(id: number, userId: number | null, builtin = false): Promise<void> {
  await query("INSERT INTO scenes (id, \"userId\", name, \"isBuiltin\") VALUES (" + id + ", " + (userId ?? "NULL") + ", 'scene-" + id + "', " + builtin + ")");
}

async function seedPersona(id: number, userId: number, sceneId: number | null): Promise<void> {
  await query("INSERT INTO personas (id, \"userId\", name, \"activeSceneId\") VALUES (" + id + ", " + userId + ", 'persona-" + id + "', " + (sceneId ?? "NULL") + ")");
}

async function seedMessage(personaId: number, userId: number, sceneId: number, role: "user" | "assistant", content: string): Promise<number> {
  const [row] = await query<{ id: number }>(
    "INSERT INTO messages (\"personaId\", \"userId\", role, content, \"sceneId\", mode) VALUES (" + personaId + ", " + userId + ", '" + role + "', '" + content + "', " + sceneId + ", 'scene') RETURNING id",
  );
  return row.id;
}

function cache(summary: string | null, facts: string[] = [], ids: number[] = []) {
  return {
    version: 1 as const,
    summary,
    openThreads: [] as Array<{ id: string; summary: string; status: "open" | "resolved" }>,
    pinnedFacts: facts.map((fact, index) => ({ id: "fact-" + index, fact, source: "user" as const })),
    recentMessageIds: ids,
    updatedAt: new Date().toISOString(),
  };
}

databaseSuite("场景状态 P1：隔离 PostgreSQL 回归", () => {
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

  it("拒绝删除他人及内置场景时保留记忆；删除本人场景只清本人关联", async () => {
    await seedScene(10, 2);
    await seedScene(11, null, true);
    await seedScene(12, 1);
    await seedPersona(1, 1, 11);
    await seedPersona(2, 2, 10);
    await seedPersona(3, 1, 12);
    await db.upsertSceneMemoryState(2, 2, 10, { cache: cache("他人记忆") });
    await db.upsertSceneMemoryState(1, 1, 11, { cache: cache("内置记忆") });
    await db.upsertSceneMemoryState(3, 1, 12, { cache: cache("本人记忆") });
    // 即使存在同一 sceneId 的异常异主数据，删除范围也必须按用户收窄。
    await db.upsertSceneMemoryState(2, 2, 12, { cache: cache("异主关联") });

    expect(await db.deleteScene(10, 1)).toBe(false);
    expect(await db.deleteScene(11, 1)).toBe(false);
    expect((await db.getSceneMemoryStateSnapshot(2, 2, 10)).cache?.summary).toBe("他人记忆");
    expect((await db.getSceneMemoryStateSnapshot(1, 1, 11)).cache?.summary).toBe("内置记忆");
    expect(await db.deleteScene(12, 1)).toBe(true);
    expect((await db.getSceneMemoryStateSnapshot(3, 1, 12)).stateId).toBeNull();
    expect((await db.getSceneMemoryStateSnapshot(2, 2, 12)).cache?.summary).toBe("异主关联");
    expect((await query<{ activeSceneId: number | null }>("SELECT \"activeSceneId\" FROM personas WHERE id=3"))[0].activeSceneId).toBeNull();
    expect((await query<{ activeSceneId: number | null }>("SELECT \"activeSceneId\" FROM personas WHERE id=2"))[0].activeSceneId).toBe(10);
    expect(await query("SELECT id FROM scenes WHERE id=12")).toHaveLength(0);
  });

  it("场景删除末步失败会连同记忆及激活状态一起回滚", async () => {
    await seedScene(20, 1);
    await seedPersona(1, 1, 20);
    await db.upsertSceneMemoryState(1, 1, 20, { cache: cache("须保留") });
    await query("CREATE FUNCTION p1_reject_scene_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'p1 rollback probe'; END $$");
    await query("CREATE TRIGGER fail_scene_delete BEFORE DELETE ON scenes FOR EACH ROW EXECUTE FUNCTION p1_reject_scene_delete()");
    await expect(db.deleteScene(20, 1)).rejects.toThrow();
    expect(await query("SELECT id FROM scenes WHERE id=20")).toHaveLength(1);
    expect((await db.getSceneMemoryStateSnapshot(1, 1, 20)).cache?.summary).toBe("须保留");
    expect((await query<{ activeSceneId: number | null }>("SELECT \"activeSceneId\" FROM personas WHERE id=1"))[0].activeSceneId).toBe(20);
  });

  it("摘要与事实并行等待模型时，回合追加和两种记忆互不覆盖", async () => {
    await seedScene(30, 1);
    await seedPersona(1, 1, 30);
    const oldUser = await seedMessage(1, 1, 30, "user", "旧对话");
    const oldAssistant = await seedMessage(1, 1, 30, "assistant", "旧回复");
    await seedMessage(1, 1, 30, "user", "新约定");
    await db.upsertSceneMemoryState(1, 1, 30, { cache: cache("旧摘要", ["旧事实"], [oldUser, oldAssistant]) });
    const pending: Array<(value: string) => void> = [];
    mocked.invoke.mockImplementation(() => new Promise<string>(resolve => pending.push(resolve)));

    const refresh = refreshSceneMemoryAndFacts({ personaId: 1, userId: 1, sceneId: 30 });
    await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 15_000 });
    const newUser = await seedMessage(1, 1, 30, "user", "继续");
    const newAssistant = await seedMessage(1, 1, 30, "assistant", "继续回复");
    await db.recordSceneMemoryTurn(1, 1, 30, "scene:30", [newUser, newAssistant]);
    const prompts = mocked.invoke.mock.calls.map(call => String(call[0]?.messages?.[0]?.content ?? ""));
    pending[prompts.findIndex(prompt => prompt.includes("影视剧本"))]("更新后的前情提要");
    pending[prompts.findIndex(prompt => prompt.includes("剧情事实归档员"))]('["新确认事实"]');
    await refresh;

    const state = await db.getSceneMemoryStateSnapshot(1, 1, 30);
    expect(state.cache?.summary).toBe("更新后的前情提要");
    expect(state.cache?.pinnedFacts.map(fact => fact.fact)).toEqual(["旧事实", "新确认事实"]);
    expect(state.cache?.recentMessageIds).toContain(newUser);
    expect(state.cache?.recentMessageIds).toContain(newAssistant);
    expect(state.storyState?.turn).toBe(2);
    expect(state.storyState?.lastMessageId).toBe(newAssistant);
  });

  it("模型等待期间清空并重建记忆时，旧摘要不得回灌", async () => {
    await seedScene(40, 1);
    await seedPersona(1, 1, 40);
    await seedMessage(1, 1, 40, "user", "需要归档的旧剧情");
    await db.upsertSceneMemoryState(1, 1, 40, { cache: cache("旧摘要") });
    let resolveModel!: (value: string) => void;
    mocked.invoke.mockImplementation(() => new Promise<string>(resolve => { resolveModel = resolve; }));
    const refresh = refreshSceneMemorySummary({ personaId: 1, userId: 1, sceneId: 40 });
    await vi.waitFor(() => expect(mocked.invoke).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const originalId = (await db.getSceneMemoryStateSnapshot(1, 1, 40)).stateId;
    await db.clearSceneMemoryState(1, 1, 40);
    await db.upsertSceneMemoryState(1, 1, 40, { cache: cache("新故事") });
    resolveModel("过期模型摘要");
    await refresh;
    const state = await db.getSceneMemoryStateSnapshot(1, 1, 40);
    expect(state.stateId).not.toBe(originalId);
    expect(state.cache?.summary).toBe("新故事");
  });

  it("切换/退出场景会推进上下文 revision，让在途回合失效", async () => {
    await seedScene(60, 1);
    await seedPersona(1, 1, 60);
    await query("INSERT INTO chat_context_states (\"userId\", \"personaId\", revision) VALUES (1, 1, 0)");
    await db.activateScene(1, 60, 1);
    expect((await query<{ revision: number }>("SELECT revision FROM chat_context_states WHERE \"personaId\"=1 AND \"userId\"=1"))[0].revision).toBe(1);
    await db.activateScene(1, null, 1);
    expect((await query<{ revision: number }>("SELECT revision FROM chat_context_states WHERE \"personaId\"=1 AND \"userId\"=1"))[0].revision).toBe(2);
  });

  it("continuationEnabled=false 的场景每次进入都重开故事，true 则保留记忆", async () => {
    await seedScene(70, 1);
    await query("UPDATE scenes SET \"continuationEnabled\"=false WHERE id=70");
    await seedPersona(1, 1, 70);
    await db.upsertSceneMemoryState(1, 1, 70, { cache: cache("旧故事") });
    await db.activateScene(1, 70, 1);
    // 关掉续写的场景：进入即清空缓存（摘要归零），已确认事实也不保留。
    expect((await db.getSceneMemoryStateSnapshot(1, 1, 70)).cache?.summary).toBeNull();

    await query("UPDATE scenes SET \"continuationEnabled\"=true WHERE id=70");
    await db.upsertSceneMemoryState(1, 1, 70, { cache: cache("新故事") });
    const before = (await db.getSceneMemoryStateSnapshot(1, 1, 70)).stateId;
    await db.activateScene(1, null, 1);
    await db.activateScene(1, 70, 1);
    // 默认续写的场景：退出再进入不重开，原记忆与 stateId 原样保留。
    expect((await db.getSceneMemoryStateSnapshot(1, 1, 70)).cache?.summary).toBe("新故事");
    expect((await db.getSceneMemoryStateSnapshot(1, 1, 70)).stateId).toBe(before);
  });

  it("同一人物场景首次并发局部修改仅产生一行并保留两项字段", async () => {
    // scene_memory_states 对 persona 有外键，这里先建立人物行（与真实数据一致）。
    await seedPersona(1, 1, null);
    const [summary, facts] = await Promise.all([
      db.mutateSceneMemoryState(1, 1, 50, current => ({ cache: { ...(current.cache ?? cache(null)), summary: "并行摘要" } })),
      db.mutateSceneMemoryState(1, 1, 50, current => ({ cache: { ...(current.cache ?? cache(null)), pinnedFacts: cache(null, ["并行事实"]).pinnedFacts } })),
    ]);
    expect(summary?.stateId).toBeTruthy();
    expect(facts?.stateId).toBe(summary?.stateId);
    expect(await query("SELECT id FROM scene_memory_states WHERE \"personaId\"=1 AND \"userId\"=1 AND \"sceneId\"=50")).toHaveLength(1);
    const state = await db.getSceneMemoryStateSnapshot(1, 1, 50);
    expect(state.cache?.summary).toBe("并行摘要");
    expect(state.cache?.pinnedFacts.map(fact => fact.fact)).toEqual(["并行事实"]);
  });
});
