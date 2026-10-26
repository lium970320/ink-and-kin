/**
 * 人物生活配置由用户提供；默认不绑定特定人物、城市、机构或关系。
 *
 * 书中人适配（第 5 批）：书中人暂无 `_core/life-schedule` 模块（第 7 批接回），
 * 因此这里不引入其 `RoutineSlot` 类型；作息槽按原始数组保留，
 * 当前唯一消费者是角色频道的 selfPronoun（旁白代词兜底门控）。
 */

export type PersonaDayRoutines = {
  weekday: unknown[];
  saturday: unknown[];
  sunday: unknown[];
};

export type PersonaLifeConfig = {
  /** 三类日的作息槽；缺省时调用方使用 life-schedule 内置默认表 */
  routines?: PersonaDayRoutines;
  /** 生活行程 overlay 的「默认设定」行 */
  settingLine: string;
  /** 互动对象的称呼，用于"被{partner}叫醒"等 */
  partnerName: string;
  /** 原著专有词表（source recall 关键词识别用） */
  sourceTerms: string[];
  /** 当前用户性别代词（长期记忆第三人称归一），默认男性"他" */
  userPronoun: "他" | "她";
  /** 人物自己的性别代词（旁白代词兜底门控），默认男性"他"；女性人物需在 life 段显式覆盖 */
  selfPronoun: "他" | "她";
  /** 用户问到原著核心人物关系、但证据不足时的「资料不足兜底」文案（由用户配置） */
  sourceFallbackReply: string;
  /** 触发上面资料兜底的核心人物名（默认空）；用户问题含它才用资料兜底，否则用通用「记不准」兜底 */
  sourceFallbackTrigger: string;
};

export const DEFAULT_SETTING_LINE =
  "默认设定：普通虚构人物的日常生活；地点、职业和人物关系仅以用户配置及当前场景为准。";
export const DEFAULT_PARTNER_NAME = "对方";
export const DEFAULT_SOURCE_TERMS: string[] = [];
export const DEFAULT_USER_PRONOUN: "他" | "她" = "他";
export const DEFAULT_SELF_PRONOUN: "他" | "她" = "他";
export const DEFAULT_SOURCE_FALLBACK_TRIGGER = "";
export const DEFAULT_SOURCE_FALLBACK_REPLY = "这段资料暂时没有足够证据，我不能确定；可以提供原文后再核对。";

export function isLongDistanceSettingLine(settingLine: string): boolean {
  if (/异地|不要默认(?:同屋|同城|马上见面)/.test(settingLine)) return true;
  const residences = Array.from(
    settingLine.matchAll(/常驻([^，。；;,\s]{2,10})/g),
    (match) => match[1],
  );
  return new Set(residences).size >= 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lifeSection(personaData: unknown): Record<string, unknown> {
  if (!isRecord(personaData)) return {};
  const sections = isRecord(personaData.profileSections)
    ? personaData.profileSections
    : {};
  return isRecord(sections.life) ? sections.life : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback;
}

function parseRoutines(value: unknown): PersonaDayRoutines | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (key: string) =>
    Array.isArray(value[key]) ? (value[key] as unknown[]) : undefined;
  const weekday = pick("weekday");
  const saturday = pick("saturday");
  const sunday = pick("sunday");
  if (weekday && saturday && sunday) return { weekday, saturday, sunday };
  return undefined;
}

/** 读取 persona 生活配置：`profileSections.life` 覆盖默认；无覆盖时返回中性默认。 */
export function getPersonaLifeConfig(personaData: unknown): PersonaLifeConfig {
  const life = lifeSection(personaData);
  return {
    routines: parseRoutines(life.routines),
    settingLine: stringValue(life.settingLine, DEFAULT_SETTING_LINE),
    partnerName: stringValue(life.partnerName, DEFAULT_PARTNER_NAME),
    sourceTerms: stringArray(life.sourceTerms, DEFAULT_SOURCE_TERMS),
    userPronoun: life.userPronoun === "她" ? "她" : DEFAULT_USER_PRONOUN,
    selfPronoun: life.selfPronoun === "她" ? "她" : DEFAULT_SELF_PRONOUN,
    sourceFallbackReply: stringValue(
      life.sourceFallbackReply,
      DEFAULT_SOURCE_FALLBACK_REPLY,
    ),
    sourceFallbackTrigger: stringValue(
      life.sourceFallbackTrigger,
      DEFAULT_SOURCE_FALLBACK_TRIGGER,
    ),
  };
}
