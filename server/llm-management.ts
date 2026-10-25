import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { encryptSecret } from "./_core/crypto";
import { registry } from "./llm";
import { invalidateUserProviderCache } from "./llm/user-provider";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
const reasoning = new Set(["low", "medium", "high", "xhigh"]);
const secretKeys = new Set(["apikey", "apisecret", "accesstoken", "token", "bearertoken", "authorization", "password", "secret", "__proto__", "constructor", "prototype"]);
function isSecretKey(key: string) { return secretKeys.has(key.toLowerCase().replace(/[-_]/g, "")) || ["__proto__", "constructor", "prototype"].includes(key); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function extraForClient(value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => !isSecretKey(key)).map(([key, item]) => [key, item && typeof item === "object" ? Array.isArray(item) ? item.map(entry => entry && typeof entry === "object" ? extraForClient(entry) : entry) : extraForClient(item) : item]));
}
function validateExtra(value: Record<string, unknown>) {
  let text: string; try { text = JSON.stringify(value); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "配置参数格式无效。" }); }
  if (Buffer.byteLength(text, "utf8") > 65536) throw new TRPCError({ code: "BAD_REQUEST", message: "配置参数过大。" });
  function check(item: unknown, depth = 0) {
    if (depth > 16) throw new TRPCError({ code: "BAD_REQUEST", message: "配置参数嵌套过深。" });
    if (Array.isArray(item)) { item.forEach(entry => check(entry, depth + 1)); return; }
    if (item && typeof item === "object") for (const [key, entry] of Object.entries(item)) {
      if (isSecretKey(key)) throw new TRPCError({ code: "BAD_REQUEST", message: "密钥请使用独立密钥栏，不能写入普通参数。" });
      check(entry, depth + 1);
    }
  }
  check(value);
  if (value.reasoningEffort !== undefined && value.reasoningEffort !== null && !reasoning.has(String(value.reasoningEffort))) throw new TRPCError({ code: "BAD_REQUEST", message: "推理档位无效。" });
  if (value.deepseekDynamicRouting !== undefined && typeof value.deepseekDynamicRouting !== "boolean") throw new TRPCError({ code: "BAD_REQUEST", message: "动态分流开关格式无效。" });
  return value;
}
function providerName(value: string): string {
  const trimmed = db.normalizeLlmProviderName(value);
  if (!/^[A-Za-z0-9\u00C0-\u02FF\u0370-\u052F\u3400-\u9FFF][A-Za-z0-9\u00C0-\u02FF\u0370-\u052F\u3400-\u9FFF ._/-]*$/.test(trimmed)) throw new TRPCError({ code: "BAD_REQUEST", message: "提供商名称格式无效。" });
  const known = registry.list().find(provider => provider.name.toLowerCase() === trimmed.toLowerCase());
  return known?.name ?? trimmed;
}
function registered(name: string) { return registry.list().some(provider => provider.name.toLowerCase() === name.toLowerCase()); }
async function hasOwnedEndpoint(userId: number, name: string) {
  const [configs, relays] = await Promise.all([db.getLlmConfigsByUserId(userId), db.getLlmRelaysByUserId(userId, name)]);
  const config = configs.find(item => item.providerName.trim().toLowerCase() === name.toLowerCase());
  return !!(config?.apiKey && config.baseUrl || relays.some(relay => relay.enabled && relay.apiKey && relay.baseUrl));
}
async function usableProviderName(userId: number, value: string) {
  const name = providerName(value);
  if (!registered(name) && !await hasOwnedEndpoint(userId, name)) throw new TRPCError({ code: "BAD_REQUEST", message: "自定义提供商须先配置你自己的密钥和完整 API 地址。" });
  return name;
}
function optionalText(value: string | undefined) { return value === undefined ? undefined : value.trim() || null; }
function baseUrl(value: string | undefined) {
  const trimmed = optionalText(value); if (!trimmed) return trimmed;
  let url: URL; try { url = new URL(trimmed); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "API 地址格式无效。" }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TRPCError({ code: "BAD_REQUEST", message: "API 地址只支持无内嵌凭据的 HTTP 或 HTTPS 地址。" });
  return trimmed;
}
async function encryptedKey(value: string | undefined) {
  const key = value?.trim(); if (!key) return {};
  return { apiKey: await encryptSecret(key), apiKeyHint: key.length >= 8 ? key.slice(-4) : null };
}
export function sanitizeLlmConfigForClient(config: Awaited<ReturnType<typeof db.getLlmConfigsByUserId>>[number]) {
  return { id: config.id, providerName: config.providerName, isDefault: config.isDefault, baseUrl: config.baseUrl, model: config.model,
    systemMessage: config.systemMessage, extraConfig: extraForClient(config.extraConfig), hasKey: !!config.apiKey, apiKeyHint: config.apiKeyHint ?? null, createdAt: config.createdAt };
}
export async function listUserLlmProviders(userId: number) {
  const [configs, relays] = await Promise.all([db.getLlmConfigsByUserId(userId), db.getLlmRelaysByUserId(userId)]);
  const registered = registry.list();
  const names = Array.from(new Set([...registered.map(provider => provider.name), ...configs.filter(config => !registered.some(provider => provider.name.toLowerCase() === config.providerName.trim().toLowerCase())).map(config => config.providerName)]));
  return names.map(name => {
    const entry = registered.find(provider => provider.name.toLowerCase() === name.toLowerCase());
    const instance = entry ? registry.get(name) : undefined;
    const summary = instance?.getConfigSummary?.() ?? {};
    const config = configs.find(item => item.providerName.trim().toLowerCase() === name.toLowerCase());
    const extra = object(config?.extraConfig);
    const stations = relays.filter(relay => relay.llmConfigId === config?.id);
    const primary = stations.find(relay => relay.enabled);
    return { name, configured: Boolean(entry?.configured || config?.apiKey || stations.some(relay => relay.enabled && relay.apiKey)),
      supportsModelList: typeof instance?.listModels === "function", supportsReasoningEffort: entry ? instance?.supportsReasoningEffort : true,
      baseUrl: primary?.baseUrl ?? config?.baseUrl ?? summary.baseUrl ?? null,
      model: primary?.model ?? config?.model ?? summary.model ?? null,
      reasoningEffort: extra.reasoningEffort === null ? null : typeof extra.reasoningEffort === "string" && reasoning.has(extra.reasoningEffort) ? extra.reasoningEffort : summary.reasoningEffort ?? null,
      dynamicRouting: name.toLowerCase() === "deepseek" && extra.deepseekDynamicRouting === true,
      relays: stations.map(relay => ({ id: relay.id, relayName: relay.relayName, priority: relay.priority, enabled: relay.enabled,
        baseUrl: relay.baseUrl, model: relay.model, reasoningEffort: relay.reasoningEffort, apiKeyConfigured: !!relay.apiKey, apiKeyHint: relay.apiKeyHint ?? null })),
    };
  });
}
export async function getUserDefaultLlmConfig(userId: number) {
  const config = await db.getDefaultLlmConfig(userId); if (!config) return null;
  const result = sanitizeLlmConfigForClient(config);
  return { ...result, fallbackProvider: typeof result.extraConfig.fallbackProvider === "string" ? result.extraConfig.fallbackProvider : null };
}
export async function saveUserLlmConfig(userId: number, input: {
  providerName: string; apiKey?: string; baseUrl?: string; model?: string; reasoningEffort?: ReasoningEffort | null;
  deepseekDynamicRouting?: boolean; extraConfig?: Record<string, unknown>;
}) {
  const name = providerName(input.providerName);
  if (!registered(name)) {
    const configs = await db.getLlmConfigsByUserId(userId);
    const before = configs.find(config => config.providerName.trim().toLowerCase() === name.toLowerCase());
    const ownsPair = !!(input.apiKey?.trim() || before?.apiKey) && !!(input.baseUrl !== undefined ? baseUrl(input.baseUrl) : before?.baseUrl);
    if (!ownsPair && !await hasOwnedEndpoint(userId, name)) throw new TRPCError({ code: "BAD_REQUEST", message: "自定义提供商须使用你自己的密钥和完整 API 地址。" });
  }
  const extra: Record<string, unknown> = { ...(input.extraConfig ?? {}), ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}), ...(input.deepseekDynamicRouting !== undefined ? { deepseekDynamicRouting: input.deepseekDynamicRouting } : {}) };
  if (typeof extra.fallbackProvider === "string" && extra.fallbackProvider.trim()) extra.fallbackProvider = await usableProviderName(userId, extra.fallbackProvider);
  const id = await db.upsertLlmConfig(userId, { providerName: name, ...await encryptedKey(input.apiKey),
    ...(input.baseUrl !== undefined ? { baseUrl: baseUrl(input.baseUrl) } : {}), ...(input.model !== undefined ? { model: optionalText(input.model) } : {}),
    ...(Object.keys(extra).length ? { extraConfig: validateExtra(extra) } : {}),
  });
  invalidateUserProviderCache(userId); return { id };
}
export async function saveUserLlmRelay(userId: number, input: {
  id?: number; providerName: string; relayName: string; priority: number; enabled: boolean;
  apiKey?: string; baseUrl?: string; model?: string; reasoningEffort?: ReasoningEffort | null;
}) {
  try {
    const { apiKey, ...fields } = input;
    const name = providerName(input.providerName);
    if (!registered(name)) {
      const relays = await db.getLlmRelaysByUserId(userId, name);
      const before = relays.find(relay => relay.id === input.id);
      if (!(apiKey?.trim() || before?.apiKey) || !(input.baseUrl !== undefined ? baseUrl(input.baseUrl) : before?.baseUrl)) throw new TRPCError({ code: "BAD_REQUEST", message: "自定义中转站须使用你自己的密钥和完整 API 地址。" });
    }
    const id = await db.saveLlmRelayConfig(userId, { ...fields, providerName: name, ...await encryptedKey(apiKey),
      ...(input.baseUrl !== undefined ? { baseUrl: baseUrl(input.baseUrl) } : {}), ...(input.model !== undefined ? { model: optionalText(input.model) } : {}),
    });
    invalidateUserProviderCache(userId); return { id };
  } catch (error) {
    if (error instanceof Error && error.message === "LLM_RELAY_NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "中转站不存在或不属于当前提供商。" });
    throw error;
  }
}
export async function deleteUserLlmRelay(userId: number, id: number) {
  if (!await db.deleteLlmRelayConfig(id, userId)) throw new TRPCError({ code: "NOT_FOUND", message: "中转站不存在。" });
  invalidateUserProviderCache(userId); return { success: true };
}
export async function setUserDefaultLlmProvider(userId: number, name: string) {
  await db.setDefaultLlmConfig(userId, await usableProviderName(userId, name)); invalidateUserProviderCache(userId); return { success: true };
}
export async function updateUserDefaultLlmExtra(userId: number, extraConfig: Record<string, unknown>) {
  const config = await db.getDefaultLlmConfig(userId);
  if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "请先配置默认 LLM 提供商。" });
  const fields = { ...extraConfig };
  if (typeof fields.fallbackProvider === "string" && fields.fallbackProvider.trim()) fields.fallbackProvider = await usableProviderName(userId, fields.fallbackProvider);
  await db.upsertLlmConfig(userId, { providerName: config.providerName, extraConfig: validateExtra(fields) });
  invalidateUserProviderCache(userId); return { success: true };
}
export async function setUserFallbackLlmProvider(userId: number, name: string) {
  return updateUserDefaultLlmExtra(userId, { fallbackProvider: await usableProviderName(userId, name) });
}
