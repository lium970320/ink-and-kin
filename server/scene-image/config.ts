import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { sceneImageConfigs } from "../../drizzle/scene-image-config-schema";
import { llmConfigs, llmProviderRelays, users } from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../_core/crypto";
import { getDb, type DbTransaction } from "../db";
import { sceneImageReferenceKey, readSceneImageAsset } from "./assets";
import type { SceneImageProtocol } from "./provider-types";
import { resolveSceneImageProtocol } from "./providers";

export type SceneImagePriority = "comfyui_first" | "relay_first" | "comfyui_only" | "relay_only";
export interface SceneImageSettings {
  enabled: boolean;
  priorityStrategy: SceneImagePriority;
  comfyPromptTemplate: string | null;
  cooldownMinutes: number;
  maxPerHour: number;
  userReferenceKey: string | null;
  personaReferenceKeys: string[];
  activePersonaReferenceKey: string | null;
  promptRewriteRelayId: number | null;
}

const NODE_FIELDS = ["positivePromptNodeId", "modelNodeId", "loadImageNodeId", "userLoadImageNodeId", "envLoadImageNodeId"] as const;
const REFERENCE_ROLES = ["persona", "user", "env"] as const;
type SceneImageNodeField = typeof NODE_FIELDS[number];
export type SceneImageWorkflowConfig = {
  nodeMapping?: Partial<Record<SceneImageNodeField, string>>;
  referenceNodes?: Partial<Record<typeof REFERENCE_ROLES[number], string>>;
};

export interface SceneImageRelayInput {
  id?: number | null;
  relayName: string;
  priority: number;
  enabled: boolean;
  apiKey?: string | null;
  baseUrl: string;
  model: string;
  protocol: SceneImageProtocol;
  size: string;
  timeoutMs: number;
  formalReferenceEnabled: boolean;
  workflowJson?: string | null;
  extraConfig?: Record<string, unknown> | null;
}
type RelayFields = Omit<SceneImageRelayInput, "id" | "apiKey" | "extraConfig" | "workflowJson"> & {
  workflowJson: string | null;
  extraConfig: SceneImageWorkflowConfig | null;
};
export type StoredSceneImageRelay = RelayFields & { id: number; apiKeyEnc: string | null };
export type SceneImageRuntimeRelay = RelayFields & { id: number | null; apiKey: string | null };
export type SceneImageRelaySummary = RelayFields & { id: number; apiKeyConfigured: boolean };
export type SceneImagePromptRewriteRelayOption = { relayId: number; providerName: string; relayName: string; priority: number; model: string | null };

const PRIORITIES: SceneImagePriority[] = ["comfyui_first", "relay_first", "comfyui_only", "relay_only"];
const PROTOCOLS: SceneImageProtocol[] = ["auto", "openai", "google_gemini", "comfyui"];
const MAX_REVISION = 2_147_483_647;
const MAX_RELAYS = 24;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_TIMEOUT_MS = 180_000;
export const SCENE_IMAGE_MAX_RELAY_TIMEOUT_MS = 600_000;
export const SCENE_IMAGE_API_KEY_MAX_LENGTH = 2048;
const API_KEY_CHARACTERS = /^[\x21-\x7e]+$/;
const DEFAULTS: Omit<SceneImageSettings, "personaReferenceKeys"> = Object.freeze({
  enabled: false, priorityStrategy: "comfyui_first", comfyPromptTemplate: null, cooldownMinutes: 0, maxPerHour: 0,
  userReferenceKey: null, activePersonaReferenceKey: null, promptRewriteRelayId: null,
});

