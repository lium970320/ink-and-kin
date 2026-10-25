import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
import { LLMService } from "./index";
import { ProviderRegistry } from "./provider-registry";
import { NO_CAPABILITIES, type LLMProvider } from "./types";
import { scopeProvider, withLlmRequestContext } from "./usage-context";
import { getLlmUsageDetails, getLlmUsageSnapshot, resetLlmUsageForTests, type LlmUsageRecord } from "./usage";
import { OpenAIProvider } from "./providers/openai";
const messages = [{ role: "user" as const, content: "不得写入用量的资料正文" }];
function fixture() {
  const records: LlmUsageRecord[] = []; const provider: LLMProvider = { name: "Test", maxAttempts: 1, capabilities: NO_CAPABILITIES, isConfigured: () => true, invoke: vi.fn(async () => "答复") };
  const registry = new ProviderRegistry(); registry.register(provider); registry.setDefault("Test"); mocks.resolve.mockResolvedValue(provider);
  const service = new LLMService(registry, record => { records.push(record); }, mocks.resolve); return { records, provider, service, registry };
}
beforeEach(() => { vi.clearAllMocks(); resetLlmUsageForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("每次逻辑调用的计量与取消", () => {
  it("ALS并发用户、阶段覆盖及退出后的无归属调用隔离", async () => {
    const { records, service } = fixture();
    await Promise.all([
      withLlmRequestContext({ userId: 17, personaId: 9, route: "pipeline", purpose: "skill_pipeline" }, () => service.invoke({ messages, options: { purpose: "persona_analysis" } })),
      withLlmRequestContext({ userId: 23, personaId: 10, route: "chat" }, () => service.invoke({ messages })),
    ]);
    expect(records.map(record => record.userId).sort()).toEqual([17, 23]);
    expect(records.find(record => record.userId === 17)).toMatchObject({ personaId: 9, route: "pipeline", purpose: "persona_analysis" });
    await service.invoke({ messages }); expect(records[2].userId).toBeUndefined(); expect(records).toHaveLength(3);
  });
  it("共享底层provider包装不能跨用户覆盖", async () => {
    const { service, provider, records } = fixture(); const owned = scopeProvider(provider, { userId: 17 });
    await expect(service.invokeWithProvider(owned, { messages, options: { usageContext: { userId: 23 } } })).rejects.toThrow("another user"); expect(records).toHaveLength(0);
    await expect(withLlmRequestContext({ userId: 23 }, () => service.invokeWithProvider(owned, { messages }))).rejects.toThrow("another user");
    await withLlmRequestContext({ userId: 17, route: "pipeline" }, () => service.invokeWithProvider(owned, { messages, options: { usageContext: { userId: undefined } } }));
    expect(records[0]).toMatchObject({ userId: 17, route: "pipeline" });
  });
  it("报告usage优先，失败和取消也保留一条脱敏记录", async () => {
    const { service, provider, records } = fixture();
    provider.invoke = vi.fn(async (_messages, options) => { options?.onUsage?.({ inputTokens: 7, outputTokens: 3, totalTokens: 10 }); return "不得落库的回答"; });
    await service.invokeForUser({ userId: 17, provider, messages }); expect(records[0]).toMatchObject({ success: true, totalTokens: 10, usageSource: "provider", attempts: 1 });
    provider.invoke = vi.fn().mockRejectedValue(new Error("private payload sk-test-secret"));
    await expect(service.invokeForUser({ userId: 17, provider, messages })).rejects.toMatchObject({ kind: "unknown" });
    const controller = new AbortController(); controller.abort();
    await expect(service.invokeForUser({ userId: 17, provider, messages, options: { signal: controller.signal } })).rejects.toMatchObject({ name: "AbortError" });
    expect(records[1]).toMatchObject({ status: "failed", error: "provider_error" }); expect(records[2]).toMatchObject({ status: "cancelled", attempts: 0, inputTokens: 0 });
    expect(JSON.stringify(records)).not.toMatch(/private payload|sk-test-secret|不得/);
  });
  it("流式输出后失败不重放，消费者关闭只计一次取消", async () => {
    const { service, provider, records } = fixture(); provider.maxAttempts = 3;
    provider.stream = vi.fn(async function* () { yield { text: "首段" }; throw new Error("HTTP 503 unavailable"); });
    await expect((async () => { for await (const _ of service.streamForUser({ userId: 17, provider, messages })) {} })()).rejects.toMatchObject({ kind: "transient" });
    expect(provider.stream).toHaveBeenCalledTimes(1); expect(records[0]).toMatchObject({ status: "failed", attempts: 1 });
    provider.stream = async function* () { yield { text: "首段" }; yield { text: "末段" }; };
    const stream = service.streamForUser({ userId: 17, provider, messages }); await stream.next(); await stream.return(undefined);
    expect(records).toHaveLength(2); expect(records[1]).toMatchObject({ status: "cancelled", error: "consumer_closed" });
  });
  it("OpenAI最终usage帧与实际返回模型只记录一次", async () => {
    const frames = [{ model: "reported-model", choices: [{ delta: { content: "答复" } }] }, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }];
    const separator = String.fromCharCode(10, 10);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(frames.map(frame => "data: " + JSON.stringify(frame)).join(separator) + separator + "data: [DONE]" + separator)));
    const { service, records } = fixture(); const provider = new OpenAIProvider("OpenAI", "own-key", "https://example.test/v1", "configured-model");
    for await (const _ of service.streamForUser({ userId: 17, provider, messages })) {}
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ totalTokens: 10, model: "reported-model", usageSource: "provider", attempts: 1 });
  });
  it("内存回退查询强制过滤时用户隔离，DB写失败不改变结果", async () => {
    const { provider, registry } = fixture(); const service = new LLMService(registry);
    await service.invokeForUser({ userId: 17, provider, messages }); await service.invokeForUser({ userId: 23, provider, messages });
    expect(getLlmUsageDetails({ userId: 17 }).records.map(record => record.userId)).toEqual([17]);
    expect(getLlmUsageSnapshot(new Date(), { userId: 23 }).today.calls).toBe(1);
    const failingSink = new LLMService(registry, async () => { throw new Error("DB private detail"); });
    await expect(failingSink.invokeForUser({ userId: 17, provider, messages })).resolves.toBe("答复");
  });
});

