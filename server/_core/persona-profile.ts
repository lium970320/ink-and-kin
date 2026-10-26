export const PROFILE_SECTIONS_KEY = "profileSections";
export const PROFILE_SCHEMA_VERSION = 1;
export const DEFAULT_COMPACT_LONG_BACKGROUND_CHARS = 2400;
export const DEFAULT_FULL_LONG_BACKGROUND_CHARS = 32000;

type UnknownRecord = Record<string, unknown>;

export type PersonaCoreProfile = {
  identity: string;
  hardFacts: string[];
  healthState: string;
  workAndLocation: string;
  userContext: string;
  relationshipStage: string;
};

export type PersonaPersonalityProfile = {
  traits: string;
  values: string;
  attachmentStyle: string;
  loveLanguage: string;
  conflictStyle: string;
};

export type PersonaRelationshipProfile = {
  nickname: string;
  memories: string;
  touchingMoments: string;
  feelingsForUser: string;
  boundaries: string;
};

export type PersonaSpeakingProfile = {
  style: string;
  catchphrases: string[];
  replyRules: string;
};

export type PersonaSourceProfile = {
  longBackground: string;
  sourcePolicy: string;
};

export type PersonaBehaviorProfile = {
  dailyScenes: string;
  proactiveStyle: string;
  customInstructions: string;
  starterQuestions: string[];
};

export type PersonaRuntimeProfile = {
  proactiveMessages?: unknown;
  runtimeLifeState?: unknown;
};

export type PersonaAppearanceProfile = {
  description: string;
};

export type PersonaProfileSections = {
  schemaVersion: number;
  core: PersonaCoreProfile;
  personality: PersonaPersonalityProfile;
  relationship: PersonaRelationshipProfile;
  speaking: PersonaSpeakingProfile;
  source: PersonaSourceProfile;
  behavior: PersonaBehaviorProfile;
  runtime: PersonaRuntimeProfile;
  appearance?: PersonaAppearanceProfile;
};

export type PersonaProfileContext = {
  name?: string | null;
  relationshipDesc?: string | null;
  togetherFrom?: string | null;
  togetherTo?: string | null;
};

export type PersonaLongBackgroundMode = "compact" | "full" | "none";

export type PersonaProfilePromptOptions = {
  longBackgroundMode?: PersonaLongBackgroundMode;
  compactLongBackgroundChars?: number;
  fullLongBackgroundChars?: number;
  /**
   * 情景内模式（角色生活频道等自成一体的场景）：剔除只对"日常聊天"成立的段落——
   * 日常所在地/异地关系、对用户的固定称呼、常用语气词、主动消息风格与日常场景。
   * 这些内容会与频道当下的时空和人物关系直接冲突（实测：山坡上的 18 岁少年被写成
   * 日常身份口吻）。默认 false，其他调用方行为不变。
   */
  sceneScoped?: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stringArrayValue(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map(item => typeof item === "string" ? item.trim() : "")
      .filter(Boolean);
    if (items.length > 0) return Array.from(new Set(items));
  }
  return [];
}

function section(data: UnknownRecord, key: string): UnknownRecord {
  const sections = isRecord(data[PROFILE_SECTIONS_KEY]) ? data[PROFILE_SECTIONS_KEY] : {};
  return isRecord(sections[key]) ? sections[key] : {};
}

function relationshipPeriod(context?: PersonaProfileContext): string {
  const from = context?.togetherFrom?.trim();
  const to = context?.togetherTo?.trim();
  if (from && to) return `${from} 至 ${to}`;
  if (from) return `从 ${from} 开始`;
  return "";
}

function defaultHardFacts(data: UnknownRecord): string[] {
  return stringArrayValue(data.hardFacts, data.facts, data.keyFacts);
}

