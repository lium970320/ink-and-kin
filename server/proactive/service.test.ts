import { describe, expect, it, vi } from "vitest";
import { validateSettings } from "./policy";
import { createProactiveService } from "./service";
import type { ProactiveClaim, ProactiveEnqueue, ProactiveJob, ProactivePolicy, ProactiveRepository, ProactiveDispatchSnapshot } from "./types";

const at = (time: string) => new Date(time);

function fixture(time = "2026-11-06T12:00:00Z", settings: Partial<ProactivePolicy> = {}) {
  let currentTime = at(time);
  const policy: ProactivePolicy = {
    ...validateSettings({ enabled: true, timeZone: "UTC", quietHours: "00:00-00:00" }),
    userId: 7, personaId: 11, revision: 1, qqConsent: null, ...settings,
  };
  const repo = {
    getPolicy: vi.fn<ProactiveRepository["getPolicy"]>().mockResolvedValue(policy),
    listEnabled: vi.fn<ProactiveRepository["listEnabled"]>().mockResolvedValue([policy]),
    enqueue: vi.fn<ProactiveRepository["enqueue"]>().mockResolvedValue(null),
    pending: vi.fn<ProactiveRepository["pending"]>().mockResolvedValue([]),
    claim: vi.fn<ProactiveRepository["claim"]>().mockResolvedValue(null),
    saveText: vi.fn<ProactiveRepository["saveText"]>().mockResolvedValue(true),
    deliverWeb: vi.fn<ProactiveRepository["deliverWeb"]>().mockResolvedValue(true),
    failBeforeDispatch: vi.fn<ProactiveRepository["failBeforeDispatch"]>().mockResolvedValue(undefined),
  };
  const beforeGenerate = vi.fn<(claim: ProactiveClaim, signal: AbortSignal) => Promise<ProactiveDispatchSnapshot | void>>().mockResolvedValue(undefined);
  const generate = vi.fn<(claim: ProactiveClaim, signal: AbortSignal) => Promise<string>>().mockResolvedValue("  一条主动消息。  ");
  const deliverQq = vi.fn<(claim: ProactiveClaim, signal: AbortSignal, snapshot?: ProactiveDispatchSnapshot) => Promise<void>>().mockResolvedValue(undefined);
  const service = createProactiveService({ repo, beforeGenerate, generate, deliverQq, now: () => currentTime });

  function job(input: Partial<ProactiveEnqueue> = {}): ProactiveJob {
    return {
      id: 19, userId: policy.userId, personaId: policy.personaId, policyRevision: policy.revision,
      kind: "followup", triggerKey: "followup:example", topic: "继续谈故事",
      dueAt: currentTime, expiresAt: new Date(+currentTime + 15 * 60_000),
      ...input, status: "pending", text: null, claimToken: null, attemptedAt: null, localDay: null,
      reason: null, remoteMessageId: null, readAt: null, unknownAcknowledgedAt: null, cancelRequestedAt: null, createdAt: currentTime, updatedAt: currentTime,
    };
  }

  function claimJob(pending: ProactiveJob = job()): ProactiveClaim {
    const claim: ProactiveClaim = { job: { ...pending, status: "generating", claimToken: "claim" }, policy: { ...policy }, token: "claim" };
    repo.pending.mockResolvedValueOnce([pending]);
    repo.claim.mockResolvedValueOnce(claim);
    return claim;
  }

  return { service, repo, policy, beforeGenerate, generate, deliverQq, job, claimJob, setNow: (value: string) => { currentTime = at(value); } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("审查发现的调度边界", () => {
  it("把模型生成前的绑定与路由快照原样交给最终派发", async () => {
    const f = fixture(undefined, { delivery: "qq" });
    f.claimJob();
    const snapshot = { configId: 3, generation: 7, routeRevision: 9 };
    f.beforeGenerate.mockResolvedValueOnce(snapshot);
    await f.service.sweep();
    expect(f.deliverQq).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), snapshot);
  });
  it("首50个候选不可领取时继续扫描后续候选", async () => {
    const f = fixture();
    const blocked = Array.from({ length: 50 }, (_, i) => ({ ...f.job(), id: i + 1 }));
    const later = { ...f.job(), id: 51 };
    f.repo.pending.mockResolvedValueOnce(blocked).mockResolvedValueOnce([later]);
    f.repo.claim.mockImplementation(async job => job.id === 51
      ? { job: { ...job, status: "generating", claimToken: "later" }, policy: f.policy, token: "later" }
      : null);
    await f.service.sweep();
    expect(f.repo.pending.mock.calls[1][2]).toBe(50);
    expect(f.repo.deliverWeb).toHaveBeenCalledOnce();
  });
});

