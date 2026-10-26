import { SCENE_INTERACTION_RULE } from "../../shared/scene-mode";
import * as db from "../db";
import { buildStoryBeatInstruction, getStoryBeatPhase, type StoryBeatPhase } from "./story-director";

// 拍子阶梯与各相位指令已抽到 story-director.ts（与频道共用同一份纯逻辑），
// 这里只保留场景模式原有的导出名，避免调用方与测试受影响。
export type SceneStoryBeat = StoryBeatPhase;

export type ProactiveSceneContext = {
  immersiveMode: boolean;
  overlay: string | null;
  identityOverrides: SceneIdentityOverrides | null;
};

/**
 * 主动消息（定时/环境）统一解析当前是否处于场景模式。
 *
 * 自用版这里还有 QQ 内存场景开关与「频道/对戏接管」边界；书中人（公开 fork）
 * 没有 QQ 通道、也没有主动消息子系统（第 7 批才引入 personaRuntimeStates / proactive），
 * 因此本函数只按 DB 的 persona.activeSceneId 判定，保留同名导出以便第 7 批接回主动消息时复用。
 */
export async function resolveProactiveSceneContext(
  persona: { id: number; userId: number; activeSceneId?: number | null },
): Promise<ProactiveSceneContext> {
  const sceneId = (persona as any)?.activeSceneId ?? null;
  if (typeof sceneId === "number") {
    try {
      // 4A 已把 db.getSceneById 改为单参（id）；书中人其余调用点同步收尾。
      const scene = await db.getSceneById(sceneId);
      if (scene) {
        return {
          immersiveMode: true,
          overlay: formatScenePromptOverlay(scene),
          identityOverrides: getSceneIdentityOverrides(scene as never),
        };
      }
    } catch {
      // 背景读取失败不阻断主动消息，继续按无背景场景处理。
    }
  }
  return { immersiveMode: false, overlay: null, identityOverrides: null };
}

type SceneLike = {
  name?: string | null;
  description?: string | null;
  systemPromptOverlay?: string | null;
  contextSeed?: string | null;
  personaIdentityOverride?: string | null;
  userIdentityOverride?: string | null;
};

export function formatScenePromptOverlay(scene: SceneLike | null | undefined): string | null {
  if (!scene) return null;
  const sections = [
    scene.name?.trim() ? `场景名称：${scene.name.trim()}` : "",
    scene.description?.trim() ? `场景背景：${scene.description.trim()}` : "",
    scene.contextSeed?.trim()
      ? `场景前情提要/当前上下文（进入这个场景时自动接上，之后随剧情推进）：\n${scene.contextSeed.trim()}`
      : "",
    scene.systemPromptOverlay?.trim()
      ? `这个场景的专属行为与写法：\n${scene.systemPromptOverlay.trim()}`
      : "",
  ].filter(Boolean);
  return sections.length > 0 ? sections.join("\n") : null;
}

export type SceneIdentityOverrides = {
  personaIdentityOverride?: string | null;
  userIdentityOverride?: string | null;
};

export function getSceneIdentityOverrides(
  scene: SceneIdentityOverrides | null | undefined,
): SceneIdentityOverrides | null {
  if (!scene) return null;
  const personaIdentityOverride = scene.personaIdentityOverride?.trim() || null;
  const userIdentityOverride = scene.userIdentityOverride?.trim() || null;
  if (!personaIdentityOverride && !userIdentityOverride) return null;
  return { personaIdentityOverride, userIdentityOverride };
}

/**
 * 场景级外观覆盖标记：写在场景的「人物身份覆盖 / 用户身份覆盖」文本里即生效。
 * 带标记的场景才允许按场景设定改写皮肤质感与嗓音音色；不带标记的场景行为与历史完全一致。
 */
export const SCENE_SKIN_OVERRIDE_MARKER = "【本场皮肤覆盖】";
export const SCENE_VOICE_OVERRIDE_MARKER = "【本场嗓音覆盖】";

export type SceneAppearanceOverride = { skin: boolean; voice: boolean };

