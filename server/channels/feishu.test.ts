import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const sdk = vi.hoisted(() => ({
  createMessage: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  dispatcherOptions: vi.fn(),
  register: vi.fn(),
}));

// 所有 SDK 行为均为本地替身；本文件不会创建真实网络客户端。
vi.mock("@larksuiteoapi/node-sdk", () => ({
  AppType: { SelfBuild: "self-build" },
  Domain: { Feishu: "feishu" },
  Client: class {
    im = { v1: { message: { create: sdk.createMessage } } };
  },
  WSClient: class {
    start = sdk.start;
    close = sdk.close;
  },
  EventDispatcher: class {
    constructor(options: Record<string, unknown>) {
      if (!options) throw new Error("事件分发器需要选项对象");
      sdk.dispatcherOptions(options);
    }
    register(handlers: Record<string, unknown>) {
      sdk.register(handlers);
      return this;
    }
  },
}));

const getChannelState = vi.fn();
const upsertChannelState = vi.fn();
const decryptSecret = vi.fn();
vi.mock("../_core/crypto", () => ({
  decryptSecret: (...a: unknown[]) => decryptSecret(...a),
  encryptSecret: vi.fn(),
}));

const getChannelBinding = vi.fn();
const getPersonaById = vi.fn();
const handleChannelChat = vi.fn();
const handleCommand = vi.fn();
const getActivePersonaId = vi.fn();

vi.mock("../db", () => ({
  getChannelState: (...a: unknown[]) => getChannelState(...a),
  upsertChannelState: (...a: unknown[]) => upsertChannelState(...a),
  getChannelBinding: (...a: unknown[]) => getChannelBinding(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./bridge", () => ({
  handleChannelChat: (...a: unknown[]) => handleChannelChat(...a),
}));

vi.mock("./commands", () => ({
  handleCommand: (...a: unknown[]) => handleCommand(...a),
  getActivePersonaId: (...a: unknown[]) => getActivePersonaId(...a),
}));

import { extractMessageText, handleFeishuEvent, feishuAdapter } from "./feishu";

describe("extractMessageText", () => {
  it("reads the text out of the JSON content field", () => {
    const text = extractMessageText({
      message_type: "text",
      content: JSON.stringify({ text: "在吗" }),
    });
    expect(text).toBe("在吗");
  });

  it("returns null for a non-text message", () => {
    expect(extractMessageText({ message_type: "image", content: "{}" })).toBeNull();
  });

  it("returns null when the content is missing", () => {
    expect(extractMessageText({ message_type: "text" })).toBeNull();
  });

  it("returns null when the content is not valid JSON", () => {
    expect(extractMessageText({ message_type: "text", content: "not json" })).toBeNull();
  });

  it("returns null when the JSON has no text field", () => {
    expect(extractMessageText({ message_type: "text", content: "{}" })).toBeNull();
  });
});

describe("handleFeishuEvent", () => {
  beforeEach(() => {
    getChannelBinding.mockReset();
    getPersonaById.mockReset();
    handleChannelChat.mockReset();
    handleCommand.mockReset();
    getActivePersonaId.mockReset();

    getChannelBinding.mockResolvedValue({ personaId: 7 });
    getPersonaById.mockResolvedValue({ id: 7, graduationStatus: null });
    getActivePersonaId.mockReturnValue(7);
    handleCommand.mockResolvedValue({ handled: false });
    handleChannelChat.mockResolvedValue("在的。");
  });

  it("sends the persona's reply back to the chat", async () => {
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).toHaveBeenCalled();
    expect(sent).toContain("在的。");
  });

  it("ignores a group conversation", async () => {
    const sendText = vi.fn();
    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "group",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText,
    });
    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("ignores an event with no chat id", async () => {
    const sendText = vi.fn();
    await handleFeishuEvent({
      userId: 1,
      event: { message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) } },
      sendText,
    });
    expect(handleChannelChat).not.toHaveBeenCalled();
  });

  it("tells the user to pick a persona when nothing is bound", async () => {
    getChannelBinding.mockResolvedValue(undefined);
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sent.join("\n")).toContain("默认分身");
  });

  it("lets a slash command short-circuit the conversation", async () => {
    handleCommand.mockResolvedValue({ handled: true, reply: "已切换到 小A。" });
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "/使用 小A" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sent).toContain("已切换到 小A。");
  });

  it("mentions the graduation ritual when the persona is ready to let go", async () => {
    getPersonaById.mockResolvedValue({ id: 7, graduationStatus: "suggested" });
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(sent.join("\n")).toContain("/毕业");
  });
});

describe("飞书 SDK 离线构造与发送", () => {
  const userId = 301;
  beforeEach(() => {
    for (const fn of [...Object.values(sdk), getChannelState, upsertChannelState, decryptSecret]) fn.mockReset();
    getChannelState.mockResolvedValue({ credentialsEnc: "test-encrypted-credentials", status: "configured" });
    decryptSecret.mockResolvedValue(JSON.stringify({ appId: "test-app-id", appSecret: "test-app-secret" }));
    sdk.createMessage.mockResolvedValue({ code: 0 });
  });
  afterEach(async () => {
    await feishuAdapter.stop(userId);
  });

  it("按锁定 SDK 合同传入选项并使用会话编号发送文本", async () => {
    await feishuAdapter.start(userId);
    expect(sdk.dispatcherOptions).toHaveBeenCalledWith({});
    expect(sdk.register).toHaveBeenCalledWith({ "im.message.receive_v1": expect.any(Function) });
    expect(sdk.start).toHaveBeenCalledWith({ eventDispatcher: expect.any(Object) });
    await feishuAdapter.send(userId, "oc_test", "你好");
    expect(sdk.createMessage).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: "oc_test", msg_type: "text", content: JSON.stringify({ text: "你好" }) },
    });
  });

  it("启动同步抛错时不登记连接或写入连接成功状态", async () => {
    sdk.start.mockImplementationOnce(() => { throw new Error("模拟启动失败"); });
    await expect(feishuAdapter.start(userId)).rejects.toThrow("模拟启动失败");
    expect(upsertChannelState).not.toHaveBeenCalled();
    await expect(feishuAdapter.send(userId, "oc_test", "你好")).rejects.toThrow("尚未连接");
    expect(sdk.createMessage).not.toHaveBeenCalled();
  });

  it("发送接口失败时将错误返回调用方", async () => {
    await feishuAdapter.start(userId);
    sdk.createMessage.mockRejectedValueOnce(new Error("模拟发送失败"));
    await expect(feishuAdapter.send(userId, "oc_test", "你好")).rejects.toThrow("模拟发送失败");
  });
});
