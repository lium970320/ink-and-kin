import { describe, expect, it, vi, beforeEach } from "vitest";

const createMessage = vi.fn();
const getDefaultLlmConfig = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const updatePersona = vi.fn();
const getPersonaById = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const createChatSummary = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const createGraduationAssessment = vi.fn();
const getMessagesSince = vi.fn();
const touchMemoryRecalled = vi.fn();
const createSafetyEvent = vi.fn();
const getLastMessageAt = vi.fn();
const getMessageCountSince = vi.fn();
const getDailyChatCounts = vi.fn();
const getSceneMemoryStateSnapshot = vi.fn();
const getSceneConversationMessagesBySceneId = vi.fn();
const recordSceneMemoryTurn = vi.fn();
const getSceneGenerationSnapshot = vi.fn();
const lockedTransaction = Object.freeze({ fixture: "context-transaction" });

vi.mock("../db", () => ({
  createMessage: (...a: unknown[]) => createMessage(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getSceneMemoryStateSnapshot: (...a: unknown[]) => getSceneMemoryStateSnapshot(...a),
  getSceneConversationMessagesBySceneId: (...a: unknown[]) => getSceneConversationMessagesBySceneId(...a),
  recordSceneMemoryTurn: (...a: unknown[]) => recordSceneMemoryTurn(...a),
  getSceneGenerationSnapshot: (...a: unknown[]) => getSceneGenerationSnapshot(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getMessageCountSince: (...a: unknown[]) => getMessageCountSince(...a),
  getDailyChatCounts: (...a: unknown[]) => getDailyChatCounts(...a),
}));

// 上下文锁、来源证据与审阅隔离由独立集成测试负责。
// 本组继续使用原有内存历史和写入探针。
vi.mock("./context-state", () => ({
  getContextState: async (userId: number, personaId: number) => ({ userId, personaId, revision: 0, startAfterMessageId: 0, overrides: {} }),
  getContextHistory: async (userId: number, personaId: number, limit: number) => ({
    state: { userId, personaId, revision: 0, startAfterMessageId: 0, overrides: {} },
    history: await getMessagesByPersonaId(personaId, userId, limit),
  }),
  withContextRevision: async (_userId: number, _personaId: number, _revision: number, work: (tx: typeof lockedTransaction) => Promise<unknown>) => work(lockedTransaction),
}));
vi.mock("../source-library", () => ({ sourceLibraryService: { context: async () => null } }));
vi.mock("../memory-review", () => ({ eligibleRealityMemories: async (rows: unknown[]) => rows }));

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const streamWithProvider = vi.fn();
const resolveProviderForUser = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: (...a: unknown[]) => streamWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

const inferEmotionalState = vi.fn();

vi.mock("../_core/emotion", () => ({
  inferEmotionalState: (...a: unknown[]) => inferEmotionalState(...a),
}));

import { runConversation as runConversationWithDb, composeMessages } from "./service";

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前任",
    togetherFrom: "2021-05",
    togetherTo: null,
    personaData: { personality: "温柔" },
    analysisStatus: "ready",
    emotionalState: "warm",
    chatCount: 10,
    intimacyScore: 120,
    intimacyLevel: "familiar",
    graduationStatus: null,
    llmProvider: null,
    activeSceneId: null,
    ...overrides,
  } as any;
}

function installGenerationFixture() {
  getPersonaById.mockImplementation(async (id: number, userId: number) => persona({ id, userId }));
  getSceneGenerationSnapshot.mockImplementation(async (id: number, userId: number) => {
    const current = await getPersonaById(id, userId);
    const scene = current.activeSceneId == null ? null : await getSceneById(current.activeSceneId);
    return { persona: current, scene, revision: 0 };
  });
}

// 既有用例把角色覆盖值设为当前持久角色；过期快照用例单独传入不同值。
function runConversation(options: Parameters<typeof runConversationWithDb>[0]) {
  getPersonaById.mockResolvedValue({ ...options.persona });
  return runConversationWithDb(options);
}

