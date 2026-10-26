import { llmService } from "../llm";
import * as db from "../db";
import { computeEmotionalState } from "../_core/persona-utils";
import { cleanAssistantReply, isRepetitiveImmersiveReply } from "../_core/reply-utils";
import { buildChannelPersonaSystemPrompt, channelYouthToneRequested } from "./channel-persona-prompt";
import { getPersonaLifeConfig } from "../_core/persona-life-config";
import { hasProviderPolicyRefusal } from "./provider-policy-refusal";
import {
  buildDialogueQuotaInstruction,
  buildPersonShiftInstruction,
  buildStallBreakInstruction,
  buildStoryArcCue,
  buildStoryArcInstruction,
  buildStoryMemoryCue,
  currentArcStep,
  isSameStoryAnchor,
  normalizeStoryDirectorState,
  parseStoryPlan,
  shouldReplanStoryArc,
  type StoryDirectorState,
} from "./story-director";

const ROLEPLAY_MOODS = ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"] as const;

type RoleplayMood = typeof ROLEPLAY_MOODS[number];

export type RoleplayTurnMember = {
  personaId: number;
  personaName?: string;
  displayOrder: number;
  speakingEnabled: boolean;
  analysisStatus?: string;
};

export type RoleplayTranscriptMessage = {
  personaId: number | null;
  speakerName: string;
  role: string;
  content: string;
  createdAt?: Date;
};

export type ParsedRoleplayTurn = {
  shouldSpeak: boolean;
  reply: string;
  innerThought: string;
  mood: RoleplayMood;
};

export type RunRoleplayTurnOptions = {
  channelId: number;
  userId: number;
  personaId?: number;
  allowSilence?: boolean;
  /** 消息来源标记：channel=角色生活频道（默认），duet=QQ 对戏专用频道。仅用于数据区分。 */
  mode?: "channel" | "duet";
  /** 上层会话已切换时，终止尚未提交的生成；回调必须同步且无副作用。 */
  shouldAbort?: () => boolean;
};

export class RoleplayTurnCancelledError extends Error {
  constructor() {
    super("频道会话已切换，本轮生成已取消");
    this.name = "RoleplayTurnCancelledError";
  }
}

export type ChannelReflection = {
  /** 本轮应让谁接话：same=上一位继续（可连说），other=换人，null=由默认轮换决定 */
  nextSpeakerHint: "same" | "other" | null;
  /** 对下一位发言角色的内心活动预判（作为 innerThought 与节奏铺垫） */
  innerThought: string;
  mood: RoleplayMood;
  /** 生成时的节奏/深度策略提示 */
  replyStrategy: string;
  /** 预计篇幅：short | medium | long */
  replyLength: "short" | "medium" | "long";
  /** 多个角色中先让谁开口的倾向（可选，角色名） */
  preferredSpeaker?: string | null;
  /** 下一拍应发生的剧情推进（明确事件/动作/情绪进展），防止画面原地打转 */
  nextBeat?: string | null;
  /** 是否检测到最近几拍处于静止状态（睡/躺/沉默等），需要强制打破 */
  stuckOnStatic?: boolean;
  /** 对用户最新引导中已成立事实的内部承接确认，不直接发给用户 */
  acknowledgement?: string | null;
  /**
   * 本拍时空锚：一句话写清「此刻在哪里、大致什么时段、在场有谁、关键物件什么状态」。
   * 跨拍持久化在 runtimeDiagnostics 里，下一拍原样带回来，防止场景在无声无息中换地方
   * （实测故障：模板写的是盛夏午后山坡，几拍之后人物飘进屋里上了炕）。
   */
  sceneAnchor?: string | null;
  /**
   * 本拍适合自然带出的身份/背景落点（一句话）；不适合就 null。
   *
   * 为什么不每拍都塞：身份描写一旦变成"每拍配额"就很死板（用户明确否掉了这种写法）。
   * 由反思层判断时机——场景转换、安静相处、聊到过去与将来、称呼对方、掏东西/走路/吃饭
   * 这类地方适合带一处；动作主导时就不适合。但连续多拍一个身份词都没有时，
   * 反思层要主动安排一处（实测 18 条消息里 14 条零身份词，人物只剩身体、没有身份）。
   */
  identityCue?: string | null;
};

export type RoleplayTurnBeat = {
  personaId: number;
  speakerName: string;
  replyText: string;
  innerThought: string;
  emotionalState: RoleplayMood;
  messageId: number;
};

export type RunRoleplayTurnResult = {
  spoken: boolean;
  /** 网页任务已失效，调用方正常结束而非报告生成失败。 */
  cancelled?: boolean;
  /**
   * 书中人第 5 批不迁 QQ 交付：这两个字段只为 Roleplay.tsx 的客户端类型兼容而保留，
   * 生成侧恒不赋值（网页推进不再镜像到 QQ）。
   */
  qqDelivery?: import("../../shared/qq-delivery").QqDeliveryBatch[];
  qqDeliveryError?: string;
  channelId: number;
  personaId: number;
  speakerName: string;
  replyText: string;
  innerThought: string;
  emotionalState: RoleplayMood;
  messageId?: number;
  /** 本次调用实际落库的全部人物发言，按消息写入顺序排列；顶层字段仍指第一拍。 */
  beats?: RoleplayTurnBeat[];
  /** 本轮没能开口的可展示原因（例如上游安全拒绝），供 QQ/网页如实告诉用户。 */
  skippedReason?: string | null;
};

function normalizeMood(value: unknown, fallback: string): RoleplayMood {
  const text = typeof value === "string" ? value.trim() : "";
  if ((ROLEPLAY_MOODS as readonly string[]).includes(text)) return text as RoleplayMood;
  if ((ROLEPLAY_MOODS as readonly string[]).includes(fallback)) return fallback as RoleplayMood;
  return "warm";
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripCodeFence(text);
  const candidates = [
    stripped,
    stripped.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next
    }
  }

  // 语法容错修复：修复常见的缺失前导引号 (例如 reply": 代替 "reply":) 以及未转义的特殊字符
  for (const candidate of candidates) {
    try {
      const repaired = candidate
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)":/g, '$1"$2":')
        .replace(/([{,]\s*)"([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue to regex extraction
    }
  }

  // 正则提取兜底：即使 JSON 完全破损，也精准抽取出字段内容，绝不让原始代码块泄露
  const result: Record<string, unknown> = {};
  let foundAny = false;

  const shouldSpeakMatch = stripped.match(/"?shouldSpeak"?\s*:\s*(true|false)/i);
  if (shouldSpeakMatch) {
    result.shouldSpeak = shouldSpeakMatch[1].toLowerCase() === "true";
    foundAny = true;
  }

  const shouldSpeakDiagMatch = stripped.match(/"?shouldSpeakDialogue"?\s*:\s*(true|false)/i);
  if (shouldSpeakDiagMatch) {
    result.shouldSpeakDialogue = shouldSpeakDiagMatch[1].toLowerCase() === "true";
    foundAny = true;
  }

  const innerThoughtMatch = stripped.match(/"?innerThought"?\s*:\s*"([\s\S]*?)(?=(?:"\s*,\s*"?\w+"?\s*:|"\s*\}|\n\s*"?\w+"?\s*:|\n\s*\}))/i);
  if (innerThoughtMatch) {
    result.innerThought = innerThoughtMatch[1].trim();
    foundAny = true;
  }

  const narrationMatch = stripped.match(/"?narration"?\s*:\s*"([\s\S]*?)(?=(?:"\s*,\s*"?\w+"?\s*:|"\s*\}|\n\s*"?\w+"?\s*:|\n\s*\}))/i);
  if (narrationMatch) {
    result.narration = narrationMatch[1].trim();
    foundAny = true;
  }

  const dialogueMatch = stripped.match(/"?dialogue"?\s*:\s*"([\s\S]*?)(?=(?:"\s*,\s*"?\w+"?\s*:|"\s*\}|\n\s*"?\w+"?\s*:|\n\s*\}))/i);
  if (dialogueMatch) {
    result.dialogue = dialogueMatch[1].trim();
    foundAny = true;
  }

  const replyMatch = stripped.match(/"?reply"?\s*:\s*"([\s\S]*?)(?=(?:"\s*,\s*"?\w+"?\s*:|"\s*\}|\n\s*"?\w+"?\s*:|\n\s*\}))/i);
  if (replyMatch) {
    result.reply = replyMatch[1].trim();
    foundAny = true;
  }

  const moodMatch = stripped.match(/"?mood"?\s*:\s*"([a-zA-Z0-9_-]+)"/i);
  if (moodMatch) {
    result.mood = moodMatch[1].trim();
    foundAny = true;
  }

  return foundAny ? result : null;
}

/** 彻底清洗泄露的 JSON 代码块或花括号 */
export function sanitizeRawRoleplayReply(text: string): string {
  if (!text) return "";
  let out = stripCodeFence(text).trim();
  if (/^\s*\{[\s\S]*\}\s*$/.test(out) || /^\s*\{[\s\S]*"shouldSpeak"/.test(out)) {
    const narrationMatch = out.match(/【[\s\S]*?】/g);
    if (narrationMatch && narrationMatch.length > 0) {
      return narrationMatch.join("\n\n");
    }
    const textMatch = out.match(/"?(?:reply|dialogue|narration)"?\s*:\s*"([\s\S]*?)"/);
    if (textMatch && textMatch[1].trim()) {
      return textMatch[1].replace(/\\n/g, "\n").trim();
    }
    return "";
  }
  return out;
}

function stripSpeakerPrefix(text: string, speakerName: string): string {
  const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`^\\s*${escaped}\\s*[：:]\\s*`), "")
    .replace(/^\s*(回复|发言|正文)\s*[：:]\s*/, "")
    .trim();
}

export function parseRoleplayTurnResponse(raw: string, speakerName: string, fallbackMood: string): ParsedRoleplayTurn {
  const parsed = extractJsonObject(raw);
  const shouldSpeak = parsed?.shouldSpeak !== false;

  let replyText = "";
  if (typeof parsed?.narration === "string" && parsed.narration.trim()) {
    const narration = parsed.narration.trim().replace(/\\n/g, "\n");
    const cleanNarration = hasNarrationBlock(narration) ? narration : `【${narration}】`;
    const dialogue = typeof parsed.dialogue === "string" ? parsed.dialogue.trim().replace(/\\n/g, "\n") : "";
    // 修复：历史上只在模型显式输出 shouldSpeakDialogue:true 时才保留台词，但没有任何提示词
    // 要求过这个字段，于是 {narration, dialogue} 形状的输出会把台词整段丢掉、只剩旁白。
    const shouldSpeakDialogue = parsed.shouldSpeakDialogue !== false && dialogue.length > 0;

    if (shouldSpeakDialogue) {
      replyText = `${cleanNarration}\n\n${dialogue}`;
    } else {
      replyText = cleanNarration;
    }
  } else if (typeof parsed?.reply === "string" && parsed.reply.trim()) {
    replyText = parsed.reply.replace(/\\n/g, "\n");
  } else {
    replyText = sanitizeRawRoleplayReply(raw);
  }

  const innerThought = typeof parsed?.innerThought === "string" ? parsed.innerThought.trim() : "";
  const mood = normalizeMood(parsed?.mood, fallbackMood);
  // 不再使用硬编码兜底台词（曾导致频道里反复冒出「我在。」）：剥空就交空串，
  // 由下游的旁白补齐与静默逻辑处理。
  //
  // immersiveMode: true 是必需的：频道本来就是沉浸格式，旁白必须落库。
  // 这里曾经漏传这个参数，cleanAssistantReply 于是走"非沉浸交付"分支，把所有
  // 【…】旁白清干净、只留下台词；紧接着 decorateReplyWithNarration 发现"缺少【】旁白"，
  // 又用一次补写调用把旁白重写一遍。结果：主生成花几千 token 写的旁白被整段丢弃，
  // 落库的旁白反而来自看不到人设、世界锚与场景框的补写调用。

  const reply = cleanAssistantReply(stripSpeakerPrefix(replyText, speakerName), "", {
    immersiveMode: true,
  });
  const sanitizedReply = sanitizeRawRoleplayReply(reply);

  return {
    shouldSpeak: shouldSpeak && (sanitizedReply.length > 0 || parsed?.shouldSpeak === false),
    reply: sanitizedReply,
    innerThought,
    mood,
  };
}

export function orderedEnabledRoleplayMembers<T extends RoleplayTurnMember>(members: T[]): T[] {
  return members
    .filter(member => member.speakingEnabled && (!member.analysisStatus || member.analysisStatus === "ready"))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.personaId - b.personaId);
}

export function pickNextRoleplayMember<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  requestedPersonaId?: number,
): T | null {
  const enabled = orderedEnabledRoleplayMembers(members);
  if (enabled.length === 0) return null;

  if (requestedPersonaId) {
    return enabled.find(member => member.personaId === requestedPersonaId) ?? null;
  }

  // 1. 如果用户最新剧情引导明确提及了某位角色，优先由 TA 主导后续动作
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  if (lastUserMessage?.content) {
    const mentioned = enabled.find(m => {
      const name = (m as any).personaName;
      return typeof name === "string" && name.length > 0 && lastUserMessage.content.includes(name);
    });
    if (mentioned) {
      const recentByMentioned = messages.slice(-3).filter(m => m.role === "persona" && m.personaId === mentioned.personaId).length;
      if (recentByMentioned < 3) {
        return mentioned;
      }
    }
  }

  const personaMessages = [...messages]
    .filter(message => message.role === "persona" && typeof message.personaId === "number");
  const lastPersonaMessage = personaMessages[personaMessages.length - 1];
  if (!lastPersonaMessage?.personaId) return enabled[0];

  const recentBySame = personaMessages.slice(-3).filter(m => m.personaId === lastPersonaMessage.personaId).length;
  const lastIndex = enabled.findIndex(member => member.personaId === lastPersonaMessage.personaId);
  if (lastIndex < 0) return enabled[0];

  // 自由化：若最近已有连续主导（对方沉默中），且未超过上限，允许继续由 TA 推进
  if (recentBySame >= 2 && recentBySame < 3) return enabled[lastIndex];

  return enabled[(lastIndex + 1) % enabled.length];
}

export function roleplayTurnCandidates<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  requestedPersonaId?: number,
): T[] {
  const enabled = orderedEnabledRoleplayMembers(members);
  if (enabled.length === 0) return [];
  if (requestedPersonaId) {
    const found = enabled.find(member => member.personaId === requestedPersonaId);
    return found ? [found] : [];
  }
  const start = pickNextRoleplayMember(members, messages);
  const startIndex = start ? enabled.findIndex(member => member.personaId === start.personaId) : 0;
  return enabled.map((_, offset) => enabled[(startIndex + offset) % enabled.length]);
}

