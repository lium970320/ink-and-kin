import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
const openai = () => new OpenAIProvider("OpenAI", "owned-key", "https://owned.example.test/v1", "model");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("模型列表只读协议", () => {
  it("OpenAI GET只使用本实例key并规范化模型", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "model-a", owned_by: "test", created: 1 }, { id: "model-a" }, { id: "model-b" }, { invalid: true }] })));
    const value = await openai().listModels();
    expect(value.map(model => model.id)).toEqual(["model-a", "model-b"]);
    expect(value[0]).toMatchObject({ ownedBy: "test", created: 1 });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://owned.example.test/v1/models");
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer owned-key" } });
  });
  it("Claude使用原生header，Ollama使用tags接口", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "claude-test", created_at: "2026-01-01T00:00:00Z" }] }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: "local-model:latest" }] })));
    const claude = await new ClaudeProvider("owned-claude-key", "m", "https://claude.example.test").listModels();
    expect(claude[0].id).toBe("claude-test");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://claude.example.test/v1/models?limit=1000");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "owned-claude-key", "anthropic-version": "2023-06-01" });
    expect(await new OllamaProvider("http://localhost:11434", "local-model").listModels()).toEqual([{ id: "local-model:latest" }]);
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("http://localhost:11434/api/tags");
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).not.toHaveProperty("Authorization");
  });
  it.each(["sensitive_words_detected", "policy_block", "policy_blocked"])("网关500中的%s仍是安全拒绝且脱敏", async code => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code, message: "private upstream body" } }), { status: 500 })));
    await expect(openai().listModels()).rejects.toMatchObject({ kind: "safety" });
    expect(fetch).toHaveBeenCalledTimes(1);
    try { await openai().listModels(); } catch (error) { expect(String(error)).not.toContain("private upstream body"); }
  });
  it.each(["insufficient_account_balance", "no_available_accounts"])("网关500中的%s为账户终止错误", async code => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(code, { status: 500 })));
    await expect(openai().listModels()).rejects.toMatchObject({ kind: "permission", message: "模型服务账户余额或可用账户不足，请检查账户配置。" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("不兼容payload明确报错，预先取消不发GET", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unexpected: [] })));
    await expect(openai().listModels()).rejects.toMatchObject({ kind: "invalid_request" });
    vi.mocked(fetch).mockClear(); const controller = new AbortController(); controller.abort();
    await expect(openai().listModels({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("15秒GET超时不会无限等待，也不泄漏网络错误", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    })));
    const pending = expect(openai().listModels()).rejects.toMatchObject({ kind: "network" });
    await vi.advanceTimersByTimeAsync(15000); await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
