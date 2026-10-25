import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMRequestError, type LLMFailureKind } from "./errors";
import { clearRelayHealth, isRelayCoolingDown, markRelayTransientFailure } from "./relay-health";
import { createRoutedProvider, type RoutedCandidate } from "./routing";
import type { LLMOptions, LLMProvider, LLMStreamChunk } from "./types";

const messages = [{ role: "user" as const, content: "请继续这段普通的虚构故事。" }];
const capabilities = { streaming: true, vision: false, tools: false, jsonMode: false };
function provider(name = "Primary") {
  return {
    name, capabilities: { ...capabilities }, reportsAttempts: false, isConfigured: () => true,
    getConfigSummary: () => ({ model: `${name}-model`, reasoningEffort: "xhigh", baseUrl: "https://example.invalid" }),
    invoke: vi.fn(async (_messages: unknown, _options?: LLMOptions) => `${name}回复`),
  };
}
function route(rows: RoutedCandidate[], hasFallback = false, userId = 1) {
  return createRoutedProvider(rows, { userId, requestedProvider: "Primary", hasFallback });
}
function candidate(value: LLMProvider, relayId = 1): RoutedCandidate { return { provider: value, providerName: value.name, relayId, priority: 100 }; }
async function collect(value: AsyncIterable<LLMStreamChunk>) {
  const chunks: string[] = [];
  for await (const chunk of value) chunks.push(chunk.text);
  return chunks;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { clearRelayHealth(); });
afterEach(() => { clearRelayHealth(); vi.useRealTimers(); });