export function normalizePersonaProfileSections(
  personaData: unknown,
  context: PersonaProfileContext = {},
): PersonaProfileSections {
  const data = isRecord(personaData) ? personaData : {};
  const core = section(data, "core");
  const personality = section(data, "personality");
  const relationship = section(data, "relationship");
  const speaking = section(data, "speaking");
  const source = section(data, "source");
  const behavior = section(data, "behavior");
  const runtime = section(data, "runtime");
  const appearance = section(data, "appearance");

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    core: {
      identity: stringValue(
        core.identity,
        data.coreIdentity,
        data.summary,
        context.name ? `你是 ${context.name}` : "",
      ),
      hardFacts: stringArrayValue(core.hardFacts, defaultHardFacts(data)),
      healthState: stringValue(core.healthState, data.healthState, data.bodyState),
      workAndLocation: stringValue(core.workAndLocation, data.workAndLocation, data.workBackground, data.locationContext),
      userContext: stringValue(core.userContext, data.userContext, data.userBackground),
      relationshipStage: stringValue(
        core.relationshipStage,
        data.relationshipStage,
        relationshipPeriod(context),
        context.relationshipDesc,
      ),
    },
    personality: {
      traits: stringValue(personality.traits, data.personality),
      values: stringValue(personality.values, data.values, data.personalityValues),
      attachmentStyle: stringValue(personality.attachmentStyle, data.attachmentStyle),
      loveLanguage: stringValue(personality.loveLanguage, data.loveLanguage),
      conflictStyle: stringValue(personality.conflictStyle, data.conflictStyle),
    },
    relationship: {
      nickname: stringValue(relationship.nickname, data.nickname),
      memories: stringValue(relationship.memories, data.memories),
      touchingMoments: stringValue(relationship.touchingMoments, data.touchingMoments),
      feelingsForUser: stringValue(relationship.feelingsForUser, data.feelingsForUser, data.feelingsForLiu, data.feelingsForreader),
      boundaries: stringValue(relationship.boundaries, data.boundaries, data.relationshipBoundaries),
    },
    speaking: {
      style: stringValue(speaking.style, data.speakingStyle),
      catchphrases: stringArrayValue(speaking.catchphrases, data.catchphrases),
      replyRules: stringValue(speaking.replyRules, data.replyRules, data.chatStyleRules),
    },
    source: {
      longBackground: stringValue(source.longBackground, data.longBackground),
      sourcePolicy: stringValue(source.sourcePolicy, data.sourcePolicy),
    },
    behavior: {
      dailyScenes: stringValue(behavior.dailyScenes, data.dailyScenes, data.dailyLifeScenes),
      proactiveStyle: stringValue(
        behavior.proactiveStyle,
        data.proactiveStyle,
        isRecord(data.proactiveMessages) ? data.proactiveMessages.stylePrompt : "",
      ),
      customInstructions: stringValue(behavior.customInstructions, data.customInstructions),
      starterQuestions: stringArrayValue(behavior.starterQuestions, data.starterQuestions),
    },
    runtime: {
      proactiveMessages: runtime.proactiveMessages ?? data.proactiveMessages,
      runtimeLifeState: runtime.runtimeLifeState ?? data.runtimeLifeState,
    },
    appearance: {
      description: stringValue(appearance.description, data.appearance, data.appearanceDescription),
    },
  };
}

export function withPersonaProfileSections(
  personaData: unknown,
  context: PersonaProfileContext = {},
): UnknownRecord {
  const data = isRecord(personaData) ? { ...personaData } : {};
  const normalized = normalizePersonaProfileSections(data, context);
  return {
    ...data,
    [PROFILE_SECTIONS_KEY]: normalized,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
  };
}

function hasContent(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value?.trim());
}

function linesForObject(title: string, lines: Array<string | undefined>): string {
  const active = lines.filter((line): line is string => Boolean(line?.trim()));
  return active.length ? `【${title}】\n${active.join("\n")}` : "";
}

function boundedPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * 情景内要剔除的日常路由块：异地/微信/主动消息/作息这类只在日常聊天成立的内容。
 * 这些块常常内嵌在画像字段里（自带【】小标题或"某某：…"前缀），字段级排除抓不到，只能按块过滤。
 */
const SCENE_SCOPED_DAILY_MARKERS = /异地|微信|朋友圈|主动消息|定时消息|作息|上下班|通勤|打电话|报平安|所在地/;

function dropDailyRoutingBlocks(text: string): string {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .filter(block => {
      const trimmed = block.trim();
      if (!trimmed) return false;
      // 只丢"带标题的"日常块，避免把人物核心画像这类无标题正文整段删掉。
      const labeled = /^【[^】]+】/.test(trimmed) || /^[^\n：]{2,12}：/.test(trimmed);
      return !(labeled && SCENE_SCOPED_DAILY_MARKERS.test(trimmed));
    })
    .join("\n\n")
    .trim();
}

