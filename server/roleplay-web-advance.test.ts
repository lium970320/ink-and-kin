import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { RoleplayTurnCancelledError, runRoleplayChannelTurn } from "./social/roleplay-channel";

/**
 * 网页推进服务端合同（书中人第 5 批 5B）。
 *
 * 自用版这份测试还包含 QQ 镜像断言；书中人没有 QQ 交付，这里只保留网页生成链路：
 * 任务身份、归属校验、停止/取消、慢 start 竞争、旧单轮兼容，以及 advanceStatus
 * 在"没有 QQ 服务端推进"时的等价边界（归属校验后返回 null）。
 *
 * 任务表是 web-channel-advance 的模块级内存状态：每个用例换一个 channelId，
 * 避免上一条用例的任务串到下一条（与自用版测试同一做法）。
 */

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getRoleplayChannelById: vi.fn(),
}));
vi.mock("./social/roleplay-channel", () => ({
  runRoleplayChannelTurn: vi.fn(),
  RoleplayTurnCancelledError: class extends Error {},
}));

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      username: "test-user",
      passwordHash: null,
      openId: "test-open-id",
      email: null,
      name: "测试用户",
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

let nextChannelId = 1000;
let channelId: number;
const reply = {
  spoken: true,
  channelId: 0,
  personaId: 3,
  speakerName: "测试人物",
  replyText: "新回复",
  innerThought: "",
  emotionalState: "warm" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  channelId = ++nextChannelId;
  vi.mocked(db.getRoleplayChannelById).mockResolvedValue({ id: channelId } as any);
  vi.mocked(runRoleplayChannelTurn).mockResolvedValue({ ...reply, channelId });
});