describe("路由调用次数与错误边界", () => {
  it("单站无备用网络失败后只重试一次，包装器阻止外层叠加", async () => {
    const first = provider();
    first.invoke.mockRejectedValueOnce(new LLMRequestError("network"));
    const routed = route([candidate(first)]);
    const onAttempt = vi.fn(); const onRoute = vi.fn();
    await expect(routed.invoke(messages, { onAttempt, onRoute })).resolves.toBe("Primary回复");
    expect(routed.maxAttempts).toBe(1); expect(routed.reportsAttempts).toBe(true);
    expect(first.invoke).toHaveBeenCalledTimes(2); expect(onAttempt).toHaveBeenCalledTimes(2); expect(onRoute).toHaveBeenCalledTimes(2);
    expect(first.invoke.mock.calls[0][1]).toMatchObject({ requestTimeoutMs: 120000 });
    expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("多站每站一次，保留原排序后切备用", async () => {
    const first = provider(); const second = provider("Backup"); const third = provider("Unused");
    first.invoke.mockRejectedValue(new LLMRequestError("transient"));
    const rows = [{ ...candidate(first, 8), priority: 300 }, { ...candidate(second, 3), priority: 200 }, candidate(third, 1)];
    const onRoute = vi.fn();
    await expect(route(rows, true).invoke(messages, { onRoute })).resolves.toBe("Backup回复");
    expect(first.invoke).toHaveBeenCalledTimes(1); expect(second.invoke).toHaveBeenCalledTimes(1); expect(third.invoke).not.toHaveBeenCalled();
    expect(onRoute.mock.calls.map(([value]) => value.relayId)).toEqual([8, 3]);
    expect(rows.map(row => row.relayId)).toEqual([8, 3, 1]);
    expect(isRelayCoolingDown(1, 8)).toBe(true); expect(isRelayCoolingDown(2, 8)).toBe(false);
  });

  it("声明有备用但仅余一个候选时仍只调用一次", async () => {
    const first = provider(); first.invoke.mockRejectedValue(new LLMRequestError("rate_limit"));
    await expect(route([candidate(first)], true).invoke(messages)).rejects.toMatchObject({ kind: "rate_limit" });
    expect(first.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["safety", "auth", "permission", "invalid_request", "cancelled", "unknown"] as LLMFailureKind[])("%s立即终止，不换站、不记站点故障", async kind => {
    const first = provider(); const second = provider("Backup");
    first.invoke.mockRejectedValue(new LLMRequestError(kind));
    await expect(route([candidate(first), candidate(second, 2)], true).invoke(messages)).rejects.toMatchObject({ kind });
    expect(first.invoke).toHaveBeenCalledTimes(1); expect(second.invoke).not.toHaveBeenCalled();
    expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("原始未知异常不被当作网络故障换站", async () => {
    const first = provider(); const second = provider("Backup"); first.invoke.mockRejectedValue(new Error("Unexpected implementation failure"));
    await expect(route([candidate(first), candidate(second, 2)], true).invoke(messages)).rejects.toMatchObject({ kind: "unknown" });
    expect(second.invoke).not.toHaveBeenCalled();
  });

  it("报告真实动态提供商、模型与本站ID，不向摘要暴露地址", async () => {
    const first = { ...provider("DeepSeek"), getProviderName: () => "DeepSeek-Pro" };
    const routed = route([candidate(first, 7)]); const onRoute = vi.fn();
    await routed.invoke(messages, { onRoute });
    expect(onRoute).toHaveBeenCalledWith({ provider: "DeepSeek-Pro", model: "DeepSeek-model", relayId: 7, reasoningEffort: "xhigh" });
    expect(routed.getConfigSummary?.()).toEqual({ model: "DeepSeek-model", reasoningEffort: "xhigh" });
    expect(JSON.stringify(routed.getConfigSummary?.())).not.toContain("example.invalid");
  });

  it("协议提供商自行报告多个实际HTTP尝试时，包装器不重复计数", async () => {
    const first = { ...provider(), reportsAttempts: true };
    first.invoke.mockImplementation(async (_messages, options) => { options?.onAttempt?.(); options?.onAttempt?.(); return "协议兼容后回复"; });
    const onAttempt = vi.fn();
    await route([candidate(first)]).invoke(messages, { onAttempt });
    expect(onAttempt).toHaveBeenCalledTimes(2); expect(first.invoke).toHaveBeenCalledTimes(1);
  });

  it("没有候选明确报配置错误", async () => {
    const routed = route([]);
    expect(routed.isConfigured()).toBe(false);
    await expect(routed.invoke(messages)).rejects.toMatchObject({ kind: "invalid_request" });
  });
});

describe("逐次超时与外部取消", () => {
  it("忽略signal的提供商也在两分钟超时后换站，超时归网络故障", async () => {
    vi.useFakeTimers();
    const first = provider(); const second = provider("Backup");
    first.invoke.mockImplementation(() => new Promise<string>(() => {}));
    const promise = route([candidate(first), candidate(second, 2)], true).invoke(messages);
    await vi.advanceTimersByTimeAsync(120000);
    await expect(promise).resolves.toBe("Backup回复");
    expect(first.invoke.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(isRelayCoolingDown(1, 1)).toBe(true); expect(first.invoke).toHaveBeenCalledTimes(1);
  });

  it("外部取消立即结束挂起调用，不换站也不标故障", async () => {
    const controller = new AbortController(); const entered = deferred<void>();
    const first = provider(); const second = provider("Backup");
    first.invoke.mockImplementation(() => { entered.resolve(); return new Promise<string>(() => {}); });
    const promise = route([candidate(first), candidate(second, 2)], true).invoke(messages, { signal: controller.signal });
    const result = expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    await entered.promise; controller.abort(); await result;
    expect(second.invoke).not.toHaveBeenCalled(); expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("开始前或onRoute中取消，均不产生调用与尝试计数", async () => {
    const first = provider(); const controller = new AbortController(); const onAttempt = vi.fn();
    const routed = route([candidate(first)]);
    await expect(routed.invoke(messages, { signal: controller.signal, onAttempt, onRoute: () => controller.abort() })).rejects.toMatchObject({ kind: "cancelled" });
    await expect(routed.invoke(messages, { signal: controller.signal, onAttempt })).rejects.toMatchObject({ kind: "cancelled" });
    expect(first.invoke).not.toHaveBeenCalled(); expect(onAttempt).not.toHaveBeenCalled();
  });
});

describe("流式正文与关闭边界", () => {
  it("只有空chunk时允许暂态换站，不重复任何正文", async () => {
    const first = { ...provider(), stream: vi.fn(async function* () { yield { text: "" }; throw new LLMRequestError("network"); }) };
    const second = { ...provider("Backup"), stream: vi.fn(async function* () { yield { text: "备用正文" }; }) };
    await expect(collect(route([candidate(first), candidate(second, 2)], true).stream!(messages))).resolves.toEqual(["", "备用正文"]);
    expect(first.stream).toHaveBeenCalledTimes(1); expect(second.stream).toHaveBeenCalledTimes(1);
  });

  it("输出任何非空正文后不重试不换站，包括单个空格", async () => {
    const first = { ...provider(), stream: vi.fn(async function* () { yield { text: " " }; throw new LLMRequestError("network"); }) };
    const second = provider("Backup"); const seen: string[] = [];
    const task = (async () => { for await (const chunk of route([candidate(first), candidate(second, 2)], true).stream!(messages)) seen.push(chunk.text); })();
    await expect(task).rejects.toMatchObject({ kind: "network" });
    expect(seen).toEqual([" "]); expect(first.stream).toHaveBeenCalledTimes(1); expect(second.invoke).not.toHaveBeenCalled();
  });

  it("流内内容策略拒绝立即停止，不降级", async () => {
    const first = { ...provider(), stream: vi.fn(async function* () { throw new LLMRequestError("safety"); yield { text: "不可达" }; }) };
    const second = provider("Backup");
    await expect(collect(route([candidate(first), candidate(second, 2)], true).stream!(messages))).rejects.toMatchObject({ kind: "safety" });
    expect(second.invoke).not.toHaveBeenCalled(); expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("消费方return会中止HTTP信号并关闭内层生成器", async () => {
    let closed = false; let signal: AbortSignal | undefined;
    const first = { ...provider(), stream: vi.fn(async function* (_messages: unknown, options?: LLMOptions) {
      signal = options?.signal;
      try { yield { text: "第一段" }; yield { text: "后续段" }; } finally { closed = true; }
    }) };
    const second = provider("Backup");
    const iterator = route([candidate(first), candidate(second, 2)], true).stream!(messages)[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: { text: "第一段" }, done: false });
    await iterator.return!(); await Promise.resolve();
    expect(signal?.aborted).toBe(true); expect(closed).toBe(true); expect(second.invoke).not.toHaveBeenCalled();
    expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("消费方return也能结束一个忽略signal的挂起next", async () => {
    const entered = deferred<void>(); let signal: AbortSignal | undefined;
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const first = { ...provider(), stream: vi.fn((_messages: unknown, options?: LLMOptions): AsyncIterable<LLMStreamChunk> => {
      signal = options?.signal;
      return { [Symbol.asyncIterator]: () => ({ next: () => { entered.resolve(); return new Promise<IteratorResult<LLMStreamChunk>>(() => {}); }, return: close }) };
    }) };
    const second = provider("Backup");
    const iterator = route([candidate(first), candidate(second, 2)], true).stream!(messages)[Symbol.asyncIterator]();
    const pending = iterator.next(); await entered.promise; await iterator.return!();
    expect(await pending).toMatchObject({ done: true }); expect(close).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true); expect(second.invoke).not.toHaveBeenCalled(); expect(isRelayCoolingDown(1, 1)).toBe(false);
  });

  it("无流式接口的候选可返回一个文本chunk，尝试计数一次", async () => {
    const first = provider(); const onAttempt = vi.fn();
    expect(await collect(route([candidate(first)]).stream!(messages, { onAttempt }))).toEqual(["Primary回复"]);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("流式超时在正文前可换站，实际协议计数不会重复", async () => {
    vi.useFakeTimers();
    const first = { ...provider(), reportsAttempts: true, stream: vi.fn((_messages: unknown, options?: LLMOptions): AsyncIterable<LLMStreamChunk> => ({
      [Symbol.asyncIterator]: () => ({ next: () => { options?.onAttempt?.(); return new Promise<IteratorResult<LLMStreamChunk>>(() => {}); } }),
    })) };
    const second = provider("Backup"); const onAttempt = vi.fn();
    const task = collect(route([candidate(first), candidate(second, 2)], true).stream!(messages, { onAttempt }));
    await vi.advanceTimersByTimeAsync(120000);
    await expect(task).resolves.toEqual(["Backup回复"]); expect(onAttempt).toHaveBeenCalledTimes(2);
  });
});

describe("全部站点冷却时的有界探测", () => {
  it("一次只探测一个站且不做单站二次重试，租约后可探测另一站", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
    markRelayTransientFailure(1, 1); markRelayTransientFailure(1, 2);
    const first = provider(); const second = provider("Backup");
    first.invoke.mockRejectedValue(new LLMRequestError("network"));
    const routed = route([candidate(first), candidate(second, 2)], true);
    await expect(routed.invoke(messages)).rejects.toMatchObject({ kind: "network" });
    await expect(routed.invoke(messages)).rejects.toMatchObject({ kind: "transient" });
    expect(first.invoke).toHaveBeenCalledTimes(1); expect(second.invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120001);
    await expect(routed.invoke(messages)).resolves.toBe("Backup回复");
    expect(second.invoke).toHaveBeenCalledTimes(1);
  });
});