describe("runConversation", () => {
  beforeEach(() => {
    for (const fn of [
      createMessage, getDefaultLlmConfig, getTodaySnapshot, createEmotionSnapshot,
      getIntimacyData, updateIntimacy, updatePersona, getPersonaById,
      getMessagesByPersonaId, getMemoriesByPersonaId, getFilesByPersonaId, getSceneById,
      getLatestChatSummary, createChatSummary, getRecentEmotionTrend,
      getMessageCountInRange, setGraduationStatus, getLatestGraduationAssessment,
      createGraduationAssessment, getMessagesSince, touchMemoryRecalled, createSafetyEvent,
      getLastMessageAt, getMessageCountSince, getDailyChatCounts, invoke, invokeWithProvider,
      streamWithProvider, resolveProviderForUser, inferEmotionalState,
      getSceneMemoryStateSnapshot, getSceneConversationMessagesBySceneId,
      recordSceneMemoryTurn, getSceneGenerationSnapshot,
    ]) {
      fn.mockReset();
    }

    getDefaultLlmConfig.mockResolvedValue(null);
    getTodaySnapshot.mockResolvedValue(undefined);
    getIntimacyData.mockResolvedValue({
      chatCount: 10, totalMessages: 20, memoryCount: 3,
      emotionVariety: 3, daysSinceCreation: 100, consecutiveDays: 2,
    });
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getSceneMemoryStateSnapshot.mockResolvedValue({ stateId: null, storyState: null, cache: null });
    getSceneConversationMessagesBySceneId.mockResolvedValue([]);
    recordSceneMemoryTurn.mockResolvedValue(0);
    installGenerationFixture();
    getLatestChatSummary.mockResolvedValue(undefined);
    getRecentEmotionTrend.mockResolvedValue([]);
    getMessageCountInRange.mockResolvedValue(0);
    getLatestGraduationAssessment.mockResolvedValue(undefined);
    createGraduationAssessment.mockResolvedValue(1);
    getMessagesSince.mockResolvedValue([]);
    getLastMessageAt.mockResolvedValue(new Date());
    getMessageCountSince.mockResolvedValue(1);
    getDailyChatCounts.mockResolvedValue([]);
    createMessage.mockResolvedValue(99);
    createSafetyEvent.mockResolvedValue(1);
    touchMemoryRecalled.mockResolvedValue(undefined);
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke: invoke,
      stream: async function* () {
        yield { text: "" };
      },
    });
    invokeWithProvider.mockResolvedValue("在的。");
  });

  it("取消流式回复后不启动辅助模型或写入虚假回复", async () => {
    const controller = new AbortController();
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "部分" };
      controller.abort();
      throw new DOMException("已取消", "AbortError");
    });
    const events = [];
    for await (const event of runConversation({ persona: persona(), userId: 1, message: "你好", mode: "stream", signal: controller.signal })) events.push(event);
    expect(inferEmotionalState).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(events.some(event => event.type === "done")).toBe(false);
  });

  it("主回复传递可信用户角色和用途", async () => {
    for await (const _ of runConversation({ persona: persona({ id: 23, userId: 9 }), userId: 9, message: "你好", mode: "once" })) {}
    expect(invokeWithProvider.mock.calls[0][1].options.usageContext).toEqual({ userId: 9, personaId: 23, route: "web", purpose: "chat" });
    expect(inferEmotionalState.mock.calls[0][0].usageContext).toEqual({ userId: 9, personaId: 23, route: "web", purpose: "emotion" });
  });

  it("stores the user's turn and the persona's reply", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(createMessage).toHaveBeenCalledTimes(2);
    const [userCall, assistantCall] = createMessage.mock.calls;
    expect(userCall[0].role).toBe("user");
    expect(userCall[0].content).toBe("在吗");
    expect(assistantCall[0].role).toBe("assistant");
    expect(assistantCall[0].content).toContain("在的。");
    expect(userCall[1]).toBe(lockedTransaction);
    expect(assistantCall[1]).toBe(lockedTransaction);

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
  });

  it("never calls the model when the message is a crisis", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(invokeWithProvider).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(true);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("12356");
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("streams the reply in pieces", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      yield { text: "的" };
    });

    const deltas: string[] = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).toBe("在的");
  });

  it("keeps a partial answer when the model fails mid-stream", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      throw new Error("upstream exploded");
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    const error = events.find((e) => e.type === "error");
    expect(error?.partial).toBe(true);
    // The partial reply is still stored.
    expect(createMessage.mock.calls[1][0].content).toContain("在");
  });

  it("updates the intimacy score and the persona's state", async () => {
    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(updateIntimacy).toHaveBeenCalled();
    expect(updatePersona).toHaveBeenCalled();
  });

  it("hands the resolved provider to the emotion classifier", async () => {
    // The classifier has to run on the same credentials as the reply —
    // otherwise a user who configured their own key falls back to the
    // environment one.
    const providerInstance = {
      name: "UserProvider",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
    };
    resolveProviderForUser.mockResolvedValue(providerInstance);

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(inferEmotionalState).toHaveBeenCalled();
    expect(inferEmotionalState.mock.calls[0][0].providerInstance).toBe(providerInstance);
  });

  it("measures the conversation length against the message before this turn", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    // The database returns the newest message — once this turn is stored that
    // is the turn itself, which would make the session length zero.
    getLastMessageAt.mockImplementation(async () =>
      createMessage.mock.calls.length > 0
        ? now
        : new Date(now.getTime() - 3 * 60 * 60 * 1000),
    );

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.kind).toBe("long_session");
    // The timestamp was read before the turn was stored.
    expect(getLastMessageAt.mock.invocationCallOrder[0]).toBeLessThan(
      createMessage.mock.invocationCallOrder[0],
    );
  });

  it("gives the care note a translation key and the client's language", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    getLastMessageAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      locale: "en",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.textKey).toBe("safety.care.longSession");
    expect(done?.careNote?.text).toContain("We've been talking");
  });

  it("adds a gentle check-in when the user sounds exhausted", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "今天好累",
      mode: "once",
    })) {
      events.push(event);
    }

    // The model still answers — a weak signal is not a crisis.
    expect(invokeWithProvider).toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(false);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("在的。");
    expect(assistantCall.content).toContain("你刚刚那句话我听见了");
    // No crisis resources.
    expect(assistantCall.content).not.toContain("12356");
  });

  it("assesses the emotional trajectory and lets it suggest graduation earlier", async () => {
    getMessagesByPersonaId.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );
    invoke.mockResolvedValue(
      JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
    );
    // The reply comes first, the trajectory assessment second — both on the
    // provider that was resolved for the user.
    invokeWithProvider
      .mockResolvedValueOnce("在的。")
      .mockResolvedValue(
        JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
      );
    // Nothing stored yet (the throttle check), then the fresh assessment the
    // graduation check reads.
    getLatestGraduationAssessment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        id: 1,
        userId: 1,
        personaId: 1,
        trajectory: "improving",
        regretRatio: 10,
        gratitudeRatio: 80,
        assessment: null,
        windowStart: new Date("2025-12-18T12:00:00Z"),
        windowEnd: new Date("2026-01-15T12:00:00Z"),
        createdAt: new Date("2026-01-15T12:00:00Z"),
      });

    const events = [];
    for await (const event of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00Z"),
    })) {
      events.push(event);
    }

    expect(createGraduationAssessment).toHaveBeenCalledTimes(1);
    expect(createGraduationAssessment.mock.calls[0][0].trajectory).toBe("improving");

    const done = events.find((e) => e.type === "done");
    expect(done?.graduationSuggested).toBe(true);
  });

  it("does not assess the trajectory again within a day", async () => {
    getLatestGraduationAssessment.mockResolvedValue({
      id: 1,
      userId: 1,
      personaId: 1,
      trajectory: "stable",
      regretRatio: 10,
      gratitudeRatio: 10,
      assessment: null,
      windowStart: new Date("2025-12-18T12:00:00Z"),
      windowEnd: new Date("2026-01-15T12:00:00Z"),
      createdAt: new Date("2026-01-15T11:00:00Z"),
    });

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00Z"),
    })) {
      // drain
    }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  // ─── 场景模式（第 4 批 4B）───────────────────────────────────────────────

  it("scene mode replays only the active scene and records the scene turn", async () => {
    getSceneById.mockResolvedValue({
      id: 7,
      userId: 1,
      isBuiltin: false,
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      systemPromptOverlay: "钟楼不可随意进入。",
      contextSeed: "上次已经见过主持。",
      continuationEnabled: true,
      personaIdentityOverride: "你是借宿的琴师。",
      userIdentityOverride: null,
    });
    getSceneConversationMessagesBySceneId.mockResolvedValue([
      {
        id: 11, personaId: 1, userId: 1, role: "user", content: "场景里甲",
        messageType: "text", mediaUrl: null, sceneId: 7, contextOverride: null,
        mode: "scene", createdAt: new Date("2026-01-15T11:00:00Z"),
      },
      {
        id: 12, personaId: 1, userId: 1, role: "assistant", content: "场景里乙",
        messageType: "text", mediaUrl: null, sceneId: 7, contextOverride: null,
        mode: "scene", createdAt: new Date("2026-01-15T11:01:00Z"),
      },
      // 真实库里本轮用户消息先落库再组装提示词，所以历史里包含它（id=101）。
      {
        id: 101, personaId: 1, userId: 1, role: "user", content: "继续往里走",
        messageType: "text", mediaUrl: null, sceneId: 7, contextOverride: null,
        mode: "scene", createdAt: new Date("2026-01-15T11:02:00Z"),
      },
    ]);
    getSceneMemoryStateSnapshot.mockResolvedValue({
      stateId: 1,
      storyState: {
        sceneKey: "scene:7", turn: 2,
        startedAt: "2026-01-15T10:00:00.000Z", updatedAt: "2026-01-15T11:01:00.000Z",
        lastMessageId: 12, lastExitAt: null,
      },
      cache: {
        version: 1, summary: "他们已进入山寺", openThreads: [],
        pinnedFacts: [{ id: "f1", fact: "小岚怕黑", source: "user" }],
        recentMessageIds: [11, 12], updatedAt: "2026-01-15T11:01:00.000Z",
      },
    });
    createMessage.mockReset();
    createMessage.mockResolvedValueOnce(101).mockResolvedValueOnce(102);

    for await (const _ of runConversation({
      persona: persona({ activeSceneId: 7 }),
      userId: 1,
      message: "继续往里走",
      mode: "once",
    })) {
      // drain
    }

    expect(getSceneConversationMessagesBySceneId).toHaveBeenCalledWith(1, 1, 7, 200);
    expect(createMessage.mock.calls[0][0].sceneId).toBe(7);
    expect(createMessage.mock.calls[1][0].sceneId).toBe(7);
    expect(recordSceneMemoryTurn).toHaveBeenCalledWith(1, 1, 7, "scene:7", [101, 102], lockedTransaction);
    const sent = invokeWithProvider.mock.calls[0][1].messages as Array<{ role: string; content: unknown }>;
    const system = String(sent[0].content);
    expect(system).toContain("场景名称：山寺夜宿");
    expect(system).toContain("前情提要：他们已进入山寺");
    expect(system).toContain("场景内已确认事实：小岚怕黑");
    expect(system).toContain("第 3 个回复回合");
    expect(String(sent[sent.length - 1].content)).toContain("本轮场景导演输入");
    expect(sent.some((m) => typeof m.content === "string" && m.content.includes("场景里甲"))).toBe(true);
  });

  it("the scene start marker opens a new story segment before storing the turn", async () => {
    getSceneById.mockResolvedValue({
      id: 7, userId: 1, isBuiltin: false, name: "山寺夜宿", description: null,
      systemPromptOverlay: null, contextSeed: null, continuationEnabled: true,
      personaIdentityOverride: null, userIdentityOverride: null,
    });
    getSceneConversationMessagesBySceneId.mockResolvedValue([]);

    for await (const _ of runConversation({
      persona: persona({ activeSceneId: 7 }),
      userId: 1,
      message: "【开始】我们到了山门",
      mode: "once",
    })) {
      // drain
    }

    expect(getSceneGenerationSnapshot).toHaveBeenCalledWith(1, 1, { startNewScene: true });
    expect(getSceneGenerationSnapshot.mock.invocationCallOrder[0]).toBeLessThan(createMessage.mock.invocationCallOrder[0]);
    expect(createMessage.mock.calls[0][0].content).toContain("【开始】");
    expect(createMessage.mock.calls[0][0].sceneId).toBe(7);
  });

  it("重新读取数据库角色与当前场景，忽略调用方传入的旧场景快照", async () => {
    getPersonaById.mockResolvedValue(persona({ name: "当前角色", activeSceneId: 7, emotionalState: "warm" }));
    getSceneById.mockResolvedValue({
      id: 7, userId: 1, isBuiltin: false, name: "当前场景", description: null,
      systemPromptOverlay: null, contextSeed: null, continuationEnabled: true,
      personaIdentityOverride: null, userIdentityOverride: null,
    });
    const stale = persona({ name: "过期角色名", activeSceneId: null, emotionalState: "sad" });
    for await (const _ of runConversationWithDb({ persona: stale, userId: 1, message: "继续", mode: "once" })) {
      // 消费整个回合。
    }

    expect(getSceneGenerationSnapshot).toHaveBeenCalledWith(1, 1, { startNewScene: false });
    expect(getSceneConversationMessagesBySceneId).toHaveBeenCalledWith(1, 1, 7, 200);
    expect(createMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      role: "user", sceneId: 7, emotionalState: "warm", content: "继续",
    }), lockedTransaction);
    const prompt = String(invokeWithProvider.mock.calls[0][1].messages[0].content);
    expect(prompt).toContain("当前角色");
    expect(prompt).not.toContain("过期角色名");
  });

  it("daily conversations never read or write scene tables", async () => {
    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "你好",
      mode: "once",
    })) {
      // drain
    }

    expect(getSceneConversationMessagesBySceneId).not.toHaveBeenCalled();
    expect(recordSceneMemoryTurn).not.toHaveBeenCalled();
    expect(getSceneMemoryStateSnapshot).not.toHaveBeenCalled();
    expect(createMessage.mock.calls.every((call) => call[0].sceneId == null)).toBe(true);
  });
});