describe("网页推进服务端合同", () => {
  it("登记任务后 tick 走角色频道生成，结束任务不影响已返回结果", async () => {
    const caller = appRouter.createCaller(makeCtx());
    expect(await caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:1" }))
      .toEqual({ started: true, cancelled: false });
    const result = await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId: "client-one:1" });
    expect(result.spoken).toBe(true);
    expect(result.replyText).toBe(reply.replyText);
    expect(runRoleplayChannelTurn).toHaveBeenCalledTimes(1);
    expect(runRoleplayChannelTurn).toHaveBeenCalledWith(expect.objectContaining({
      channelId,
      userId: 1,
      shouldAbort: expect.any(Function),
    }));
    expect(await caller.roleplay.finishWebAdvance({ channelId, taskId: "client-one:1" }))
      .toEqual({ finished: true });
  });

  it("任务管理入口均按当前用户验证频道所有权", async () => {
    vi.mocked(db.getRoleplayChannelById).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());
    for (const action of [
      () => caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:1" }),
      () => caller.roleplay.stopAdvance({ channelId, taskId: "client-one:1" }),
      () => caller.roleplay.finishWebAdvance({ channelId, taskId: "client-one:1" }),
      () => caller.roleplay.advanceStatus({ channelId }),
      () => caller.roleplay.tick({ operationId: randomUUID(), channelId }),
    ]) {
      await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(db.getRoleplayChannelById).toHaveBeenCalledWith(channelId, 1);
    expect(runRoleplayChannelTurn).not.toHaveBeenCalled();
  });

  it("advanceStatus 在归属校验后返回 null（书中人无 QQ 服务端推进）", async () => {
    const caller = appRouter.createCaller(makeCtx());
    expect(await caller.roleplay.advanceStatus({ channelId })).toBeNull();
    expect(db.getRoleplayChannelById).toHaveBeenCalledWith(channelId, 1);
  });

  it("指定停止后旧 tick 返回 cancelled，不再生成也不落库第二拍", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const taskId = "client-one:1";
    const model = deferred<typeof reply>();
    vi.mocked(runRoleplayChannelTurn).mockImplementationOnce(async options => {
      const result = await model.promise;
      if (options.shouldAbort?.()) throw new RoleplayTurnCancelledError();
      return { ...result, channelId };
    });
    expect(await caller.roleplay.startWebAdvance({ channelId, taskId })).toEqual({ started: true, cancelled: false });
    const pending = caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId });
    await vi.waitFor(() => expect(runRoleplayChannelTurn).toHaveBeenCalledTimes(1));
    expect(await caller.roleplay.stopAdvance({ channelId, taskId })).toEqual({ stopped: true });
    model.resolve({ ...reply, channelId });
    expect(await pending).toMatchObject({ spoken: false, cancelled: true, channelId, beats: [] });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId })).toMatchObject({ cancelled: true });
    expect(runRoleplayChannelTurn).toHaveBeenCalledTimes(1);
  });

  it("旧 start 等待权限查询时，新 start 先到；迟到旧请求被拒绝", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const access = deferred<any>();
    vi.mocked(db.getRoleplayChannelById).mockReturnValueOnce(access.promise);
    const oldStart = caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:1" });
    await vi.waitFor(() => expect(db.getRoleplayChannelById).toHaveBeenCalledTimes(1));
    expect(await caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:2" }))
      .toMatchObject({ started: true });
    access.resolve({ id: channelId });
    expect(await oldStart).toEqual({ started: false, cancelled: true });
    await caller.roleplay.finishWebAdvance({ channelId, taskId: "client-one:1" });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId: "client-one:2" })).toMatchObject({ spoken: true });
  });

  it("停止先于慢 start 权限查询返回时，该任务不能开始", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const access = deferred<any>();
    const taskId = "client-one:1";
    vi.mocked(db.getRoleplayChannelById).mockReturnValueOnce(access.promise);
    const start = caller.roleplay.startWebAdvance({ channelId, taskId });
    await vi.waitFor(() => expect(db.getRoleplayChannelById).toHaveBeenCalledTimes(1));
    await caller.roleplay.stopAdvance({ channelId, taskId });
    access.resolve({ id: channelId });
    expect(await start).toEqual({ started: false, cancelled: true });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId })).toMatchObject({ cancelled: true });
    expect(runRoleplayChannelTurn).not.toHaveBeenCalled();
  });

  it("没有任务编号的停止停止当前网页任务；跨频道/跨用户任务不受影响", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const otherCaller = appRouter.createCaller(makeCtx(2));
    const otherChannelId = ++nextChannelId;
    vi.mocked(db.getRoleplayChannelById).mockImplementation(async (id: number, userId: number) => ({ id, userId } as any));
    const taskId = "client-one:1";
    await caller.roleplay.startWebAdvance({ channelId, taskId });
    await otherCaller.roleplay.startWebAdvance({ channelId: otherChannelId, taskId });
    await caller.roleplay.startWebAdvance({ channelId, taskId: "client-two:1" });
    // 停止第一批（页面一）；页面二在另一个频道的任务仍在。
    expect(await caller.roleplay.stopAdvance({ channelId })).toEqual({ stopped: true });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId })).toMatchObject({ cancelled: true });
    expect(await otherCaller.roleplay.tick({ operationId: randomUUID(), channelId: otherChannelId, taskId })).toMatchObject({ spoken: true });
  });

  it("跨页面慢旧 start 不能覆盖后来已开始的另一页面任务", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const access = deferred<any>();
    vi.mocked(db.getRoleplayChannelById).mockReturnValueOnce(access.promise);
    const oldStart = caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:1" });
    await vi.waitFor(() => expect(db.getRoleplayChannelById).toHaveBeenCalledTimes(1));
    expect(await caller.roleplay.startWebAdvance({ channelId, taskId: "client-two:1" }))
      .toMatchObject({ started: true });
    access.resolve({ id: channelId });
    expect(await oldStart).toMatchObject({ started: false });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId: "client-two:1" })).toMatchObject({ spoken: true });
  });

  it("不带 taskId 的旧单轮接口也受停止约束，不能绕过生成门", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const model = deferred<typeof reply>();
    vi.mocked(runRoleplayChannelTurn).mockImplementationOnce(async options => {
      const result = await model.promise;
      if (options.shouldAbort?.()) throw new RoleplayTurnCancelledError();
      return { ...result, channelId };
    });
    const pending = caller.roleplay.tick({ operationId: randomUUID(), channelId });
    await vi.waitFor(() => expect(runRoleplayChannelTurn).toHaveBeenCalledTimes(1));
    await caller.roleplay.stopAdvance({ channelId });
    model.resolve({ ...reply, channelId });
    expect(await pending).toMatchObject({ cancelled: true });
  });

  it("旧单轮还在等待频道查询时，无编号停止也阻止其随后登记生成", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const access = deferred<any>();
    vi.mocked(db.getRoleplayChannelById).mockReturnValueOnce(access.promise);
    const pending = caller.roleplay.tick({ operationId: randomUUID(), channelId });
    await vi.waitFor(() => expect(db.getRoleplayChannelById).toHaveBeenCalledTimes(1));
    await caller.roleplay.stopAdvance({ channelId });
    access.resolve({ id: channelId });
    expect(await pending).toMatchObject({ cancelled: true });
    expect(runRoleplayChannelTurn).not.toHaveBeenCalled();
  });

  it("同一 taskId 重试不复活已结束任务；未知 taskId 直接 cancelled 且不生成", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const taskId = "client-one:1";
    await caller.roleplay.startWebAdvance({ channelId, taskId });
    await caller.roleplay.finishWebAdvance({ channelId, taskId });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId })).toMatchObject({ cancelled: true });
    expect(await caller.roleplay.tick({ operationId: randomUUID(), channelId, taskId: "client-one:9" })).toMatchObject({ cancelled: true });
    expect(runRoleplayChannelTurn).not.toHaveBeenCalled();
  });

  it("没有任务的停止返回 stopped:false；未开始的编号不会阻止新任务", async () => {
    const caller = appRouter.createCaller(makeCtx());
    expect(await caller.roleplay.stopAdvance({ channelId })).toEqual({ stopped: false });
    expect(await caller.roleplay.startWebAdvance({ channelId, taskId: "client-one:2" }))
      .toMatchObject({ started: true });
  });
});
