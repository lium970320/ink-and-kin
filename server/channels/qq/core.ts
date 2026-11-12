import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

export const QQ_MAX_TEXT = 4000;
export const QQ_MAX_BODY = 64 * 1024;
export const QQ_SECRET_MASK = "••••••••";
export type DeliveryStatus = "confirmed" | "failed" | "unknown";
export type QqErrorCode = "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "TOO_MANY_REQUESTS";

export class QqError extends Error {
  constructor(public readonly code: QqErrorCode, message: string) {
    super(message);
    this.name = "QqError";
  }
}

export interface QqSecrets { apiToken: string; receiveToken: string; webhookSecret: string }
export interface QqConfig {
  id: number; userId: number; hookId: string; apiBaseUrl: string; botId: string; targetId: string;
  personaId: number | null; secretsEnc: string; enabled: boolean; generation: number;
}
export interface QqSaveInput {
  expectedGeneration: number | null; apiBaseUrl: string; botId: string; targetId: string; personaId: number;
  apiToken?: string; receiveToken?: string; webhookSecret?: string;
  clearApiToken?: boolean; clearReceiveToken?: boolean;
}
export interface QqDelivery {
  id: number; targetId: string; status: DeliveryStatus;
  remoteMessageId: string | null; reason: string | null; createdAt: Date | string;
}

export function qqId(value: unknown): string {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value)
    : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9][0-9]{0,15}$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new QqError("BAD_REQUEST", "请输入有效的机器人或目标账号编号。");
  }
  return text;
}

export function apiBase(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new QqError("BAD_REQUEST", "请输入你自己的完整 HTTP API 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new QqError("BAD_REQUEST", "API 地址只支持 HTTP 或 HTTPS，凭据请填入独立密钥栏。");
  }
  return url.toString().replace(/\/+$/, "");
}

export function plainText(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value) && value.length > 0
    && value.every(part => part?.type === "text" && typeof part.data?.text === "string")) {
    text = value.map(part => part.data.text).join("");
  } else throw new QqError("BAD_REQUEST", "当前仅支持普通文字消息。");
  if (!text.trim() || Array.from(text).length > QQ_MAX_TEXT || /\[CQ:/i.test(text) || text.includes("\0")) {
    throw new QqError("BAD_REQUEST", "消息为空、过长或包含不支持的消息段。");
  }
  return text;
}

function constantEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function verifyWebhook(raw: Buffer, signature: string | undefined, authorization: string | undefined, secrets: QqSecrets): boolean {
  if (!secrets.webhookSecret || !signature || !/^sha1=[a-f0-9]{40}$/i.test(signature)) return false;
  const expected = `sha1=${createHmac("sha1", secrets.webhookSecret).update(raw).digest("hex")}`;
  return constantEqual(signature.toLowerCase(), expected)
    && (!secrets.receiveToken || constantEqual(authorization ?? "", `Bearer ${secrets.receiveToken}`));
}

function messageId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^-?[0-9]{1,40}$/.test(text)) return null;
  return text.replace(/^(-?)0+(?=\d)/, "$1").replace(/^-0$/, "0");
}

export interface QqInboundEvent {
  messageId: string;
  text: string;
  unsupportedMedia?: boolean;
  voiceRecord?: { id: string | null };
}

function recordingId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  // NapCat emits the cache token in file, separate from the optional path and URL.
  const { file: token } = data as { file?: unknown };
  return typeof token === "string" && token === token.trim()
    && /^[a-f0-9]{32}(?:\.(?:amr|silk|slk|mp3|wav))?$/i.test(token) ? token : null;
}

export function parseInbound(raw: Buffer, config: QqConfig, acceptMediaNotice = false, acceptVoice = false): QqInboundEvent {
  if (raw.length > QQ_MAX_BODY) throw new QqError("BAD_REQUEST", "事件体积超过上限。");
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    event = parsed as Record<string, unknown>;
  } catch { throw new QqError("BAD_REQUEST", "事件格式无效。"); }
  if (event.post_type !== "message" || event.message_type !== "private") {
    throw new QqError("BAD_REQUEST", "当前仅接收一对一文字消息。");
  }
  const sender = event.sender as { user_id?: unknown } | undefined;
  if (qqId(event.self_id) !== config.botId || qqId(event.user_id) !== config.targetId
    || (sender?.user_id != null && qqId(sender.user_id) !== config.targetId)) {
    throw new QqError("FORBIDDEN", "事件不属于已绑定的机器人和目标。");
  }
  const id = messageId(event.message_id);
  if (id == null) throw new QqError("BAD_REQUEST", "事件缺少有效消息编号。");
  if (acceptVoice && Array.isArray(event.message) && event.message.length === 1 && event.message[0]?.type === "record") {
    return { messageId: id, text: "", voiceRecord: { id: recordingId(event.message[0].data) } };
  }
  if (acceptMediaNotice && Array.isArray(event.message) && event.message.length > 0
    && event.message.every(part => part && ["text", "image", "record"].includes(part.type))
    && event.message.some(part => part.type === "image" || part.type === "record")) {
    // 不读取、下载或向模型传递外部媒体地址，只让调用方回复功能提示。
    return { messageId: id, text: "", unsupportedMedia: true };
  }
  return { messageId: id, text: plainText(event.message) };
}

/** Stable across retries of one signed inbound event, even after a config generation changes. */
export function qqSceneImageOperationId(config: Pick<QqConfig, "id" | "userId" | "botId" | "targetId">, messageId: string): string {
  const digest = createHash("sha256").update(JSON.stringify(["qq-scene-image", config.id, config.userId, config.botId, config.targetId, messageId])).digest();
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type DeliveryResult = { status: DeliveryStatus; remoteMessageId: string | null; reason: string };

export function deliveryResult(body: unknown): DeliveryResult {
  const result = body as { status?: unknown; retcode?: unknown; data?: { message_id?: unknown } } | null;
  if (result?.status === "ok" && result.retcode === 0) {
    const id = messageId(result.data?.message_id);
    if (id !== null) return { status: "confirmed", remoteMessageId: id, reason: "confirmed_by_api" };
  }
  if (result?.status === "failed" && typeof result.retcode === "number" && Number.isInteger(result.retcode) && result.retcode !== 0) {
    return { status: "failed", remoteMessageId: null, reason: "rejected_by_api" };
  }
  return { status: "unknown", remoteMessageId: null, reason: "unconfirmed_response" };
}
