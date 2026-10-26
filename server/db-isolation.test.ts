import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * A miniature database for the behavioural tests below.
 *
 * Each helper mirrors the SQL predicate it stands in for: a row is only
 * returned when the caller's user id matches the row's owner. That is what
 * makes the cross-user assertions meaningful — the router is exercised
 * end-to-end, and the filter is simulated rather than assumed.
 */
const store = {
  skillJobs: [
    { id: 7, userId: 1, personaId: 5, pipelineStage: "complete", analysisResult: { private: "A's data" } },
  ],
  scenes: [
    { id: 3, userId: 1, name: "A 的场景", isBuiltin: false },
    { id: 4, userId: null, name: "内置场景", isBuiltin: true },
  ],
  personas: [
    { id: 5, userId: 1, name: "A 的分身" },
  ],
};

const getSkillJobById = vi.fn(async (id: number, userId: number) =>
  store.skillJobs.find((row) => row.id === id && row.userId === userId),
);
// 场景读取与自用版一致只按 id 返回；归属由路由层按 isBuiltin/userId 判定，
// 因此这里的模拟只模拟“按 id 查一行”。
const getSceneById = vi.fn(async (id: number) =>
  store.scenes.find((row) => row.id === id),
);
// Mirrors the SQL predicate: only the owner can edit a non-built-in scene.
const updateScene = vi.fn(async (id: number, userId: number, data: Record<string, unknown>) => {
  const scene = store.scenes.find(
    (row) => row.id === id && !row.isBuiltin && row.userId === userId,
  );
  if (!scene) return null;
  Object.assign(scene, data);
  return scene;
});
const deleteScene = vi.fn(async (id: number, userId: number) => {
  const index = store.scenes.findIndex(
    (row) => row.id === id && !row.isBuiltin && row.userId === userId,
  );
  if (index === -1) return false;
  store.scenes.splice(index, 1);
  return true;
});
const getPersonaById = vi.fn(async (id: number, userId: number) =>
  store.personas.find((row) => row.id === id && row.userId === userId),
);
const deletePersona = vi.fn(async (id: number, userId: number) => {
  const index = store.personas.findIndex(
    (row) => row.id === id && row.userId === userId,
  );
  if (index === -1) return false;
  store.personas.splice(index, 1);
  return true;
});
// 场景记忆写入口：跨用户用例断言它们完全没被调用。
const mutateSceneMemoryState = vi.fn();
const clearSceneMemoryState = vi.fn();

