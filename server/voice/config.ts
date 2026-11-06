import { and, eq, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { voiceConfigs } from "../../drizzle/voice-schema";
import { decryptSecret, encryptSecret } from "../_core/crypto";
import { getDb } from "../db";

export interface VoiceSettings {
  asrEnabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  ttsEnabled: boolean;
}

export interface VoiceSummary extends VoiceSettings {
  revision: number;
  apiKeyConfigured: boolean;
  maxDurationSeconds: 30;
}

/** Server use only. Never return this object from a public route. */
export interface VoiceSecretConfig extends VoiceSettings {
  revision: number;
  apiKey: string | null;
}

export type VoiceConfigErrorCode = "BAD_REQUEST" | "PRECONDITION_FAILED" | "CONFLICT" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR";

export class VoiceConfigError extends Error {
  constructor(public readonly code: VoiceConfigErrorCode, message: string) {
    super(message);
    this.name = "VoiceConfigError";
  }
}

const DEFAULTS: Readonly<VoiceSettings> = Object.freeze({
  asrEnabled: false, baseUrl: "", model: "", timeoutMs: 60_000, ttsEnabled: true,
});
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_REVISION = 2_147_483_647;
const TRANSCRIPTION_PATH = "/audio/transcriptions";
const bad = (message: string) => new VoiceConfigError("BAD_REQUEST", message);
const conflict = () => new VoiceConfigError("CONFLICT", "语音设置已更新，请刷新后再保存。");

export function normalizeVoiceBaseUrl(input: string): string {
  if (typeof input !== "string") throw bad("语音服务地址格式无效。");
  const value = input.trim();
  if (!value) return "";
  if (value.length > 2000 || /[\\?#\u0000-\u0020\u007f]/.test(value)
    || !/^https?:\/\/[^/]+/i.test(value) || /^https?:\/\/[^/]*@/i.test(value)) {
    throw bad("语音服务地址不得包含账号、查询参数或片段。");
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw bad("语音服务地址格式无效。"); }
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))) {
    throw bad("语音服务地址必须使用 HTTPS，或使用本机环回 HTTP。");
  }
  const path = url.pathname.replace(/\/+$/, "");
  const basePath = path.endsWith(TRANSCRIPTION_PATH) ? path.slice(0, -TRANSCRIPTION_PATH.length).replace(/\/+$/, "") : path;
  const base = url.origin + basePath;
  if (base.length > 2000) throw bad("语音服务地址过长。");
  return base;
}

export function normalizeVoiceSettings(input: VoiceSettings): VoiceSettings {
  if (!input || typeof input.asrEnabled !== "boolean" || typeof input.ttsEnabled !== "boolean"
    || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 120_000
    || typeof input.model !== "string") throw bad("语音设置或超时范围无效。");
  const model = input.model.trim();
  if (model.length > 160 || /[\u0000-\u001f\u007f]/.test(model)) throw bad("语音模型名称无效。");
  return { asrEnabled: input.asrEnabled, baseUrl: normalizeVoiceBaseUrl(input.baseUrl), model,
    timeoutMs: input.timeoutMs, ttsEnabled: input.ttsEnabled };
}

export function normalizeVoiceApiKey(input: string): string {
  if (typeof input !== "string") throw bad("语音密钥格式无效。");
  const key = input.trim();
  if (!/^[\x21-\x7e]{1,512}$/.test(key)) throw bad("语音密钥格式无效。");
  return key;
}

export function voiceTranscriptionUrl(baseUrl: string): string {
  const base = normalizeVoiceBaseUrl(baseUrl);
  if (!base) throw bad("请填写语音服务地址。");
  return base + TRANSCRIPTION_PATH;
}

type Row = typeof voiceConfigs.$inferSelect;

function settings(row: Row | undefined): VoiceSettings {
  if (!row) return { ...DEFAULTS };
  const { asrEnabled, baseUrl, model, timeoutMs, ttsEnabled } = row;
  return { asrEnabled, baseUrl, model, timeoutMs, ttsEnabled };
}

function summary(row: Row | undefined): VoiceSummary {
  return { ...settings(row), revision: row?.revision ?? 0, apiKeyConfigured: Boolean(row?.apiKeyEnc), maxDurationSeconds: 30 };
}

function checkOwner(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new VoiceConfigError("NOT_FOUND", "账号不存在。");
}

async function database() {
  const db = await getDb();
  if (!db) throw new VoiceConfigError("INTERNAL_SERVER_ERROR", "语音设置暂不可用。");
  return db;
}

async function read(userId: number) {
  checkOwner(userId);
  const db = await database();
  const [row] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.userId, userId)).limit(1);
  return row;
}

export async function getVoiceConfig(userId: number): Promise<VoiceSummary> {
  return summary(await read(userId));
}

export async function getVoiceSecretConfig(userId: number): Promise<VoiceSecretConfig> {
  const row = await read(userId);
  return { ...settings(row), revision: row?.revision ?? 0, apiKey: await decryptSecret(row?.apiKeyEnc) };
}

export async function isVoiceConfigCurrent(userId: number, revision: number): Promise<boolean> {
  if (!Number.isInteger(revision) || revision < 0 || revision > MAX_REVISION) return false;
  return ((await read(userId))?.revision ?? 0) === revision;
}

export async function saveVoiceConfig(
  userId: number, expectedRevision: number, input: VoiceSettings, apiKey?: string | null,
): Promise<VoiceSummary> {
  checkOwner(userId);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > MAX_REVISION) {
    throw bad("语音设置版本无效。");
  }
  const next = normalizeVoiceSettings(input);
  const key = apiKey == null ? apiKey : normalizeVoiceApiKey(apiKey);
  let replacement: string | null | undefined;
  try { replacement = typeof key === "string" ? await encryptSecret(key) : key; }
  catch { throw new VoiceConfigError("INTERNAL_SERVER_ERROR", "无法安全保存语音密钥。"); }
  const db = await database();
  return db.transaction(async tx => {
    // Also serializes first writes when no configuration row exists yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:voice-config'), ${userId})`);
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("key share");
    if (!owner) throw new VoiceConfigError("NOT_FOUND", "账号不存在。");
    const [prior] = await tx.select().from(voiceConfigs).where(eq(voiceConfigs.userId, userId)).limit(1).for("update");
    if ((prior?.revision ?? 0) !== expectedRevision || expectedRevision === MAX_REVISION) throw conflict();
    if (replacement === undefined && prior?.apiKeyEnc && prior.baseUrl !== next.baseUrl) {
      throw new VoiceConfigError("PRECONDITION_FAILED", "更换语音服务地址时，请重新输入或删除原密钥。");
    }
    const apiKeyEnc = replacement === undefined ? prior?.apiKeyEnc ?? null : replacement;
    if (next.asrEnabled && (!next.baseUrl || !next.model || !apiKeyEnc
      || (replacement === undefined && !await decryptSecret(apiKeyEnc)))) {
      throw new VoiceConfigError("PRECONDITION_FAILED", "开启转写前，请设置语音服务地址、模型和有效密钥。");
    }
    const values = { ...next, apiKeyEnc, revision: expectedRevision + 1, updatedAt: new Date() };
    const [saved] = prior
      ? await tx.update(voiceConfigs).set(values).where(and(eq(voiceConfigs.userId, userId), eq(voiceConfigs.revision, expectedRevision))).returning()
      : await tx.insert(voiceConfigs).values({ ...values, userId }).returning();
    if (!saved) throw conflict();
    return summary(saved);
  });
}
