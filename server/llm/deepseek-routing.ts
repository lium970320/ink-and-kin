import type { LLMPurpose } from "./types";

export const DEEPSEEK_FLASH_PROVIDER = "DeepSeek-Flash";
export const DEEPSEEK_PRO_PROVIDER = "DeepSeek-Pro";
export const DEEPSEEK_DYNAMIC_ROUTING_EXTRA_CONFIG_KEY = "deepseekDynamicRouting";

const DYNAMIC_DEEPSEEK_ALIASES = new Set([
  "deepseek",
  "deepseek-auto",
]);

const PRO_PURPOSES = new Set<LLMPurpose>([
  "source_recall",
  "roleplay",
  "reflection",
  "persona_analysis",
  "skill_pipeline",
  "graduation",
  "scene_image_prompt",
  "scene_image_synopsis",
]);

function normalizeProviderName(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isDynamicDeepSeekProvider(value: string | undefined | null): boolean {
  return DYNAMIC_DEEPSEEK_ALIASES.has(normalizeProviderName(value));
}

export function readConfiguredDeepSeekDynamicRouting(extraConfig: unknown): boolean {
  if (!extraConfig || typeof extraConfig !== "object" || Array.isArray(extraConfig)) {
    return false;
  }
  return (extraConfig as Record<string, unknown>)[DEEPSEEK_DYNAMIC_ROUTING_EXTRA_CONFIG_KEY] === true;
}

export function findDeepSeekDynamicRoutingEnabled(
  configs: readonly { providerName?: string | null; extraConfig?: unknown }[],
): boolean {
  const config = configs.find((item) => isDynamicDeepSeekProvider(item.providerName));
  return readConfiguredDeepSeekDynamicRouting(config?.extraConfig);
}

export function deepSeekProviderForPurpose(purpose: LLMPurpose | undefined): string {
  return purpose && PRO_PURPOSES.has(purpose)
    ? DEEPSEEK_PRO_PROVIDER
    : DEEPSEEK_FLASH_PROVIDER;
}

export function resolveDeepSeekProvider(
  requestedProvider: string | undefined,
  purpose: LLMPurpose | undefined,
  defaultProvider: string,
  dynamicEnabled = false,
): string | undefined {
  const requested = requestedProvider?.trim();
  if (requested) {
    return isDynamicDeepSeekProvider(requested) && dynamicEnabled
      ? deepSeekProviderForPurpose(purpose)
      : requested;
  }

  return isDynamicDeepSeekProvider(defaultProvider) && dynamicEnabled
    ? deepSeekProviderForPurpose(purpose)
    : undefined;
}
