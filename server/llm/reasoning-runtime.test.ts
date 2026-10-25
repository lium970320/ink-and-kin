import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { createUserConfiguredLlmProvider } from "./user-provider-factory";
import { resolveReasoningConfig } from "./reasoning";
import type { LLMTokenUsage } from "./types";
const messages = [{ role: "user" as const, content: "普通故事资料" }];
afterEach(() => vi.unstubAllGlobals());
function ok() { return Response.json({ choices: [{ message: { content: "回答" } }], content: [{ type: "text", text: "回答" }], usage: { input_tokens: 3, output_tokens: 2 } }); }
function body(index = 0) { return JSON.parse(String(vi.mocked(fetch).mock.calls[index][1]?.body)); }
describe("可见推理配置实际请求", () => {
  it.each(["low", "medium", "high", "xhigh"] as const)("OpenAI四档 %s 真正发送", async effort => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    await new OpenAIProvider("OpenAI", "own-key", "https://example.test/v1", "test-model", undefined, 1, { mode: "effort", effort }).invoke(messages);
    expect(body().reasoning_effort).toBe(effort);
  });
  it("默认不发档位，自定义兼容站xhigh沿自用映射max", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    await new OpenAIProvider("OpenAI", "own-key", "https://example.test/v1", "m").invoke(messages);
    expect(body()).not.toHaveProperty("reasoning_effort");
    await createUserConfiguredLlmProvider({ providerName: "自定义兼容站", apiKey: "own-key", baseUrl: "https://example.test/v1", model: "m", extraConfig: { reasoningEffort: "xhigh" } })!.invoke(messages);
    expect(body(1).reasoning_effort).toBe("max");
  });
  it.each([["low", 1024], ["medium", 4096], ["high", 8192], ["xhigh", 16384]] as const)("Claude旧方言 %s 按预算发送", async (effort, budget) => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    await new ClaudeProvider("own-key", "claude-sonnet-4-6", "https://example.test", { mode: "effort", effort }).invoke(messages);
    expect(body().thinking).toEqual({ type: "enabled", budget_tokens: budget }); expect(body().max_tokens).toBeGreaterThan(budget);
  });
  it("Claude新方言和一次明确方言纠正均生效", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("requires adaptive thinking", { status: 400 })).mockResolvedValueOnce(ok()));
    const attempts = vi.fn();
    await new ClaudeProvider("own-key", "unknown-model", "https://example.test", { mode: "effort", effort: "high" }).invoke(messages, { onAttempt: attempts });
    expect(body().thinking.type).toBe("enabled"); expect(body(1).thinking.type).toBe("adaptive"); expect(body(1).output_config.effort).toBe("high"); expect(attempts).toHaveBeenCalledTimes(2);
  });
  it("站级覆盖和null继承不丢档位", () => {
    expect(resolveReasoningConfig({ reasoningEffort: "high" }, { reasoningEffort: "xhigh" })).toEqual({ mode: "effort", effort: "xhigh" });
    expect(resolveReasoningConfig({ reasoningEffort: "high" }, { reasoningEffort: null })).toEqual({ mode: "effort", effort: "high" });
    expect(resolveReasoningConfig({ reasoningEffort: null })).toEqual({ mode: "default" });
  });
  it("DeepSeek动态Flash/Pro随用途变化，同站模型覆盖保留", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    const provider = createUserConfiguredLlmProvider({ providerName: "DeepSeek", apiKey: "own-key", baseUrl: "https://example.test/v1", extraConfig: { reasoningEffort: "xhigh" } }, undefined, true)!;
    await provider.invoke(messages, { purpose: "chat" }); await provider.invoke(messages, { purpose: "roleplay" });
    expect(body().model).toBe("deepseek-v4-flash"); expect(body().extra_body.thinking.type).toBe("disabled"); expect(body()).not.toHaveProperty("reasoning_effort");
    expect(body(1).model).toBe("deepseek-v4-pro"); expect(body(1).reasoning_effort).toBe("max");
  });
});