function bad(message: string): never { throw new TRPCError({ code: "BAD_REQUEST", message }); }
function missing(message: string): never { throw new TRPCError({ code: "NOT_FOUND", message }); }
function conflict(): never { throw new TRPCError({ code: "CONFLICT", message: "配图配置已变化，请刷新后重试。" }); }
function requireOwner(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1) return missing("账号不存在。");
}
function assertRevision(revision: number) {
  if (!Number.isInteger(revision) || revision < 0 || revision > MAX_REVISION) return bad("配图配置版本无效。");
}
function integer(value: number, low: number, high: number, label: string) {
  if (!Number.isInteger(value) || value < low || value > high) return bad(`${label}超出允许范围。`);
  return value;
}
function scalar(value: string, max: number, label: string) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return bad(`${label}格式无效。`);
  return value.trim();
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSceneImageBaseUrl(input: string) {
  const value = scalar(input, 2048, "图片接口地址");
  if (!value) return "";
  if (/[\\?#\s]/.test(value) || !/^https?:\/\/[^/]+/i.test(value) || /^https?:\/\/[^/]*@/i.test(value)) {
    return bad("图片接口地址不可包含凭据、查询参数或片段。");
  }
  let url: URL;
  try { url = new URL(value); } catch { return bad("图片接口地址格式无效。"); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))) {
    return bad("图片接口地址必须使用 HTTPS，或使用本机环回 HTTP。");
  }
  const canonical = url.origin + url.pathname.replace(/\/+$/, "");
  if (canonical.length > 2048) return bad("图片接口地址过长。");
  return canonical;
}

/** 唯一可公开或交给执行端的 extraConfig 字段是有限的 ComfyUI 节点编号。 */
export function projectSceneImageExtraConfig(value: unknown): SceneImageWorkflowConfig | null {
  if (!isObject(value)) return null;
  function nodeId(raw: unknown) {
    const id = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? String(raw) : raw;
    return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : undefined;
  }
  const projection: SceneImageWorkflowConfig = {};
  if (isObject(value.nodeMapping)) {
    const nodeMapping: NonNullable<SceneImageWorkflowConfig["nodeMapping"]> = {};
    for (const name of NODE_FIELDS) {
      const id = nodeId(value.nodeMapping[name]);
      if (id !== undefined) nodeMapping[name] = id;
    }
    if (Object.keys(nodeMapping).length) projection.nodeMapping = nodeMapping;
  }
  if (isObject(value.referenceNodes)) {
    const referenceNodes: NonNullable<SceneImageWorkflowConfig["referenceNodes"]> = {};
    for (const role of REFERENCE_ROLES) {
      const id = nodeId(value.referenceNodes[role]);
      if (id !== undefined) referenceNodes[role] = id;
    }
    if (Object.keys(referenceNodes).length) projection.referenceNodes = referenceNodes;
  }
  return Object.keys(projection).length ? projection : null;
}

function normalizeWorkflow(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Buffer.byteLength(value) > 512 * 1024 || value.includes("\0")) return bad("工作流 JSON 超过允许范围。");
  const text = value.trim();
  if (!text) return null;
  let graph: unknown;
  try { graph = JSON.parse(text); } catch { return bad("工作流不是有效的 JSON 对象。"); }
  if (!isObject(graph)) return bad("请粘贴有效的 ComfyUI 工作流对象。");
  const pending: Array<{ value: unknown; depth: number }> = [{ value: graph, depth: 0 }];
  let inspected = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++inspected > 50_000 || item.depth > 30) return bad("工作流结构超出允许范围。");
    if (item.value && typeof item.value === "object") {
      for (const [key, child] of Object.entries(item.value)) {
        if (/^(?:__proto__|constructor|prototype|api[_-]?key|access[_-]?token|token|password|secret|authorization|credentials?|headers)$/i.test(key)) {
          return bad("请从工作流移除凭据或敏感配置，密钥须填在独立字段。");
        }
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return text;
}

function normalizeRelay(input: SceneImageRelayInput): RelayFields {
  if (!PROTOCOLS.includes(input.protocol)) return bad("图片接口协议无效。");
  if (typeof input.enabled !== "boolean" || typeof input.formalReferenceEnabled !== "boolean") return bad("图片中转站开关无效。");
  const size = scalar(input.size, 32, "图片尺寸") || DEFAULT_SIZE;
  if (!/^(?:auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4})$/.test(size)) return bad("图片尺寸须为宽x高，或 auto。");
  const baseUrl = normalizeSceneImageBaseUrl(input.baseUrl);
  const model = scalar(input.model, 160, "图片模型");
  return {
    relayName: scalar(input.relayName, 128, "图片中转站名称") || (input.protocol === "comfyui" ? "本地 ComfyUI" : "未命名图片中转站"),
    priority: integer(input.priority, -10000, 10000, "中转站优先级"), enabled: input.enabled, protocol: input.protocol,
    baseUrl, model, size, timeoutMs: integer(input.timeoutMs, 30_000, SCENE_IMAGE_MAX_RELAY_TIMEOUT_MS, "图片请求超时"),
    formalReferenceEnabled: input.formalReferenceEnabled,
    workflowJson: normalizeWorkflow(input.workflowJson), extraConfig: projectSceneImageExtraConfig(input.extraConfig),
  };
}

