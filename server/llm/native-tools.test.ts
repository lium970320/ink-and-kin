import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMService } from "./index";
import { createRoutedProvider } from "./routing";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { clearRelayHealth, isRelayCoolingDown, markRelayTransientFailure } from "./relay-health";
import type { LLMMessage, LLMToolDefinition } from "./types";

const tools: LLMToolDefinition[] = [{
  name: "get_date",
  description: "查询日期",
  parameters: { type: "object", properties: { date: { type: "string" } } },
}];
const messages: LLMMessage[] = [{ role: "user", content: "今天是几号？" }];

afterEach(() => {
  vi.unstubAllGlobals();
  clearRelayHealth();
});

describe("原生模型工具协议", () => {
  it("合并兼容协议 SSE 增量，回传推理并记录每次调用费用", async () => {
    const chunks = [
      { choices: [{ delta: { reasoning_content: "应先", tool_calls: [{ index: 0, id: "call_date", function: { name: "get_", arguments: '{"da' } }] } }] },
      { choices: [{ delta: { reasoning_content: "查历法", tool_calls: [{ index: 0, function: { name: "date", arguments: 'te":"2026-11-16"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
    ];
    const sse = chunks.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(sse, { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "今天是 16 日。" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider("DeepSeek-Pro", "test-key", "https://example.invalid/v1", "deepseek-v4-pro");
    const route = createRoutedProvider([{ provider, providerName: provider.name, relayId: 7 }], { userId: 1, hasFallback: false });
    const sink = vi.fn();
    const llm = new LLMService(undefined, sink);
    const first = await llm.invokeDetailedWithProvider(route, { messages, options: { tools, toolChoice: "auto", streamResponse: true, usageContext: { userId: 1 } } });
    expect(first).toEqual({
      text: "",
      finishReason: "tool_calls",
      reasoningContent: "应先查历法",
      toolCalls: [{ id: "call_date", name: "get_date", arguments: '{"date":"2026-11-16"}' }],
    });
    const followUp: LLMMessage[] = [...messages, {
      role: "assistant",
      content: first.text,
      toolCalls: first.toolCalls,
      reasoningContent: first.reasoningContent,
    }, { role: "tool", content: "2026-11-16", toolCallId: "call_date" }];
    await expect(llm.invokeDetailedWithProvider(route, { messages: followUp, options: { usageContext: { userId: 1 } } }))
      .resolves.toMatchObject({ text: "今天是 16 日。" });

    const [firstBody, secondBody] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(firstBody).toMatchObject({ stream: true, tools: [{ type: "function", function: { name: "get_date" } }], tool_choice: "auto" });
    expect(secondBody.tools).toBeUndefined();
    expect(secondBody.messages.slice(-2)).toEqual([
      { role: "assistant", content: null, reasoning_content: "应先查历法",
        tool_calls: [{ id: "call_date", type: "function", function: { name: "get_date", arguments: '{"date":"2026-11-16"}' } }] },
      { role: "tool", tool_call_id: "call_date", content: "2026-11-16" },
    ]);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0]).toMatchObject({ attempts: 1, relayId: 7, inputTokens: 20, outputTokens: 5 });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("应先查历法");
  });

  it("Claude 将同批工具结果合并在紧随工具调用的 user 块中", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_1", name: "get_date", input: { date: "2026-11-16" } },
          { type: "tool_use", id: "toolu_2", name: "get_date", input: { date: "2026-11-17" } }],
      }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "两天都查到了。" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("test-key", "claude-sonnet-4-6", "https://example.invalid", { mode: "effort", effort: "high" });
    const result = await provider.invokeDetailed(messages, { tools, toolChoice: "auto" });
    await expect(provider.invokeDetailed([
      ...messages, { role: "assistant", content: "", toolCalls: result.toolCalls },
      { role: "tool", toolCallId: "toolu_1", content: "星期一" },
      { role: "tool", toolCallId: "toolu_2", content: "星期二" },
    ], { tools, toolChoice: "auto" })).resolves.toMatchObject({ text: "两天都查到了。" });
    const [firstBody, secondBody] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(firstBody).toMatchObject({ tools: [{ name: "get_date", input_schema: tools[0].parameters }] });
    expect(firstBody.thinking).toBeUndefined();
    expect(secondBody.messages.slice(-2)).toEqual([
      { role: "assistant", content: [
        { type: "tool_use", id: "toolu_1", name: "get_date", input: { date: "2026-11-16" } },
        { type: "tool_use", id: "toolu_2", name: "get_date", input: { date: "2026-11-17" } },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "星期一" },
        { type: "tool_result", tool_use_id: "toolu_2", content: "星期二" },
      ] },
    ]);
  });

  it("账户上游错误不重试原站，另一站暂态冷却仍可探活", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "insufficient_quota" } }, { status: 402 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "探活成功" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const first = new OpenAIProvider("Primary", "test-a", "https://primary.invalid/v1", "example");
    const recovering = new OpenAIProvider("Secondary", "test-b", "https://secondary.invalid/v1", "example");
    markRelayTransientFailure(1, 2);
    const route = createRoutedProvider([
      { provider: first, providerName: "Primary", relayId: 1 },
      { provider: recovering, providerName: "Secondary", relayId: 2 },
    ], { userId: 1, hasFallback: true });
    await expect(route.invoke(messages)).resolves.toBe("探活成功");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://primary.invalid/v1/chat/completions", "https://secondary.invalid/v1/chat/completions",
    ]);
    expect(isRelayCoolingDown(1, 1)).toBe(true);
    expect(isRelayCoolingDown(2, 1)).toBe(false);
    expect(isRelayCoolingDown(1, 2)).toBe(false);
  });
});
