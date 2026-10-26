import { beforeEach, describe, expect, it, vi } from "vitest";

let runtime: typeof import("./web-channel-advance");
const base = { channelId: 11, userId: 7 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  runtime = await import("./web-channel-advance");
});

describe("网页推进任务身份", () => {
  it("停止后旧编号不能复活；新编号生效，旧 finish 不会清新任务", () => {
    const first = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    expect(runtime.stopWebChannelAdvance({ ...base, taskId: first.taskId })).toBe(true);
    const second = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    expect(runtime.startWebChannelAdvance({ ...base, taskId: first.taskId })).toBeNull();
    expect(runtime.finishWebChannelAdvance({ ...base, taskId: first.taskId })).toBe(false);
    expect(runtime.isCurrentWebChannelAdvanceTask(second)).toBe(true);
    expect(runtime.isCurrentWebChannelAdvanceTask(first)).toBe(false);
  });

  it("停止先于慢 start 登记到达，也拒绝迟到开始", () => {
    runtime.stopWebChannelAdvance({ ...base, taskId: "client-one:1" });
    expect(runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })).toBeNull();
    expect(runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })).not.toBeNull();
  });

  it("同一页面的新 start 先到时，旧 start 不得抢占；同编号重试不替换任务对象", () => {
    const current = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    expect(runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })).toBeNull();
    expect(runtime.startWebChannelAdvance({ ...base, taskId: current.taskId })).toBe(current);
  });

  it("任务编号按用户和频道隔离，同频道另一个页面新任务使旧任务失效", () => {
    const first = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    const otherUser = runtime.startWebChannelAdvance({ ...base, userId: 8, taskId: "client-one:1" })!;
    const otherChannel = runtime.startWebChannelAdvance({ ...base, channelId: 22, taskId: "client-one:1" })!;
    const secondPage = runtime.startWebChannelAdvance({ ...base, taskId: "client-two:1" })!;
    expect(runtime.isCurrentWebChannelAdvanceTask(first)).toBe(false);
    expect(runtime.isCurrentWebChannelAdvanceTask(secondPage)).toBe(true);
    runtime.stopWebChannelAdvance(base);
    expect(runtime.isCurrentWebChannelAdvanceTask(secondPage)).toBe(false);
    expect(runtime.isCurrentWebChannelAdvanceTask(otherUser)).toBe(true);
    expect(runtime.isCurrentWebChannelAdvanceTask(otherChannel)).toBe(true);
    expect(runtime.getWebChannelAdvanceTask({ ...base, taskId: secondPage.taskId })).toBeNull();
  });

  it("旧生成未返回时新任务等候，旧结果不交付，释放后仅新任务继续", async () => {
    const oldModel = deferred<string>();
    const first = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    const oldRun = runtime.runWebChannelAdvanceTurn(first, async shouldAbort => {
      const reply = await oldModel.promise;
      if (shouldAbort()) throw new runtime.WebChannelAdvanceCancelledError();
      return reply;
    }).catch(error => error);
    runtime.stopWebChannelAdvance({ ...base, taskId: first.taskId });
    const second = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    const generateNew = vi.fn().mockResolvedValue("新回复");
    const newRun = runtime.runWebChannelAdvanceTurn(second, generateNew);
    await Promise.resolve();
    expect(generateNew).not.toHaveBeenCalled();
    oldModel.resolve("旧回复");
    expect(await oldRun).toBeInstanceOf(runtime.WebChannelAdvanceCancelledError);
    expect(await newRun).toBe("新回复");
    expect(generateNew).toHaveBeenCalledTimes(1);
    expect(runtime.isCurrentWebChannelAdvanceTask(second)).toBe(true);
  });

  it("排队等待的任务也能停止，不调用其生成函数", async () => {
    const oldModel = deferred<string>();
    const first = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    const oldRun = runtime.runWebChannelAdvanceTurn(first, () => oldModel.promise).catch(error => error);
    const second = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    const generateNew = vi.fn().mockResolvedValue("不应生成");
    const newRun = runtime.runWebChannelAdvanceTurn(second, generateNew).catch(error => error);
    runtime.stopWebChannelAdvance({ ...base, taskId: second.taskId });
    oldModel.resolve("旧回复");
    await oldRun;
    expect(await newRun).toBeInstanceOf(runtime.WebChannelAdvanceCancelledError);
    expect(generateNew).not.toHaveBeenCalled();
  });
});