/** undefined 或空字符串保留旧值；只对相同的规范化地址、配置协议和实际协议开放复用。 */
export function resolveSceneImageSecretEdit(fields: Pick<RelayFields, "baseUrl" | "protocol" | "model" | "workflowJson">,
  apiKey: string | null | undefined, previous?: StoredSceneImageRelay): string | null | undefined {
  if (apiKey === null) return null;
  if (apiKey !== undefined && typeof apiKey !== "string") return bad("图片接口密钥格式无效。");
  const key = apiKey?.trim();
  if (key) {
    if (key.length > SCENE_IMAGE_API_KEY_MAX_LENGTH || !API_KEY_CHARACTERS.test(key)) return bad("图片接口密钥格式无效。");
    return key;
  }
  if (previous?.apiKeyEnc && (fields.baseUrl !== previous.baseUrl || fields.protocol !== previous.protocol
    || resolveSceneImageProtocol(fields) !== resolveSceneImageProtocol(previous))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "更换图片地址或协议时，请重新输入或清除原密钥。" });
  }
  return undefined;
}

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "暂时无法读取配图配置。" });
  return db;
}

type Row = typeof sceneImageConfigs.$inferSelect;
function settingsOf(row?: Row): SceneImageSettings {
  const saved = row?.settings;
  return {
    enabled: saved?.enabled ?? DEFAULTS.enabled,
    priorityStrategy: saved?.priorityStrategy ?? DEFAULTS.priorityStrategy,
    comfyPromptTemplate: saved?.comfyPromptTemplate ?? null,
    cooldownMinutes: saved?.cooldownMinutes ?? DEFAULTS.cooldownMinutes,
    maxPerHour: saved?.maxPerHour ?? DEFAULTS.maxPerHour,
    userReferenceKey: saved?.userReferenceKey ?? null,
    personaReferenceKeys: Array.isArray(saved?.personaReferenceKeys) ? [...saved.personaReferenceKeys] : [],
    activePersonaReferenceKey: saved?.activePersonaReferenceKey ?? null,
    promptRewriteRelayId: saved?.promptRewriteRelayId ?? null,
  };
}
function orderedRelays(row?: Row) {
  return [...(row?.relays ?? [])].sort((a, b) => b.priority - a.priority || a.id - b.id);
}
async function readConfig(userId: number) {
  requireOwner(userId);
  const db = await database();
  const [row] = await db.select().from(sceneImageConfigs).where(eq(sceneImageConfigs.userId, userId)).limit(1);
  return row;
}

async function lockConfig(tx: DbTransaction, userId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ink-and-kin:scene-image-config'), ${userId})`);
  const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("key share");
  if (!owner) return missing("账号不存在。");
  const [row] = await tx.select().from(sceneImageConfigs).where(eq(sceneImageConfigs.userId, userId)).limit(1).for("update");
  return row;
}

