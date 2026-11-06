import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ persona: vi.fn(), conversation: vi.fn() }));
vi.mock("../db", () => ({ getPersonaById: state.persona }));
vi.mock("../chat/service", () => ({ runConversation: state.conversation }));
import { handleChannelChat } from "./bridge";

beforeEach(() => {
  state.persona.mockReset().mockResolvedValue({ id: 3, userId: 7, analysisStatus: "ready", llmProvider: null });
  state.conversation.mockReset().mockImplementation(async function* () {
    yield { type: "delta", text: "已读到" };
    yield { type: "delta", text: "这一页。" };
  });
});

describe("统一渠道聊天桥", () => {
  it("把 QQ 的账号、渠道与取消信号传到现有聊天管线", async () => {
    const controller = new AbortController();
    const reply = await handleChannelChat({ userId: 7, personaId: 3, conversationKey: "qq:10002", messageText: "这一页", channel: "qq", signal: controller.signal });
    expect(state.persona).toHaveBeenCalledWith(3, 7);
    expect(state.conversation).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, channel: "qq", message: "这一页", signal: controller.signal }));
    expect(reply).toBe("已读到这一页。");
  });

  it("在停止后拒绝开始新的数据库读取与生成", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(handleChannelChat({ userId: 7, personaId: 3, conversationKey: "qq:10002", messageText: "这一页", channel: "qq", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(state.persona).not.toHaveBeenCalled();
    expect(state.conversation).not.toHaveBeenCalled();
  });

  it("没有角色归属时不进入生成管线", async () => {
    state.persona.mockResolvedValue(undefined);
    expect(await handleChannelChat({ userId: 8, personaId: 3, conversationKey: "qq:10002", messageText: "这一页", channel: "qq" })).toBeNull();
    expect(state.persona).toHaveBeenCalledWith(3, 8);
    expect(state.conversation).not.toHaveBeenCalled();
  });
});