/**
 * 反思驱动的候选排序：需要"上一位连说"时把上一位排最前，否则保持原有轮换顺序。
 * 这让频道对话不再机械地一人一句，而是可以出现一人连续承续的自然节奏。
 */
export function reflectedRoleplayTurnCandidates<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  reflection: ChannelReflection | null,
  requestedPersonaId?: number,
): T[] {
  const enabled = orderedEnabledRoleplayMembers(members);
  if (enabled.length === 0) return [];
  if (requestedPersonaId) {
    const found = enabled.find(member => member.personaId === requestedPersonaId);
    return found ? [found] : [];
  }
  // 连说硬上限：最近 3 条都是同一个人时，不再接受反思层的 "same"。
  // 反思提示词里写着 "same …非常推荐"，遇到"这一拍由他继续主导"就会一路 same 下去，

  // 自然的"有人话多"仍然允许（最多连说 2-3 拍），但不能再锁死。
  const recentSpeakerIds = messages
    .filter(message => message.role === "persona" && typeof message.personaId === "number")
    .slice(-3)
    .map(message => message.personaId as number);
  const sameSpeakerLocked = recentSpeakerIds.length >= 3
    && recentSpeakerIds.every(id => id === recentSpeakerIds[0]);

  if (reflection?.nextSpeakerHint === "same" && !sameSpeakerLocked) {
    // 上一位连说：把最近发言者提到最前，其余照轮换序
    const lastPersonaMessage = [...messages]
      .reverse()
      .find(message => message.role === "persona" && typeof message.personaId === "number");
    if (lastPersonaMessage?.personaId) {
      const last = enabled.find(member => member.personaId === lastPersonaMessage.personaId);
      if (last) {
        const rest = enabled.filter(member => member.personaId !== last.personaId);
        return [last, ...rest];
      }
    }
  }
  // 注意：连说上限必须同时挡住 preferredSpeaker，否则反思层改口"指定某人主导"就绕过了上限

  if (reflection?.preferredSpeaker && !sameSpeakerLocked) {
    const preferred = enabled.find(member => member.personaName === reflection.preferredSpeaker);
    if (preferred) {
      const rest = enabled.filter(member => member.personaId !== preferred.personaId);
      return [preferred, ...rest];
    }
  }
  return roleplayTurnCandidates(members, messages, requestedPersonaId);
}

function hasNarrationBlock(text: string): boolean {
  return /【[\s\S]*?】/.test(text || "");
}

/**
 * 频道代词兜底（门控版）：仅当频道内全部成员都是男性时，才把模型误写的"她"改为"他"。
 * 频道成员含女性、或无法确认全为男性时原样返回，绝不把女性角色的代词静默改错。
 * 人物性别取自 profileSections.life.selfPronoun，缺省"他"（= 历史全男频道行为）。
 * 未传 options 时保持历史行为，旧调用方语义不变。
 */
export function sanitizeChannelGender(
  text: string,
  options?: { allMembersMale?: boolean },
): string {
  if (!text) return text;
  if (options?.allMembersMale === false) return text;
  return text.replace(/她/g, "他");
}

/**
 * 频道复读重写指令：列出该角色自己最近写过的【】旁白与台词，要求整段换新写法。
 * 只用于「同一角色跨拍复读」，不做跨角色比对——频道里两位角色本来就会互相呼应。
 */
export function buildChannelAntiRepeatInstruction(recentReplies: string[]): string {
  const examples = recentReplies
    .flatMap(text => {
      const asides = text.match(/【[^】]+】/g);
      return asides && asides.length > 0 ? asides : [text];
    })
    .slice(-6)
    .map(text => `- ${Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 90).join("")}`)
    .join("\n");
  return [
    "【频道严禁复写·最高优先·输出前最后检查】你最近几拍已经写过下面这些【】旁白/台词画面：",
    examples,
    "本轮必须继续当前剧情向前推进，但换全新的动作走向、身体位置、环境锚点、感官细节和句式；绝不要原样或近义复写其中任何一段，也不要复用同一组意象组合。整段作废并从头重写，只输出重写后的完整 JSON。",
  ].join("\n");
}

/**
 * 频道外来人名检测（窄口径、高精度）。
 *
 * 实测故障：模型在九十年代山村情景里凭空写出第三人名「阿莲」，而这个人名在人物资料、
 * 记忆、原著分块、频道情境里都不存在；它一落库就进入后续每一轮的上下文，自己把自己变成了设定。
 * 这里只抓「阿X」形状——中文行文里它几乎总是人名或亲属称谓，排除常见亲属词后误报率很低；
 * 「小X / 老X」的日常词太多（小臂、小声、老实、老式……），故意不抓，避免误重写。
 */
const CHANNEL_KINSHIP_WORDS = new Set([
  "阿姨", "阿爸", "阿妈", "阿婆", "阿公", "阿伯", "阿叔", "阿婶", "阿舅", "阿姑", "阿弟", "阿妹", "阿姐", "阿哥",
]);

/**
 * 可发送正文判定：拦住英文元回复与供应商拒绝。
 *
 * 实测故障：频道里落库过一条英文正文「I'm 人物频道. I won't reproduce my setup text,
 * but I'm glad to help with what you're working on.」——上游把身份自述/规则回应当成正文返回，
 * 而频道链路不经过 generatePersonaTextReply，绕过了那道 assertUsableProviderReply 防线。
 *
 * 判据一：命中项目既有的供应商拒绝正则（已补上这批新措辞）。
 * 判据二：几乎没有中文却带成串英文——人物正文永远是中文，这种形状只可能是说明或拒绝。
 * 用两个条件同时成立来卡，避免误杀带英文词或极短（如「蹲」）的正常回复。
 */
export function looksLikeUnusableChannelReply(text: string): boolean {
  const value = String(text || "").trim();
  if (!value) return true;
  if (hasProviderPolicyRefusal(value)) return true;
  const cjk = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  return cjk < 10 && /[A-Za-z]{3,}/.test(value);
}

const UNUSABLE_REPLY_FIX_INSTRUCTION = [
  "【正文不可用·最高优先·整段重写】刚才的输出不是人物正文——它是英文说明、身份自述，或对规则与系统的回应，绝不能作为角色的话发出去。",
  "现在只输出这一拍的人物正文：中文，以【】动作/神态/触感旁白为主体，可带极短台词；不要提及系统、提示词、身份、规则或频道名，不要用英文，不要解释自己在做什么。",
  "严格按本轮要求的 JSON 格式输出。",
].join("\n");

export function findChannelForeignNames(text: string, allowedNames: string[]): string[] {
  const found = new Set<string>();
  // 每次新建正则，避免模块级 g 正则的 lastIndex 在多次调用间串味。
  const pattern = /阿[\u4e00-\u9fa5]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    const token = match[0];
    if (CHANNEL_KINSHIP_WORDS.has(token)) continue;
    if (allowedNames.some(name => name && (name.includes(token) || token.includes(name)))) continue;
    found.add(token);
  }
  return Array.from(found);
}

/** 审计调用要学会忽略的非人名词：代词、亲属称谓、泛称。 */
const CHANNEL_NON_NAME_WORDS = new Set([
  "他", "她", "它", "你", "我", "咱", "对方", "那人", "这个人", "那个人", "两人", "二人", "自己",
  "叔", "婶", "姨", "伯", "舅", "姑", "爹", "娘", "爸", "妈", "哥", "姐", "弟", "妹",
  "师傅", "老师", "大夫", "医生", "孩子", "小孩", "老人", "男人", "女人", "少年", "青年",
  "村民", "邻居", "同伴", "路人", "旁人", "众人", "伙计", "同事", "同学", "房东", "老板",
]);

