import { beforeEach, describe, expect, it, vi } from "vitest";

// 这一组测试专门验证「空正文 → 关闭隐藏思考重试」在生产链路里真的接上了。
// 实测背景：上游把隐藏思考 token 计入 completion，推理吃满 maxTokens 时返回
// 「HTTP 200 但正文为空」；原来的兜底两次都用同一份配置，第二次照空。
// 现行策略：正文默认**开着**隐藏思考（撞顶由 16384 预算 + 推理上限解决），
// 只有真出现空正文时，才在第二次调用里关闭隐藏思考把这一拍救回来。
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getRoleplayChannelById: vi.fn(),
  isRoleplayGenerationCurrent: vi.fn(),
  getPersonasByUserId: vi.fn(),
  getPersonaById: vi.fn(),
  getRoleplayChannelMessages: vi.fn(),
  getDefaultLlmConfig: vi.fn(),
  getRoleplayChannelDirectorState: vi.fn(),
  setRoleplayChannelDirectorState: vi.fn(),
  withRoleplayBeatTransaction: vi.fn(),
  createRoleplayMessage: vi.fn(),
  updateRoleplayMemberCursor: vi.fn(),
  updateRoleplayChannelDiagnostics: vi.fn(),
}));

vi.mock("../llm", () => ({ llmService: { invoke: h.invoke } }));
vi.mock("../db", () => ({
  getRoleplayChannelById: h.getRoleplayChannelById,
  isRoleplayGenerationCurrent: h.isRoleplayGenerationCurrent,
  getPersonasByUserId: h.getPersonasByUserId,
  getPersonaById: h.getPersonaById,
  getRoleplayChannelMessages: h.getRoleplayChannelMessages,
  getDefaultLlmConfig: h.getDefaultLlmConfig,
  getRoleplayChannelDirectorState: h.getRoleplayChannelDirectorState,
  setRoleplayChannelDirectorState: h.setRoleplayChannelDirectorState,
  withRoleplayBeatTransaction: h.withRoleplayBeatTransaction,
  createRoleplayMessage: h.createRoleplayMessage,
  updateRoleplayMemberCursor: h.updateRoleplayMemberCursor,
  updateRoleplayChannelDiagnostics: h.updateRoleplayChannelDiagnostics,
}));

// 书中人 tsconfig 未显式指定 target（默认 ES5），这里不用顶层 await import；
// vitest 会把上面的 vi.mock 提升到模块加载前，静态 import 同样拿到 mock 后的模块。
import { RoleplayTurnCancelledError, runRoleplayChannelTurn, type RoleplayTurnBeat } from "./roleplay-channel";
import type { QqDeliveryBatch } from "../../shared/qq-delivery";

const CHANNEL = {
  id: 11,
  userId: 1,
  name: "晨间图书室",
  description: "两位角色讨论路线",
  scenePrompt: "清晨，图书室里摊着一张地图。",
  isActive: true,
  generationRevision: 4,
  channelKind: "channel",
  runtimeDiagnostics: null,
  members: [
    { personaId: 1, personaName: "林舟", displayOrder: 0, speakingEnabled: true, analysisStatus: "ready", lastReadMessageId: 0 },
    { personaId: 2, personaName: "陈远", displayOrder: 1, speakingEnabled: true, analysisStatus: "ready", lastReadMessageId: 0 },
  ],
};

const PERSONAS = [
  { id: 1, name: "林舟", analysisStatus: "ready", emotionalState: "warm", personaData: {} },
  { id: 2, name: "陈远", analysisStatus: "ready", emotionalState: "warm", personaData: {} },
];

const MESSAGES = [
  { id: 1, personaId: null, speakerName: "你", role: "user", content: "继续，写具体一点。", createdAt: new Date() },
];

