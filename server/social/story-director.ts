/**
 * 故事导演线（story director）——场景模式与角色生活频道共用的**纯逻辑层**。
 *
 * 这里只放不碰数据库、不碰 QQ 路由的纯函数与类型：
 *   ① 拍子阶梯：turn → 当前叙事相位（保证"每一拍一定会换"，免费且确定）
 *   ② 导演线 arc：模型生成的接下来 4~6 拍计划，可被用户引导改线
 *   ③ 停滞判定：时空锚连着几拍没变 = 原地打转，需要强制跳拍
 *
 * 两个模式的状态存储各自独立（场景模式存 persona_runtime_states / scene_memory_states，
 * 频道存 roleplay_channels.directorState），互不冲突；共享的只有这里的纯函数。
 * 这样做是为了避免第二套实现：历史上频道和场景各写一份，很快就漂移了。
 */

/** 叙事相位：阶梯的六个拍子。 */
export type StoryBeatPhase =
  | "opening"
  | "establish"
  | "world_event"
  | "consequence"
  | "development"
  | "choice";

/** turn ≥ 3 之后进入的四拍循环。 */
export const STORY_BEAT_CYCLE = ["world_event", "consequence", "development", "choice"] as const;

/**
 * 第 turn 拍处于哪个相位（从 0 开始计）。
 * 注意：它只看回合数，**不知道剧情发生了什么**——它只能保证"拍子一定会换"，
 * 具体这一拍做什么要由导演线 arc 提供。两者叠加，不是替代关系。
 */
export function getStoryBeatPhase(turn: number): StoryBeatPhase {
  const safeTurn = Number.isSafeInteger(turn) && turn > 0 ? turn : 0;
  if (safeTurn === 0) return "opening";
  if (safeTurn <= 2) return "establish";
  return STORY_BEAT_CYCLE[(safeTurn - 3) % 4];
}

/** 每个相位的强制指令（沿用场景模式原文，以免行为漂移）。 */
export function buildStoryBeatInstruction(beat: StoryBeatPhase): string {
  switch (beat) {
    case "opening":
      return "这是本段故事的第一回合。用 1-2 段简短【】旁白交代人物怎样来到当前地点、眼前最直接的处境或目的，随后立刻进入动作和互动；不要写长序章、人物小传或大段前情。如果用户本轮已经写出了入场旁白或直接指定正在发生的动作，就以用户版本为开场，只补最短的衔接，不另起一套。";
    case "establish":
      return "这是故事建立阶段。承接已经发生的动作，逐渐明确这一段眼下要做的事、人物之间的小目标或潜在张力；不要重新介绍地点，也不要急着制造大事件。";
    case "world_event":
      return "这一回合适合让世界轻轻动一下：依据地点与当前情节，引入一个合理的外界变化，例如脚步、来人、钟声、天气、物件、规矩、消息或空间变化。一次只引入一个，并让它和当前行动有因果关系；不要随机惊吓，不要为了热闹强行打断亲密或用户正在明确推进的核心情节。";
    case "consequence":
      return "这一回合重点写上一轮行动或外界变化造成的后果，让人物必须应对、调整或作出反应；不要立刻再扔一个互不相干的新事件。";
    case "development":
      return "这一回合推进人物行动、关系或信息，至少让局面发生一个可见变化。可以揭开一个小细节、完成一步目标或让原有张力升级，但不要原地重复同一组动作。";
    case "choice":
      return "这一回合把前面的发展收束成一个自然的选择、转折或下一步机会，给用户留下可继续导演的抓手；不要替用户决定其台词、意愿或最终选择，也不要把整个场景仓促完结。";
  }
}

/** 导演线的一拍计划。 */
export type StoryArcStep = {
  /** 这一拍要干什么（短标题）。 */
  title: string;
  /** 落实要求：这一拍必须发生的具体事件。 */
  goal: string;
};

