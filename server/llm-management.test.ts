import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("./db", () => ({
  getLlmConfigsByUserId: async () => [{ id: 1, providerName: "OpenAI", extraConfig: state.extra }],
  getLlmRelaysByUserId: async () => [],
  normalizeLlmProviderName: (value: string) => value.trim(),
}));
vi.mock("./llm", () => ({ registry: { list: () => [{ name: "OpenAI", configured: true }], get: () => ({ getConfigSummary: () => ({ reasoningEffort: "high" }) }) } }));
vi.mock("./llm/user-provider", async importOriginal => ({
  ...await importOriginal<typeof import("./llm/user-provider")>(),
  invalidateUserProviderCache: vi.fn(),
  canUseServerLlmFallback: () => true,
}));
import { listUserLlmProviders, saveUserLlmConfig } from "./llm-management";
describe("提供商推理档位回读", () => {
  it("显式清除不重新显示环境档位，缺省才继承摘要", async () => {
    state.extra = { reasoningEffort: null };
    expect((await listUserLlmProviders(1))[0].reasoningEffort).toBe(null);
    state.extra = {};
    expect((await listUserLlmProviders(1))[0].reasoningEffort).toBe("high");
  });
});

it("rejects a custom network destination before saving a model config", async () => {
  await expect(saveUserLlmConfig(1, {
    providerName: "OpenAI",
    baseUrl: "http://127.0.0.1:3000",
  })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