export async function withSceneImageConfigRevision<T>(userId: number, revision: number, fn: (tx: DbTransaction) => Promise<T> | T): Promise<T> {
  requireOwner(userId);
  assertRevision(revision);
  const db = await database();
  return db.transaction(async tx => {
    const row = await lockConfig(tx, userId);
    if ((row?.revision ?? 0) !== revision) return conflict();
    return fn(tx);
  });
}

function usableTextRelay(providerName: string, model: string | null, key: string | null) {
  return (Boolean(key) || providerName.toLowerCase() === "ollama")
    && !/(?:embedding|rerank|dall-e|imagen|gpt-image|grok-imagine-image|stable-diffusion|whisper|^tts(?:-|$))/i.test(model ?? "");
}

async function promptRewriteOptions(connection: Awaited<ReturnType<typeof database>> | DbTransaction, userId: number,
  lockSelected?: number): Promise<SceneImagePromptRewriteRelayOption[]> {
  const query = connection.select({ relayId: llmProviderRelays.id, providerName: llmConfigs.providerName,
    relayName: llmProviderRelays.relayName, priority: llmProviderRelays.priority, model: llmProviderRelays.model,
    parentModel: llmConfigs.model, key: llmProviderRelays.apiKey,
  }).from(llmProviderRelays).innerJoin(llmConfigs, and(eq(llmConfigs.id, llmProviderRelays.llmConfigId), eq(llmConfigs.userId, userId)))
    .where(and(eq(llmProviderRelays.userId, userId), eq(llmProviderRelays.enabled, true),
      lockSelected === undefined ? undefined : eq(llmProviderRelays.id, lockSelected)));
  const rows = lockSelected === undefined ? await query : await query.for("share", { of: [llmProviderRelays, llmConfigs] });
  return rows.filter(row => usableTextRelay(row.providerName, row.model ?? row.parentModel, row.key))
    .map(({ key: _key, parentModel, ...option }) => ({ ...option, model: option.model ?? parentModel }))
    .sort((a, b) => b.priority - a.priority || a.relayId - b.relayId);
}

function savedRelayFields(relay: StoredSceneImageRelay): RelayFields {
  const { relayName, priority, enabled, baseUrl, model, protocol, size, timeoutMs, formalReferenceEnabled, workflowJson } = relay;
  return { relayName, priority, enabled, baseUrl, model, protocol, size, timeoutMs, formalReferenceEnabled, workflowJson,
    extraConfig: projectSceneImageExtraConfig(relay.extraConfig) };
}

function referenceDto(key: string) { return { key, url: `/uploads/${key}` }; }
async function summarize(row: Row | undefined, userId: number) {
  const options = await promptRewriteOptions(await database(), userId);
  const defaults = options.find(relay => relay.providerName.toLowerCase() === "claude") ?? options[0];
  const settings = settingsOf(row);
  const relays: SceneImageRelaySummary[] = orderedRelays(row).map(relay => ({
    ...savedRelayFields(relay), id: relay.id, apiKeyConfigured: Boolean(relay.apiKeyEnc),
  }));
  return {
    ...settings, revision: row?.revision ?? 0, source: row ? "saved" as const : "none" as const, hasSavedConfig: Boolean(row),
    relays, apiKeyConfigured: relays.some(relay => relay.apiKeyConfigured), baseUrl: relays[0]?.baseUrl ?? "", model: relays[0]?.model ?? "",
    size: relays[0]?.size ?? DEFAULT_SIZE, timeoutMs: relays[0]?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userReference: settings.userReferenceKey ? referenceDto(settings.userReferenceKey) : null,
    personaReferences: settings.personaReferenceKeys.map(referenceDto),
    promptRewriteDefaultRelayId: defaults?.relayId ?? null, promptRewriteRelayOptions: options,
    referenceAvailable: false, environmentReferenceAvailable: false,
  };
}
export type SceneImageConfigSummary = Awaited<ReturnType<typeof summarize>>;

