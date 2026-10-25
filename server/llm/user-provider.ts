import { createHash } from "node:crypto";
import { decryptIfEncrypted } from "../_core/crypto";
import * as db from "../db";
import { registry } from "./index";
import { scopeProvider } from "./usage-context";
import { createUserConfiguredLlmProvider } from "./user-provider-factory";
import { extraObject, resolveReasoningConfig, type ReasoningEffort } from "./reasoning";
import { readConfiguredDeepSeekDynamicRouting } from "./deepseek-routing";
import { LLMRequestError } from "./errors";
import { createRoutedProvider, type RoutedCandidate } from "./routing";
import { clearRelayHealth } from "./relay-health";
import { getRelayFailoverPolicy } from "./relay-failover-policy";
import type { LLMProvider } from "./types";

type Config = Awaited<ReturnType<typeof db.getLlmConfigsByUserId>>[number];
type Relay = Awaited<ReturnType<typeof db.getLlmRelaysByUserId>>[number];
export type SingleProviderInput = {
  userId: number;
  providerName: string;
  relayId?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort | null;
  /** Compatibility input: blank model follows the same saved-null inheritance in all probes. */
  allowEmptyModel?: boolean;
};
export type SingleProviderResolution = {
  provider: LLMProvider;
  reflectsCurrentChatRoute: boolean;
  relayEnabled?: boolean;
  maxAttempts: 1 | 2;
};
type EffectiveOverrides = Pick<SingleProviderInput, "apiKey" | "baseUrl" | "model" | "reasoningEffort" | "allowEmptyModel">;
const providerCache = new Map<string, { provider: LLMProvider; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 200;

export function invalidateUserProviderCache(userId?: number) {
  clearRelayHealth(userId);
  if (userId === undefined) { providerCache.clear(); return; }
  for (const key of Array.from(providerCache.keys())) {
    if (key.startsWith(`${userId}:`)) providerCache.delete(key);
  }
}
function validateUser(userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new LLMRequestError("invalid_request");
}
function sameName(left: string, right: string) { return left.trim().toLowerCase() === right.trim().toLowerCase(); }
function canonicalName(name: string) {
  const trimmed = name.trim();
  if (sameName(trimmed, "DeepSeek-auto")) return "DeepSeek";
  return registry.get(trimmed)?.name ?? trimmed;
}
function findConfig(configs: Config[], name: string | undefined) {
  if (!name) return configs.find(config => config.isDefault) ?? configs[0];
  const exact = configs.find(config => sameName(config.providerName, name));
  return exact ?? (/^deepseek-(?:flash|pro)$/i.test(name)
    ? configs.find(config => sameName(config.providerName, "DeepSeek")) : undefined);
}
function fallbackName(configs: Config[], primary: string) {
  const defaults = findConfig(configs, undefined);
  const value = extraObject(defaults?.extraConfig).fallbackProvider;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const fallback = canonicalName(value);
  return sameName(primary, fallback) ? undefined : fallback;
}
async function rowsFor(userId: number, name: string, parent?: Config) {
  const rows = await db.getLlmRelaysByUserId(userId, parent?.providerName ?? name);
  return rows.filter(row => row.userId === userId)
    .sort((left, right) => right.priority - left.priority || left.id - right.id);
}
function emptyParent(config?: Config) {
  return !config?.apiKey && !config?.baseUrl && !config?.model;
}
function relayExtra(relay?: Relay, overrides: EffectiveOverrides = {}) {
  if (overrides.reasoningEffort !== undefined) return { reasoningEffort: overrides.reasoningEffort };
  return relay ? { ...extraObject(relay.extraConfig), reasoningEffort: relay.reasoningEffort } : undefined;
}

async function buildEffective(
  userId: number,
  providerName: string,
  parent?: Config,
  relay?: Relay,
  overrides: EffectiveOverrides = {},
): Promise<LLMProvider> {
  const credential = relay ? relay.apiKey : parent?.apiKey;
  const savedKey = await decryptIfEncrypted(credential);
  const replacementKey = overrides.apiKey?.trim();
  const apiKey = replacementKey || savedKey;
  if (credential && !savedKey && !replacementKey) throw new LLMRequestError("auth");
  if (!apiKey && !sameName(providerName, "Ollama")) throw new LLMRequestError("auth");
  const baseUrl = overrides.baseUrl !== undefined ? overrides.baseUrl.trim() || parent?.baseUrl : relay?.baseUrl ?? parent?.baseUrl;
  const model = overrides.model !== undefined ? overrides.model.trim() || parent?.model : relay?.model ?? parent?.model;
  const reasoning = resolveReasoningConfig(parent?.extraConfig, relayExtra(relay, overrides));
  const dynamic = sameName(providerName, "DeepSeek") && readConfiguredDeepSeekDynamicRouting(parent?.extraConfig);
  const settings = { providerName, apiKey, baseUrl, model, systemMessage: parent?.systemMessage, relayId: relay?.id };
  const fingerprint = createHash("sha256").update(JSON.stringify({ settings, reasoning, dynamic })).digest("hex");
  const key = `${userId}:${providerName.toLowerCase()}:${fingerprint}`;
  let cached = providerCache.get(key);
  if (cached && Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    providerCache.delete(key);
    cached = undefined;
  }
  let provider = cached?.provider;
  if (!provider) {
    provider = createUserConfiguredLlmProvider(settings, reasoning, dynamic);
    if (!provider) throw new LLMRequestError("invalid_request");
    if (providerCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = Array.from(providerCache.entries()).sort((left, right) => left[1].cachedAt - right[1].cachedAt)[0];
      if (oldest) providerCache.delete(oldest[0]);
    }
    providerCache.set(key, { provider, cachedAt: Date.now() });
  }
  return scopeProvider(provider, { userId });
}

async function candidatesFor(
  userId: number,
  providerName: string,
  parent: Config | undefined,
  allowEnvironment: boolean,
): Promise<RoutedCandidate[]> {
  const rows = await rowsFor(userId, providerName, parent);
  if (rows.length) {
    const active = rows.filter(row => row.enabled);
    const candidates: RoutedCandidate[] = [];
    for (const relay of active) {
      // A broken configured station is a configuration error, never an implicit skip.
      const provider = await buildEffective(userId, providerName, parent, relay);
      candidates.push({ provider, providerName, relayId: relay.id, priority: relay.priority });
    }
    return candidates;
  }
  if (!emptyParent(parent)) {
    return [{ provider: await buildEffective(userId, providerName, parent), providerName, priority: 100 }];
  }
  if (allowEnvironment) {
    const reasoning = resolveReasoningConfig(parent?.extraConfig);
    const dynamic = sameName(providerName, "DeepSeek") && readConfiguredDeepSeekDynamicRouting(parent?.extraConfig);
    const trusted = dynamic ? registry.getBaseConfig(providerName) : undefined;
    const provider = trusted?.apiKey
      ? createUserConfiguredLlmProvider({ providerName, apiKey: trusted.apiKey, baseUrl: trusted.baseUrl }, reasoning, true)
      : parent ? registry.build(providerName, { extra: { reasoning } }) : registry.get(providerName);
    if (provider) return [{ provider: scopeProvider(provider, { userId }), providerName }];
  }
  return [];
}

export async function resolveProviderForUser(params: { userId: number; providerName?: string }): Promise<LLMProvider | undefined> {
  const { userId } = params;
  validateUser(userId);
  const configs = await db.getLlmConfigsByUserId(userId);
  let requested = params.providerName?.trim() ? canonicalName(params.providerName) : undefined;
  let parent = findConfig(configs, requested);
  if (requested && !parent && !registry.getEntry(requested)) {
    requested = undefined;
    parent = findConfig(configs, undefined);
  }
  const providerName = requested && /^deepseek-(?:flash|pro)$/i.test(requested)
    ? requested : parent?.providerName ?? requested ?? registry.get()?.name;
  if (!providerName) return undefined;
  const primaryName = canonicalName(providerName);
  const fallback = fallbackName(configs, primaryName);
  const allowEnvironment = !fallback && configs.length === 0;
  const candidates = await candidatesFor(userId, primaryName, parent, allowEnvironment);
  if (fallback) {
    const backupParent = findConfig(configs, fallback);
    candidates.push(...await candidatesFor(userId, fallback, backupParent, false));
  }
  if (!candidates.length) return undefined;
  const routed = createRoutedProvider(candidates, { userId, requestedProvider: primaryName, hasFallback: Boolean(fallback) });
  return scopeProvider(routed, { userId });
}

export async function hasUserLlmConfig(userId: number): Promise<boolean> {
  const configs = await db.getLlmConfigsByUserId(userId);
  return configs.some(config => !!(config.apiKey || config.baseUrl || config.model));
}

/** Builds one owned station only. The returned retry count describes the full saved route,
 * but no alternate station or environment credential enters the probe provider. */
export async function resolveSingleProviderForUser(input: SingleProviderInput): Promise<SingleProviderResolution> {
  validateUser(input.userId);
  if (!input.providerName.trim()) throw new LLMRequestError("invalid_request");
  const providerName = canonicalName(input.providerName);
  const configs = await db.getLlmConfigsByUserId(input.userId);
  const parent = findConfig(configs, providerName);
  const rows = await rowsFor(input.userId, providerName, parent);
  const savedRelay = input.relayId !== undefined
    ? rows.find(row => row.id === input.relayId)
    : rows.find(row => row.enabled) ?? rows[0];
  if (input.relayId !== undefined && !savedRelay) throw new LLMRequestError("permission");
  const credential = savedRelay ? savedRelay.apiKey : parent?.apiKey;
  const savedKey = await decryptIfEncrypted(credential);
  const overrides: EffectiveOverrides = {
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    allowEmptyModel: input.allowEmptyModel,
  };
  const provider = await buildEffective(input.userId, providerName, parent, savedRelay, overrides);
  let matches = false;
  if (savedKey || sameName(providerName, "Ollama")) {
    const saved = await buildEffective(input.userId, providerName, parent, savedRelay);
    const savedSummary = saved.getConfigSummary?.();
    const actualSummary = provider.getConfigSummary?.();
    const savedReasoning = resolveReasoningConfig(parent?.extraConfig, relayExtra(savedRelay));
    const actualReasoning = resolveReasoningConfig(parent?.extraConfig, relayExtra(savedRelay, overrides));
    const savedBaseUrl = savedSummary?.baseUrl ?? savedRelay?.baseUrl ?? parent?.baseUrl;
    const actualBaseUrl = actualSummary?.baseUrl ?? (input.baseUrl !== undefined ? input.baseUrl.trim() : savedRelay?.baseUrl ?? parent?.baseUrl);
    const savedModel = savedSummary?.model ?? savedRelay?.model ?? parent?.model;
    const actualModel = actualSummary?.model ?? (input.model !== undefined ? input.model.trim() : savedRelay?.model ?? parent?.model);
    matches = (!input.apiKey?.trim() || input.apiKey.trim() === savedKey)
      && actualBaseUrl === savedBaseUrl
      && actualModel === savedModel
      && JSON.stringify(actualReasoning) === JSON.stringify(savedReasoning);
  }
  const hasSaved = Boolean(savedRelay || parent?.apiKey || (parent?.baseUrl && sameName(providerName, "Ollama")));
  const relayEnabled = savedRelay?.enabled ?? (hasSaved ? true : undefined);
  const reflectsCurrentChatRoute = hasSaved && relayEnabled === true && matches;
  let candidateCount = rows.filter(row => row.enabled).length;
  if (!rows.length && parent?.apiKey) candidateCount = 1;
  const fallback = fallbackName(configs, providerName);
  if (fallback) {
    const backupParent = findConfig(configs, fallback);
    const backupRows = await rowsFor(input.userId, fallback, backupParent);
    candidateCount += backupRows.filter(row => row.enabled).length;
    if (!backupRows.length && backupParent?.apiKey) candidateCount++;
  }
  const savedPolicy = getRelayFailoverPolicy({ candidateCount, hasFallback: Boolean(fallback) });
  const maxAttempts = reflectsCurrentChatRoute ? savedPolicy.maxAttemptsPerCandidate as 1 | 2 : 1;
  const independent = new Proxy(provider, {
    get(target, key) {
      if (key === "maxAttempts") return maxAttempts;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { provider: scopeProvider(independent, { userId: input.userId }), reflectsCurrentChatRoute, relayEnabled, maxAttempts };
}
