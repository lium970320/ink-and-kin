import { messageId, QqError, qqId, type QqConfig } from "./core";

export type QqInteractions = {
  typing: boolean;
  references: boolean;
  images?: boolean;
  recall: boolean;
  poke: boolean;
  interrupt: boolean;
};

type QqNotice = { kind: "recall"; messageId: string } | { kind: "poke" };

export function readQqNotice(event: Record<string, unknown>, config: QqConfig, options?: QqInteractions): QqNotice | null {
  if (event.group_id != null) return null;
  if (options?.recall && event.notice_type === "friend_recall") {
    if (qqId(event.self_id) !== config.botId || qqId(event.user_id) !== config.targetId
      || (event.operator_id != null && qqId(event.operator_id) !== config.targetId)) {
      throw new QqError("FORBIDDEN", "事件不属于已绑定的机器人和目标。");
    }
    const recalled = messageId(event.message_id);
    if (recalled === null) throw new QqError("BAD_REQUEST", "撤回缺少有效消息编号。");
    return { kind: "recall", messageId: recalled };
  }
  if (options?.poke && event.notice_type === "notify" && event.sub_type === "poke") {
    const actor = event.user_id ?? event.sender_id ?? event.operator_id;
    if (qqId(event.self_id) !== config.botId || qqId(event.target_id) !== config.botId
      || qqId(actor) !== config.targetId) {
      throw new QqError("FORBIDDEN", "事件不属于已绑定的机器人和目标。");
    }
    return { kind: "poke" };
  }
  return null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function oneBotData(response: unknown): unknown {
  const result = object(response);
  return result.status === "ok" && result.retcode === 0 ? result.data ?? null : null;
}

export function oneBotId(id: string): string | number {
  const number = Number(id);
  return Number.isSafeInteger(number) ? number : id;
}

function safeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\[CQ:[^\]]*\]/gi, "[消息段]").replace(/[\0\r]/g, "").trim()
    : "";
}

function bounded(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : value;
}

function segmentText(value: unknown): string {
  if (!Array.isArray(value)) return safeText(value);
  return value.map(segment => {
    const item = object(segment);
    switch (item.type) {
      case "text": return typeof object(item.data).text === "string" ? String(object(item.data).text) : "";
      case "image": return "[图片]";
      case "record": return "[语音]";
      case "face": return "[表情]";
      default: return "";
    }
  }).join("").replace(/\[CQ:[^\]]*\]/gi, "[消息段]").replace(/[\0\r]/g, "").trim();
}

/** 只采用可核对到本私聊的原文，防止引用任意编号时读取其他会话。 */
export function quoteFromOneBot(response: unknown, config: QqConfig, requestedId: string): string {
  const original = object(oneBotData(response));
  if (original.message_type !== "private" || messageId(original.message_id) !== requestedId) return "";
  const sender = object(original.sender);
  const from = String(sender.user_id ?? original.user_id ?? "");
  const peer = String(original.target_id ?? original.peer_id ?? "");
  const incoming = from === config.targetId && (!peer || peer === config.botId);
  const outgoing = from === config.botId && peer === config.targetId;
  if (!incoming && !outgoing) return "";
  const text = segmentText(original.message) || safeText(original.raw_message);
  return text ? "【引用的私聊消息】\n" + bounded(text, 240) : "";
}

export function forwardFromOneBot(response: unknown): string {
  const data = oneBotData(response);
  const nodes = Array.isArray(data) ? data : object(data).messages;
  const heading = "【合并转发聊天记录】";
  if (!Array.isArray(nodes) || !nodes.length) return heading;
  const lines = nodes.slice(0, 15).map((value, index) => {
    const wrapper = object(value);
    const node = wrapper.type === "node" ? object(wrapper.data) : wrapper;
    const content = node.content ?? node.message;
    const text = segmentText(content) || segmentText(object(content).message) || "[消息]";
    return (index + 1) + ". " + text;
  });
  if (nodes.length > 15) lines.push("（其余 " + (nodes.length - 15) + " 条已省略）");
  return bounded([heading, ...lines].join("\n"), 1200);
}