describe("实际路由用量元数据", () => {
  it("onRoute随实际HTTP切换末站，保留中文名和每次尝试顺序", async () => {
    const { service, provider, records } = fixture(); provider.reportsAttempts = true;
    provider.invoke = vi.fn(async (_messages, options) => {
      options?.onRoute?.({ provider: "主站", model: "primary-model", relayId: 101, reasoningEffort: "low" });
      options?.onAttempt?.(); options?.onUsage?.({ inputTokens: 3, outputTokens: 0 });
      options?.onRoute?.({ provider: "备用兼容站", model: "backup-model", relayId: 201, reasoningEffort: "xhigh" });
      options?.onAttempt?.(); options?.onUsage?.({ inputTokens: 5, outputTokens: 2 }); options?.onModel?.("reported-backup-model");
      return "最终答复";
    });
    await service.invokeForUser({ userId: 17, provider, messages });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ provider: "备用兼容站", model: "reported-backup-model", relayId: 201, reasoningEffort: "xhigh", attempts: 2,
      attemptedProviders: ["主站", "备用兼容站"], attemptedRelayIds: [101, 201], inputTokens: 8, outputTokens: 2, totalTokens: 10, usageSource: "provider" });
  });
  it("onRoute后取消但未发HTTP，不能把未调用站记成末站", async () => {
    const { service, provider, records } = fixture(); provider.reportsAttempts = true;
    provider.invoke = vi.fn(async (_messages, options) => {
      options?.onRoute?.({ provider: "Primary", model: "primary-model", relayId: 101 });
      options?.onAttempt?.(); options?.onUsage?.({ inputTokens: 3, outputTokens: 0 });
      options?.onRoute?.({ provider: "NeverCalled", model: "unused-model", relayId: 201 });
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    });
    await expect(service.invokeForUser({ userId: 17, provider, messages })).rejects.toMatchObject({ name: "AbortError" });
    expect(records[0]).toMatchObject({ status: "cancelled", provider: "Primary", model: "primary-model", relayId: 101, attempts: 1,
      attemptedProviders: ["Primary"], attemptedRelayIds: [101] });
  });
});