export async function getSceneImageConfig(userId: number): Promise<SceneImageConfigSummary> {
  return summarize(await readConfig(userId), userId);
}

export async function getSceneImageRuntimeConfig(userId: number) {
  const row = await readConfig(userId);
  const relays = await Promise.all(orderedRelays(row).map(async (relay): Promise<SceneImageRuntimeRelay> => ({
    ...savedRelayFields(relay), id: relay.id, apiKey: await decryptSecret(relay.apiKeyEnc),
  })));
  return { ...settingsOf(row), revision: row?.revision ?? 0, relays };
}
export type SceneImageRuntimeConfig = Awaited<ReturnType<typeof getSceneImageRuntimeConfig>>;

function normalizeSettings(userId: number, previous: SceneImageSettings, update: Partial<SceneImageSettings>): SceneImageSettings {
  const merged = { ...previous, ...update };
  if (typeof merged.enabled !== "boolean" || !PRIORITIES.includes(merged.priorityStrategy)) return bad("配图开关或优先策略无效。");
  if (!Array.isArray(merged.personaReferenceKeys) || merged.personaReferenceKeys.length > 8) return bad("最多保存 8 张人物参考图。");
  const personaReferenceKeys = Array.from(new Set(merged.personaReferenceKeys.map(key => sceneImageReferenceKey(userId, key))));
  const userReferenceKey = merged.userReferenceKey === null ? null : sceneImageReferenceKey(userId, merged.userReferenceKey);
  const activePersonaReferenceKey = merged.activePersonaReferenceKey === null ? null : sceneImageReferenceKey(userId, merged.activePersonaReferenceKey);
  if (activePersonaReferenceKey && !personaReferenceKeys.includes(activePersonaReferenceKey)) return bad("默认人物参考图必须在已选列表中。");
  const template = merged.comfyPromptTemplate;
  if (template !== null && (typeof template !== "string" || template.length > 16000 || template.includes("\0"))) return bad("工作流提示词模板格式无效或过长。");
  const rewrite = merged.promptRewriteRelayId;
  if (rewrite !== null) integer(rewrite, 1, MAX_REVISION, "提示词改写中转站编号");
  return {
    enabled: merged.enabled, priorityStrategy: merged.priorityStrategy, comfyPromptTemplate: template?.trim() || null,
    cooldownMinutes: integer(merged.cooldownMinutes, 0, 1440, "配图冷却时间"), maxPerHour: integer(merged.maxPerHour, 0, 100, "每小时配图上限"),
    userReferenceKey, personaReferenceKeys, activePersonaReferenceKey, promptRewriteRelayId: rewrite,
  };
}

async function updateConfig(userId: number, expectedRevision: number,
  edit: (row: Row | undefined, tx: DbTransaction) => Promise<{ settings: SceneImageSettings; relays: StoredSceneImageRelay[]; nextRelayId: number; savedRelayId?: number }>) {
  requireOwner(userId);
  assertRevision(expectedRevision);
  if (expectedRevision === MAX_REVISION) return conflict();
  const db = await database();
  return db.transaction(async tx => {
    const before = await lockConfig(tx, userId);
    if ((before?.revision ?? 0) !== expectedRevision) return conflict();
    const { savedRelayId, ...edited } = await edit(before, tx);
    const values = { ...edited, revision: expectedRevision + 1, updatedAt: new Date() };
    const [row] = before ? await tx.update(sceneImageConfigs).set(values)
      .where(and(eq(sceneImageConfigs.userId, userId), eq(sceneImageConfigs.revision, expectedRevision))).returning()
      : await tx.insert(sceneImageConfigs).values({ userId, ...values }).returning();
    if (!row) return conflict();
    return { row, savedRelayId };
  });
}