describe("composeMessages", () => {
  beforeEach(() => {
    installGenerationFixture();
    getDefaultLlmConfig.mockResolvedValue(null);
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getSceneMemoryStateSnapshot.mockResolvedValue({ stateId: null, storyState: null, cache: null });
    getSceneConversationMessagesBySceneId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(undefined);
    touchMemoryRecalled.mockResolvedValue(undefined);
  });

  it("puts the system prompt first", async () => {
    const messages = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain("小A");
  });

  it("includes the retrieved memories", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    const messages = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).toContain("第一次见面");
  });

  it("marks a recalled memory as recalled", async () => {
    // The recall time is what damps a memory that keeps coming up, so a
    // recall has to be recorded — not just scored.
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 42,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(touchMemoryRecalled).toHaveBeenCalledWith(
      42,
      1,
      expect.any(Date),
    );
  });

  it("sends an image message as a multi-part content array", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "[图片]",
        messageType: "image",
        mediaUrl: "https://cdn.example.com/photo.png",
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const messages = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "看这个",
      contextLimit: 20,
    });

    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "text", text: "[图片]" },
      { type: "image_url", url: "https://cdn.example.com/photo.png" },
    ]);
  });

  it("keeps a text message as a plain string", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "在吗",
        messageType: "text",
        mediaUrl: null,
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const messages = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[messages.length - 1].content).toBe("在吗");
  });
});