/** 导演线状态：两个模式各自的存储里都放这个形状。 */
export type StoryDirectorState = {
  arc: StoryArcStep[];
  /** 已经走到第几拍（0 基）。 */
  cursor: number;
  /** 上一次规划时看到的用户引导；变了就重新规划。 */
  lastUserSteer: string | null;
  /** 连续几拍的时空锚没有变化（原地打转信号）。 */
  stallStreak: number;
  /** 最近几拍实际发生的事，用于下次规划。 */
  recentBeats: string[];
  /** 上次规划时的回合数。 */
  plannedAtTurn: number;
  /**
   * 【长期记忆】故事到目前为止的滚动摘要。
   * 消息窗口只有 100 条，掉出去的内容会永久失忆；这一段摘要负责把它们带下去。
   * 每次重规划导演线时顺手更新，不额外增加模型调用。
   */
  storySummary: string;
  /** 【长期记忆】已经确认的事实：关系变化、约定、承诺、关键物件的状态。 */
  pinnedFacts: string[];
  /** 全局回合数：跨重规划不归零，让模型知道整段故事演了多久。 */
  turnCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanSteps(value: unknown): StoryArcStep[] {
  if (!Array.isArray(value)) return [];
  const steps: StoryArcStep[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const goal = typeof item.goal === "string" ? item.goal.trim() : "";
    if (!title && !goal) continue;
    steps.push({ title: title || goal.slice(0, 24), goal: goal || title });
  }
  return steps.slice(0, 8);
}

/** 读取存储里的导演线状态；坏数据一律当作"没有计划"。 */
export function normalizeStoryDirectorState(value: unknown): StoryDirectorState | null {
  if (!isRecord(value)) return null;
  const arc = cleanSteps(value.arc);
  if (arc.length === 0) return null;
  const cursorRaw = typeof value.cursor === "number" && Number.isFinite(value.cursor) ? Math.floor(value.cursor) : 0;
  const stallRaw = typeof value.stallStreak === "number" && Number.isFinite(value.stallStreak) ? Math.floor(value.stallStreak) : 0;
  return {
    arc,
    cursor: Math.max(0, Math.min(cursorRaw, arc.length)),
    lastUserSteer: typeof value.lastUserSteer === "string" && value.lastUserSteer.trim() ? value.lastUserSteer.trim() : null,
    stallStreak: Math.max(0, stallRaw),
    recentBeats: Array.isArray(value.recentBeats)
      ? value.recentBeats.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(-8)
      : [],
    plannedAtTurn: typeof value.plannedAtTurn === "number" && Number.isFinite(value.plannedAtTurn) ? Math.floor(value.plannedAtTurn) : 0,
    storySummary: typeof value.storySummary === "string" ? value.storySummary.trim().slice(0, 2000) : "",
    pinnedFacts: Array.isArray(value.pinnedFacts)
      ? value.pinnedFacts.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim().slice(0, 200)).slice(-8)
      : [],
    turnCount: typeof value.turnCount === "number" && Number.isFinite(value.turnCount) ? Math.max(0, Math.floor(value.turnCount)) : 0,
  };
}

/** 当前该演哪一拍；计划走完返回 null。 */
export function currentArcStep(state: StoryDirectorState | null): StoryArcStep | null {
  if (!state) return null;
  if (state.cursor < 0 || state.cursor >= state.arc.length) return null;
  return state.arc[state.cursor];
}

/** 是否需要重新规划导演线。 */
export function shouldReplanStoryArc(
  state: StoryDirectorState | null,
  options: { userSteer?: string | null; replanEveryBeats?: number } = {},
): boolean {
  if (!state) return true;
  if (state.cursor >= state.arc.length) return true;
  const steer = (options.userSteer || "").trim();
  if (steer && steer !== (state.lastUserSteer || "")) return true;
  const every = options.replanEveryBeats ?? 0;
  if (every > 0 && state.cursor > 0 && state.cursor % every === 0) return true;
  return false;
}