export async function saveSceneImageSettings(userId: number, expectedRevision: number, input: Partial<SceneImageSettings>) {
  // Validate supplied references before taking the account lock; a later missing file is still refused at generation time.
  if (input.personaReferenceKeys !== undefined && !Array.isArray(input.personaReferenceKeys)) return bad("人物参考图列表无效。");
  const suppliedKeys = [input.userReferenceKey, ...(input.personaReferenceKeys ?? []), input.activePersonaReferenceKey];
  if (suppliedKeys.length > 10) return bad("最多保存 8 张人物参考图。");
  for (const key of Array.from(new Set(suppliedKeys))) if (key != null) await readSceneImageAsset(userId, key);
  const { row } = await updateConfig(userId, expectedRevision, async (before, tx) => {
    const settings = normalizeSettings(userId, settingsOf(before), input);
    if (settings.promptRewriteRelayId !== null && !(await promptRewriteOptions(tx, userId, settings.promptRewriteRelayId)).length) {
      return bad("提示词改写站须为本账号已启用的文字中转站。");
    }
    return { settings, relays: before?.relays ?? [], nextRelayId: before?.nextRelayId ?? 1 };
  });
  return summarize(row, userId);
}

export async function saveSceneImageRelay(userId: number, expectedRevision: number, input: SceneImageRelayInput) {
  const fields = normalizeRelay(input);
  const id = input.id == null ? null : integer(input.id, 1, MAX_REVISION, "图片中转站编号");
  const { row, savedRelayId } = await updateConfig(userId, expectedRevision, async before => {
    const relays = before?.relays ?? [];
    const old = id === null ? undefined : relays.find(relay => relay.id === id);
    if (id !== null && !old) return missing("图片中转站不存在。");
    const next = before?.nextRelayId ?? 1;
    if (!old && (relays.length >= MAX_RELAYS || next >= MAX_REVISION)) return bad("图片中转站数量已达上限。");
    const replacement = resolveSceneImageSecretEdit(fields, input.apiKey, old);
    let apiKeyEnc: string | null;
    try { apiKeyEnc = replacement === undefined ? old?.apiKeyEnc ?? null : replacement === null ? null : await encryptSecret(replacement); }
    catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "无法安全保存图片接口密钥。" }); }
    const saved = { id: old?.id ?? next, ...fields, apiKeyEnc };
    return { settings: settingsOf(before), relays: old ? relays.map(relay => relay.id === saved.id ? saved : relay) : [...relays, saved],
      nextRelayId: old ? next : next + 1, savedRelayId: saved.id };
  });
  return { ...await summarize(row, userId), savedRelayId: savedRelayId!, id: savedRelayId! };
}

export async function deleteSceneImageRelay(userId: number, expectedRevision: number, id: number) {
  integer(id, 1, MAX_REVISION, "图片中转站编号");
  const { row } = await updateConfig(userId, expectedRevision, async before => {
    if (!before?.relays.some(relay => relay.id === id)) return missing("图片中转站不存在。");
    return { settings: settingsOf(before), relays: before.relays.filter(relay => relay.id !== id), nextRelayId: before.nextRelayId };
  });
  return summarize(row, userId);
}

export async function resolveSceneImageRelayDraft(userId: number, expectedRevision: number, input: SceneImageRelayInput): Promise<SceneImageRuntimeRelay> {
  assertRevision(expectedRevision);
  const row = await readConfig(userId);
  if ((row?.revision ?? 0) !== expectedRevision) return conflict();
  const id = input.id == null ? null : integer(input.id, 1, MAX_REVISION, "图片中转站编号");
  const previous = id === null ? undefined : row?.relays.find(relay => relay.id === id);
  if (id !== null && !previous) return missing("图片中转站不存在。");
  const fields = normalizeRelay(input);
  const replacement = resolveSceneImageSecretEdit(fields, input.apiKey, previous);
  const apiKey = replacement === undefined ? await decryptSecret(previous?.apiKeyEnc) : replacement;
  return { id, ...fields, apiKey };
}
