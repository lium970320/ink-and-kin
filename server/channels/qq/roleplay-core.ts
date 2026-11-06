import { QQ_MAX_TEXT, QqError, type QqConfig } from "./core";
import type { QqRoleplayTicket } from "./roleplay-types";

export const QQ_ROLEPLAY_MAX_TURNS = 50;
export const QQ_ROLEPLAY_CHANNEL_PAGE = 50;

export type QqRoleplayCommand =
  | { kind: "list" } | { kind: "status" } | { kind: "exit" } | { kind: "stop" } | { kind: "invalid" }
  | { kind: "enter"; index?: number }
  | { kind: "advance"; continuous: boolean; total: number };

function channelNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = "零一二三四五六七八九";
  const value = text.replace(/两/g, "二").replace(/〇/g, "零");
  if (value.length === 1 && digits.includes(value)) return digits.indexOf(value);
  const tens = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(value);
  if (tens) return (tens[1] ? digits.indexOf(tens[1]) : 1) * 10 + (tens[2] ? digits.indexOf(tens[2]) : 0);
  return NaN;
}

export function parseQqRoleplayCommand(text: string): QqRoleplayCommand | null {
  const value = text.trim().normalize("NFKC");
  if (/^(?:频道列表|有哪些频道|频道帮助)$/.test(value)) return { kind: "list" };
  if (/^(?:频道状态|在频道里吗)$/.test(value)) return { kind: "status" };
  if (/^(?:退出频道(?:模式)?|离开频道|出频道)$/.test(value)) return { kind: "exit" };
  if (/^\/(?:s|r0+)$/i.test(value)) return { kind: "stop" };
  if (/^\/r$/i.test(value)) return { kind: "advance", continuous: true, total: QQ_ROLEPLAY_MAX_TURNS };
  const advance = /^\/r(\d+)$/i.exec(value);
  if (advance) {
    const total = Number(advance[1]);
    return total >= 1 && total <= QQ_ROLEPLAY_MAX_TURNS ? { kind: "advance", total, continuous: false } : { kind: "invalid" };
  }
  const enter = /^进入频道\s*(.*?)$/.exec(value);
  if (!enter) return null;
  if (!enter[1] || enter[1] === "模式") return { kind: "enter" };
  const index = channelNumber(enter[1]);
  return index >= 1 && index <= QQ_ROLEPLAY_CHANNEL_PAGE ? { kind: "enter", index } : { kind: "invalid" };
}

export function qqRoleplayConfigMatches(ticket: QqRoleplayTicket, config: QqConfig): boolean {
  return config.enabled && ticket.userId === config.userId && ticket.configId === config.id
    && ticket.configGeneration === config.generation && ticket.botId === config.botId && ticket.targetId === config.targetId;
}

export function sameQqRoleplayRoute(a: QqRoleplayTicket, b: QqRoleplayTicket): boolean {
  return a.userId === b.userId && a.configId === b.configId && a.configGeneration === b.configGeneration
    && a.botId === b.botId && a.targetId === b.targetId && a.channelId === b.channelId && a.routeRevision === b.routeRevision;
}

/** 固定公开正文：旁白独立分段；人物台词带名字。模型心声不作为发送素材。 */
export function splitQqRoleplayBeat(beat: { speakerName: string; replyText: string }): string[] {
  const reply = beat.replyText.trim();
  if (!reply) return [];
  const speaker = beat.speakerName.trim();
  const sections = reply.split(/(【[^【】]+】)/g).filter(section => section.trim());
  const texts = sections.map(section => {
    const text = section.trim();
    return text.startsWith("【") && text.endsWith("】") ? text : `${speaker}：${text}`;
  });
  // 保留全部正文；约束分段数和单请求体积，且不在 Unicode 代理对中间切断。
  const bounded = texts.length <= 12 ? texts : [...texts.slice(0, 11), texts.slice(11).join("\n")];
  const parts = bounded.flatMap(text => {
    const chars = Array.from(text.replace(/\[CQ:/gi, "［CQ:").replace(/\0/g, ""));
    const segments: string[] = [];
    for (let offset = 0; offset < chars.length; offset += QQ_MAX_TEXT) {
      const part = chars.slice(offset, offset + QQ_MAX_TEXT).join("");
      if (part.trim()) segments.push(part);
    }
    return segments;
  });
  if (parts.length > 32) throw new QqError("BAD_REQUEST", "频道本拍正文超过 QQ 分段上限。");
  return parts;
}
