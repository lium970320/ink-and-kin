import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("./db", () => ({ getLlmConfigsByUserId: async () => [{ id: 1, providerName: "OpenAI", extraConfig: state.extra }], getLlmRelaysByUserId: async () => [] }));
vi.mock("./llm", () => ({ registry: { list: () => [{ name: "OpenAI", configured: true }], get: () => ({ getConfigSummary: () => ({ reasoningEffort: "high" }) }) } }));
vi.mock("./llm/user-provider", () => ({ invalidateUserProviderCache: vi.fn() }));
import { listUserLlmProviders } from "./llm-management";
describe("提供商推理档位回读", () => {
  it("显式清除不重新显示环境档位，缺省才继承摘要", async () => {
    state.extra = { reasoningEffort: null };
    expect((await listUserLlmProviders(1))[0].reasoningEffort).toBe(null);
    state.extra = {};
    expect((await listUserLlmProviders(1))[0].reasoningEffort).toBe("high");
  });
});