const GOOD_REPLY = '{"shouldSpeak":true,"innerThought":"心跳还没落下来。","mood":"warm","reply":"【林舟把台灯拧暗了一些，灯光剩下一小团。】\\n\\n别急。"}';
const SECOND_REPLY = '{"shouldSpeak":true,"innerThought":"他终于松了口气。","mood":"warm","reply":"【林舟走到窗前，推开了一道缝。】\\n\\n雨已经停了。"}';

/** 记录本次回合真正发起过的所有 route，用来断言"没有再触发旁白补写"。 */
const calledRoutes: string[] = [];
/** 记录频道主生成实际收到的 system / user 提示词，用来断言去重与格式预答生效。 */
const turnPrompts: { system: string; user: string }[] = [];

function mockTurnReplies(sequence: string[]) {
  const turnOptions: any[] = [];
  h.invoke.mockImplementation(async (params: any) => {
    calledRoutes.push(String(params?.options?.usageContext?.route ?? ""));
    if (params?.options?.usageContext?.route === "roleplay.channel_turn") {
      turnOptions.push(params.options);
      turnPrompts.push({
        system: String(params?.messages?.[0]?.content ?? ""),
        user: String(params?.messages?.[1]?.content ?? ""),
      });
      return sequence[turnOptions.length - 1] ?? sequence[sequence.length - 1] ?? "";
    }
    // 反思 / 导演线 / 旁白补写 / 人名审计等辅助调用一律返回空串，走各自的降级路径。
    return "";
  });
  return turnOptions;
}

function latestDiagnostics() {
  return h.updateRoleplayChannelDiagnostics.mock.calls.at(-1)?.[2];
}

const committedBeatTransactions: object[] = [];