vi.mock("./db", () => ({
  getSkillJobById: (id: number, userId: number) => getSkillJobById(id, userId),
  getSceneById: (id: number) => getSceneById(id),
  updateScene: (id: number, userId: number, data: Record<string, unknown>) => updateScene(id, userId, data),
  deleteScene: (id: number, userId: number) => deleteScene(id, userId),
  getPersonaById: (id: number, userId: number) => getPersonaById(id, userId),
  deletePersona: (id: number, userId: number) => deletePersona(id, userId),
  // Everything else the routers import has to exist, even if the tests here
  // never call it.
  createPersona: vi.fn().mockResolvedValue(1),
  getPersonasByUserId: vi.fn().mockResolvedValue([]),
  updatePersona: vi.fn(),
  getPersonasWithStats: vi.fn().mockResolvedValue([]),
  getUserStats: vi.fn().mockResolvedValue({}),
  getRecentActivity: vi.fn().mockResolvedValue([]),
  getDailyChatCounts: vi.fn().mockResolvedValue([]),
  createPersonaFile: vi.fn(),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn(),
  getMessagesByPersonaId: vi.fn().mockResolvedValue([]),
  clearMessagesByPersonaId: vi.fn(),
  searchMessages: vi.fn().mockResolvedValue([]),
  createWechatBinding: vi.fn(),
  getWechatBindingsByUserId: vi.fn().mockResolvedValue([]),
  deleteWechatBinding: vi.fn(),
  setWechatBindingPersona: vi.fn(),
  getLlmConfigsByUserId: vi.fn().mockResolvedValue([]),
  upsertLlmConfig: vi.fn(),
  setDefaultLlmConfig: vi.fn(),
  getDefaultLlmConfig: vi.fn().mockResolvedValue(null),
  updateUserProfile: vi.fn(),
  updateUserPassword: vi.fn(),
  deleteUserAccount: vi.fn(),
  getAccountStats: vi.fn().mockResolvedValue({}),
  exportUserData: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn(),
  bumpUserTokenVersion: vi.fn(),
  createMemory: vi.fn(),
  getMemoriesByPersonaId: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
  createEmotionSnapshot: vi.fn(),
  getEmotionSnapshots: vi.fn().mockResolvedValue([]),
  getEmotionReport: vi.fn().mockResolvedValue({}),
  getTodaySnapshot: vi.fn(),
  getIntimacyData: vi.fn().mockResolvedValue({}),
  updateIntimacy: vi.fn(),
  getMessageVolume: vi.fn().mockResolvedValue([]),
  getEmotionTimeline: vi.fn().mockResolvedValue([]),
  getPersonaEngagement: vi.fn().mockResolvedValue([]),
  getHourlyDistribution: vi.fn().mockResolvedValue([]),
  getAnalyticsStats: vi.fn().mockResolvedValue({}),
  createDiaryEntry: vi.fn(),
  getDiaryEntries: vi.fn().mockResolvedValue([]),
  getDiaryByDate: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  getMessagesByDate: vi.fn().mockResolvedValue([]),
  getDiaryDates: vi.fn().mockResolvedValue([]),
  getScenes: vi.fn().mockResolvedValue([]),
  createScene: vi.fn(),
  activateScene: vi.fn(),
  getExportData: vi.fn().mockResolvedValue(null),
  getRecentEmotionTrend: vi.fn().mockResolvedValue([]),
  getMessageCountInRange: vi.fn().mockResolvedValue(0),
  setGraduationStatus: vi.fn(),
  getChannelBindingsByUserId: vi.fn().mockResolvedValue([]),
  getChannelBinding: vi.fn(),
  setChannelBindingPersona: vi.fn(),
  deleteChannelBinding: vi.fn(),
  getChannelState: vi.fn(),
  upsertChannelState: vi.fn(),
  getUserTemplates: vi.fn().mockResolvedValue([]),
  createUserTemplate: vi.fn(),
  updateUserTemplate: vi.fn(),
  deleteUserTemplate: vi.fn(),
  createQuestionnaireAnswers: vi.fn(),
  getActiveReminders: vi.fn().mockResolvedValue([]),
  dismissReminder: vi.fn(),
  appendPersonaCorrection: vi.fn(),
  // 第 4 批 4B：场景记忆与场景上下文管理（行为测试按需覆写返回值）。
  getDb: vi.fn().mockResolvedValue(null),
  getSceneMemoryStateSnapshot: vi.fn(async () => ({ stateId: null, storyState: null, cache: null })),
  mutateSceneMemoryState: (personaId: number, userId: number, sceneId: number, mutate: unknown) => mutateSceneMemoryState(personaId, userId, sceneId, mutate),
  clearSceneMemoryState: (personaId: number, userId: number, sceneId: number) => clearSceneMemoryState(personaId, userId, sceneId),
  resetPersonaSceneStoryState: vi.fn(),
  bumpChatContextRevision: vi.fn(),
  getSceneMessageContextManagement: vi.fn(async () => ({ startAfterMessageId: 0, messages: [] })),
  setSceneMessagesContextOverride: vi.fn(async () => 0),
  clearSceneMessagesContextOverride: vi.fn(),
  setAllSceneMessagesContextOverride: vi.fn(async () => 0),
  startNewPersonaConversationContext: vi.fn(async () => 0),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Static analysis ──────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
const db = readFileSync(path.join(ROOT, "server", "db.ts"), "utf-8");

/** A parameter that identifies a row. */
const ID_PARAM = /\b(id|personaId|jobId|sceneId|memoryId|targetId|templateId|jobKey|collectionId|sourceId)\b/;

interface DbFunction {
  name: string;
  params: string;
  body: string;
}

/** Every exported async function in db.ts, with its body. */
function exportedFunctions(src: string): DbFunction[] {
  const out: DbFunction[] = [];
  // The return type is optional and may itself contain braces, so it is
  // matched loosely up to the opening brace of the body.
  const pattern = /export async function (\w+)\(([^)]*)\)\s*(?::[^{]+)?\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    while (i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = src.slice(match.index + match[0].length, i);
    out.push({
      name: match[1],
      params: match[2].split(/\s+/).join(" "),
      body,
    });
  }
  return out;
}

const functions = exportedFunctions(db);

/**
 * True when the function only ever touches the user's own row.
 *
 * `getUserById`, `updateUserProfile` and friends take the user's id — that
 * *is* the owner, so there is nothing to filter on. The distinguishing mark
 * is that they query the `users` table.
 */
function isUserScoped(fn: DbFunction): boolean {
  return /eq\(\s*users\.id\s*,/.test(fn.body) && !/personaId|jobId|sceneId|memoryId/.test(fn.params);
}

describe("db helpers enforce ownership", () => {
  it("finds the exported functions", () => {
    expect(functions.length).toBeGreaterThan(50);
  });

  /**
   * 只按行 id 读取、归属交给调用方校验的显式例外。
   *
   * `getSceneById` 与自用版一致保持单参：场景要么是内置（userId 为 null，所有人可读），
   * 要么属于某个用户。数据层不再按 userId 过滤，归属改由每个场景路由显式校验
   * （isBuiltin || scene.userId === ctx.user.id；chat/service.ts 读取当前场景时同样兜底），
   * 并由下方 "a user cannot reach another user's scenes" 的跨用户测试覆盖。
   * 这也是本文件里唯一允许的单参读取——新增这类读取必须先说明归属由谁校验。
   */
  const ID_ONLY_READ_EXCEPTIONS = new Set(["getSceneById"]);

  it("requires a userId on every helper that takes a row identifier", () => {
    const unguarded = functions
      .filter((fn) => ID_PARAM.test(fn.params))
      .filter((fn) => !fn.params.includes("userId"))
      .filter((fn) => !isUserScoped(fn))
      .filter((fn) => !ID_ONLY_READ_EXCEPTIONS.has(fn.name))
      .map((fn) => `${fn.name}(${fn.params})`);

    expect(
      unguarded,
      "these helpers take a row identifier but never check who owns the row",
    ).toEqual([]);
  });

  it("leaves only the user-scoped helpers without a userId", () => {
    const withoutUserId = functions
      .filter((fn) => ID_PARAM.test(fn.params))
      .filter((fn) => !fn.params.includes("userId"))
      .map((fn) => fn.name)
      .sort();

    // These operate on the caller's own user row — the id *is* the owner.
    // `getSceneById` is also id-only, matching the self-use build: a scene is
    // either built-in (userId null, readable by everyone) or owned by a user,
    // and the scene router re-checks `isBuiltin || userId === ctx.user.id`
    // before returning anything. The same check guards chat/service.ts.
    expect(withoutUserId).toEqual([
      "bumpUserTokenVersion",
      "deleteUserAccount",
      "getSceneById",
      "getUserById",
      "updateUserLastSignedIn",
      "updateUserPassword",
      "updateUserProfile",
    ]);
  });

  it("filters the plan's named helpers by user", () => {
    const named = [
      "getSkillJobById",
      "deleteScene",
      "activateScene",
      "getFilesByPersonaId",
      "getMessagesByPersonaId",
      "getMemoriesByPersonaId",
      "getEmotionSnapshots",
      "getEmotionReport",
      "getRecentEmotionTrend",
      "getMessageCountInRange",
    ];

    for (const name of named) {
      const fn = functions.find((f) => f.name === name);
      expect(fn, `${name} must exist`).toBeDefined();
      expect(fn!.params, `${name} must take a userId`).toContain("userId");
    }
  });

  it("checks ownership before deleting a persona's rows", () => {
    const fn = functions.find((f) => f.name === "deletePersona");
    expect(fn).toBeDefined();
    // The ownership lookup has to come before the first delete.
    const checkIndex = fn!.body.indexOf("getPersonaById");
    const firstDelete = fn!.body.indexOf("tx.delete");
    expect(checkIndex, "deletePersona must check ownership").toBeGreaterThan(-1);
    expect(checkIndex, "the ownership check must come first").toBeLessThan(firstDelete);
  });

  it("scopes every row delete in deletePersona to the owner", () => {
    const fn = functions.find((f) => f.name === "deletePersona");
    const deletes = Array.from(fn!.body.matchAll(/tx\.delete\((\w+)\)\.where\(([^;]+)\)/g));
    expect(deletes.length).toBeGreaterThan(10);

    const unscoped = deletes
      .filter(([, , where]) => !/userId/.test(where))
      .map(([, table]) => table);
    expect(unscoped, "these deletes are not scoped to the owner").toEqual([]);
  });
});

// ─── Behavioural cross-user isolation ─────────────────────────────────────

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      name: `User ${userId}`,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("a user cannot reach another user's data", () => {
  beforeEach(() => {
    store.skillJobs = [
      { id: 7, userId: 1, personaId: 5, pipelineStage: "complete", analysisResult: { private: "A's data" } },
    ];
    store.scenes = [
      { id: 3, userId: 1, name: "A 的场景", isBuiltin: false },
      { id: 4, userId: null, name: "内置场景", isBuiltin: true },
    ];
    store.personas = [{ id: 5, userId: 1, name: "A 的分身" }];
    vi.clearAllMocks();
  });

  it("hides another user's distillation job (acceptance 0-C)", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const callerB = appRouter.createCaller(ctxFor(2));

    // The owner can read their own job.
    const own = await callerA.skillEngine.getJobStatus({ jobId: 7 });
    expect(own.id).toBe(7);

    // Somebody else cannot.
    await expect(
      callerB.skillEngine.getJobStatus({ jobId: 7 }),
    ).rejects.toThrow(/not found|NOT_FOUND/i);
  });

  it("refuses to delete another user's scene (acceptance 0-C)", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));

    await expect(callerB.scene.delete({ id: 3 })).rejects.toThrow();

    // The scene is still there.
    expect(store.scenes.some((s) => s.id === 3)).toBe(true);
  });

  it("refuses to delete a built-in scene", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    await expect(callerA.scene.delete({ id: 4 })).rejects.toThrow();
    expect(store.scenes.some((s) => s.id === 4)).toBe(true);
  });

  it("lets the owner delete their own scene", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const result = await callerA.scene.delete({ id: 3 });
    expect(result).toEqual({ success: true });
    expect(store.scenes.some((s) => s.id === 3)).toBe(false);
  });

  it("refuses to delete another user's persona (acceptance 0-C)", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));

    await expect(callerB.persona.delete({ id: 5 })).rejects.toThrow();

    // The persona and its rows are untouched.
    expect(store.personas.some((p) => p.id === 5)).toBe(true);
  });

  it("lets the owner delete their own persona", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const result = await callerA.persona.delete({ id: 5 });
    expect(result).toEqual({ success: true });
    expect(store.personas.some((p) => p.id === 5)).toBe(false);
  });
});