function sourceBackgroundPrompt(profile: PersonaProfileSections, options: PersonaProfilePromptOptions): string {
  const background = profile.source.longBackground.trim();
  if (!background) return "";

  const mode = options.longBackgroundMode ?? "compact";
  if (mode === "none") {
    return [
      "【原著/长篇背景使用策略】",
      "本轮不常驻注入完整长篇资料，以节省额度并避免用概括记忆替代原文证据。",
      "仍必须遵守上方人物核心画像、关系阶段、硬性事实和说话方式。",
      "当用户询问原著剧情、回忆、地点、人物、先后顺序或动作细节时，只能依赖本轮资料库检索到的内部证据；没有证据就自然说记不准，不要凭印象补编。",
    ].join("\n");
  }

  if (mode === "full") {
    const limit = boundedPositiveInt(options.fullLongBackgroundChars, DEFAULT_FULL_LONG_BACKGROUND_CHARS);
    const clipped = background.slice(0, limit);
    return [
      "【原著/长篇背景设定】",
      "以下是高优先级人物资料。聊天时优先遵守这些事实、经历、关系、价值观、禁忌和说话习惯；不要随意编造与其矛盾的设定。",
      clipped,
      background.length > clipped.length ? "（长篇资料后续内容已因长度限制省略。）" : "",
    ].filter(Boolean).join("\n");
  }

  return [
    "【原著/长篇背景认知锚点】",
    "完整长篇资料不在普通聊天里常驻注入，避免旧剧情片段压过当前 AU 和结构化人物画像。",
    "普通聊天必须遵守上方人物核心画像、关系阶段、硬性事实、当前成年人爱人关系覆盖和说话方式。",
    "若用户询问原著具体情节、地点、人物、先后顺序或动作细节，必须依赖资料库检索片段；没有证据就说记不准，不要凭摘要编剧情。",
  ].filter(Boolean).join("\n");
}

export function buildPersonaProfilePromptSections(
  profile: PersonaProfileSections,
  options: PersonaProfilePromptOptions = {},
): string[] {
  const sceneScoped = options.sceneScoped === true;

  const coreLines = [
    profile.core.identity,
    hasContent(profile.core.hardFacts) ? `硬性事实：${profile.core.hardFacts.join("；")}` : "",
    profile.core.healthState ? `身体状态：${profile.core.healthState}` : "",
    // 日常所在地与"用户背景"描述的是日常聊天里的异地关系，情景内不注入。
    !sceneScoped && profile.core.workAndLocation ? `工作与所在地：${profile.core.workAndLocation}` : "",
    !sceneScoped && profile.core.userContext ? `用户背景：${profile.core.userContext}` : "",
    profile.core.relationshipStage ? `关系阶段：${profile.core.relationshipStage}` : "",
  ];

  const personalityLines = [
    profile.personality.traits,
    profile.personality.values ? `价值观/底层动机：${profile.personality.values}` : "",
    profile.personality.attachmentStyle ? `依恋类型：${profile.personality.attachmentStyle}` : "",
    profile.personality.loveLanguage ? `爱的语言：${profile.personality.loveLanguage}` : "",
    profile.personality.conflictStyle ? `争吵时：${profile.personality.conflictStyle}` : "",
  ];

  const relationshipLines = [
    profile.relationship.memories ? `重要记忆：${profile.relationship.memories}` : "",
    profile.relationship.touchingMoments ? `触动瞬间：${profile.relationship.touchingMoments}` : "",
    profile.relationship.feelingsForUser ? `对用户的情感：${profile.relationship.feelingsForUser}` : "",
    profile.relationship.boundaries ? `关系边界：${profile.relationship.boundaries}` : "",
  ];

  const speakingLines = sceneScoped
    // 情景内只保留人物音色的底层描述；固定称呼与日常微信口吻会与当下的关系和时空冲突。
    ? [profile.speaking.style]
    : [
        profile.speaking.style,
        hasContent(profile.speaking.catchphrases) ? `常用语气词：${profile.speaking.catchphrases.join("、")}` : "",
        profile.relationship.nickname ? `称呼对方：${profile.relationship.nickname}` : "",
        profile.speaking.replyRules ? `回复规则：${profile.speaking.replyRules}` : "",
      ];

  const behaviorLines = [
    profile.behavior.dailyScenes ? `日常生活场景：${profile.behavior.dailyScenes}` : "",
    profile.behavior.proactiveStyle ? `主动消息风格：${profile.behavior.proactiveStyle}` : "",
  ];

  const appearanceLines = [
    profile.appearance?.description ? `你的长相与形象：${profile.appearance.description}` : "",
    "被问到长相、身材、穿着或外形时，按上面的形象自然回答、保持前后一致；不要否认自己有具体长相。",
  ];

  const sections = [
    linesForObject("人物核心画像", coreLines),
    profile.appearance?.description ? linesForObject("外貌与形象", appearanceLines) : "",
    linesForObject("性格与情感模式", personalityLines),
    linesForObject("关系与共同记忆", relationshipLines),
    sourceBackgroundPrompt(profile, options),
    profile.source.sourcePolicy ? `【原著资料使用规则】\n${profile.source.sourcePolicy}` : "",
    linesForObject("说话方式", speakingLines),
    // 行为策略（主动消息风格/日常生活场景）纯属日常聊天路由，情景内不注入。
    sceneScoped ? "" : linesForObject("行为策略", behaviorLines),
  ].filter(Boolean);

  // 情景内再按块剔除内嵌的日常路由内容（异地细节、微信口径、主动消息等）。
  return sceneScoped ? sections.map(dropDailyRoutingBlocks).filter(Boolean) : sections;
}
