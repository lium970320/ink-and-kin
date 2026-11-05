import { beforeEach, describe, expect, it, vi } from "vitest";

let runtime: typeof import("./web-channel-advance");
const base = { channelId: 11, userId: 7, generationRevision: 4 };
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
    const oldRun = runtime.runWebChannelAdvanceTurn(first, "old", "", async shouldAbort => {
      const reply = await oldModel.promise;
      if (shouldAbort()) throw new runtime.WebChannelAdvanceCancelledError();
      return reply;
    }).catch(error => error);
    await Promise.resolve();
    runtime.stopWebChannelAdvance({ ...base, taskId: first.taskId });
    const second = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    const generateNew = vi.fn().mockResolvedValue("新回复");
    const newRun = runtime.runWebChannelAdvanceTurn(second, "new", "", generateNew);
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
    const oldRun = runtime.runWebChannelAdvanceTurn(first, "old", "", () => oldModel.promise).catch(error => error);
    await Promise.resolve();
    const second = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:2" })!;
    const generateNew = vi.fn().mockResolvedValue("不应生成");
    const newRun = runtime.runWebChannelAdvanceTurn(second, "new", "", generateNew).catch(error => error);
    runtime.stopWebChannelAdvance({ ...base, taskId: second.taskId });
    oldModel.resolve("旧回复");
    await oldRun;
    expect(await newRun).toBeInstanceOf(runtime.WebChannelAdvanceCancelledError);
    expect(generateNew).not.toHaveBeenCalled();
  });

  it("同任务同操作并发与完成后重试共享结果；同编号改参数拒绝，新编号独立生成", async () => {
    const task = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    const model = deferred<string>();
    const generate = vi.fn(() => model.promise);
    const duplicate = vi.fn().mockResolvedValue("不应生成");
    const first = runtime.runWebChannelAdvanceTurn(task, "beat-one", "[1,false]", generate);
    const concurrent = runtime.runWebChannelAdvanceTurn(task, "beat-one", "[1,false]", duplicate);
    await expect(runtime.runWebChannelAdvanceTurn(task, "beat-one", "[2,false]", duplicate)).rejects.toThrow("不同参数");
    model.resolve("第一拍");
    expect(await first).toBe("第一拍");
    expect(await concurrent).toBe("第一拍");
    expect(await runtime.runWebChannelAdvanceTurn(task, "beat-one", "[1,false]", duplicate)).toBe("第一拍");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(await runtime.runWebChannelAdvanceTurn(task, "beat-two", "[1,false]", () => Promise.resolve("第二拍"))).toBe("第二拍");
  });

  it("停止只等待已经进入的写入，不等待模型，返回后拒绝任何迟到的写入", async () => {
    const task = runtime.startWebChannelAdvance({ ...base, taskId: "client-one:1" })!;
    const entered = deferred<void>();
    const insert = deferred<void>();
    const model = deferred<void>();
    const written = vi.fn();
    const lateWrite = vi.fn().mockResolvedValue(undefined);
    const run = runtime.runWebChannelAdvanceTurn(task, "beat", "", async (_shouldAbort, save) => {
      await save(async () => {
        entered.resolve();
        await insert.promise;
        written();
      });
      await model.promise;
      await save(lateWrite);
    }).catch(error => error);
    await entered.promise;
    let stopReturned = false;
    const stop = runtime.stopWebChannelAdvanceAndWait({ ...base, taskId: task.taskId }).then(value => {
      stopReturned = true;
      return value;
    });
    expect(task.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(stopReturned).toBe(false);
    insert.resolve();
    expect(await stop).toBe(true);
    expect(written).toHaveBeenCalledTimes(1);
    model.resolve();
    expect(await run).toBeInstanceOf(runtime.WebChannelAdvanceCancelledError);
    expect(lateWrite).not.toHaveBeenCalled();
  });
});