// ─── Scene isolation ──────────────────────────────────────────────────────

/**
 * 场景读取在数据层只按 id 返回，所以归属校验必须在路由层，且必须有测试守住。
 *
 * 这里给 B 用户自己的分身，目的是让 activate 通过“分身属于本人”这一关，
 * 真正走到场景归属判断：越权的场景必须 NOT_FOUND，而不是被别的检查顺带挡住。
 */
describe("a user cannot reach another user's scenes", () => {
  beforeEach(() => {
    store.scenes = [
      { id: 3, userId: 1, name: "A 的场景", isBuiltin: false },
      { id: 4, userId: null, name: "内置场景", isBuiltin: true },
    ];
    store.personas = [
      { id: 5, userId: 1, name: "A 的分身" },
      { id: 6, userId: 2, name: "B 的分身" },
    ];
    vi.clearAllMocks();
  });

  it("hides another user's scene from detail", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.detail({ id: 3, personaId: 6 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets any user read a built-in scene", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    const detail = await callerB.scene.detail({ id: 4, personaId: 6 });
    expect(detail.scene.id).toBe(4);
    // 4A 的占位：真实记忆快照由 4B 接管，键名与自用版一致。
    expect(detail.memory).toMatchObject({ stateId: null, storyState: null, cache: null });
  });

  it("refuses to update another user's scene", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.update({ id: 3, name: "被改掉的场景" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.scenes.find((s) => s.id === 3)?.name).toBe("A 的场景");
  });

  it("lets the owner update their own scene", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const updated = await callerA.scene.update({ id: 3, name: "我改的场景" });
    expect(updated.name).toBe("我改的场景");
  });

  it("refuses to activate another user's scene on the caller's own persona", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.activate({ personaId: 6, sceneId: 3 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to copy another user's scene", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.copy({ sceneId: 3 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to delete another user's scene", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(callerB.scene.delete({ id: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.scenes.some((s) => s.id === 3)).toBe(true);
  });

  // 第 4 批 4B：场景记忆/历史/上下文端点必须和 detail/update 一样先校验归属。
  it("refuses to read another user's scene chat history", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.getChatHistory({ sceneId: 3, personaId: 6 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to change another user's scene context inclusion", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.setContextInclusion({ sceneId: 3, personaId: 6, messageIds: [1], included: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerB.scene.setAllContextInclusion({ sceneId: 3, personaId: 6, included: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to edit another user's scene memory", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.updateMemory({ sceneId: 3, personaId: 6, summary: "越权摘要" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mutateSceneMemoryState).not.toHaveBeenCalled();
  });

  it("refuses to clear another user's scene memory", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.clearMemory({ sceneId: 3, personaId: 6 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(clearSceneMemoryState).not.toHaveBeenCalled();
  });

  it("refuses to delete another user's scene messages", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));
    await expect(
      callerB.scene.deleteMessages({ sceneId: 3, personaId: 6, messageIds: [1] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});