/** 两个时空锚是不是同一个地方（原地打转检测）。 */
export function isSameStoryAnchor(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a || "").replace(/\s+/g, "").trim();
  const right = (b || "").replace(/\s+/g, "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

/** 规划导演线的提示词（调用方负责真正发起模型调用）。 */
export function buildStoryArcInstruction(params: {
  sceneBrief: string;
  recentBeats: string[];
  userSteer?: string | null;
  stepCount?: number;
  /** 上一次的长期记忆：要求模型在此基础上更新，而不是每次从头重写。 */
  previousSummary?: string | null;
  previousPinnedFacts?: string[];
}): string {
  const count = Math.max(3, Math.min(6, params.stepCount ?? 5));
  return [
    "你是这段故事的编剧。根据已经发生的事和用户的最新要求，排出接下来几拍的情节计划。",
    params.sceneBrief ? `【故事背景】\n${params.sceneBrief.slice(0, 700)}` : "",
    params.previousSummary?.trim()
      ? `【上一次的故事摘要（在此基础上更新，不要丢掉仍然成立的信息）】\n${params.previousSummary.trim().slice(0, 1200)}`
      : "",
    params.previousPinnedFacts?.length
      ? `【已经确认的事实（继续沿用，除非剧情明确推翻了它）】\n${params.previousPinnedFacts.map(item => "- " + item).join("\n")}`
      : "",
    params.recentBeats.length
      ? `【最近几拍发生了什么】\n${params.recentBeats.map((beat, index) => (index + 1) + ". " + beat).join("\n")}`
      : "【最近几拍发生了什么】\n（故事刚开始）",
    params.userSteer?.trim()
      ? `【用户最新要求·最高优先，计划必须服从它】\n${params.userSteer.trim().slice(0, 400)}`
      : "",
    "【输出要求】只输出 JSON，不要 Markdown，格式为：{\"arc\":[{\"title\":\"这一拍干什么\",\"goal\":\"这一拍必须发生的具体事件\"}],\"storySummary\":\"故事到目前为止的脉络\",\"pinnedFacts\":[\"需要长期记住的事实\"]}",
    `一共 ${count} 拍。要求：①每一拍都必须让局面发生可见变化，禁止继续在同一个动作、同一个地点反复描摹；②拍与拍之间要有因果推进；③如果用户给了要求，第一拍就要落实它；④只写情节走向，不要替人物写台词。`,
    "storySummary 是最重要的长期记忆：上下文窗口只有 100 条消息，更早的剧情会整段掉出去，只能靠这段摘要带下去。所以必须写清「谁和谁、关系走到了哪一步、发生过哪些关键事件、眼下悬着什么」，200-400 字，不要写「未完待续」这类空话。",
    "pinnedFacts 写 3-8 条最硬的事实（约定、承诺、关系变化、关键物件的位置与状态），每条一句话。",
  ].filter(Boolean).join("\n\n");
}

/** 一次规划的结果：拍子计划 + 长期记忆。 */
export type StoryPlan = {
  arc: StoryArcStep[];
  storySummary: string;
  pinnedFacts: string[];
};

/** 解析模型返回的规划 JSON（含长期记忆）。解析不出来返回 null。 */
export function parseStoryPlan(raw: string): StoryPlan | null {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  const matched = text.match(/\{[\s\S]*\}/);
  if (!matched) return null;
  try {
    const parsed = JSON.parse(matched[0]) as Record<string, unknown>;
    const arc = cleanSteps(parsed?.arc);
    if (arc.length === 0) return null;
    const storySummary = typeof parsed.storySummary === "string" ? parsed.storySummary.trim().slice(0, 2000) : "";
    const pinnedFacts = Array.isArray(parsed.pinnedFacts)
      ? parsed.pinnedFacts
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .map(item => item.trim().slice(0, 200))
          .slice(-8)
      : [];
    return { arc, storySummary, pinnedFacts };
  } catch {
    return null;
  }
}

/** 只要拍子计划（兼容旧调用与既有测试）。 */
export function parseStoryArc(raw: string): StoryArcStep[] {
  return parseStoryPlan(raw)?.arc ?? [];
}

/**
 * 长期记忆注入：摘要 + 已确认事实 + 全局回合数。
 * 这是频道对抗"100 条窗口之外彻底失忆"的唯一载体，必须放在提示词靠前、权重高的位置。
 */
export function buildStoryMemoryCue(state: StoryDirectorState | null): string {
  if (!state) return "";
  const parts: string[] = [];
  if (state.turnCount > 0) {
    parts.push(`【整段故事进度】已经演到第 ${state.turnCount} 拍。`);
  }
  if (state.storySummary.trim()) {
    parts.push(
      `【故事到目前为止·长期记忆】\n${state.storySummary.trim()}\n（比【最近频道记录】更早的事一律以这段摘要为准；摘要里已经发生过的事不要再演一遍。）`
    );
  }
  if (state.pinnedFacts.length) {
    parts.push(`【已确认事实·必须遵守】\n${state.pinnedFacts.map(item => "- " + item).join("\n")}`);
  }
  return parts.join("\n\n");
}
/** 注入给生成模型的"本拍是整条线的第几拍、必须发生什么"。 */
export function buildStoryArcCue(state: StoryDirectorState | null): string {
  if (!state || state.arc.length === 0) return "";
  const exhausted = state.cursor >= state.arc.length;
  // 计划走完但重规划失败时，**沿用最后一拍**而不是让提示词整个消失。
  // 实测故障：重规划连续失败 + 游标无条件前进 → 游标涨到 6/5，导演线提示词变空，
  // 那一拍就完全失去了计划指引（只剩最近记录）。
  const step = currentArcStep(state) ?? state.arc[state.arc.length - 1];
  if (!step) return "";
  const rest = state.arc.slice(state.cursor + 1, state.cursor + 3).map(item => item.title).join(" → ");
  return [
    exhausted
      ? `【导演线·计划已走完，重规划尚未成功】继续把最后一拍（${step.title}）演到位，不要仓促收尾，也不要把已经演过的事再演一遍。`
      : `【导演线·第 ${state.cursor + 1}/${state.arc.length} 拍】${step.title}`,
    `这一拍必须发生：${step.goal}`,
    rest ? `后面还要走到：${rest}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * 台词配额：连着几拍正文全是旁白时强制让人物开口。
 * 实测故障：提示词写着"纯旁白与分镜头驱动、人物开口并非每轮必须"，反思每轮也判"无需开口"，
 * 于是连着 8 拍零台词——正文 100% 旁白、0% 台词，一段感情戏写成了默片。
 */
export function buildDialogueQuotaInstruction(): string {
  return [
    "【台词配额·本拍必须落实（最高优先）】最近几拍的正文全是旁白，人物一句话都没说过，已经写成默片了。",
    "这一拍必须让人物真的开口：至少 2 句台词，其中至少 1 句是说得完整的句子——不要全是“你、你别……”“好、好烫”这种气音。",
    "台词要像这个人真的会说的话：带他的身份、性格和此刻的处境（说错了、说半截、说完自己脸红都可以，但不能不说）。旁白照写，只是不要再把话整个省掉。",
  ].join("\n");
}

/**
 * 人称转换配额：允许人物在心里用自己的声音说话。
 * 实测故障：全程单一第三人称、第一人称 0/8，人物从来没有在心里说过话。
 */
export function buildPersonShiftInstruction(): string {
  return [
    "【人称转换·本拍可用一次】最近几拍全程第三人称，人物从来没有在心里用自己的声音说过话。",
    "这一拍允许出现一次第一人称的内心话（直接写在正文里，加不加引号都可以），例如“我这是在干什么”“他要是回头看我一眼……”。",
    "只转这一次，转完就回到第三人称；不要把整段改成第一人称，也不要每拍都转。",
  ].join("\n");
}

/** 原地打转时的强制跳拍指令。 */
export function buildStallBreakInstruction(stallStreak: number): string {
  return [
    `【停滞打破·最高优先】已经连续 ${stallStreak} 拍停在同一个时间、同一个地点、同一组动作上了。`,
    "这一拍必须让情境发生一次真实位移或事件：换一个具体位置或时段，或引入一个明确的新变化（来人、声响、天气转折、物件、决定、离开、见面）。",
    "禁止再描摹上一拍的身体动作与感官细节，不要重复同一个画面，也不要只写喘息与气音：先让事情动起来，再写人物反应。",
  ].join("\n");
}
