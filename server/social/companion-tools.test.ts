import { describe, expect, it, vi } from "vitest";
import { LLMRequestError } from "../llm/errors";
import type { InvokeParams, LLMInvokeDetailedResult } from "../llm/types";
import { runCompanionToolLoop, shouldOfferCompanionTools } from "./companion-tools";

vi.mock("../_core/env", () => ({ ENV: { companionToolsEnabled: true, companionWeatherTimeoutMs: 5000 } }));

describe("陪伴工具门控", () => {
  it("识别日常话题并按用户开关、预算、沉浸、考据和短句关闭", () => {
    const input = { messageText: "今天北京冷不冷？" };
    expect(shouldOfferCompanionTools(input)).toBe(true);
    expect(shouldOfferCompanionTools({ ...input, companionToolsEnabled: false })).toBe(false);
    expect(shouldOfferCompanionTools({ ...input, budgetMode: "conserve" })).toBe(false);
    expect(shouldOfferCompanionTools({ ...input, immersiveMode: true })).toBe(false);
    expect(shouldOfferCompanionTools({ ...input, activeSceneOverlay: "修仙世界" })).toBe(false);
    expect(shouldOfferCompanionTools({ ...input, sourceGroundedStrictRewrite: true })).toBe(false);
    expect(shouldOfferCompanionTools({ messageText: "好呀！", previousMessage: "今天雨很大" })).toBe(false);
  });
});

function input() {
  return {
    messages: [{ role: "user" as const, content: "今日是什么节日？" }],
    options: { maxTokens: 1000 },
    invoke: vi.fn(async (_params: InvokeParams) => "普通回复。"),
    invokeDetailed: vi.fn<(_params: InvokeParams) => Promise<LLMInvokeDetailedResult>>(),
    toolContext: {
      messageText: "今日是什么节日？",
      now: new Date("2026-02-17T07:00:00Z"),
      fetchImpl: vi.fn<typeof fetch>(),
      deepRecall: vi.fn(async () => "以前约好一起看书。"),
    },
  };
}

describe("陪伴工具循环", () => {
  it("允许两个工具步骤，并把最终正文与工具结果留在不同消息上", async () => {
    const params = input();
    const calendar = { id: "calendar", name: "get_calendar_and_anniversaries", arguments: "{}" };
    const recall = { id: "recall", name: "recall_deep_memory", arguments: '{"query":"旧约","scope":"memory"}' };
    params.invokeDetailed
      .mockResolvedValueOnce({ text: "草稿", toolCalls: [calendar], reasoningContent: "隐藏思考" })
      .mockResolvedValueOnce({ text: "", toolCalls: [recall] })
      .mockResolvedValueOnce({ text: "最终说法。" });
    await expect(runCompanionToolLoop(params)).resolves.toBe("最终说法。");
    expect(params.messages).toHaveLength(1);
    expect(params.invoke).not.toHaveBeenCalled();
    const [, second, final] = params.invokeDetailed.mock.calls.map(([value]) => value);
    expect(second.options?.tools?.map(tool => tool.name)).toEqual([
      "get_realtime_weather", "get_calendar_and_anniversaries", "recall_deep_memory",
    ]);
    expect(second.messages.slice(-2)).toEqual([
      expect.objectContaining({ role: "assistant", reasoningContent: "隐藏思考", toolCalls: [calendar] }),
      expect.objectContaining({ role: "tool", toolCallId: "calendar", content: expect.stringContaining("春节") }),
    ]);
    expect(final.options?.tools).toBeUndefined();
    expect(final.messages.at(-1)).toEqual(expect.objectContaining({ role: "tool", toolCallId: "recall" }));
    expect(params.toolContext.deepRecall).toHaveBeenCalledWith("旧约", "memory", expect.any(AbortSignal));
  });

  it("对工具协议错误保留单次普通回复，对内容安全拒绝原样抛出", async () => {
    const params = input();
    params.invokeDetailed.mockRejectedValueOnce(new LLMRequestError("invalid_request", 400, "unsupported_tools"));
    await expect(runCompanionToolLoop(params)).resolves.toBe("普通回复。");
    expect(params.invoke).toHaveBeenCalledOnce();
    expect(params.invoke.mock.calls[0][0].messages).toEqual(params.messages);

    params.invoke.mockClear();
    params.invokeDetailed.mockRejectedValueOnce(new LLMRequestError("safety", 400));
    await expect(runCompanionToolLoop(params)).rejects.toMatchObject({ kind: "safety" });
    expect(params.invoke).not.toHaveBeenCalled();
  });

  it("不会向天气服务发送当前对话与明确配置以外的城市", async () => {
    const params = input();
    params.invokeDetailed
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "weather", name: "get_realtime_weather", arguments: '{"cities":["私有位置"]}' }],
      })
      .mockResolvedValueOnce({ text: "天气无资料。" });
    await expect(runCompanionToolLoop(params)).resolves.toBe("天气无资料。");
    expect(params.toolContext.fetchImpl).not.toHaveBeenCalled();
  });

  it("外部取消打断正在进行的工具，且不启动普通回退", async () => {
    const params = input();
    const controller = new AbortController();
    params.invokeDetailed.mockResolvedValueOnce({
      text: "",
      toolCalls: [{ id: "recall", name: "recall_deep_memory", arguments: '{"query":"旧约"}' }],
    });
    params.toolContext.deepRecall.mockImplementationOnce(() => {
      controller.abort();
      return new Promise(() => {});
    });
    await expect(runCompanionToolLoop({ ...params, options: { ...params.options, signal: controller.signal } }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(params.invoke).not.toHaveBeenCalled();
    expect(params.invokeDetailed).toHaveBeenCalledOnce();
  });
});