/** 从场景身份覆盖文本里解析皮肤/嗓音覆盖开关（缺省全为 false，等价于旧行为）。 */
export function getSceneAppearanceOverride(
  overrides: SceneIdentityOverrides | null | undefined,
): SceneAppearanceOverride {
  const normalized = getSceneIdentityOverrides(overrides);
  if (!normalized) return { skin: false, voice: false };
  const raw = [
    normalized.personaIdentityOverride,
    normalized.userIdentityOverride,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    skin: raw.includes(SCENE_SKIN_OVERRIDE_MARKER),
    voice: raw.includes(SCENE_VOICE_OVERRIDE_MARKER),
  };
}

export function buildSceneIdentityOverrideInstruction(
  overrides: SceneIdentityOverrides | null | undefined,
): string {
  const normalized = getSceneIdentityOverrides(overrides);
  if (!normalized) return "";
  return [
    "【当前场景身份覆盖】只对当前虚构故事生效，退出场景后不作为日常或现实身份。",
    normalized.personaIdentityOverride ? `角色本场设定：
${normalized.personaIdentityOverride}` : "",
    normalized.userIdentityOverride ? `参与者本场设定：
${normalized.userIdentityOverride}` : "",
    "本场明确提供的身份、年龄、时代、外貌和口吻以本场设定为准；未写明的部分沿用角色资料，不固定为某个体型、职业或关系。",
    "场景设定不授权替其他参与者新增意愿、台词或选择；保持普通小说共创的内容边界。",
  ].filter(Boolean).join("\n");
}

export function getSceneStoryBeat(turn: number): SceneStoryBeat {
  return getStoryBeatPhase(turn);
}

export function isSceneStoryStartMarker(text: string): boolean {
  return /^\s*【\s*(?:开始|开场|开场白|故事开始|场景开始|开始场景|正式开始|开始剧情|进入剧情)(?:\s*[：:][^】]*)?\s*】/.test(
    text,
  );
}

export function buildSceneStorySystemInstruction(params: {
  turn: number;
}): string {
  const beat = getSceneStoryBeat(params.turn);
  return [
    "【场景故事线·当前回合】",
    `当前是本段场景故事的第 ${Math.max(0, params.turn) + 1} 个回复回合，阶段为 ${beat}。`,
    buildStoryBeatInstruction(beat),
    "连续性硬规则：把最近聊天里已经发生的地点、人物位置、物件状态、来人、承诺和未完成动作当作当前事实。不要重播开场、不要把已经完成的动作又从头做一遍、不要让刚出现的人或事件无故消失。每轮至少推进一项：行动、环境、关系、信息、阻碍或选择。",
    "世界互动规则：场景不是封闭布景。寺庙、街道、家、单位等地点都可以有符合自身规律的人、声音、物件和事件；外界变化应每隔若干回合自然出现一次，而不是每轮硬塞，也不能抢走用户正在主导的剧情。",
    "用户创作方向：承接用户明确给出的故事事实与当下目标；关键矛盾时简短澄清，再继续推进普通故事。",
    "人物连续性：回应新的剧情方向时保持角色性格；不代替其他参与者决定意愿或行动。",
    "创作边界：只把明确提供的信息当作故事事实，不从简短消息推断参与者未表达的选择。",
    SCENE_INTERACTION_RULE,
    "禁止把“故事性”误解成脱离当前互动的小说章节：保持聊天式共创，每次只推进一小段，让用户随时能用下一条消息改变方向。",
  ].join("\n");
}

export function buildSceneStoryUserDirectionInstruction(params: {
  text: string;
  turn: number;
}): string {
  const isStartMarker = isSceneStoryStartMarker(params.text);
  const hasNarration =
    /【[^】]+】|（[^）]+）|\([^)]{4,}\)|(?:随后|这时|忽然|门外|有人|传来|来到|走进|场景|旁白)/.test(
      params.text,
    );
  return [
    "【本轮场景导演输入】把用户这条消息作为当前故事的最高优先推进指令。",
    isStartMarker
      ? "用户使用了场景开始标记。根据当前场景开始普通故事，不把标记当作角色台词，也不回到之前的日常场景。"
      : hasNarration
      ? "这条消息包含旁白、动作或故事变化：承接明确提供的事实并继续推进，不补造其他参与者的意愿。"
      : "这条消息主要是台词或行动意图：先让人物直接回应，再让当前场景向前发生一小步。",
    params.turn === 0
      ? "这是新故事的首轮；开场只做最短衔接，尽快落到用户给出的当下。"
      : "这不是重新开场；承接上一轮的具体位置与未完成动作，禁止重置时间、地点或关系。",

  ].join("\n");
}