describe("频道主生成链路：空正文降级重试 + 【】旁白保留", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calledRoutes.length = 0;
    turnPrompts.length = 0;
    committedBeatTransactions.length = 0;
    h.getRoleplayChannelById.mockResolvedValue(CHANNEL);
    h.isRoleplayGenerationCurrent.mockResolvedValue(true);
    h.getPersonasByUserId.mockResolvedValue(PERSONAS);
    h.getPersonaById.mockImplementation(async (id: number) => PERSONAS.find(p => p.id === id));
    h.getRoleplayChannelMessages.mockResolvedValue(MESSAGES);
    h.getDefaultLlmConfig.mockResolvedValue({ extraConfig: {} });
    h.getRoleplayChannelDirectorState.mockResolvedValue(null);
    h.setRoleplayChannelDirectorState.mockResolvedValue(undefined);
    h.withRoleplayBeatTransaction.mockImplementation(async (write: (executor: object) => Promise<unknown>) => {
      const executor = {};
      const result = await write(executor);
      committedBeatTransactions.push(executor);
      return result;
    });
    h.createRoleplayMessage.mockResolvedValue({ id: 99 });
    h.updateRoleplayMemberCursor.mockResolvedValue(undefined);
    h.updateRoleplayChannelDiagnostics.mockResolvedValue(undefined);
  });

  it("首轮空正文时，第二次调用必须关闭隐藏思考并把这一拍救回来", async () => {
    const turnOptions = mockTurnReplies(["", GOOD_REPLY]);

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(turnOptions).toHaveLength(2);
    // 第一次按用户配置跑：默认开着隐藏思考
    expect(turnOptions[0].disableThinking).toBeUndefined();
    // 第二次必须降级关闭，否则同一份预算下会再空一次
    expect(turnOptions[1].disableThinking).toBe(true);
    expect(result.spoken).toBe(true);
    // 主生成的【】旁白必须落库：以前解析层会把它剥掉，再由补写调用重写一遍
    expect(result.replyText).toContain("台灯");
    expect(result.replyText).toContain("别急");
    expect(calledRoutes).not.toContain("roleplay.channel_narration_decorate");
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
  });

  it("首轮就有正文时只调一次，不做无谓降级", async () => {
    const turnOptions = mockTurnReplies([GOOD_REPLY]);

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(turnOptions).toHaveLength(1);
    expect(turnOptions[0].disableThinking).toBeUndefined();
    expect(result.spoken).toBe(true);
    expect(result.replyText).toContain("台灯");
    expect(calledRoutes).not.toContain("roleplay.channel_narration_decorate");
  });

  it("两次都空：本拍不落库，交给候选轮转（保持原有安全行为）", async () => {
    const turnOptions = mockTurnReplies(["", ""]);

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    // 两位候选各试一组「原样 → 降级」，仍然都没拿到正文
    expect(turnOptions.map(option => option.disableThinking ?? false)).toEqual([false, true, false, true]);
    expect(result.spoken).toBe(false);
    expect(h.createRoleplayMessage).not.toHaveBeenCalled();
    expect(latestDiagnostics().beats).toEqual([]);
    expect(latestDiagnostics().messageId).toBeNull();
  });

  it("反思要求同人续拍时，返回两条按落库顺序排列的发言并保留第一拍顶层字段", async () => {
    let turnCount = 0;
    h.invoke.mockImplementation(async (params: any) => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") return turnCount++ === 0 ? GOOD_REPLY : SECOND_REPLY;
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 }).mockResolvedValueOnce({ id: 101 });

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(2);
    expect(h.createRoleplayMessage.mock.calls.map(([message]) => message.content)).toEqual([
      expect.stringContaining("台灯"),
      expect.stringContaining("雨已经停了"),
    ]);
    expect(result.beats?.map(beat => beat.messageId)).toEqual([100, 101]);
    expect(result.beats?.map(beat => beat.replyText)).toEqual([
      expect.stringContaining("台灯"),
      expect.stringContaining("雨已经停了"),
    ]);
    expect(result.beats?.map(beat => beat.innerThought)).toEqual(["心跳还没落下来。", "他终于松了口气。"]);
    expect(result.messageId).toBe(100);
    expect(result.replyText).toBe(result.beats?.[0].replyText);
    expect(latestDiagnostics().beats).toEqual(result.beats);
    expect(latestDiagnostics().messageId).toBe(101);
    expect(latestDiagnostics().replyText).toContain("雨已经停了");
    expect(latestDiagnostics().innerThought).toBe("他终于松了口气。");
  });

  it("首拍在事务内登记交付，提交后确认结果未知则保留首拍且不生成续拍", async () => {
    let modelTurns = 0;
    h.invoke.mockImplementation(async params => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") return modelTurns++ === 0 ? GOOD_REPLY : SECOND_REPLY;
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 });
    const unknownBatch: QqDeliveryBatch = {
      id: "fixture-batch", channelId: 11, userId: 1, contactId: "fixture:private:100", source: "qq",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      parts: [{ id: "fixture-part", messageId: 100, beatIndex: 0, partIndex: 0, text: "已保存的发言", status: "unknown", attempts: 1 }],
      summary: { total: 1, sent: 0, failed: 0, unknown: 1, pending: 0, cancelled: 0, sending: 0 },
    };
    const qqDeliveryError = "首拍 QQ 交付结果未知，请核对。";
    const beforeSave = vi.fn(async (_executor: object) => {
      expect(committedBeatTransactions).toHaveLength(0);
      expect(h.createRoleplayMessage).not.toHaveBeenCalled();
    });
    const savedBeat = vi.fn(async (executor: object, beat: RoleplayTurnBeat, beatIndex: number) => {
      expect(committedBeatTransactions).toHaveLength(0);
      expect(executor).toBe(beforeSave.mock.calls[0][0]);
      expect(executor).toBe(h.createRoleplayMessage.mock.calls[0][2]);
      expect(beat).toMatchObject({ messageId: 100, replyText: expect.stringContaining("台灯") });
      expect(beatIndex).toBe(0);
    });
    const afterBeat = vi.fn(async (beat: RoleplayTurnBeat) => {
      expect(committedBeatTransactions).toHaveLength(1);
      expect(committedBeatTransactions[0]).toBe(savedBeat.mock.calls[0][0]);
      expect(beat).toBe(savedBeat.mock.calls[0][1]);
      return false;
    });
    const readResult = vi.fn(() => ({ qqDelivery: [unknownBatch], qqDeliveryError }));

    const result = await runRoleplayChannelTurn({
      channelId: 11, userId: 1, delivery: { beforeSave, savedBeat, afterBeat, readResult },
    });

    expect(modelTurns).toBe(1);
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(beforeSave).toHaveBeenCalledTimes(1);
    expect(savedBeat).toHaveBeenCalledTimes(1);
    expect(afterBeat).toHaveBeenCalledTimes(1);
    expect(readResult).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ spoken: true, messageId: 100, qqDelivery: [unknownBatch], qqDeliveryError });
    expect(result.beats).toEqual([savedBeat.mock.calls[0][1]]);
  });

  it("事务内登记交付失败时整拍不提交，也不触发提交后交付", async () => {
    mockTurnReplies([GOOD_REPLY]);
    const writeError = new Error("登记交付失败");
    const beforeSave = vi.fn(async (_executor: object) => {});
    const savedBeat = vi.fn(async (_executor: object, _beat: RoleplayTurnBeat, _beatIndex: number) => {
      throw writeError;
    });
    const afterBeat = vi.fn(async (_beat: RoleplayTurnBeat) => true);
    const readResult = vi.fn(() => ({ qqDelivery: [] }));

    await expect(runRoleplayChannelTurn({
      channelId: 11, userId: 1, delivery: { beforeSave, savedBeat, afterBeat, readResult },
    })).rejects.toBe(writeError);

    expect(h.withRoleplayBeatTransaction).toHaveBeenCalledTimes(1);
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(savedBeat).toHaveBeenCalledTimes(1);
    expect(committedBeatTransactions).toHaveLength(0);
    expect(afterBeat).not.toHaveBeenCalled();
    expect(readResult).not.toHaveBeenCalled();
  });

  it("同人续拍异常时仍只返回并保留已落库的第一拍", async () => {
    let turnCount = 0;
    h.invoke.mockImplementation(async (params: any) => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") {
        if (turnCount++ === 0) return GOOD_REPLY;
        throw new Error("第二拍上游失败");
      }
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 });

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(result.spoken).toBe(true);
    expect(result.beats?.map(beat => beat.messageId)).toEqual([100]);
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(latestDiagnostics().beats.map((beat: any) => beat.messageId)).toEqual([100]);
    expect(latestDiagnostics().messageId).toBe(100);
    expect(latestDiagnostics().skippedReason).toContain("续拍");
  });

  it("第二拍游标更新失败时回滚第二拍，只返回已提交的第一拍", async () => {
    let turnCount = 0;
    h.invoke.mockImplementation(async (params: any) => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") return turnCount++ === 0 ? GOOD_REPLY : SECOND_REPLY;
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 }).mockResolvedValueOnce({ id: 101 });
    h.updateRoleplayMemberCursor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("第二拍游标写入失败"));

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(2);
    expect(committedBeatTransactions).toHaveLength(1);
    expect(result.beats?.map(beat => beat.messageId)).toEqual([100]);
    expect(result.messageId).toBe(100);
    expect(latestDiagnostics().messageId).toBe(100);
    expect(latestDiagnostics().skippedReason).toContain("续拍生成或保存失败");
  });

  it("第一拍成员游标失败时回滚发言，不写后续诊断或导演进度", async () => {
    mockTurnReplies([GOOD_REPLY]);
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 });
    h.updateRoleplayMemberCursor.mockRejectedValueOnce(new Error("游标写入失败"));
    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1 })).rejects.toThrow("游标写入失败");
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(committedBeatTransactions).toHaveLength(0);
    expect(h.updateRoleplayChannelDiagnostics).not.toHaveBeenCalled();
    expect(h.setRoleplayChannelDirectorState).not.toHaveBeenCalled();
  });

  it("发言、游标、诊断和导演进度共享同一事务；导演失败时整拍不提交", async () => {
    h.getRoleplayChannelDirectorState.mockResolvedValue({
      arc: [{ title: "窗边", goal: "看雨" }], cursor: 0,
      lastUserSteer: MESSAGES[0].content, stallStreak: 0, recentBeats: [],
      plannedAtTurn: 0, turnCount: 0, storySummary: "", pinnedFacts: [],
    });
    mockTurnReplies([GOOD_REPLY]);
    h.setRoleplayChannelDirectorState.mockRejectedValueOnce(new Error("导演写入失败"));

    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1 })).rejects.toThrow("导演写入失败");
    expect(h.withRoleplayBeatTransaction).toHaveBeenCalledTimes(1);
    const executor = h.createRoleplayMessage.mock.calls[0][2];
    expect(executor).toBeTruthy();
    expect(h.updateRoleplayMemberCursor.mock.calls[0][5]).toBe(executor);
    expect(h.updateRoleplayChannelDiagnostics.mock.calls[0][5]).toBe(executor);
    expect(h.setRoleplayChannelDirectorState.mock.calls[0][5]).toBe(executor);
    expect(committedBeatTransactions).toHaveLength(0);
  });

  it("导演记录保留两拍顺序，回合只增加一次，下一次规划能看到第二拍", async () => {
    h.getRoleplayChannelDirectorState.mockResolvedValue({
      arc: [{ title: "窗边", goal: "看雨" }], cursor: 0,
      lastUserSteer: MESSAGES[0].content, stallStreak: 0, recentBeats: ["前情"],
      plannedAtTurn: 4, turnCount: 4, storySummary: "", pinnedFacts: [],
    });
    let turnCount = 0;
    const plannerPrompts: string[] = [];
    h.invoke.mockImplementation(async (params: any) => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") return turnCount++ % 2 === 0 ? GOOD_REPLY : SECOND_REPLY;
      plannerPrompts.push(JSON.stringify(params.messages));
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 }).mockResolvedValueOnce({ id: 101 });
    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });
    const state = h.setRoleplayChannelDirectorState.mock.calls.at(-1)?.[2];
    expect(state.cursor).toBe(1);
    expect(state.turnCount).toBe(5);
    expect(state.recentBeats).toEqual(["前情", expect.stringContaining("第 1 拍"), expect.stringContaining("第 2 拍")]);
    expect(state.recentBeats[1]).toContain("台灯");
    expect(state.recentBeats[2]).toContain("雨已经停了");
    h.getRoleplayChannelDirectorState.mockResolvedValue(state);
    plannerPrompts.length = 0;
    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });
    expect(plannerPrompts.some(prompt => prompt.includes("台灯") && prompt.includes("雨已经停了"))).toBe(true);
  });

  it("允许沉默时第二拍选择沉默，不落库也不返回空拍", async () => {
    let turnCount = 0;
    h.invoke.mockImplementation(async (params: any) => {
      const route = params?.options?.usageContext?.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route === "roleplay.channel_turn") {
        return turnCount++ === 0
          ? GOOD_REPLY
          : '{"shouldSpeak":false,"innerThought":"先听他讲完。","mood":"warm","reply":"（保持沉默。）"}';
      }
      return "";
    });
    h.createRoleplayMessage.mockResolvedValueOnce({ id: 100 });

    const result = await runRoleplayChannelTurn({ channelId: 11, userId: 1, allowSilence: true });

    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(result.beats?.map(beat => beat.messageId)).toEqual([100]);
    expect(result.beats?.every(beat => Boolean(beat.replyText.trim()))).toBe(true);
  });

  it("系统提示词里场景与前情只注入一次（不再重复 2,295 字）", async () => {
    mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    const system = turnPrompts[0].system;
    const sceneHead = CHANNEL.scenePrompt;
    const occurrences = system.split(sceneHead).length - 1;
    expect(occurrences).toBe(1);
    expect(system).toContain("本频道的场景与前情见上方【频道当前情境】，此处不重复。");
  });

  it("主生成带推理上限与大输出预算（隐藏推理不再挤掉正文）", async () => {
    const turnOptions = mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    // 8192 的旧预算实测会被隐藏推理周期性吃满，正文变空字符串。
    expect(turnOptions[0].maxTokens).toBe(16384);
    expect(turnOptions[0].reasoningMaxTokens).toBe(3000);
  });

  it("用户提示词带格式预答（消掉 JSON 转义的反复权衡）", async () => {
    mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    const user = turnPrompts[0].user;
    expect(user).toContain("【格式预答·不必再权衡】");
    expect(user).toContain("不存在 JSON 转义问题");
  });

  it.each(["roleplay.channel_turn", "roleplay.channel_narration_decorate"])(
    "等待 %s 时取消：旧任务不落库、不更新游标，并释放频道生成锁",
    async targetRoute => {
      let cancelled = false;
      let release!: (reply: string) => void;
      let signalStarted!: () => void;
      const started = new Promise<void>(resolve => { signalStarted = resolve; });
      const pending = new Promise<string>(resolve => { release = resolve; });
      h.invoke.mockImplementation(async (params: any) => {
        const route = params?.options?.usageContext?.route;
        if (route === targetRoute) {
          signalStarted();
          return pending;
        }
        // 没有旁白才会触发补写，让取消覆盖辅助模型返回之后的路径。
        if (route === "roleplay.channel_turn") {
          return '{"shouldSpeak":true,"mood":"warm","reply":"先在这里等我。"}';
        }
        return "";
      });
      const oldTurn = runRoleplayChannelTurn({ channelId: 11, userId: 1, shouldAbort: () => cancelled });
      // 立即挂上拒绝处理，取消在等待期间抛错也不会形成未处理的拒绝。
      const oldResult = oldTurn.then(() => null, error => error);
      await started;
      h.setRoleplayChannelDirectorState.mockClear();
      cancelled = true;
      release(GOOD_REPLY);
      expect(await oldResult).toBeInstanceOf(RoleplayTurnCancelledError);
      expect(h.createRoleplayMessage).not.toHaveBeenCalled();
      expect(h.updateRoleplayMemberCursor).not.toHaveBeenCalled();
      expect(h.updateRoleplayChannelDiagnostics).not.toHaveBeenCalled();
      expect(h.setRoleplayChannelDirectorState).not.toHaveBeenCalled();

      // 旧任务退出后，同频道能够继续接收新的推进任务。
      mockTurnReplies([GOOD_REPLY]);
      const next = await runRoleplayChannelTurn({ channelId: 11, userId: 1 });
      expect(next.spoken).toBe(true);
      expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    },
  );

  it.each([1, 2])("停止发生在第 %s 拍插入期间：已保存事实进入诊断，回合仍取消且不再生成", async stopAtBeat => {
    let cancelled = false;
    let generated = 0;
    let inserted = 0;
    h.invoke.mockImplementation(async (params: any) => {
      if (params.options.usageContext?.route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (params.options.usageContext?.route === "roleplay.channel_turn") return generated++ === 0 ? GOOD_REPLY : SECOND_REPLY;
      return "";
    });
    h.createRoleplayMessage.mockImplementation(async () => {
      inserted++;
      if (inserted === stopAtBeat) cancelled = true;
      return { id: 99 + inserted };
    });
    h.getRoleplayChannelDirectorState.mockResolvedValue({
      arc: [{ title: "窗边", goal: "看雨" }], cursor: 0,
      lastUserSteer: MESSAGES[0].content, stallStreak: 0, recentBeats: [],
      plannedAtTurn: 0, turnCount: 0, storySummary: "", pinnedFacts: [],
    });
    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1, shouldAbort: () => cancelled }))
      .rejects.toBeInstanceOf(RoleplayTurnCancelledError);
    expect(generated).toBe(stopAtBeat);
    expect(latestDiagnostics().beats.map((beat: any) => beat.messageId)).toEqual(stopAtBeat === 1 ? [100] : [100, 101]);
    expect(latestDiagnostics().messageId).toBe(99 + stopAtBeat);
    expect(latestDiagnostics().skippedReason).toContain("本轮已停止");
    const state = h.setRoleplayChannelDirectorState.mock.calls.at(-1)?.[2];
    expect(state.recentBeats).toHaveLength(stopAtBeat);
    expect(state.turnCount).toBe(1);
    expect(h.updateRoleplayMemberCursor).toHaveBeenCalledTimes(stopAtBeat);
    expect(committedBeatTransactions).toHaveLength(stopAtBeat);
  });

  it("用户插话被尊重：最近一条用户消息作为【用户本轮创作方向】进入主生成提示词", async () => {
    mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(turnPrompts[0].user).toContain("【用户本轮创作方向】");
    expect(turnPrompts[0].user).toContain("继续，写具体一点");
  });

  it("首拍写入后停止仍在等待的续拍：导演与诊断已记录首拍，停止后没有补写", async () => {
    let stopped = false;
    let turnCount = 0;
    let signalSecond!: () => void;
    let releaseSecond!: (reply: string) => void;
    const secondStarted = new Promise<void>(resolve => { signalSecond = resolve; });
    const secondReply = new Promise<string>(resolve => { releaseSecond = resolve; });
    h.getRoleplayChannelDirectorState.mockResolvedValue({
      arc: [{ title: "窗边", goal: "看雨" }], cursor: 0,
      lastUserSteer: MESSAGES[0].content, stallStreak: 0, recentBeats: [],
      plannedAtTurn: 4, turnCount: 4, storySummary: "", pinnedFacts: [],
    });
    h.invoke.mockImplementation(async params => {
      const route = params.options.usageContext.route;
      if (route === "roleplay.channel_reflection") return '{"nextSpeakerHint":"same","mood":"warm"}';
      if (route !== "roleplay.channel_turn") return "";
      if (turnCount++ === 0) return GOOD_REPLY;
      signalSecond();
      return secondReply;
    });

    const run = runRoleplayChannelTurn({ channelId: 11, userId: 1, shouldAbort: () => stopped }).catch(error => error);
    await secondStarted;
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(h.updateRoleplayMemberCursor).toHaveBeenCalledTimes(1);
    expect(latestDiagnostics().beats.map((beat: any) => beat.messageId)).toEqual([99]);
    expect(h.setRoleplayChannelDirectorState.mock.calls.at(-1)?.[2]).toMatchObject({
      cursor: 1, turnCount: 5, recentBeats: [expect.stringContaining("台灯")],
    });
    const diagnosticsWrites = h.updateRoleplayChannelDiagnostics.mock.calls.length;
    const directorWrites = h.setRoleplayChannelDirectorState.mock.calls.length;
    stopped = true;
    releaseSecond(SECOND_REPLY);
    expect(await run).toBeInstanceOf(RoleplayTurnCancelledError);
    expect(h.createRoleplayMessage).toHaveBeenCalledTimes(1);
    expect(h.updateRoleplayChannelDiagnostics).toHaveBeenCalledTimes(diagnosticsWrites);
    expect(h.setRoleplayChannelDirectorState).toHaveBeenCalledTimes(directorWrites);
  });

  it("排除的用户插话不进入导演、反思或正文提示", async () => {
    const excluded = "不要把这个测试标记带入剧情";
    h.getRoleplayChannelMessages.mockResolvedValue([
      ...MESSAGES, { ...MESSAGES[0], id: 2, content: excluded, contextOverride: "excluded" },
    ]);
    mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1, generationRevision: 4 });

    for (const route of ["roleplay.channel_director_arc", "roleplay.channel_reflection", "roleplay.channel_turn"]) {
      const calls = h.invoke.mock.calls.map(([params]) => params).filter(params => params.options.usageContext.route === route);
      expect(calls.length).toBeGreaterThan(0);
      const prompt = JSON.stringify(calls.map(params => params.messages));
      expect(prompt).toContain(MESSAGES[0].content);
      expect(prompt).not.toContain(excluded);
    }
  });

  it("停止时辅助模型返回空正文，不再发起重试或写入", async () => {
    let stopped = false;
    const routes: string[] = [];
    h.invoke.mockImplementation(async params => {
      const route = params.options.usageContext.route;
      routes.push(route);
      if (route === "roleplay.channel_director_arc") stopped = true;
      return "";
    });

    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1, shouldAbort: () => stopped }))
      .rejects.toBeInstanceOf(RoleplayTurnCancelledError);
    expect(routes).toEqual(["roleplay.channel_director_arc"]);
    expect(h.createRoleplayMessage).not.toHaveBeenCalled();
    expect(h.updateRoleplayChannelDiagnostics).not.toHaveBeenCalled();
    expect(h.setRoleplayChannelDirectorState).not.toHaveBeenCalled();
  });

  it("上下文版本已改变时取消旧任务，未调用模型或保存", async () => {
    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1, generationRevision: 3 }))
      .rejects.toBeInstanceOf(RoleplayTurnCancelledError);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.createRoleplayMessage).not.toHaveBeenCalled();
  });

  it("生成已返回但行锁内的快照校验失败：不更新游标、诊断或导演进度", async () => {
    mockTurnReplies([GOOD_REPLY]);
    h.createRoleplayMessage.mockRejectedValueOnce(Object.assign(new Error("频道已被清空"), {
      name: "RoleplayGenerationChangedError",
    }));

    await expect(runRoleplayChannelTurn({ channelId: 11, userId: 1, generationRevision: 4 }))
      .rejects.toBeInstanceOf(RoleplayTurnCancelledError);
    expect(h.createRoleplayMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "persona" }), 4, expect.any(Object));
    expect(h.updateRoleplayMemberCursor).not.toHaveBeenCalled();
    expect(h.updateRoleplayChannelDiagnostics).not.toHaveBeenCalled();
    expect(h.setRoleplayChannelDirectorState).not.toHaveBeenCalled();
  });

  it("重启恢复：runtimeDiagnostics 的时空锚与已存导演线会被下一拍带回来（不重规划）", async () => {
    h.getRoleplayChannelById.mockResolvedValue({
      ...CHANNEL,
      runtimeDiagnostics: { reflection: { sceneAnchor: "深夜的书房，桌上摊着一张地图" } },
    } as any);
    h.getRoleplayChannelDirectorState.mockResolvedValue({
      arc: [{ title: "窗边", goal: "看雨" }], cursor: 0,
      // 用户引导没变，不触发重规划：验证"重启后沿用已存导演线"。
      lastUserSteer: MESSAGES[0].content, stallStreak: 0, recentBeats: [],
      plannedAtTurn: 0, turnCount: 0, storySummary: "", pinnedFacts: [],
    });
    mockTurnReplies([GOOD_REPLY]);

    await runRoleplayChannelTurn({ channelId: 11, userId: 1 });

    expect(h.getRoleplayChannelMessages).toHaveBeenCalled();
    expect(turnPrompts[0].user).toContain("深夜的书房，桌上摊着一张地图");
    expect(calledRoutes).not.toContain("roleplay.channel_director_arc");
    const state = h.setRoleplayChannelDirectorState.mock.calls.at(-1)?.[2];
    expect(state.cursor).toBe(1);
    expect(state.turnCount).toBe(1);
  });
});

