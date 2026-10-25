import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configs: vi.fn(), relays: vi.fn() }));
vi.mock("../db", () => ({ getLlmConfigsByUserId: mocks.configs, getLlmRelaysByUserId: mocks.relays }));
vi.mock("../_core/crypto", () => ({ decryptIfEncrypted: async (value: string | null) => value?.startsWith("v1:") ? null : value }));
import { resolveProviderForUser, resolveSingleProviderForUser, invalidateUserProviderCache } from "./user-provider";
import { registry } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { getUsageContext } from "./usage-context";
const parent = { id: 1, userId: 17, providerName: "OpenAI", isDefault: true, apiKey: "own-parent-key", apiKeyHint: "-key", baseUrl: "https://parent.example.test/v1", model: "parent-model", systemMessage: null, extraConfig: { reasoningEffort: "high" } };
const relay = { id: 101, llmConfigId: 1, userId: 17, providerName: "OpenAI", relayName: "示例站", enabled: true, priority: 100, apiKey: "own-relay-key", apiKeyHint: "-key", baseUrl: "https://relay.example.test/v1", model: "relay-model", reasoningEffort: null, extraConfig: null };
const original = registry.getBaseConfig("OpenAI");
beforeEach(() => {
  vi.clearAllMocks(); invalidateUserProviderCache(); mocks.configs.mockResolvedValue([parent]); mocks.relays.mockResolvedValue([]);
  registry.registerFactory("OpenAI", cfg => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""), { apiKey: "deployment-shared-key", baseUrl: "https://trusted.example.test/v1", model: "trusted-model" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "答复" } }] })));
});
afterEach(() => { vi.unstubAllGlobals(); if (original) registry.registerFactory("OpenAI", cfg => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""), original); });
const messages = [{ role: "user" as const, content: "普通请求" }];
const requestBody = () => JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
describe("用户配置与站级安全适配", () => {
  it("自定端点没有自己的key时绝不借共享ENV key", async () => {
    mocks.configs.mockResolvedValue([{ ...parent, apiKey: null }]);
    await expect(resolveProviderForUser({ userId: 17, providerName: "OpenAI" })).rejects.toMatchObject({ kind: "auth" }); expect(fetch).not.toHaveBeenCalled();
    mocks.configs.mockResolvedValue([{ ...parent, apiKey: "v1:invalid", baseUrl: null }]);
    await expect(resolveProviderForUser({ userId: 17, providerName: "OpenAI" })).rejects.toMatchObject({ kind: "auth" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("完全没有用户配置时保留可信环境默认，仍独立标记用户", async () => {
    mocks.configs.mockResolvedValue([]); const a = await resolveProviderForUser({ userId: 17, providerName: "OpenAI" }); const b = await resolveProviderForUser({ userId: 23, providerName: "OpenAI" });
    expect(a).not.toBe(b); expect(getUsageContext(a!)).toEqual({ userId: 17 }); expect(getUsageContext(b!)).toEqual({ userId: 23 });
    await a!.invoke(messages); expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://trusted.example.test/v1/chat/completions");
  });
  it("只取本用户最高优先启用站，null继承provider推理", async () => {
    mocks.relays.mockResolvedValue([relay, { ...relay, id: 102, priority: 120, model: "highest-model" }, { ...relay, id: 103, priority: 150, enabled: false }]);
    const provider = await resolveProviderForUser({ userId: 17, providerName: "OpenAI" }); await provider!.invoke(messages);
    expect(provider!.getRelayId?.()).toBe(102); expect(requestBody()).toMatchObject({ model: "highest-model", reasoning_effort: "high" });
    expect(mocks.relays).toHaveBeenCalledWith(17, "OpenAI");
    expect((vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer own-relay-key");
  });
  it("站级xhigh覆盖provider，配置变化参与缓存指纹", async () => {
    mocks.relays.mockResolvedValue([{ ...relay, reasoningEffort: "xhigh" }]);
    const first = await resolveProviderForUser({ userId: 17 }); await first!.invoke(messages); expect(requestBody().reasoning_effort).toBe("xhigh");
    mocks.relays.mockResolvedValue([{ ...relay, reasoningEffort: "low" }]); const second = await resolveProviderForUser({ userId: 17 }); await second!.invoke(messages);
    expect(first).not.toBe(second); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).reasoning_effort).toBe("low");
  });
  it("最高站缺密钥不能退父key、下一站或共享环境", async () => {
    mocks.relays.mockResolvedValue([{ ...relay, priority: 120, apiKey: null }, { ...relay, id: 102, priority: 100 }]);
    await expect(resolveProviderForUser({ userId: 17 })).rejects.toMatchObject({ kind: "auth" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("用户自定义OpenAI兼容名保持模型和四档配置", async () => {
    mocks.configs.mockResolvedValue([{ ...parent, providerName: "兼容站", extraConfig: { reasoningEffort: "xhigh" } }]);
    const provider = await resolveProviderForUser({ userId: 17, providerName: "兼容站" }); await provider!.invoke(messages);
    expect(provider!.name).toBe("兼容站"); expect(requestBody()).toMatchObject({ model: "parent-model", reasoning_effort: "max" });
  });
});

describe("主备解析与单站probe合同", () => {
  it("同provider优先序完成后才进一级备用，不递归备用配置", async () => {
    const backup = { ...parent, id: 2, providerName: "Claude", isDefault: false, apiKey: "owned-backup-key", baseUrl: "https://backup.example.test", model: "claude-test", extraConfig: { fallbackProvider: "Grok" } };
    mocks.configs.mockResolvedValue([{ ...parent, extraConfig: { fallbackProvider: "Claude" } }, backup]);
    mocks.relays.mockImplementation(async (_userId: number, name: string) => name === "Claude"
      ? [{ ...relay, id: 201, providerName: "Claude", baseUrl: backup.baseUrl, model: backup.model, apiKey: backup.apiKey }]
      : [{ ...relay, baseUrl: "https://lower.example.test/v1" }, { ...relay, id: 102, priority: 120, baseUrl: "https://higher.example.test/v1" }]);
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("backup.example.test")
      ? Response.json({ content: [{ type: "text", text: "备用答复" }] }) : new Response("temporary", { status: 503 })));
    const provider = await resolveProviderForUser({ userId: 17, providerName: "OpenAI" });
    await expect(provider!.invoke(messages)).resolves.toBe("备用答复");
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      "https://higher.example.test/v1/chat/completions", "https://lower.example.test/v1/chat/completions", "https://backup.example.test/v1/messages",
    ]);
    expect(mocks.relays.mock.calls.map(call => call[1])).toEqual(["OpenAI", "Claude"]);
  });
  it("主备同名只解析一次，坏备用配置在任何HTTP前终止", async () => {
    mocks.configs.mockResolvedValue([{ ...parent, extraConfig: { fallbackProvider: "openai" } }]); mocks.relays.mockResolvedValue([relay]);
    await resolveProviderForUser({ userId: 17, providerName: "OpenAI" }); expect(mocks.relays).toHaveBeenCalledTimes(1);
    mocks.relays.mockClear();
    mocks.configs.mockResolvedValue([{ ...parent, extraConfig: { fallbackProvider: "Claude" } }, { ...parent, id: 2, providerName: "Claude", isDefault: false }]);
    mocks.relays.mockImplementation(async (_id: number, name: string) => name === "Claude" ? [{ ...relay, id: 201, providerName: "Claude", apiKey: "v1:broken" }] : [relay]);
    await expect(resolveProviderForUser({ userId: 17 })).rejects.toMatchObject({ kind: "auth" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("保存值相同的probe使用全链策略，草稿和停用站只一次", async () => {
    mocks.relays.mockResolvedValue([relay]);
    const input = { userId: 17, providerName: "OpenAI", relayId: relay.id, baseUrl: relay.baseUrl, model: relay.model, apiKey: "", reasoningEffort: null };
    const same = await resolveSingleProviderForUser(input);
    expect(same).toMatchObject({ reflectsCurrentChatRoute: true, relayEnabled: true, maxAttempts: 2 });
    expect(getUsageContext(same.provider)).toEqual({ userId: 17 });
    mocks.relays.mockResolvedValue([relay, { ...relay, id: 102, priority: 90 }]);
    expect((await resolveSingleProviderForUser(input)).maxAttempts).toBe(1);
    mocks.relays.mockResolvedValue([relay]);
    const draft = await resolveSingleProviderForUser({ ...input, reasoningEffort: "xhigh" });
    expect(draft).toMatchObject({ reflectsCurrentChatRoute: false, maxAttempts: 1 });
    await draft.provider.invoke(messages); expect(requestBody().reasoning_effort).toBe("xhigh");
    mocks.relays.mockResolvedValue([{ ...relay, enabled: false }]);
    expect(await resolveSingleProviderForUser(input)).toMatchObject({ relayEnabled: false, reflectsCurrentChatRoute: false, maxAttempts: 1 });
  });
  it("probe显式清空站字段继承provider，不取回旧站地址或模型", async () => {
    mocks.relays.mockResolvedValue([relay]);
    const cleared = await resolveSingleProviderForUser({ userId: 17, providerName: "OpenAI", relayId: relay.id, baseUrl: "", model: "", apiKey: "" });
    expect(cleared.reflectsCurrentChatRoute).toBe(false);
    expect(cleared.provider.getConfigSummary?.()).toMatchObject({ baseUrl: parent.baseUrl, model: parent.model });
    await cleared.provider.invoke(messages);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://parent.example.test/v1/chat/completions");
    expect((vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer own-relay-key");
  });
});

describe("禁用与清空站点的环境边界", () => {
  it("主站全禁用仍可进入用户明确备用，禁用站不构造不调用", async () => {
    mocks.configs.mockResolvedValue([{ ...parent, extraConfig: { fallbackProvider: "Claude" } }, { ...parent, id: 2, providerName: "Claude", isDefault: false }]);
    mocks.relays.mockImplementation(async (_id: number, name: string) => name === "Claude"
      ? [{ ...relay, id: 201, providerName: "Claude", baseUrl: "https://backup.example.test" }]
      : [{ ...relay, enabled: false, apiKey: "v1:broken" }]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [{ type: "text", text: "备用答复" }] })));
    const provider = await resolveProviderForUser({ userId: 17 });
    await expect(provider!.invoke(messages)).resolves.toBe("备用答复");
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["https://backup.example.test/v1/messages"]);
  });
  it("已存在用户配置但最后站被清空时不能复活ENV共享key", async () => {
    mocks.configs.mockResolvedValue([{ ...parent, apiKey: null, baseUrl: null, model: null }]); mocks.relays.mockResolvedValue([]);
    expect(await resolveProviderForUser({ userId: 17, providerName: "OpenAI" })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("新站probe启用状态", () => {
  it("未保存新站成功也不返回停用标记，仍是单次草稿", async () => {
    mocks.configs.mockResolvedValue([]);
    mocks.relays.mockResolvedValue([]);
    const result = await resolveSingleProviderForUser({
      userId: 17, providerName: "OpenAI", apiKey: "draft-owned-key",
      baseUrl: "https://draft.example.test/v1", model: "draft-model",
    });
    await expect(result.provider.invoke(messages)).resolves.toBe("答复");
    expect(result.relayEnabled).toBeUndefined();
    expect(result.reflectsCurrentChatRoute).toBe(false);
    expect(result.maxAttempts).toBe(1);
    const payload = JSON.parse(JSON.stringify({
      relayEnabled: result.relayEnabled,
      reflectsCurrentChatRoute: result.reflectsCurrentChatRoute,
      maxAttempts: result.maxAttempts,
    }));
    expect(payload).not.toHaveProperty("relayEnabled");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