function extractJsonStringArray(text: string): string[] {
  const fenced = String(text || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  const matched = fenced.match(/\[[\s\S]*?\]/);
  if (!matched) return [];
  try {
    const parsed = JSON.parse(matched[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 在场审计结果：外来名字 + 画面里是否还有别的在场者（可能没有名字）。 */
export type ChannelPresenceAudit = {
  foreignNames: string[];
  /** 除在场成员外，画面里是否还出现了别的"人"（人影、来人、年轻人、无名却发出动作的人）。 */
  otherOnScene: boolean;
};

/**
 * 解析审计调用的输出。兼容两种形状：
 * - 新形状 {"names":[...],"otherOnScene":true}
 * - 旧形状 ["名字", ...]（按只有名字处理）
 * 解析失败一律按"没问题"处理，绝不因为审计坏了就阻断生成。
 */
export function parseChannelPresenceAudit(raw: string): ChannelPresenceAudit {
  const fenced = String(raw || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  const objectMatch = fenced.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const names = Array.isArray((parsed as any).names)
          ? ((parsed as any).names as unknown[])
              .filter((item): item is string => typeof item === "string")
              .map(item => item.trim())
              .filter(Boolean)
          : [];
        return { foreignNames: names, otherOnScene: (parsed as any).otherOnScene === true };
      }
    } catch {
      // 落到旧形状解析
    }
  }
  return { foreignNames: extractJsonStringArray(fenced), otherOnScene: false };
}

/**
 * 生成后的在场审计：用一个极短的调用，同时把「外来人名」和「画面里有没有别的在场者」抽出来。
 *
 * 为什么不能只靠正则：
 * - 实测模型会凭空造出「阿莲」（阿X 形状能抓）和「桂英」（没有任何固定形状，正则抓不到）；
 * - 更隐蔽的一种是**没有名字的第三人**——「从草脊后头冒出一个人影」「上来一个二十来岁的年轻人」。
 *   这种既没有名字也没有固定形状，旧闸门完全看不见，而它会直接把角色演崩：
 *   指称铁律不允许代词，模型没有第三个称呼可用，只能借用在场成员的名字。
 *
 * 审计调用关闭隐藏思考，短而快；审计本身失败时返回"没有问题"（宁可放过，不阻断生成）。
 */
export async function auditChannelReplyPresence(params: {
  reply: string;
  allowedNames: string[];
  userId: number;
}): Promise<ChannelPresenceAudit> {
  const text = String(params.reply || "").trim();
  if (!text) return { foreignNames: [], otherOnScene: false };
  try {
    const response = await llmService.invoke({
      messages: [
        { role: "system", content: "你只做两件事，只输出一个 JSON 对象，不要解释、不要 Markdown。" },
        {
          role: "user",
          content: [
            "读下面正文，输出：{\"names\":[\"正文里出现的人物名字\"],\"otherOnScene\":true 或 false}",
            "names 规则：小名、绰号、用具体名字指称的人都算；代词（他/她/对方/那人）、亲属称谓（叔/婶/姨）、泛称（村民/邻居/师傅/老人/孩子）都不算名字；地名、物件名不算。",
            "otherOnScene 规则：判断「除 names 指代的人之外，画面里是否还有别的在场者」——人影、身影、来人、年轻人、陌生人、站在几步外的人、冒出来的人，以及任何没有名字却被写成动作发出者的人，都算 true。",
            "otherOnScene 规则：只有无名的动静（风声、脚步声、人声、车声、器物响动、光线变化）不算在场者，为 false。",
            "只输出一个 JSON 对象，例如 {\"names\":[\"角色甲\"],\"otherOnScene\":false}。",
            "正文：\n" + text.slice(0, 1500),
          ].join("\n"),
        },
      ],
      options: {
        temperature: 0,
        maxTokens: 300,
        usageContext: { userId: params.userId, purpose: "roleplay", route: "roleplay.channel_roster_audit" },
        disableThinking: true,
      },
    });
    const audit = parseChannelPresenceAudit(response || "");
    return {
      foreignNames: audit.foreignNames.filter(name => {
        if (CHANNEL_NON_NAME_WORDS.has(name)) return false;
        return !params.allowedNames.some(
          allowed => allowed && (allowed === name || name.includes(allowed) || allowed.includes(name))
        );
      }),
      otherOnScene: audit.otherOnScene,
    };
  } catch (err) {
    console.warn("[RoleplayRoster] audit failed, skip check:", err);
    return { foreignNames: [], otherOnScene: false };
  }
}

/** 旧接口：只关心外来人名时使用（内部复用同一次审计）。 */
export async function auditChannelReplyNames(params: {
  reply: string;
  allowedNames: string[];
  userId: number;
}): Promise<string[]> {
  const audit = await auditChannelReplyPresence(params);
  return audit.foreignNames;
}

/**
 * 画面里出现"在场成员之外的人"的迹象。
 *
 * 只看"有人声/脚步声"这类无名动静不算——那是世界规则明确允许的推进来源；
 * 这里抓的是把动静升级成"一个具体的人"的写法。
 */
const THIRD_PARTY_ON_SCENE =
  /人影|身影|陌生人|来人|年轻人|后生|汉子|站着一个|站着一个人|多了一个|第三个人|另一个人|旁边有人|有人上来|有人站在|看见有人|冒出来一个人/;

/**
 * 旁白代词归一：把【】里的“对方”回填成在场对方的真实名字。
 *
 * 这是幻觉人名的上游治理。频道只有两位在场成员，旁白里的“对方”必然指另一位；
 * 实测一旦记录里对方始终没有名字（每个角色只写自己的名字、对方全写“对方”），
 * 下一轮模型就无名字可用，只能凭空造一个（阿莲、桂英都是这么来的）。
 * 落库前统一回填真名，保证每一轮记录里都带着名字。只处理【】内部，
 * 【】外的台词保持自然口吻（那里“我/你”本来就是对的）。
 *
 * ⚠️ 实测事故（2026-09，必须保留这段历史）：
 * 旧实现无条件把“对方|那个人|那人”都回填成对方成员名。剧情里一旦出现第三个人，
 * 模型只能用“那人”去指他（指称铁律禁止代词，又没有第三个名字可用），
 * 归一化就把这个无名者硬写成了在场成员——库里出现了
 * 保持人物身份与当前频道情境一致。
 * 这种字符级错乱，而且一落库就进入后续每一轮的上下文，角色彻底崩掉。
 * 因此现在：
 * ①“那人/那个人”一律不再回填（它们天然可能指第三方）；
 * ②只要正文里出现第三人迹象，整段跳过归一化（连“对方”也不动）。
 */
export function normalizeNarrationReferences(
  text: string,
  speakerName: string,
  allNames: string[],
): string {
  if (!text) return text;
  const partner = allNames.find(name => name && name !== speakerName);
  if (!partner) return text;
  if (THIRD_PARTY_ON_SCENE.test(text)) return text;
  return text.replace(/【[^】]*】/g, block => block.replace(/对方/g, partner));
}

/**
 * 在场纠偏指令：把跑进画面的外人清掉。
 *
 * 两种情况共用一条指令：
 * - foreignNames 非空：出现了不属于频道的人名（阿莲、桂英这类）；
 * - otherOnScene=true 且没有名字：出现了"没有名字的第三人"（人影、来人、年轻人、
 *   被写成动作发出者的无名者）。后者是 2026-09 实测事故的元凶——它既没有名字也没有固定形状，
 *   旧闸门完全看不见，落库后模型只能借用在场成员的名字去指他，角色当场崩掉。
 */
export function buildChannelRosterFixInstruction(
  foreignNames: string[],
  allowedNames: string[],
  options: { otherOnScene?: boolean } = {},
): string {
  const roster = `本频道此刻在场的只有：${allowedNames.join("、")}。`;
  if (foreignNames.length === 0 && options.otherOnScene) {
    return [
      "【在场纠偏·最高优先】上面这条 JSON 的 reply 里出现了一个不在本频道的人（可能没有名字：人影、身影、来人、年轻人、陌生人，或一个没有名字却在做动作的人）。",
      roster + "除这两位以外，画面里不得再有第三个人在场。",
      "就地修改上面这条 JSON，不要另写一拍：把这个人的出场整段删掉，把那段改回无名的动静（脚步、风、门响、器物、远处的车声人声），或干脆删掉；**绝不要**把这个人写成在场成员之一、也不要让在场成员替他站在那个位置或做那个动作。其余剧情、动作、情绪、篇幅、【】旁白与台词结构全部原样保留。只输出改好后的完整 JSON。",
    ].join("\n");
  }
  return [
    `【在场名录纠偏·最高优先】上面这条 JSON 的 reply 里出现了一个不属于本频道的人名：「${foreignNames.join("、")}」。`,
    `${roster}除这几个名字以外，正文（含【】旁白与台词）里不得出现任何其他人名、昵称或称呼。`,
    "就地修改上面这条 JSON，不要另写一拍：把那个人改成在场成员之一，或改成无名的动静（脚步、风、器物、声响）；其余剧情、动作、情绪、篇幅、【】旁白与台词结构全部原样保留。只输出改好后的完整 JSON。",
  ].join("\n");
}

/**
 * 频道辅助调用（节奏反思 / 旁白补写）的 token 预算。
 *
 * 实测教训：当前默认模型开启思考且推理档位很高（thinking=enabled、reasoningEffort=xhigh），
 * 隐藏推理会吃掉绝大部分预算。预算过小时上游会「请求成功但正文为空」，而且不报任何错误——
 * 节奏反思曾因此长期静默返回 null，「下一拍 / 静止打破 / 连说」整条策划层等于关闭。
 * 这里给出实测可用的下限，并在拿到空正文时按倍数重试一次并告警，避免再次静默失效。
 */
// 这两个辅助调用都显式关闭隐藏思考（disableThinking），所以预算不用再迁就推理开销；
// 仍然保留「空正文按倍数重试一次」的兜底，覆盖用户配置里没有思考开关的情况。
/** 连续几拍时空锚没变就算"原地打转"，从这一拍开始强制跳拍。 */
const STALL_BREAK_THRESHOLD = 2;

// 辅助调用的基础预算。这些都是"上限"不是"目标"，放宽几乎不增加成本，

// 重试到 8000 就必成功——说明是预算不够被截，不是上游随机抖动）。
const CHANNEL_REFLECTION_MAX_TOKENS = 2200;
const CHANNEL_NARRATION_MAX_TOKENS = 2200;
const CHANNEL_DIRECTOR_ARC_MAX_TOKENS = 1800;

/**
 * 频道人物正文是否默认关闭隐藏思考。
 *
 * 结论（2026-09 同提示词 3v3 对照）：默认**开着**（false）。两边都带上 16384 预算与
 * 推理上限之后，关思考在字数/【】旁白/口吻/JSON 合法率上没有可测优势，也不更快
 * （省下的预算它会拿去写更长的正文）；而开思考在旁白段数与正文长度上略好。
 * 撞顶由「16384 总预算 + reasoningMaxTokens 软上限」解决，不再靠关思考解决；
 * 真出现空正文时由 invokeChannelTurnWithEmptyReplyRetry 关闭思考重试兜底。
 */
const CHANNEL_MAIN_DISABLE_THINKING = false;

/**
 * 书中人没有私有 llm/economy 模块：不做 strict 省额度降级，
 * 旁白补写 / 在场审计 / 复读闸门等质量兜底一律恒开。
 */
const CHANNEL_FULL_QUALITY = true;

async function invokeChannelAuxiliary(params: {
  label: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  options: {
    temperature: number;
    maxTokens: number;
    /** 辅助调用一律关掉隐藏思考，避免推理吃掉预算导致「成功但正文为空」。 */
    disableThinking: boolean;
    /** 书中人统一走 llmService + usageContext：自动切 invokeForUser，走用户路由并记用量。 */
    usageContext: { userId: number; route: string; purpose: "roleplay" };
  };
}): Promise<string> {
  const first = await llmService.invoke({ messages: params.messages, options: params.options });
  if (String(first || "").trim()) return first;
  const retryTokens = Math.max(params.options.maxTokens * 2, 8000);
  console.warn(
    `[RoleplayAux] ${params.label} 首次返回空正文（maxTokens=${params.options.maxTokens}），按 ${retryTokens} 重试一次`
  );
  const second = await llmService.invoke({
    messages: params.messages,
    options: { ...params.options, maxTokens: retryTokens },
  });
  if (!String(second || "").trim()) {
    console.warn(`[RoleplayAux] ${params.label} 重试后仍为空正文：本轮降级跳过该辅助步骤`);
  }
  return second;
}

/**
 * 旁白兜底：若生成结果没有【】旁白，由短调用按当前情景补写 1 段旁白并前置。
 * 失败静默返回原回复，绝不让生成链路断掉。
 */
async function decorateReplyWithNarration(params: {
  channel: db.RoleplayChannelView;
  speakerName: string;
  reply: string;
  /** 本拍时空锚：补写的旁白必须落在这个地点与时段的延续里。 */
  sceneAnchor?: string | null;
  /** 最近的频道记录：让补写调用看得到已经发生的事与已经出现的道具。 */
  recentTranscript?: string | null;
}): Promise<string> {
  const reply = params.reply || "";
  if (hasNarrationBlock(reply) || !reply.trim()) return reply;

  // 必须把对方的名字明确给出来。这里曾经只说"说话人：X"却要求"一律用角色名"，
  // 模型无从得知对方叫什么，只能退回"对方/他"——于是记录里对方的名字彻底消失，

  const otherNames = (params.channel.members || [])
    .map(member => (member as any).personaName)
    .filter((name: string) => name && name !== params.speakerName);
  const partnerName = otherNames[0] || "对方";

  // 场景上下文：这一段曾经完全没有，补写调用不知道两人在哪里，只能自己发明一个环境，
  // 于是同一场山坡戏被它写成"窗缝里漏进来的风"，再被落库成设定，剧情就此断掉。
  const sceneBrief = String(params.channel.scenePrompt || "").trim().slice(0, 700);
  const transcriptBrief = String(params.recentTranscript || "").trim().slice(-1500);
  const anchorBrief = String(params.sceneAnchor || "").trim();

  const prompt = [
    `把下面这段台词补写成一段画面感极强、镜头细腻的生活场景对戏回复：开头补 1-2 段详实的【】动作/神态/触感旁白（字数约 100-200 字，把身体动作过程、微表情与温度触感写透），再接原文台词。`,
    `说话人：${params.speakerName}。互动对象：${partnerName}。本轮在场只有这两位，没有第三个人。`,
    sceneBrief ? `本频道的场景与前情：\n${sceneBrief}` : "",
    anchorBrief
      ? `★本拍时空锚（旁白必须落在这个地点与时段的延续里）：${anchorBrief}`
      : "",
    transcriptBrief
      ? `★最近已经发生的记录（你的旁白必须与它一致：同一个人、同一个地方、同一批道具、动作接着上一拍）：\n${transcriptBrief}`
      : "",
    `★地点铁律（最重要）：【】旁白里出现的地点、环境与物件必须与上面的场景和时空锚一致——同一个地方、同一个时段、同一个季节天气。不得把两人搬进屋里、床上、窗边或任何新场所；不得出现场景里没有的道具（锅、碗、勺、汤、被褥、炉火等）。本轮只补动作、神态、触感与呼吸，绝不新增物品、绝不换地方。如果连地点都无法确定，就只写身体动作与呼吸，不要写任何环境。`,
    `★指称铁律（最重要）：【】旁白里指说话人一律写「${params.speakerName}」，指互动对象一律写「${partnerName}」；绝对不要用“他/她/你/我/对方/那人”来指代这两位中的任何一位。例：【${params.speakerName}伸手扣住${partnerName}的手腕】。`,
    `台词原文：${reply.trim().slice(0, 600)}`,
    `关键要求：直接写当下正在发生的具体动作步骤、眼神微表情或肢体触感，承接当前这一拍；不要重新描述大环境、不要用场景开场句（如:深夜的大殿里只剩……）。`,
    "只输出补写后的完整文本，开头必须是【】详尽旁白，不要解释、不要 Markdown、不要说话人前缀。",
  ].join("\n\n");

  try {
    const response = await invokeChannelAuxiliary({
      label: "旁白补写",
      messages: [
        { role: "system", content: "你是这段双人生活场景的电影级旁白润色者：补充细腻的动作、神态、肢体语言与触感描写，字数充足有镜头感；不改变台词内容与语气。" },
        { role: "user", content: prompt },
      ],
      options: {
        temperature: 0.8,
        maxTokens: CHANNEL_NARRATION_MAX_TOKENS,
        usageContext: { userId: params.channel.userId, purpose: "roleplay", route: "roleplay.channel_narration_decorate" },
        disableThinking: true,
      },
    });
    let out = (response || "").trim();
    // 上游偶发返回没有【】的内容或空：补写是这一拍唯一能拿到旁白的机会，再试一次更硬的指令。
    if (!hasNarrationBlock(out)) {
      const retry = await invokeChannelAuxiliary({
        label: "旁白补写(重试)",
        messages: [
          { role: "system", content: "你只做一件事：把给定台词改写成一整段中文生活场景正文，开头必须是【】旁白，只输出正文本身。" },
          {
            role: "user",
            content: [
              "上一版没有按要求写【】旁白，不合格，现在重写：",
              "1. 必须先用 1-2 段【】旁白写此刻的具体动作、神态、触感与呼吸（共 100-200 字），再接原文台词；",
              "2. 不要英文，不要说自己在做什么，不要提及规则、系统或身份；",
              "3. 只输出改写后的正文，不要 JSON，不要解释。",
              anchorBrief ? `4. 地点必须仍是：${anchorBrief}` : "",
              `台词原文：${reply.trim().slice(0, 600)}`,
            ].filter(Boolean).join("\n"),
          },
        ],
        options: {
          temperature: 0.8,
          maxTokens: CHANNEL_NARRATION_MAX_TOKENS,
          usageContext: { userId: params.channel.userId, purpose: "roleplay", route: "roleplay.channel_narration_decorate_retry" },
          disableThinking: true,
        },
      });
      const retryText = String(retry || "").trim();
      if (hasNarrationBlock(retryText)) out = retryText;
    }
    if (!hasNarrationBlock(out)) {
      console.warn(
        `[RoleplayNarration] channel=${params.channel.id} 补写两次都没有【】旁白，保留原稿（${reply.length} 字）`
      );
      return reply;
    }
    return out.slice(0, 1500);
  } catch (err) {
    console.warn("[RoleplayNarration] decorate failed, keep original:", err);
    return reply;
  }
}

/**
 * 频道内心反思（思考诊断）：站在"对话节奏导演"角度为下一位发言者做一次轻量内心预演，
 * 产出节奏提示（连说/换人）、内心反应、心情与生成策略。strict 省额度模式返回 null 跳过。
 */
/**
 * 规划/重规划频道的导演线（arc）：一次短调用，关掉隐藏思考。
 * 输入 = 场景前情 + 已经发生的事 + 用户最新引导；输出 = 接下来 4~6 拍。
 * 失败一律返回 null（保留旧计划或干脆没有计划），绝不让规划失败挡住正常出戏。
 */
async function planChannelStoryArc(params: {
  channel: db.RoleplayChannelView;
  userId: number;
  recentBeats: string[];
  userSteer: string | null;
  turn: number;
  /** 上一次的长期记忆：让模型在此基础上更新，而不是每次从头重写。 */
  previousSummary?: string | null;
  previousPinnedFacts?: string[];
  previousTurnCount?: number;
  /** 已有计划的拍数信息，仅用于日志。 */
  previousCursor?: number;
}): Promise<StoryDirectorState | null> {
  try {
    const raw = await invokeChannelAuxiliary({
      label: "导演线规划",
      messages: [
        { role: "system", content: "你只输出 JSON，不要任何解释、Markdown 或代码块标记。" },
        {
          role: "user",
          content: buildStoryArcInstruction({
            sceneBrief: params.channel.scenePrompt || params.channel.description || params.channel.name,
            recentBeats: params.recentBeats,
            userSteer: params.userSteer,
            previousSummary: params.previousSummary ?? null,
            previousPinnedFacts: params.previousPinnedFacts ?? [],
          }),
        },
      ],
      options: {
        temperature: 0.7,
        maxTokens: CHANNEL_DIRECTOR_ARC_MAX_TOKENS,
        usageContext: { userId: params.userId, purpose: "roleplay", route: "roleplay.channel_director_arc" },
        disableThinking: true,
      },
    });
    let plan = parseStoryPlan(String(raw || ""));
    if (!plan) {
      // 上游偶发把 JSON 截断（不是空正文，所以 invokeChannelAuxiliary 不会重试）。
      // 这里带着明确格式要求再要一次；仍不行就保留原状态，绝不让规划挡住出戏。
      console.warn("[RoleplayDirector] 规划返回无法解析，重试一次");
      const retryRaw = await invokeChannelAuxiliary({
        label: "导演线规划(重试)",
        messages: [
          { role: "system", content: "你只输出一个完整、闭合的 JSON 对象，不要任何解释、Markdown 或代码块标记，也不要中途截断。" },
          {
            role: "user",
            content: [
              "上一次的返回不是合法 JSON，不合格。用最短的措辞重新给一次，只要结构完整：",
              buildStoryArcInstruction({
                sceneBrief: params.channel.scenePrompt || params.channel.description || params.channel.name,
                recentBeats: params.recentBeats.slice(-3),
                userSteer: params.userSteer,
                stepCount: 4,
              }),
            ].join("\n"),
          },
        ],
        options: {
          temperature: 0.5,
          maxTokens: CHANNEL_DIRECTOR_ARC_MAX_TOKENS,
          usageContext: { userId: params.userId, purpose: "roleplay", route: "roleplay.channel_director_arc_retry" },
          disableThinking: true,
        },
      });
      plan = parseStoryPlan(String(retryRaw || ""));
    }
    if (!plan) {
      console.warn("[RoleplayDirector] 两次都无法解析，保留原状态");
      return null;
    }
    console.info(
      `[RoleplayDirector] channel=${params.channel.id} 新计划 ${plan.arc.length} 拍：${plan.arc.map(step => step.title).join(" → ")}｜摘要 ${plan.storySummary.length} 字｜事实 ${plan.pinnedFacts.length} 条`
    );
    return {
      arc: plan.arc,
      cursor: 0,
      lastUserSteer: params.userSteer,
      stallStreak: 0,
      recentBeats: params.recentBeats.slice(-8),
      plannedAtTurn: params.turn,
      // 长期记忆：模型没给就沿用上一次的，绝不因为一次抖动把记忆清空。
      storySummary: plan.storySummary || (params.previousSummary || ""),
      pinnedFacts: plan.pinnedFacts.length ? plan.pinnedFacts : (params.previousPinnedFacts ?? []),
      turnCount: params.previousTurnCount ?? 0,
    };
  } catch (err) {
    console.warn("[RoleplayDirector] 规划失败:", err);
    return null;
  }
}
/** 身份/背景信号词：判断"最近几拍有没有带出身份质感"。 */
const IDENTITY_SIGNAL =
  /学长|学弟|师兄|师姐|高三|高二|高一|大一|大二|学生|学校|暑假|寒假|村里|山村|老家|同乡|青梅竹马|九十年代|大学|录取|通知书|开学|年级|念书|上学|功课|书包|课本|速写|画夹|铅笔|毕业/;

/**
 * 数一数最近几拍里有几拍带出了身份/背景质感。
 *
 * 供反思层判断"这一拍该不该补一处身份"。身份不该每拍都塞（那样很死板，用户明确否掉了），
 * 但连续多拍一个都没有，人物就会只剩身体、没有身份——实测 18 条人物消息里 14 条零身份词。
 */
export function countRecentIdentityBeats(
  messages: RoleplayTranscriptMessage[],
  lookback = 4,
): { beats: number; withIdentity: number; gap: number } {
  const personas = messages.filter(m => m.role === "persona").slice(-lookback);
  const withIdentity = personas.filter(m => IDENTITY_SIGNAL.test(String(m.content || ""))).length;
  return { beats: personas.length, withIdentity, gap: personas.length - withIdentity };
}

export async function buildChannelReflection(params: {
  channel: db.RoleplayChannelView;
  transcript: string;
  recentMessages: RoleplayTranscriptMessage[];
  /** 上一拍持久化的时空锚；没有就由本拍反思确立一个。 */
  previousSceneAnchor?: string | null;
  /** 导演线：本拍是整条线的第几拍、必须发生什么。 */
  directorCue?: string | null;
}): Promise<ChannelReflection | null> {
  const lastSpeaker = [...params.recentMessages]
    .reverse()
    .find(m => m.role === "persona" && m.speakerName)?.speakerName ?? null;
  const nextMemberNames = params.channel.members
    .filter(m => m.speakingEnabled && m.analysisStatus === "ready")
    .map(m => m.personaName)
    .join("、");

  // 静止状态检测：最近几条是否在睡/躺/沉默等静态画面上打转
  const recentTexts = params.recentMessages.slice(-4).map(m => m.content || "").join("\n");
  const staticWords = /睡着?|躺|合眼|闭目|闭眼|休息|歇着|入眠|困|沉沉睡去|安睡|打盹|沉默|无言|静静/;
  const stuckOnStatic = staticWords.test(recentTexts);

  // 提取用户最新的最高剧情引导
  const lastUserNote = [...params.recentMessages]
    .reverse()
    .find(m => m.role === "user")?.content;
  const userGuidanceBlock = lastUserNote
    ? `【用户最新最高剧情指令（必须强力贯彻）】：“${lastUserNote}”\n⚠️ 先在 acknowledgement 中确认这条引导已经建立了哪些当前事实，再在 nextBeat 与 replyStrategy 中落实。若用户要求“少说话”、“只剩喘气/动作”、“肢体主导”、“沉默/压抑”等，必须坚决执行该方向，要求角色以多段【】肢体分镜、触感和呼吸描写为主，大幅精简对白甚至允许本轮完全不开口说话。`
    : "";

  // 身份素材 + 身份密度：由反思层判断"这一拍该不该带一处身份"，而不是每拍硬塞。
  const identitySections = extractChannelIdentitySections(params.channel.scenePrompt);
  const identityBrief = [
    identitySections.left ? "左位：" + identitySections.left.slice(0, 180) : "",
    identitySections.right ? "右位：" + identitySections.right.slice(0, 180) : "",
    identitySections.context ? "前情：" + identitySections.context.slice(0, 120) : "",
  ].filter(Boolean).join("\n");
  const identityStat = countRecentIdentityBeats(params.recentMessages, 4);
  const identityGapHint = identityStat.gap >= 3
    ? `⚠️ 最近 ${identityStat.beats} 拍里只有 ${identityStat.withIdentity} 拍带出了身份/背景（连续 ${identityStat.gap} 拍没有）。这一拍要安排一处**自然的**身份落点：在 identityCue 里写清要带什么（称呼与相处方式、学校与年级、暑假开学、年代与地点、青梅竹马的关系底色、画夹课本这类身份道具），并让 replyStrategy / nextBeat 与它配合。`
    : `最近 ${identityStat.beats} 拍里有 ${identityStat.withIdentity} 拍带出了身份/背景，密度正常。identityCue 只在本来就合适的地方给（场景转换、安静相处、聊到过去与将来、称呼对方、掏东西/走路/吃饭）；动作主导时给 null。**不要每拍都塞身份，那样很死板。**`;

  const prompt = [
    "你是虚构故事的节奏导演。规划清楚的动作、环境和必要对话，每轮推进一个普通事件，给其他参与者留出回应空间。",
    // 反思层必须看到频道情境，否则第一拍会凭空发明一个地点当锚

    `【频道情境·本轮地点、时代与人物设定一律以此为准】\n频道名称：${params.channel.name}\n${params.channel.scenePrompt ? params.channel.scenePrompt.slice(0, 1500) : "（本频道没有写场景前情）"}`,
    params.transcript ? `【最近频道记录】\n${params.transcript}` : "【最近频道记录】\n（频道刚开始）",
    userGuidanceBlock,
    // 导演线放在用户引导之后：用户引导是方向盘，导演线是既定路线。
    params.directorCue?.trim()
      ? `${params.directorCue.trim()}\nnextBeat 必须落在这一拍的范围内：先把这一拍要求的事件写实，再写人物反应；不要跳过它去写后面几拍，也不要原地重复上一拍已经写完的动作。`
      : "",
    identityBrief ? `【身份与背景素材（要不要用、什么时候用由你判断）】\n${identityBrief}` : "",
    identityBrief ? identityGapHint : "",
    `频道成员：${nextMemberNames || "两位角色"}`,
    lastSpeaker ? `最近推进动作的是：${lastSpeaker}` : "还没人行动（由你先决定谁先主导动作）。",
    stuckOnStatic ? "⚠️ 检测到最近几拍停留在睡觉/休息/沉默的静态画面上，剧情没有进展。这一拍必须安排一个明确的推进事件，打破静止（例如醒来喝水、起身、动作转折、外出、情绪变化），绝对不能再写睡/躺/安静。"
      : "请给下一拍安排明确的剧情推进：新的具体肢体动作、触觉互动或事件发展；如果上一拍已经在睡觉/休息，这一拍要自然推进到下一步，不要重复静态画面。",
    params.previousSceneAnchor?.trim()
      ? `【上一拍时空锚】${params.previousSceneAnchor.trim()}`
      : "【上一拍时空锚】（还没有；本拍请根据频道情境确定一个明确的时空锚）",
    "时空锚规则：sceneAnchor 用一句话写清「此刻在哪里（具体地点、室内还是室外）、大致什么时段、在场有谁、关键物件处于什么状态」。先判断最近的记录里是否真的发生了移动、入睡、时间跳跃，或用户是否明确改换了地点：如果都没有，本拍必须仍然发生在上一拍那个地点与时段的延续里，绝不能让场景在无声无息中换地方（实测故障：模板写的是盛夏午后山坡，几拍之后人物飘进屋里上了炕）。只有真的走出去、被带走、睡下、时间跳跃或被用户改换地点时，才更新这个锚。",
    "请输出 JSON（不要 Markdown）：",
    `{"nextSpeakerHint":"same 或 other 或 null，按剧情需要选择","acknowledgement":"对本轮用户引导的简短理解","innerThought":"当前角色的内心反应","mood":"warm|playful|nostalgic|melancholy|happy|distant","replyStrategy":"如何保持角色并推进当前普通故事事件","replyLength":"medium|long","preferredSpeaker":"角色名或 null","nextBeat":"下一步具体事件","sceneAnchor":"地点、时段、在场人物和物件状态","identityCue":"合适的角色身份细节或 null"}`, 
    // 表现层按频道情境走：少年青涩频道压下成熟 register，成年频道（模板迁移来的

    channelYouthToneRequested(params.channel.scenePrompt)
      ? "表现层要求（重要）：本频道写的是少年人，两人都青涩。replyStrategy 里不要出现“低沉”“笃定”“掌控”“不容退让”“游刃有余”这类成熟老练的写法；即使剧情走到反转、由一直被逗的一方转为主动，他也应当是笨拙的、慌的、不会拿捏的，主导动作可以坚定但语气要发紧、要断、要说错话。请据此写 replyStrategy 与 innerThought。"
      : "表现层要求（重要）：本频道的表现层一律按频道情境写——情境写的是成年人的沉稳、粗直、粗粝或威严，replyStrategy 与 innerThought 就照那个写，不要套用少年青涩模板（慌、结巴、手足无措、说半截话），也不要把情境里写明的成熟写法当成需要降级的旧笔法。口吻必须始终是情境里那个人。请据此写 replyStrategy 与 innerThought。",
    "根据情境选择说话人，避免机械轮流；每位角色只控制自身行动，不替其他参与者决定意愿。",
    "如最近记录里已多次出现相同环境开场（例如:深夜的大殿里只剩……），下一拍的旁白应直接写动作与情绪，不要再重复场景描写。但「不重复描写」不等于可以换地方：地点仍以 sceneAnchor 为准，只是不必每拍重新交代一遍环境。",
  ].filter(Boolean).join("\n\n");

  try {
    console.info(`[RoleplayReflection] running for channel=${params.channel.id} messages=${params.recentMessages.length}`);
    const response = await invokeChannelAuxiliary({
      label: "节奏反思",
      messages: [
        { role: "system", content: "你只输出一个 JSON 对象，作为频道对话节奏的幕后导演。不过度设计、不扩展剧情，只解决“下一拍怎么走”。" },
        { role: "user", content: prompt },
      ],
      options: {
        temperature: 0.7,
        maxTokens: CHANNEL_REFLECTION_MAX_TOKENS,
        usageContext: { userId: params.channel.userId, purpose: "roleplay", route: "roleplay.channel_reflection" },
        disableThinking: true,
      },
    });
    let parsed = extractJsonObject(response || "");
    if (!parsed) {

      // 与导演线规划一致的修法：带着明确的格式要求再要一次，仍不行才降级。
      console.warn(
        `[RoleplayReflection] channel=${params.channel.id} 反思输出无法解析为 JSON（长度 ${String(response || "").length}），重试一次`
      );
      const retry = await invokeChannelAuxiliary({
        label: "节奏反思(重试)",
        messages: [
          { role: "system", content: "你只输出一个完整、闭合的 JSON 对象，不要任何解释、Markdown 或代码块标记。字段必须齐全。" },
          {
            role: "user",
            content: [
              "上一次的返回不是合法 JSON，不合格。用最短的措辞重新给一次，只要结构完整：",
              prompt,
            ].join("\n"),
          },
        ],
        options: {
          temperature: 0.4,
          maxTokens: CHANNEL_REFLECTION_MAX_TOKENS,
          usageContext: { userId: params.channel.userId, purpose: "roleplay", route: "roleplay.channel_reflection_retry" },
          disableThinking: true,
        },
      });
      parsed = extractJsonObject(retry || "");
    }
    if (!parsed) {
      console.warn(`[RoleplayReflection] channel=${params.channel.id} 两次都无法解析，本轮按无反思降级`);
      return null;
    }
    const moodRaw = typeof parsed.mood === "string" ? parsed.mood.trim() : "";
    const lengthRaw = typeof parsed.replyLength === "string" ? parsed.replyLength.trim() : "";
    const hintRaw = typeof parsed.nextSpeakerHint === "string" ? parsed.nextSpeakerHint.trim() : "";
    return {
      nextSpeakerHint: hintRaw === "same" ? "same" : hintRaw === "other" ? "other" : null,
      innerThought: typeof parsed.innerThought === "string" ? parsed.innerThought.trim() : "",
      mood: (ROLEPLAY_MOODS as readonly string[]).includes(moodRaw) ? moodRaw as RoleplayMood : "warm",
      replyStrategy: typeof parsed.replyStrategy === "string" ? parsed.replyStrategy.trim() : "",
      replyLength: lengthRaw === "short" || lengthRaw === "medium" || lengthRaw === "long" ? lengthRaw : "medium",
      preferredSpeaker: typeof parsed.preferredSpeaker === "string" && parsed.preferredSpeaker.trim()
        ? parsed.preferredSpeaker.trim()
        : null,
      nextBeat: typeof parsed.nextBeat === "string" && parsed.nextBeat.trim() ? parsed.nextBeat.trim() : null,
      // 身份落点：反思层判断"这一拍适不适合带一处身份"，不合适就给 null（不硬塞）。
      identityCue: typeof parsed.identityCue === "string" && parsed.identityCue.trim() && parsed.identityCue.trim() !== "null"
        ? parsed.identityCue.trim()
        : null,
      stuckOnStatic,
      acknowledgement: typeof parsed.acknowledgement === "string" && parsed.acknowledgement.trim()
        ? parsed.acknowledgement.trim()
        : null,
      // 时空锚缺失时退回上一拍的值，宁可沿用旧锚也不让场景失去约束。
      sceneAnchor: typeof parsed.sceneAnchor === "string" && parsed.sceneAnchor.trim()
        ? parsed.sceneAnchor.trim()
        : (params.previousSceneAnchor?.trim() || null),
    };
  } catch (err) {
    console.warn("[RoleplayReflection] failed, fall back to normal turn:", err);
    return null;
  }
}

/**
 * 把频道消息拼成转录。先按条数取最近 maxMessages 条，再按字数上限收口：
 * 条数上限保证"约 100 条上下文"这个目标，字数上限是防止极端长文把输入撑爆。
 */
export function formatRoleplayTranscript(
  messages: RoleplayTranscriptMessage[],
  maxChars = 6000,
  maxMessages = ROLEPLAY_TRANSCRIPT_MAX_MESSAGES,
): string {
  const windowed = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;
  const lines = windowed.map(message => {
    const label = message.role === "user" ? "场景引导/用户" : message.speakerName;
    return `${label}: ${message.content.trim()}`;
  });
  const text = lines.join("\n").trim();
  return text.length > maxChars ? `...${text.slice(-maxChars)}` : text;
}

/** 主生成最多带多少条历史消息：目标能装下约 100 条（实测单条 300~560 字）。 */
export const ROLEPLAY_TRANSCRIPT_MAX_MESSAGES = 100;
/** 节奏反思只需要最近几拍，单独给一个小窗口，避免辅助调用白吃几万字输入。 */
const ROLEPLAY_REFLECTION_TRANSCRIPT_MESSAGES = 24;
const ROLEPLAY_REFLECTION_TRANSCRIPT_CHARS = 12000;

/**
 * 主生成的历史字数上限。
 *
 * 书中人没有私有 llm/economy 模块：不按额度档位收紧，固定自用版 off 档的 60000 字。
 * 旧自用版值是 2800/4500/6500——单条 300~560 字时只能装下 5~12 条，
 * 长篇剧情会早早掉出窗口，表现为"更早的剧情接不上"。
 */
const ROLEPLAY_TRANSCRIPT_CHARS = 60000;

/** 频道主生成的总输出预算（推理＋正文共享）。 */
const CHANNEL_TURN_MAX_TOKENS = 16384;
/** 频道主生成给隐藏推理设的软上限（实测多数样本能把推理压到 600~1600）。 */
const CHANNEL_TURN_REASONING_MAX_TOKENS = 3000;

function roleplayMaxTokens(configured: unknown): number | undefined {

  // （与正文共享 completion 预算）会周期性地吃满全部额度，正文变成空字符串、finish_reason=length。
  // 余量做大之后，即使推理失控到 6,000+ token，正文仍有一万多 token 的空间。
  const value = typeof configured === "number" && Number.isFinite(configured) ? configured : undefined;
  return Math.max(value ?? CHANNEL_TURN_MAX_TOKENS, CHANNEL_TURN_MAX_TOKENS);
}

export function buildChannelWorldOverlay(
  channel: db.RoleplayChannelView,
  speakerName: string,
  /**
   * 运行时的系统提示词里，人物频道提示词已经用【频道当前情境】注入过同一份场景与前情。
   * 传 includeScenePrompt:false 避免在同一份 system prompt 里重复注入两遍——
   * 实测场景与前情 2,295 字，重复一份等于每轮白付约 1,300 输入 token。
   * 默认 true 保持单独调用（测试与其他调用方）的旧行为。
   */
  options: { includeScenePrompt?: boolean } = {},
): string {
  const otherMembers = channel.members
    .filter(m => m.personaName !== speakerName)
    .map(m => m.personaName)
    .join("、");
  // 运行时默认关掉这一份重复注入：场景与前情已在【频道当前情境】出现过一次。
  const includeScenePrompt = options.includeScenePrompt !== false;

  return [
    "【角色生活频道·生活场景推演】",
    `当前频道：${channel.name}`,
    channel.description ? `频道说明：${channel.description}` : "",
    channel.scenePrompt && includeScenePrompt ? `生活场景与前情：\n${channel.scenePrompt}` : "",
    !includeScenePrompt ? "本频道的场景与前情见上方【频道当前情境】，此处不重复。" : "",
    `互动对象：${otherMembers || "同伴"}`,
    `你本轮扮演的是【${speakerName}】。你与对方处于同一真实生活情景中（面对面、近距离相伴）。`,
    "【旁白与对话规则（电影级分镜与叙事）】：",
    "1. 旁白是沉浸感的核心灵魂：本轮回复以动作、神态、环境细节与触感为主体，描写要充分细腻、有镜头感与呼吸感；字数与信息量要占回复的大头（建议 100~300 字左右的详实分镜头与动作刻画）。",
    "2. 叙事节奏与分镜头自由（彻底打破机械一人一句对白）：回复可以由 2-3 段独立的【】动作/触感/呼吸分镜头组成。台词绝非每轮必说！当处于亲密肢体接触、喘息、情绪压抑、无言对视、或用户指示“少说话/只剩喘气”时，整轮可以完全由多段分镜头动作与触感推进（如【分镜一：动作细节】\\n\\n【分镜二：体温与呼吸】），台词只在真正必要或情难自禁时插入极短的气音或耳语（如“……别动”、“嗯……”），甚至完全不开口说话。",
    `3. 旁白使用明确的人物名字，避免混淆；用户与角色的性别代词仅以明确配置为准。台词仍使用角色本人的自然口吻。`, 
    "4. 真实细腻的感官沉浸：注重触感（温度、软硬、轻重、肢体依偎）、呼吸声、语调与眼神流转，贴合当下生活场景与彼此深层情感纽带；拒绝“他在笑”“她看他”这类干瘪动作，要把连贯的动作步骤、触觉感受和身体语言写全。",
    "5. 篇幅全面放开：不要急于收尾，完整呈现这一拍的互动过程；场景大背景已在上方交代，旁白直接聚焦于当下正在发生的动作、神态、情绪与触感，不要用“深夜的大殿里只剩……”等相同句式反复开局。",
    "6. 剧情必须向前推进：每轮都要让情境有明显的进展——新的动作、新的对话、新的情绪变化或事件发展；严禁原地循环，不要把同一个静态画面反复描写。",
    "7. 严禁替对方角色说话，严禁输出对方的台词，也不要在开头加“" + speakerName + "：”前缀。",
    `8. 当前世界锚（最重要）：本频道是独立的当下生活情景，此刻在场的只有频道成员：${otherMembers || "对方"}。互动对象只能按频道成员设定称呼（如上方的互动对象段），禁止编造任何其他名字来指代对方或其他在场者；原著或记忆中的其他人物一律不存在于当下：不得让TA们出现在台词、旁白或“刚才/白天/昨天”的转述里；往事只能作为两人之间的情感底色被含蓄提及，绝不把原著人物编成当下互动对象。`,
    "9. 世界可以自然变化，但只能是无名的变化：脚步声、门外动静、风、雨、光线、时间推移、器物响动、远处的车声人声都算，可以随剧情自然引入，一次一个，并与当前动作有因果。绝对禁止引入任何其他人物——村民、邻居、路人、亲戚、“恰好经过的人”都不行，不管有没有名字；外界变化只能写成无名的动静，绝不写成某个具体的人。★无名的动静不得升级成人（2026-09 实测事故，必须遵守）：脚步声、人声、车声只能停在“无人称的动静”上，绝不能下一步就“从草脊后头冒出一个人影”“坡上上来一个二十来岁的年轻人”，也不能让任何外人开口说话、看向两人或参与互动。一旦画面里出现第三个人，旁白就再也没有合法称呼可用（指称铁律不允许代词），只能把这个无名者硬写成在场成员——角色当场崩掉，而且会随上下文固化下去。剧情需要紧张感时，就写两人自己的反应：屏息、手一僵、眼神乱飘、压低声音，不要把人写进来。",
    "10. 身份与背景（每拍都要有，实测最容易丢）：旁白和台词里每一拍至少要自然带出一处「这个人是谁」——称呼与相处方式（谁是年长的那位、谁被当弟弟看）、学生身份（高三 / 刚考上大学、暑假回村）、年代与地点质感（九十年代山村、山坡、草帽、蝉鸣、土路）、青梅竹马的关系底色。禁止整拍只有身体动作与生理反应、一句身份与背景都不带；但也不要写成履历介绍，要化在称呼、口吻、动作细节、环境与心境里。",
  ].filter(Boolean).join("\n\n");
}

/** 旧调用方兼容别名；频道运行时使用 buildChannelWorldOverlay，避免与场景模式概念混用。 */
export const roleplaySceneOverlay = buildChannelWorldOverlay;

/**
 * 从频道情境里抽出工坊写入的身份/前情分段。
 *
 * 频道情境是「网页工坊」压平进来的，身份信息只占很小一块（实测本频道 2,295 字里，
 * 【行为偏好】1,688 字、两份身份段合计 309 字）。身份埋在长文里、又离生成位置很远，
 * 保持人物身份与当前频道情境一致。
 * 保持人物身份与当前频道情境一致。
 */
export function extractChannelIdentitySections(scenePrompt: string | null | undefined): {
  left: string;
  right: string;
  context: string;
} {
  const text = String(scenePrompt || "");
  const pick = (label: string) => {
    const matched = text.match(new RegExp("【" + label + "】([\\s\\S]*?)(?=【[^】]+】|$)"));
    return matched ? matched[1].trim() : "";
  };
  // 按前缀兜底：分段标题会随用户在工坊里的写法变（曾用【左位角色身份】，


  const pickByPrefix = (prefix: string) => {
    const matched = text.match(new RegExp("【" + prefix + "[^】]*】([\\s\\S]*?)(?=【[^】]+】|$)"));
    return matched ? matched[1].trim() : "";
  };
  return {
    left: pick("左位角色身份") || pickByPrefix("左位角色"),
    right: pick("右位角色身份") || pickByPrefix("右位角色"),
    context: pick("前情提要/上下文") || pickByPrefix("前情"),
  };
}

/** 身份锚里的单段截断：够模型认清身份即可，不必把整段搬第二遍。 */
function clipIdentity(text: string, limit: number): string {
  const value = String(text || "").trim();
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

/** 提取用户显式写出的普通身份标签，不推断人物关系。 */
export function extractIdentityTags(text: string): string[] {
  const labels = Array.from(String(text || "").matchAll(/身份标签[：:]([^\n。]+)/g), match => match[1]);
  return Array.from(new Set(labels.flatMap(label => label.split(/[、,，]/)).map(label => label.trim()).filter(Boolean)));
}

/** 身份素材在合适的情节节点使用，不机械插入每轮回复。 */
function buildChannelIdentityAnchor(channel: db.RoleplayChannelView): string {
  const sections = extractChannelIdentitySections(channel.scenePrompt);
  if (!sections.left && !sections.right && !sections.context) return "";
  // 标签单独成一行的另一个理由：身份段会被截断到 220 字，标签恰好挂在段尾，
  // 段子一长就会被裁掉——独立成行能保证它每次都进提示词。
  const tags = Array.from(new Set([
    ...extractIdentityTags(sections.left),
    ...extractIdentityTags(sections.right),
  ]));
  return [
    "【身份与关系锚·素材，时机由节奏导演决定】",
    // 身份段现在动辄 400+ 字（用户写的"底料"），截太狠等于没给；给到 420 字基本保全。
    sections.left ? `· ${clipIdentity(sections.left, 420)}` : "",
    sections.right ? `· ${clipIdentity(sections.right, 420)}` : "",
    tags.length ? `· 身份/关系标签（有效设定，不是装饰）：${tags.join("、")}` : "",
    tags.length ? "★标签仅表示用户明确给出的身份或任务；表现方式仍以当前场景和角色资料为准，不据此推断关系。" : "",
    "★执行方式：本拍要不要带身份、带哪一处，以【本拍身份落点】为准（时机由节奏导演判断）；给了就落实，没给就照常写，**不要为了凑身份硬塞**。但下面的素材始终可用——称呼、学校与年级、暑假与开学、年代地点、关系标签，能自然带出来就带。",
  ].filter(Boolean).join("\n");
}

export function buildRoleplayUserPrompt(params: {
  channel: db.RoleplayChannelView;
  speakerName: string;
  transcript: string;
  allowSilence: boolean;
  reflection?: ChannelReflection | null;
  latestUserGuidance?: string;
  /** 同人续拍时上一拍刚写完的正文；用于强制本轮承接而不是复述。 */
  previousBeat?: string | null;
  /** 本拍时空锚（此刻在哪里/什么时段/在场谁/关键物件状态），由节奏反思跨拍维护。 */
  sceneAnchor?: string | null;
  /** 反思层给出的本拍身份/背景落点；为空表示这一拍不适合带身份。 */
  identityCue?: string | null;
}): string {
  const otherMembersForPrompt = params.channel?.members
    ? params.channel.members.filter((m: any) => m.personaName !== params.speakerName).map((m: any) => m.personaName).join("、")
    : "";
  const lengthCue = params.reflection?.replyLength
    ? params.reflection.replyLength === "short"
      ? "本轮节奏可稍紧凑，但【】旁白仍需保持生动动作细节。"
      : params.reflection.replyLength === "long"
        ? "本轮值得深入展开：充分描写分镜头动作、细腻触感与环境氛围，篇幅放开写透。"
        : "本轮保持充实详尽的叙事篇幅：写足【】动作、神态与生活细节。"
    : "本轮保持充实详尽的叙事篇幅：写足【】动作、神态与生活细节。";
  const strategyCue = params.reflection?.replyStrategy?.trim()
    ? `节奏指导：${params.reflection.replyStrategy.trim()}`
    : "";
  const acknowledgementCue = params.reflection?.acknowledgement?.trim()
    ? `【内部承接确认（只用于写作，不要原样输出）】${params.reflection.acknowledgement.trim()}。请把这项确认落实为本轮实际动作、神态或台词，不要只口头表示收到。`
    : "";
  const beatCue = params.reflection?.nextBeat?.trim()
    ? `【本拍剧情推进（必须落实）】${params.reflection.nextBeat.trim()}`
    : params.reflection?.stuckOnStatic
      ? "【本拍剧情推进（必须落实）】打破当前的静止状态：安排一个明确的新动作或新事件（醒来、起身、谈话转折、外出、情绪转折），不要再停留在睡觉/休息/沉默里。"
      : "";
  // 身份落点：只在这一拍确实合适时由反思层给出；没有给就照常写，不硬塞身份。
  const identityCue = params.identityCue?.trim()
    ? `【本拍身份落点（自然带出，不要硬塞）】${params.identityCue.trim()}`
    : "";
  const userGuidanceCue = params.latestUserGuidance?.trim()
    ? `【用户本轮创作方向】
${params.latestUserGuidance.trim()}
承接明确提供的普通故事事实；如有关键矛盾先简短澄清，遵守参与边界与服务商内容政策。`
    : "";
  const progressCue = "要让这一拍推动剧情前进：写下新的行动、话语或情绪变化，接续上一拍但不要重复上一拍已经发生的事。";
  // 时空锚：把「此刻在哪里」钉住。频道提示词第 5 条要求"不要重复场景描写"，

  const sceneAnchorCue = params.sceneAnchor?.trim()
    ? `【本拍时空锚·必须遵守】${params.sceneAnchor.trim()}\n本拍的动作必须发生在这个地点与时段的延续里；除非用户明确要求换地点，或剧情里真的走出去/被带走/睡下/时间跳跃，不得把场景悄悄挪到别的场所。不要重复交代环境，但地点以这条为准。`
    : "";
  // 同人续拍（same）时第二拍必须看得见第一拍刚写的正文，否则会拿着同一份上下文再写一遍。
  const previousBeatCue = params.previousBeat?.trim()
    ? `【你上一拍刚写完的内容（严禁复述）】\n${params.previousBeat.trim().slice(0, 600)}\n本轮是紧接着的下一拍：必须承接它继续往下推进新的动作、对话或事件，禁止原样或近义复写上面已经写过的画面、句式与意象组合。`
    : "";

  // 近场名录：比末尾的长规则更靠近输出位置、也更短更硬。

  // 自己把自己变成了设定的一部分，必须每轮重申。
  const rosterNames = params.channel.members
    .map(member => member.personaName)
    .filter(Boolean)
    .join("、");
  const rosterCue = rosterNames
    ? `【本轮在场名录·硬约束】此刻在场的只有：${rosterNames}。除这几个名字以外，正文（含【】旁白与台词）里不得出现任何其他人名、昵称或称呼；需要外界变化时只写无名的动静，不要给它安名字，也不要让旁白把动作交给第三个人。`
    : "";
  return [
    `请观察下面的频道最新对话与生活剧情进展，并以【${params.speakerName}】的当下视角决定本轮反应。`,
    params.transcript ? `【频道历史对话与场景记录】\n${params.transcript}` : "【频道历史对话与场景记录】\n（频道刚开始，双方已就位在场景中。）",
    userGuidanceCue,
    previousBeatCue,
    acknowledgementCue,
    params.allowSilence
      ? "如果此刻适合保持安静、轻声倾听或无事发生，可让 shouldSpeak 为 false。"
      : "本轮需要给出贴合生活情景的细腻互动与反应。",
    lengthCue,
    strategyCue,
    beatCue,
    identityCue,
    progressCue,
    sceneAnchorCue,
    rosterCue,
    // 身份锚放在这里：离输出位置最近，且紧挨着输出要求，权重最高。
    buildChannelIdentityAnchor(params.channel),
    "【输出要求与篇幅标准】：",
    // 篇幅口径要统一：这里原写"建议 100~300 字"，与世界规则第 5 条"篇幅全面放开"、以及
    // 旁白篇幅按本轮事件需要确定。
    "1. reply 应包含清楚的【】动作、神态或环境旁白，篇幅以推进当前事件为准，不套用固定字数与场景类型。",
    "2. 台词绝非强制！若情境处于动作主导、亲密肢体、喘息或用户指示少言时，整轮 reply 允许完全由 1~2 段【】分镜头旁白构成，或仅带极简的几个字气音/低语。",
    "3. 台词直接写自然口语/气音，不要在台词最外层包裹英文/中文双引号（不要加 \"\" 或 “”）。",
    "4. 严格以 JSON 格式输出，不要包含 Markdown 格式块外字符：",
    `{"shouldSpeak":true,"innerThought":"在此写下 ${params.speakerName} 当下真实的私密内心活动、对当前环境和对方动作的心境反应","mood":"warm|playful|nostalgic|melancholy|happy|distant","reply":"【包含 100-300 字分镜头动作、神态或触感描写的【】详尽旁白】\\n\\n自然台词或短促气音（可留空）\\n\\n【接续的动作分镜与呼吸尾声】"}`,
    // 格式预答：把模型每次都要在隐藏思考里反复权衡的格式问题一次性答掉。


    // 连着 4 次生成都是 0 个身份词，模型把它当成可选项。配额与旁白段数同级才有效。
    "5. 【格式预答·不必再权衡】正文一律只用中文引号，不要出现英文双引号（台词不加任何引号），因此不存在 JSON 转义问题，不必为了转义改写措辞；reply 里的换行直接用 \\n 表示、段落之间空一行；整条回复以 { 开头、以 } 结尾，前后不要写任何说明文字，也不要用 Markdown 代码块。",
    "6. 【身份与背景】当本轮给出【本拍身份落点】时，必须把那一处自然写进旁白或台词（称呼、学校与年级、暑假开学、年代地点、青梅竹马的关系底色、画夹课本这类身份道具），不要写成履历介绍。本轮**没有**给身份落点就照常写，不要为了凑身份硬塞——身份该在合适的地方出现，不该每拍都强调。",
    "示例格式：【角色把地图摊在桌上，指出河流转弯处。】\n\n我们从这里出发。",
    "无台词示例：【角色在地图上标出路线，收好指南针，推门走进清晨的雾里。】",
    `当前世界锚：当下只有你们两人在场的独立生活情景；对方就是${otherMembersForPrompt || "对方"}，只能按频道成员设定称呼对方、旁白用名字不用代词，禁止编造其他名字来指代对方或其他在场者；原著或其他人物一律不存在于当下，不要编造与TA们有关的台词、旁白或转述。补充：世界本身可以动——脚步声、门外动静、天气、光线、时间推移、器物响动、远处的声音或一条消息都是合法且应当使用的推进来源，一次引入一个即可；只有“给变化安上频道成员以外的具体人名或身份”才是被禁止的。`,
  ].filter(Boolean).join("\n\n");
}

const runningRoleplayTurns = new Set<string>();

/**
 * 频道运行诊断快照：每轮结束后写入 roleplay_channels.runtimeDiagnostics，
 * 供「频道运行诊断」面板展示最近一轮时间 / 节奏导演反思 / 回复策略 / 风险提示。
 * 失败仅告警，绝不影响主流程。
 */
async function persistChannelDiagnostics(params: {
  channelId: number;
  userId: number;
  spoken: boolean;
  personaId: number;
  speakerName: string;
  emotionalState: RoleplayMood;
  innerThought?: string | null;
  messageId?: number;
  reflection?: ChannelReflection | null;
  beats?: RoleplayTurnBeat[];
  postPersistWarning?: string | null;
  economyLevel: string;
  skippedReason?: string | null;
  /** 连续几拍的时空锚没有变化（原地打转信号），供下一拍强制跳拍。 */
  stallStreak?: number;
}) {
  try {
    const lastRecordedBeat = params.beats?.at(-1);
    await db.updateRoleplayChannelDiagnostics(params.channelId, params.userId, {
      lastTurnAt: new Date().toISOString(),
      spoken: params.spoken,
      // 返回合同仍指第一拍；诊断概览指向最后实际落库拍，并保存整轮所有拍。
      personaId: params.beats?.at(-1)?.personaId ?? params.personaId,
      speakerName: params.beats?.at(-1)?.speakerName ?? params.speakerName,
      emotionalState: params.beats?.at(-1)?.emotionalState ?? params.emotionalState,
      innerThought: lastRecordedBeat ? lastRecordedBeat.innerThought ?? null : params.innerThought ?? null,
      messageId: params.beats?.at(-1)?.messageId ?? params.messageId ?? null,
      replyText: params.beats?.at(-1)?.replyText ?? null,
      beats: params.beats ?? [],
      postPersistWarning: params.postPersistWarning ?? null,
      reflection: params.reflection
        ? {
            nextSpeakerHint: params.reflection.nextSpeakerHint,
            innerThought: params.reflection.innerThought,
            mood: params.reflection.mood,
            replyStrategy: params.reflection.replyStrategy,
            replyLength: params.reflection.replyLength,
            preferredSpeaker: params.reflection.preferredSpeaker ?? null,
            acknowledgement: params.reflection.acknowledgement ?? null,
            // 补落库：这两个字段原本被丢掉，导致前端「下一拍剧情推进目标」永远显示兜底文案，
            // 而且"上一拍打算推进什么"没有任何跨拍载体。
            nextBeat: params.reflection.nextBeat ?? null,
            // 身份落点也跨拍留痕：前端诊断能看到"这一拍打算怎么带身份"。
            identityCue: params.reflection.identityCue ?? null,
            stuckOnStatic: params.reflection.stuckOnStatic === true,
            // 跨拍持久化时空锚：下一拍从 runtimeDiagnostics 读回来，防止场景无声换地方。
            sceneAnchor: params.reflection.sceneAnchor ?? null,
          }
        : null,
      economyLevel: params.economyLevel,
      skippedReason: params.skippedReason ?? null,
      // 原地打转计数：连着几拍锚没变就累加，达到阈值后强制跳拍。
      stallStreak: Math.max(0, Math.floor(params.stallStreak ?? 0)),
    });
  } catch (err) {
    console.warn("[RoleplayDiagnostics] persist failed:", err);
  }
}

/**
 * 频道主生成的「空正文」重试策略。
 *
 * 背景（2026-09 实测）：上游把隐藏思考的 token 一并计入 completion，`maxTokens`
 * 是「推理＋正文」的总预算。频道这版提示词又长又密，隐藏推理在 1,305~16,384 之间漂移；
 * 推理一旦吃满预算，上游返回 HTTP 200 但正文是空字符串，应用侧看到的就是
 * 「调用成功、正文为空」。
 *
 * 原来的兜底是「原样再调一次」，但同一份预算、同一个配置，第二次会得到同样的结果：
 * 6 次真实试验里 2 次首轮空正文，原样重试仍然空。所以第二次必须换配置——关闭隐藏思考
 * （disableThinking），把预算全部留给正文。实测该策略 2/2 都把这一拍救了回来
 * （正文 2391 / 3498 字，重试输出 token 3015 / 3101，即几乎全是正文）。
 *
 * 第一次仍按用户配置跑（通常是开启隐藏思考）拿质量，只有命中原空正文才降级，
 * 代价是这一拍多等约 20 秒，但不会变成「这一轮没有角色开口」。
 */
export async function invokeChannelTurnWithEmptyReplyRetry(params: {
  /** 是否允许重试（strict 省额度档位下不重试，与其他兜底保持一致）。 */
  allowRetry: boolean;
  /** 真正的调用：参数为 true 表示本次要关闭隐藏思考。 */
  invoke: (retryWithoutThinking: boolean) => Promise<string>;
  /** 命中空正文时的回调，便于日志带上频道与角色信息。 */
  onEmptyReply?: () => void;
}): Promise<string> {
  const first = await params.invoke(false);
  if (String(first || "").trim() || !params.allowRetry) return first;
  params.onEmptyReply?.();
  return params.invoke(true);
}

export async function runRoleplayChannelTurn(options: RunRoleplayTurnOptions): Promise<RunRoleplayTurnResult> {
  const assertCurrentTurn = () => {
    if (options.shouldAbort?.()) throw new RoleplayTurnCancelledError();
  };
  assertCurrentTurn();
  const lockKey = `${options.channelId}:${options.userId}`;
  if (runningRoleplayTurns.has(lockKey)) {
    throw new Error("该角色频道正在生成上一轮发言，请稍候再试");
  }
  runningRoleplayTurns.add(lockKey);
  let persistCancelledSavedTurn: (() => Promise<void>) | null = null;
  try {
    const channel = await db.getRoleplayChannelById(options.channelId, options.userId);
    if (!channel || !channel.isActive) throw new Error("角色频道不存在或已停用");
    if (channel.members.length < 2) throw new Error("角色频道至少需要两个成员");

    // 代词兜底门控：仅当频道内全员为男性时才允许 她→他 改写。
    // 人物性别取自 profileSections.life.selfPronoun，缺省"他"；读不到人物时按不安全处理（不改写）。
    const memberPersonas = await db.getPersonasByUserId(options.userId);
    // 书中人适配：人物数据多为旧版字段，没有 profileSections.life.selfPronoun；
    // 净化版默认值「他」会把女性角色的「她」静默改成「他」。因此只有显式写了
    // selfPronoun 才算已知性别，未知一律按「非全员男性」处理（不改写代词）。
    const hasExplicitSelfPronoun = (personaData: unknown): boolean => {
      const life = (personaData as { profileSections?: { life?: unknown } } | null)?.profileSections?.life;
      if (!life || typeof life !== "object") return false;
      const value = (life as { selfPronoun?: unknown }).selfPronoun;
      return value === "他" || value === "她";
    };
    const allMembersMale = channel.members.length > 0 && channel.members.every(member => {
      const persona = memberPersonas.find(item => item.id === member.personaId);
      if (!persona || !hasExplicitSelfPronoun(persona.personaData)) return false;
      return getPersonaLifeConfig(persona.personaData).selfPronoun === "他";
    });

    // 取够 100 条上下文（旧值 40 条：转录窗口再大也拿不到更早的记录）。
    const messages = await db.getRoleplayChannelMessages(
      options.channelId,
      options.userId,
      ROLEPLAY_TRANSCRIPT_MAX_MESSAGES + 20,
    );
    const defaultConfig = await db.getDefaultLlmConfig(options.userId);
    const extra = (defaultConfig?.extraConfig as any) || {};
    assertCurrentTurn();

    const excludeForContext = (list: RoleplayTranscriptMessage[]) =>
      list.filter(message => (message as any).contextOverride !== "excluded");

    // 本回合内的实时上下文：同人续拍时第二拍必须看得见第一拍刚写的内容，
    // 否则两拍会拿着同一份过期记录各写一遍，直接变成车轱辘话。
    const liveMessages: RoleplayTranscriptMessage[] = [...messages];
    let previousBeatText: string | null = null;

    // 转录分两份用：主生成要长上下文（约 100 条），反思只要最近几拍。
    const transcript = formatRoleplayTranscript(
      excludeForContext(liveMessages),
      ROLEPLAY_TRANSCRIPT_CHARS,
      ROLEPLAY_TRANSCRIPT_MAX_MESSAGES,
    );
    const reflectionTranscript = formatRoleplayTranscript(
      excludeForContext(liveMessages),
      ROLEPLAY_REFLECTION_TRANSCRIPT_CHARS,
      ROLEPLAY_REFLECTION_TRANSCRIPT_MESSAGES,
    );

    // 上一拍持久化的时空锚：让「此刻在哪里」跟着剧情走，而不是每拍重新自由发挥。
    const previousSceneAnchorRaw = (channel.runtimeDiagnostics as any)?.reflection?.sceneAnchor;
    const previousSceneAnchor = typeof previousSceneAnchorRaw === "string" && previousSceneAnchorRaw.trim()
      ? previousSceneAnchorRaw.trim()
      : null;
    // 原地打转计数：反思层连着给出同一个时空锚 = 一拍都没挪窝。
    const previousStallStreakRaw = (channel.runtimeDiagnostics as any)?.stallStreak;
    const previousStallStreak = typeof previousStallStreakRaw === "number" && Number.isFinite(previousStallStreakRaw)
      ? Math.max(0, Math.floor(previousStallStreakRaw))
      : 0;

    // ── 剧本导演线：先确保有一条"接下来几拍"的计划，再让反思层服从它 ──
    // 没有计划、计划走完、或者用户改了引导 → 重新规划一次（短调用，失败不影响出戏）。
    const latestUserSteer = [...messages].reverse().find(m => m.role === "user")?.content?.trim() || null;
    const personaTurnCount = messages.filter(m => m.role === "persona").length;
    let directorState = normalizeStoryDirectorState(
      await db.getRoleplayChannelDirectorState(options.channelId, options.userId)
    );
    assertCurrentTurn();
    if (shouldReplanStoryArc(directorState, { userSteer: latestUserSteer })) {
      const planned = await planChannelStoryArc({
        channel,
        userId: options.userId,
        recentBeats: directorState?.recentBeats ?? [],
        userSteer: latestUserSteer,
        turn: personaTurnCount,
        previousSummary: directorState?.storySummary ?? null,
        previousPinnedFacts: directorState?.pinnedFacts ?? [],
        previousTurnCount: directorState?.turnCount ?? 0,
      });
      assertCurrentTurn();
      if (planned) {
        directorState = planned;
        await db.setRoleplayChannelDirectorState(options.channelId, options.userId, planned as any);
      }
    }
    const directorCue = buildStoryArcCue(directorState);
    // 长期记忆：消息窗口只有 100 条，更早的剧情只能靠摘要 + 已确认事实带下去。
    const memoryCue = buildStoryMemoryCue(directorState);
    // 成分配额（确定性判定，不需要额外模型调用）：

    const recentPersonaTexts = messages
      .filter(message => message.role === "persona")
      .slice(-3)
      .map(message => String(message.content || ""));
    const hasDialogueRecently = recentPersonaTexts.some(text => /[“"][^”"]{1,60}[”"]/.test(text));
    const hasFirstPersonRecently = recentPersonaTexts.some(text => /(我|咱)/.test(text));
    const compositionCue = [
      hasDialogueRecently ? "" : buildDialogueQuotaInstruction(),
      hasFirstPersonRecently ? "" : buildPersonShiftInstruction(),
    ].filter(Boolean).join("\n\n");
    if (compositionCue) {
      console.info(
        `[RoleplayCompose] channel=${options.channelId} 配额注入：台词=${hasDialogueRecently ? "近期已有" : "强制"} 人称=${hasFirstPersonRecently ? "近期已有" : "允许转换"}`
      );
    }

    // 思考诊断层：先做一次「节奏导演」反思，再决定连说/换人与生成策略
    assertCurrentTurn();
    const reflection = await buildChannelReflection({
      channel,
      transcript: reflectionTranscript,
      recentMessages: messages,
      previousSceneAnchor,
      directorCue: [memoryCue, directorCue, compositionCue].filter(Boolean).join("\n\n"),
    });
    assertCurrentTurn();
    // 反思给出的锚和上一拍一样 → 一拍都没挪窝，计数累加；锚变了就清零。
    // 这是"原地打转"的确定性信号，不需要额外模型调用。
    const stallStreak = isSameStoryAnchor(previousSceneAnchor, reflection?.sceneAnchor)
      ? previousStallStreak + 1
      : 0;
    if (stallStreak >= STALL_BREAK_THRESHOLD) {
      console.warn(
        `[RoleplayStall] channel=${options.channelId} 连续 ${stallStreak} 拍时空锚未变，本拍强制跳拍：${(reflection?.sceneAnchor ?? "").slice(0, 40)}`
      );
    }

    const candidates = reflectedRoleplayTurnCandidates(
      channel.members,
      messages,
      reflection,
      options.personaId,
    );
    if (candidates.length === 0) throw new Error("没有可发言的频道成员");

    let lastTriedMember = candidates[0];
    let lastTriedPersona: any = null;
    /** 最近一次"角色没开口"的可展示原因（安全拒绝等）。 */
    let lastSkipReason: string | null = null;
    /** 成功插入消息时立即记下，续拍后续步骤失败也不能漏报已落库内容。 */
    const recordedBeats: RoleplayTurnBeat[] = [];
    const postPersistWarnings: string[] = [];

    // 一拍可多条：把"生成并落库一条"抽成闭包，同人续拍时重用
    const generateOne = async (member: typeof candidates[number]): Promise<{
      message: Awaited<ReturnType<typeof db.createRoleplayMessage>>;
      parsed: ParsedRoleplayTurn;
      emotionalState: RoleplayMood;
      speakerName: string;
    } | null> => {
      assertCurrentTurn();
      const persona = await db.getPersonaById(member.personaId, options.userId);
      assertCurrentTurn();
      if (!persona || persona.analysisStatus !== "ready") return null;
      lastTriedMember = member;
      lastTriedPersona = persona;

      const transcriptNow = formatRoleplayTranscript(
        excludeForContext(liveMessages),
        ROLEPLAY_TRANSCRIPT_CHARS,
      );
      const latestUserGuidance = [...liveMessages].reverse().find(m => m.role === "user")?.content || undefined;
      const provider = (persona as any).llmProvider || undefined;

      const invokeTurn = async (
        systemSuffix: string,
        /** 追加到用户提示词之后的消息：用于「把你自己刚写的草稿就地改掉」这类纠偏。 */
        extraMessages: { role: "assistant" | "user"; content: string }[] = [],
      ) => {
        // 系统提示词 = 人物频道自己的边界 + 频道世界与旁白规则（含“指称铁律”）。
        // 注意：buildChannelWorldOverlay 曾是死代码（运行时无人调用，只有测试在调），
        // 里面的“旁白一律用角色名、不用代词”因此从未生效——模型才会把对方写成“对方”，
        // 记录里对方的名字随之消失，最后演变成凭空造名字。这里把它真正接上。
        const systemPrompt = [
          buildChannelPersonaSystemPrompt(persona, {
            channelName: channel.name,
            channelDescription: channel.description,
            channelScenePrompt: channel.scenePrompt,
            speakerName: persona.name,
            otherMemberNames: channel.members
              .filter(item => item.personaName !== persona.name)
              .map(item => item.personaName),
            reflection,
          }),
          // 场景与前情上面已经注入过一次，这里不再重复（每轮省约 1,300 输入 token）。
          buildChannelWorldOverlay(channel, persona.name, { includeScenePrompt: false }),
          // 长期记忆放在导演线之前：先让它知道"故事到目前为止"，再谈这一拍。
          memoryCue,
          // 导演线：本拍在整条线的位置与必须发生的事。
          directorCue,
          // 成分配额：台词下限与人称转换许可。
          compositionCue,
          // 原地打转时最硬的一条：必须先让事情动起来，再写人物反应。
          stallStreak >= STALL_BREAK_THRESHOLD ? buildStallBreakInstruction(stallStreak) : "",
        ].filter(Boolean).join("\n\n");
        const invokeOnce = async (retryWithoutThinking = false) => {
          assertCurrentTurn();
          const response = await llmService.invoke({
          messages: [
            {
              role: "system",
              content: systemSuffix ? `${systemPrompt}\n\n${systemSuffix}` : systemPrompt,
            },
            {
              role: "user",
              content: buildRoleplayUserPrompt({
                channel,
                speakerName: persona.name,
                transcript: transcriptNow,
                allowSilence: options.allowSilence === true,
                reflection,
                latestUserGuidance,
                previousBeat: previousBeatText,
                sceneAnchor: reflection?.sceneAnchor ?? previousSceneAnchor,
                identityCue: reflection?.identityCue ?? null,
              }),
            },
            ...extraMessages,
          ],
          options: {
            provider,
            temperature: extra.temperature ?? 0.9,
            maxTokens: roleplayMaxTokens(extra.maxTokens),
            usageContext: {
              userId: options.userId,
              personaId: persona.id,
              route: "roleplay.channel_turn",
              purpose: "roleplay",
            },
            // 隐藏推理与正文共享 maxTokens：思考开着时给它单独设上限，避免推理跑满把正文挤空。
            // 与 reasoning_effort 互斥（provider 层只发其中一个）；关思考时该参数被忽略。
            reasoningMaxTokens: CHANNEL_TURN_REASONING_MAX_TOKENS,
            // 默认开着隐藏思考：不撞顶由「16384 预算 + reasoningMaxTokens 上限」保证。
            // 只有真正拿到空正文时，降级重试才关闭思考（把预算全留给正文）。
            ...(CHANNEL_MAIN_DISABLE_THINKING || retryWithoutThinking ? { disableThinking: true } : {}),
          },
          });
          assertCurrentTurn();
          return response;
        };
        const response = await invokeChannelTurnWithEmptyReplyRetry({
          allowRetry: true,
          invoke: invokeOnce,
          onEmptyReply: () => {
            console.warn(
              `[RoleplayTurn] channel=${options.channelId} persona=${persona.id} 首次返回空正文（隐藏推理吃满输出预算的典型症状），关闭隐藏思考重试一次`
            );
          },
        });
        return parseRoleplayTurnResponse(response || "", persona.name, persona.emotionalState);
      };

      let parsed = await invokeTurn("");
      if (options.allowSilence && !parsed.shouldSpeak) {
        return null;
      }
      // 空正文绝不落库：开启思考的模型偶发「请求成功但正文为空」（推理吃掉全部输出预算），
      // 以前会把空消息写进频道、白占一拍并把上下文带歪。这里直接判为本拍失败，交给候选轮转。
      if (!parsed.reply.trim()) {
        console.warn(
          `[RoleplayTurn] channel=${options.channelId} persona=${member.personaId} 正文为空，本轮跳过该角色`
        );
        return null;
      }
      // 可发送正文闸门：拦住英文元回复 / 供应商拒绝（见 looksLikeUnusableChannelReply）。
      // 这类内容一旦落库就成了人物台词，还会被下一轮当成历史继续演，必须拦在落库之前。
      if (looksLikeUnusableChannelReply(parsed.reply)) {
        console.warn(
          `[RoleplayGuard] channel=${options.channelId} persona=${member.personaId} 命中元回复/安全拒绝，整段重写一次：${parsed.reply.slice(0, 60)}`
        );
        try {
          const retry = await invokeTurn(UNUSABLE_REPLY_FIX_INSTRUCTION);
          if (retry.reply.trim() && !looksLikeUnusableChannelReply(retry.reply)) {
            parsed = retry;
          } else {
            console.warn(
              `[RoleplayGuard] channel=${options.channelId} persona=${member.personaId} 重写后仍不合格，跳过该角色`
            );
            lastSkipReason = "上游拒绝了当前内容方向（安全判断），这一拍没有生成；可以调整剧情尺度或换供应商设置后重试。";
            return null;
          }
        } catch (err) {
          if (err instanceof RoleplayTurnCancelledError) throw err;
          console.warn("[RoleplayGuard] retry failed, skip beat:", err);
          lastSkipReason = "上游拒绝了当前内容方向（安全判断），重写也失败，这一拍没有生成。";
          return null;
        }
      }

      // 旁白兜底：模型没写【】旁白时补写一段（strict 省额度模式跳过）。

      if (CHANNEL_FULL_QUALITY) {
        const decorated = await decorateReplyWithNarration({
          channel,
          speakerName: persona.name,
          reply: parsed.reply,
          sceneAnchor: reflection?.sceneAnchor ?? previousSceneAnchor,
          recentTranscript: transcriptNow,
        });
        assertCurrentTurn();
        if (decorated !== parsed.reply) {
          // 补写会整段替换主生成的结果：主生成看得见完整历史，这次调用以前什么都看不见。
          // 记一条日志，便于确认"落库的到底是哪次调用写的"。
          console.info(
            `[RoleplayNarration] channel=${options.channelId} persona=${member.personaId} 主生成缺少【】旁白，已由补写调用改写（${parsed.reply.length}→${decorated.length} 字）`
          );
          parsed = { ...parsed, reply: decorated };
        }
      }
      // 旁白代词归一：把【】里的“对方/那人”回填成真名，保证落库记录里始终带名字。
      {
        const normalized = normalizeNarrationReferences(
          parsed.reply,
          persona.name,
          channel.members.map(item => item.personaName).filter(Boolean) as string[],
        );
        if (normalized !== parsed.reply) parsed = { ...parsed, reply: normalized };
      }

      // 在场闸门：先过一遍免费的正则（阿X 形状），没命中再用审计调用核对两件事——
      // ① 有没有不属于频道的人名（阿莲、桂英这类）；
      // ② 画面里有没有"没有名字的第三人"（人影、来人、年轻人、无名却发出动作的人）。


      let rosterViolationUnresolved = false;
      if (CHANNEL_FULL_QUALITY) {
        const allowedNames = channel.members
          .map(item => item.personaName)
          .filter(Boolean) as string[];
        const regexNames = findChannelForeignNames(parsed.reply, allowedNames);
        const audit: ChannelPresenceAudit = regexNames.length > 0
          ? { foreignNames: regexNames, otherOnScene: false }
          : await auditChannelReplyPresence({
              reply: parsed.reply,
              allowedNames,
              userId: options.userId,
            });
        assertCurrentTurn();
        const foreignNames = audit.foreignNames;
        if (foreignNames.length > 0 || audit.otherOnScene) {
          try {
            // 把草稿作为 assistant 消息喂回去就地修改。只在 system 里描述草稿是"盲写"：

            const draftJson = JSON.stringify({
              shouldSpeak: true,
              innerThought: parsed.innerThought || "",
              mood: parsed.mood,
              reply: parsed.reply,
            });
            const fixed = await invokeTurn("", [
              { role: "assistant", content: draftJson },
              { role: "user", content: buildChannelRosterFixInstruction(foreignNames, allowedNames, { otherOnScene: audit.otherOnScene }) },
            ]);
            assertCurrentTurn();
            const recheck = await auditChannelReplyPresence({
              reply: fixed.reply,
              allowedNames,
              userId: options.userId,
            });
            assertCurrentTurn();
            const stillForeign = [
              ...findChannelForeignNames(fixed.reply, allowedNames),
              ...recheck.foreignNames,
            ];
            const accepted = Boolean(fixed.reply.trim()) && stillForeign.length === 0 && !recheck.otherOnScene;
            if (accepted) parsed = fixed;
            else rosterViolationUnresolved = true;
            console.info(
              `[RoleplayRoster] channel=${options.channelId} persona=${member.personaId} 外来人名=${foreignNames.join("、") || "无"} 无名在场者=${audit.otherOnScene ? "是" : "否"} 已修正=${accepted ? "yes" : "no"}`
            );
          } catch (err) {
            if (err instanceof RoleplayTurnCancelledError) throw err;
            rosterViolationUnresolved = true;
            console.warn("[RoleplayRoster] retry failed, keep draft:", err);
          }
        }
      }

      // 复读闸门：只与该角色自己的近期发言比对（频道里两位角色本来就会互相呼应，
      // 跨角色比对会误杀正常接话）。命中就带“严禁复写”指令整段重写一次。
      //
      // 关键：重写后仍然重复时**绝不落库**。以前保留原稿，于是同一段旁白被反复写进记录，

      // 剧情就此原地打转。判本拍失败交给候选轮转，比把重复内容喂回上下文好得多。
      if (parsed.reply.trim()) {
        const recentSameSpeaker = liveMessages
          .filter(m => m.role === "persona" && m.personaId === member.personaId)
          .slice(-6)
          .map(m => m.content)
          .filter(Boolean);
        // 短回复（纯台词、气音）本来字就少，用长文阈值只能漏判：

        // 对短回复收紧阈值，长文仍走沉浸版默认值。
        const repeatOptions = parsed.reply.length < 150
          ? { wholeThreshold: 0.6, sentenceThreshold: 0.7, minLength: 20 }
          : undefined;
        if (recentSameSpeaker.length > 0 && isRepetitiveImmersiveReply(parsed.reply, recentSameSpeaker, repeatOptions)) {
          try {
            const retry = await invokeTurn(buildChannelAntiRepeatInstruction(recentSameSpeaker));
            const stillRepeating = isRepetitiveImmersiveReply(retry.reply, recentSameSpeaker, repeatOptions);
            if (retry.reply.trim() && !stillRepeating) {
              parsed = retry;
            } else {
              console.warn(
                `[RoleplayRepeat] channel=${options.channelId} persona=${member.personaId} 复读且重写仍重复，本拍不落库`
              );
              lastSkipReason = "这一拍与前面重复、自动重写后仍然重复，已跳过（避免剧情原地打转）。";
              return null;
            }
            console.info(
              `[RoleplayRepeat] channel=${options.channelId} persona=${member.personaId} rewritten=yes`
            );
          } catch (err) {
            if (err instanceof RoleplayTurnCancelledError) throw err;
            console.warn("[RoleplayRepeat] retry failed, keep draft:", err);
          }
        }
      }
      // 代词兜底清洗：仅当频道成员全为男性时才把模型误写的“她”改回“他”，
      // 含女性成员的频道一律不动，避免把女性角色的代词静默改错。
      {
        const cleaned = sanitizeChannelGender(parsed.reply, { allMembersMale });
        if (cleaned !== parsed.reply) parsed = { ...parsed, reply: cleaned };
      }

      // 落库前最后一道校验：旁白补写、代词清洗、人名回填都可能改写正文，

      // 这一步是"进库前的最后一道门"，命中就不再写库，改由候选轮转换人。
      if (looksLikeUnusableChannelReply(parsed.reply)) {
        console.warn(
          `[RoleplayGuard] channel=${options.channelId} persona=${member.personaId} 落库前校验命中，丢弃本拍：${parsed.reply.slice(0, 60)}`
        );
        lastSkipReason = "上游返回了拒绝或元回复（落库前拦下），这一拍没有生成。";
        return null;
      }

      const emotionalState = normalizeMood(
        parsed.mood,
        computeEmotionalState(transcriptNow, parsed.reply, persona.emotionalState),
      );
      assertCurrentTurn();
      const message = await db.createRoleplayMessage({
        channelId: options.channelId,
        userId: options.userId,
        personaId: member.personaId,
        speakerName: persona.name,
        role: "persona",
        content: parsed.reply,
        innerThought: parsed.innerThought || null,
        moodState: { emotionalState },
        mode: options.mode ?? "channel",
        // 人名重写后仍越界：这条照样给用户看，但自动排除出上下文，
        // 避免编造出来的第三个人进入后续每一轮、被当成既成事实固化下来。
        ...(rosterViolationUnresolved ? { contextOverride: "excluded" as const } : {}),
      });
      recordedBeats.push({
        personaId: member.personaId,
        speakerName: persona.name,
        replyText: parsed.reply,
        innerThought: parsed.innerThought,
        emotionalState,
        messageId: message.id,
      });
      if (rosterViolationUnresolved) {
        console.warn(
          `[RoleplayRoster] channel=${options.channelId} message=${message.id} 重写后仍有外来人名，已自动排除出上下文`
        );
      }

      assertCurrentTurn();
      try {
        await db.updateRoleplayMemberCursor(
          options.channelId,
          options.userId,
          member.personaId,
          message.id,
        );
      } catch (err) {
        // 消息已经落库，游标失败不能隐藏这一拍，也不能被标成生成失败。
        postPersistWarnings.push(`第 ${recordedBeats.length} 拍已保存，但成员游标更新失败。`);
        console.warn("[RoleplayCursor] message saved, cursor update failed:", err);
      }
      // 把这一拍写进本回合的实时上下文：同人续拍的下一次 generateOne 会看到它，
      // 并通过 previousBeat 被明确要求承接而不是复述。
      liveMessages.push({
        personaId: member.personaId,
        speakerName: persona.name,
        role: "persona",
        content: parsed.reply,
      });
      previousBeatText = parsed.reply;

      return { message, parsed, emotionalState, speakerName: persona.name };
    };

    const persistSavedTurnProgress = async (skippedReason: string | null, checkCurrent: boolean) => {
      const firstBeat = recordedBeats[0];
      if (!firstBeat) return;
      if (checkCurrent) assertCurrentTurn();
      await persistChannelDiagnostics({
        channelId: options.channelId,
        userId: options.userId,
        spoken: true,
        personaId: firstBeat.personaId,
        speakerName: firstBeat.speakerName,
        emotionalState: firstBeat.emotionalState,
        innerThought: firstBeat.innerThought,
        messageId: firstBeat.messageId,
        beats: recordedBeats,
        postPersistWarning: postPersistWarnings.length ? postPersistWarnings.join(" ") : null,
        reflection,
        economyLevel: "normal",
        stallStreak,
        skippedReason,
      });

      // 导演线推进：这一拍演完了 → 游标前进，并把"实际发生了什么"记进台账，
      // 下次重规划时模型能看到真实发生过的事（而不是只看得到最后 100 条消息）。
      if (checkCurrent) assertCurrentTurn();
      if (directorState) {
        const playedStep = currentArcStep(directorState);
        const nextDirectorState: StoryDirectorState = {
          ...directorState,
          // 游标封顶在计划长度：重规划失败时不能一路涨到 6/5（那样导演线提示词会整个变空）。
          // 封顶后下一拍必然触发重规划，同时提示词仍沿用最后一拍。
          cursor: Math.min(directorState.cursor + 1, directorState.arc.length),
          stallStreak,
          // 全局回合数：跨重规划不归零，让模型知道整段故事演了多久。
          turnCount: (directorState.turnCount ?? 0) + 1,
          recentBeats: [
            ...directorState.recentBeats,
            ...recordedBeats.map((beat, index) => `${playedStep?.title ?? "推进"} · 第 ${index + 1} 拍 · ${beat.speakerName}：${String(beat.replyText).replace(/[【】\n]/g, " ").trim().slice(0, 90)}`),
          ].slice(-8),
        };
        try {
          await db.setRoleplayChannelDirectorState(options.channelId, options.userId, nextDirectorState as any);
          console.info(
            `[RoleplayDirector] channel=${options.channelId} 推进到第 ${nextDirectorState.cursor}/${nextDirectorState.arc.length} 拍`
          );
        } catch (err) {
          console.warn("[RoleplayDirector] 推进落库失败:", err);
        }
      }

    };
    persistCancelledSavedTurn = () => persistSavedTurnProgress("本轮已停止；保留停止前实际保存的发言，后续未继续生成或交付。", false);

    // 第一拍：按候选顺序（含反思的连说倾向）找一位能开口的
    let first: Awaited<ReturnType<typeof generateOne>> | null = null;
    let firstMember = candidates[0];
    for (const member of candidates) {
      const result = await generateOne(member);
      if (result) {
        first = result;
        firstMember = member;
        break;
      }
    }

    if (first) {
      assertCurrentTurn();
      // 同人续拍：反思判定 same 且非 strict 时，同一人再补一拍（每 tick 最多 2 条）
      let secondBeatFailed = false;
      if (
        reflection?.nextSpeakerHint === "same"
      ) {
        try {
          await generateOne(firstMember);
        } catch (err) {
          if (err instanceof RoleplayTurnCancelledError) throw err;
          secondBeatFailed = true;
          console.warn("[RoleplayMultiBeat] second beat failed, keep first:", err);
        }
      }
      assertCurrentTurn();
      await persistSavedTurnProgress(secondBeatFailed
        ? "节奏导演判定同人连说，但续拍生成失败，保留第一拍。"
        : null, true);

      assertCurrentTurn();
      return {
        spoken: true,
        channelId: options.channelId,
        personaId: firstMember.personaId,
        speakerName: first.speakerName ?? String(firstMember.personaId),
        replyText: first.parsed.reply,
        innerThought: first.parsed.innerThought,
        emotionalState: first.emotionalState,
        messageId: first.message.id,
        beats: recordedBeats,
      };
    }

    const fallbackPersona = lastTriedPersona as Awaited<ReturnType<typeof db.getPersonaById>> | null;
    const fallbackMember = lastTriedMember;
    const speakerName = fallbackPersona?.name ?? "同伴";
    const fallbackMood = normalizeMood(fallbackPersona?.emotionalState, "warm");
    assertCurrentTurn();
    await persistChannelDiagnostics({
      channelId: options.channelId,
      userId: options.userId,
      spoken: false,
      personaId: fallbackMember.personaId,
      speakerName,
      emotionalState: fallbackMood,
      innerThought: "静静看着眼前的一幕，在空气中保持着自然的沉默与陪伴。",
      reflection,
      economyLevel: "normal",
      stallStreak,
      skippedReason: lastSkipReason ?? "本轮所有候选角色均未开口（沉默或生成失败），保持安静陪伴。",
    });
    assertCurrentTurn();
    return {
      spoken: false,
      channelId: options.channelId,
      personaId: fallbackMember.personaId,
      speakerName,
      replyText: "",
      innerThought: "静静看着眼前的一幕，在空气中保持着自然的沉默与陪伴。",
      emotionalState: fallbackMood,
      skippedReason: lastSkipReason,
    };
  } catch (err) {
    if (err instanceof RoleplayTurnCancelledError && persistCancelledSavedTurn) {
      await persistCancelledSavedTurn();
    }
    throw err;
  } finally {
    runningRoleplayTurns.delete(lockKey);
  }
}