describe("主动调度的本地槽位", () => {
  it("回拨时两次出现的同一钟点使用相同键，即使设置版本变化", async () => {
    const f = fixture("2026-11-01T05:34:12Z", { timeZone: "America/New_York", times: ["01:30"] });
    await f.service.sweep();
    f.policy.revision = 2;
    f.setNow("2026-11-01T06:34:12Z");
    await f.service.sweep();
    expect(f.repo.enqueue.mock.calls).toEqual([
      [7, 11, { kind: "scheduled", policyRevision: 1, triggerKey: "scheduled:2026-11-01:01:30", dueAt: at("2026-11-01T05:30:00Z"), expiresAt: at("2026-11-01T05:45:00Z") }],
      [7, 11, { kind: "scheduled", policyRevision: 2, triggerKey: "scheduled:2026-11-01:01:30", dueAt: at("2026-11-01T06:30:00Z"), expiresAt: at("2026-11-01T06:45:00Z") }],
    ]);
  });

  it("快进时不存在的钟点不补发", async () => {
    const f = fixture("2026-03-08T07:08:00Z", { timeZone: "America/New_York", times: ["02:55", "03:00"] });
    await f.service.sweep();
    expect(f.repo.enqueue).toHaveBeenCalledTimes(1);
    expect(f.repo.enqueue).toHaveBeenCalledWith(7, 11, expect.objectContaining({ triggerKey: "scheduled:2026-03-08:03:00" }));
  });

  it("午夜截断补发窗口，跳过未来和已满 15 分钟的槽位", async () => {
    const f = fixture("2026-11-06T15:58:45Z", { timeZone: "Asia/Shanghai", times: ["23:43", "23:55", "23:59"] });
    await f.service.sweep();
    expect(f.repo.enqueue.mock.calls).toEqual([
      [7, 11, { kind: "scheduled", policyRevision: 1, triggerKey: "scheduled:2026-11-06:23:55", dueAt: at("2026-11-06T15:55:00Z"), expiresAt: at("2026-11-06T16:00:00Z") }],
    ]);
    f.setNow("2026-11-06T16:01:00Z");
    await f.service.sweep();
    expect(f.repo.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("主动调度的执行边界", () => {
  it("同一实例的并发轮询共用一轮，只生成和投递一次", async () => {
    const f = fixture();
    const claim = f.claimJob();
    const first = f.service.sweep();
    expect(f.service.sweep()).toBe(first);
    await first;
    await f.service.sweep();
    expect(f.repo.listEnabled).toHaveBeenCalledTimes(2);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const signal = f.generate.mock.calls[0][1];
    expect(f.repo.saveText.mock.calls).toEqual([[claim, "一条主动消息。", at("2026-11-06T12:00:00Z"), signal]]);
    expect(f.repo.deliverWeb.mock.calls).toEqual([[claim, at("2026-11-06T12:00:00Z"), signal]]);
    expect(f.deliverQq).not.toHaveBeenCalled();
  });

  it("读取到旧待办后若策略已关闭，仓储拒绝领取就不生成", async () => {
    const f = fixture(undefined, { enabled: false, times: ["12:00"] });
    const stale = f.job();
    f.repo.pending.mockResolvedValueOnce([stale]);
    await f.service.sweep();
    expect(f.repo.enqueue).not.toHaveBeenCalled();
    expect(f.repo.claim).toHaveBeenCalledWith(stale, at("2026-11-06T12:00:00Z"));
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("生成后若旧认领被取消，仓储拒绝保存就不派发", async () => {
    const f = fixture(undefined, { delivery: "qq" });
    f.claimJob();
    f.repo.saveText.mockResolvedValueOnce(false);
    await f.service.sweep();
    expect(f.repo.saveText).toHaveBeenCalledTimes(1);
    expect(f.deliverQq).not.toHaveBeenCalled();
    expect(f.repo.deliverWeb).not.toHaveBeenCalled();
  });

  it("模型返回前任务到期，不保存生成结果、不投递", async () => {
    const f = fixture();
    const claim = f.claimJob();
    f.generate.mockImplementationOnce(async () => {
      f.setNow(claim.job.expiresAt.toISOString());
      return "已过期的内容";
    });
    await f.service.sweep();
    expect(f.repo.failBeforeDispatch.mock.calls).toEqual([[claim, "generation_expired"]]);
    expect(f.repo.saveText).not.toHaveBeenCalled();
    expect(f.repo.deliverWeb).not.toHaveBeenCalled();
  });

  it("停止时通知生成中的模型，模型即使忽略中断也无法保存或派发", async () => {
    const f = fixture(undefined, { delivery: "qq" });
    const claim = f.claimJob();
    const started = deferred<AbortSignal>();
    const response = deferred<string>();
    f.generate.mockImplementationOnce((_claim, signal) => {
      started.resolve(signal);
      return response.promise;
    });
    const running = f.service.sweep();
    const signal = await started.promise;
    f.service.stop();
    expect(signal.aborted).toBe(true);
    response.resolve("停止之后才返回");
    await running;
    await f.service.sweep();
    expect(f.repo.listEnabled).toHaveBeenCalledTimes(1);
    expect(f.repo.failBeforeDispatch.mock.calls).toEqual([[claim, "scheduler_stopped"]]);
    expect(f.repo.saveText).not.toHaveBeenCalled();
    expect(f.deliverQq).not.toHaveBeenCalled();
  });

  it("停止时向等待保存的仓储传递取消信号，并拦住后续投递", async () => {
    const f = fixture();
    const claim = f.claimJob();
    const entered = deferred<AbortSignal | undefined>();
    const saved = deferred<boolean>();
    f.repo.saveText.mockImplementationOnce((_claim, _text, _now, signal) => {
      entered.resolve(signal);
      return saved.promise;
    });
    const running = f.service.sweep();
    const signal = await entered.promise;
    f.service.stop();
    expect(signal?.aborted).toBe(true);
    saved.resolve(true);
    await running;
    expect(f.repo.failBeforeDispatch.mock.calls).toEqual([[claim, "scheduler_stopped"]]);
    expect(f.repo.deliverWeb).not.toHaveBeenCalled();
  });

  it("QQ 接管后失败不写派发前失败，也不会重试或切到站内", async () => {
    const f = fixture(undefined, { delivery: "qq" });
    const claim = f.claimJob();
    f.deliverQq.mockRejectedValueOnce(new Error("发送结果未知"));
    await expect(f.service.sweep()).rejects.toThrow("发送结果未知");
    await f.service.sweep();
    expect(f.deliverQq.mock.calls).toEqual([[
      { ...claim, job: { ...claim.job, status: "ready", text: "一条主动消息。" } },
      f.generate.mock.calls[0][1],
      undefined,
    ]]);
    expect(f.repo.failBeforeDispatch).not.toHaveBeenCalled();
    expect(f.repo.deliverWeb).not.toHaveBeenCalled();
  });

  it("预检或生成失败只记受控原因，不再调用下一步", async () => {
    const f = fixture();
    const first = f.claimJob();
    const next = f.claimJob({ ...f.job(), id: 20 });
    f.beforeGenerate.mockRejectedValueOnce(new Error("预检原始错误"));
    f.generate.mockRejectedValueOnce(new Error("模型原始错误"));
    await f.service.sweep();
    await f.service.sweep();
    await f.service.sweep();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.repo.failBeforeDispatch.mock.calls).toEqual([[first, "preflight_rejected"], [next, "model_failed"]]);
    expect(f.repo.saveText).not.toHaveBeenCalled();
    expect(f.repo.deliverWeb).not.toHaveBeenCalled();
  });
});

describe("环境触发只排队", () => {
  it("独立开关和免打扰均可阻止入队，同一小时的键与策略版本和间隔设置无关", async () => {
    const f = fixture("2026-11-06T12:50:30Z");
    expect(await f.service.enqueueAmbient(7, 11)).toEqual({ queued: false, reason: "disabled" });
    f.policy.ambientEnabled = true;
    f.policy.quietHours = "12:00-13:00";
    expect(await f.service.enqueueAmbient(7, 11)).toEqual({ queued: false, reason: "quiet_hours" });
    expect(f.repo.enqueue).not.toHaveBeenCalled();
    f.policy.quietHours = "00:00-00:00";
    f.repo.enqueue.mockResolvedValueOnce(f.job({ kind: "ambient", topic: null }));
    expect(await f.service.enqueueAmbient(7, 11)).toEqual({ queued: true });
    f.policy.revision = 2;
    f.policy.minIntervalMinutes = 5;
    f.setNow("2026-11-06T12:59:59Z");
    expect(await f.service.enqueueAmbient(7, 11)).toEqual({ queued: false, reason: "not_queued" });
    expect(f.repo.enqueue.mock.calls).toEqual([
      [7, 11, { kind: "ambient", policyRevision: 1, triggerKey: "ambient:2026-11-06:12", dueAt: at("2026-11-06T12:50:30Z"), expiresAt: at("2026-11-06T13:05:30Z") }],
      [7, 11, { kind: "ambient", policyRevision: 2, triggerKey: "ambient:2026-11-06:12", dueAt: at("2026-11-06T12:59:59Z"), expiresAt: at("2026-11-06T13:14:59Z") }],
    ]);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
