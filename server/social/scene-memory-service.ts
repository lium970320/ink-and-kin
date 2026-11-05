/**
 * 场景记忆缓存的摘要刷新与已确认事实自动提炼服务。
 *
 * 只更新 scene_memory_states.cache.summary 和 scene_memory_states.cache.pinnedFacts，
 * 不写日常聊天、不写长期记忆；失败静默返回 null，绝不阻断人物回复。
 * 自动触发由书中人聊天管线（server/chat/service.ts 的场景回合）伴随调用。
 */
import { llmService } from "../llm";
import * as db from "../db";
import {
  buildInitialSceneMemoryCache,
  SCENE_MEMORY_LIMITS,
  type SceneMemoryCache,
  type SceneMemoryPinnedFact,
} from "./scene-memory";

export const SCENE_MEMORY_SUMMARY_INTERVAL_TURNS = 6;

type SceneRefreshParams = {
  personaId: number;
  userId: number;
  sceneId: number;
  expectedRevision?: number;
  // 兼容现有调用；生成提示以事务内读取的场景设定为准。
  sceneName?: string | null;
  sceneDescription?: string | null;
};
type RefreshSnapshot = Awaited<ReturnType<typeof db.getSceneMemoryRefreshSnapshot>>;

function readSceneMemorySnapshot(params: SceneRefreshParams) {
  return db.getSceneMemoryRefreshSnapshot(
    params.personaId, params.userId, params.sceneId, 24, params.expectedRevision,
  );
}

/**
 * 判断大模型返回的内容是否为安全审核拒答文本
 */
function isRefusalOutput(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  const refusalPatterns = [
    /^对不起/i,
    /^抱歉/i,
    /^我很抱歉/i,
    /无法协助生成/i,
    /无法提供包含/i,
    /违反.*(政策|准则|规定|规范)/i,
    /不符合.*(政策|安全|使用)/i,
    /涉及.*(?:内容策略|使用限制)/i,
    /作为.*AI/i,
    /作为一个人工智能/i,
    /I cannot/i,
    /I am unable to/i,
    /I apologize/i,
  ];
  return refusalPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * 刷新场景滚动前情摘要，服务商拒绝时保持原缓存
 */
export async function refreshSceneMemorySummary(
  params: SceneRefreshParams, captured?: RefreshSnapshot,
): Promise<string | null> {
  try {
    const snapshot = captured === undefined ? await readSceneMemorySnapshot(params) : captured;
    if (!snapshot) return null;
    const { history: sceneMessages, scene, stateId, revision } = snapshot;

    // 1. 系统提示词：明确虚构剧本文学语境与安全出版规范
    const systemPrompt = [
      "【任务背景】你是一位专业的影视剧本与小说叙事顾问。你的任务是将以下虚构剧本场景中的角色互动提取为一小段含蓄、精炼、符合出版合规的「前情提要」，供人物下一次进入该剧本时快速接续情节。",
      "【表达与安全要求】",
      "1. 遵守内容策略，只概括必要的普通故事事实；",
      "2. 只记录普通故事的客观事件、人物目标与已经明确的关系变化，不推断参与者的意愿；",
      "3. 重点提炼：①核心剧情发展与转折、②两人关系与心理状态变化、③地点与环境状态、④关键约定与未完事件；",
      "4. 篇幅 120–300 字；直接输出摘要正文，不要标题、序号、前缀或引号。",
    ].join("\n");

    const sanitizedMessages = sceneMessages.slice(-16).map(message => {
      const role = message.role === "assistant" ? "人物" : "用户";
      const rawContent = (message.content ?? "").trim().slice(0, 300);
      const cleanContent = rawContent;
      return `${role}：${cleanContent}`;
    });

    const userPrompt = [
      scene.name.trim() ? `【场景名称】：${scene.name.trim()}` : "",
      scene.description?.trim() ? `【场景背景】：${scene.description.trim()}` : "",
      "",
      "【最近的剧本对话记录】：",
      ...sanitizedMessages,
    ].filter(Boolean).join("\n");

    const raw = await llmService.invoke({
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      options: {
        purpose: "scene_memory_summary" as const,
        maxTokens: 420,
        temperature: 0.2,
        // 书中人统一走 llmService + usageContext：带 userId 时 invoke 会自动转到
        // invokeForUser，使用该用户配置的路由/备用模型，并走既有用量记录。
        usageContext: {
          userId: params.userId,
          personaId: params.personaId,
          route: "social.scene.memory_summary",
          purpose: "scene_memory_summary",
        },
      },
    });

    // 服务商拒绝时停止本次摘要，不改写词汇或重试绕过拒绝。
    if (!raw || isRefusalOutput(raw)) return null;

    const summary = (raw ?? "").trim().slice(0, SCENE_MEMORY_LIMITS.summaryMaxChars);
    if (!summary || isRefusalOutput(summary)) return null;

    const updated = await db.mutateSceneMemoryState(
      params.personaId, params.userId, params.sceneId,
      current => ({ cache: {
        ...(current.cache ?? buildInitialSceneMemoryCache()),
        summary,
        updatedAt: new Date().toISOString(),
      } }),
      { stateId, revision },
    );
    return updated ? summary : null;
  } catch (error) {
    console.warn("[SceneMemory] summary refresh failed", error);
    return null;
  }
}

/**
 * 自动从场景对话中提炼「已确认事实」（重要时刻、里程碑、经常发生的事情、默契偏好）
 * 并自动去重沉淀到场景记忆缓存中。
 */
export async function extractSceneConfirmedFacts(
  params: SceneRefreshParams, captured?: RefreshSnapshot,
): Promise<SceneMemoryPinnedFact[]> {
  try {
    const snapshot = captured === undefined ? await readSceneMemorySnapshot(params) : captured;
    if (!snapshot || snapshot.history.length < 3) return [];
    const { history: sceneMessages, scene, stateId, revision } = snapshot;
    const cache: SceneMemoryCache = snapshot.cache ?? buildInitialSceneMemoryCache();
    const existingFacts = cache.pinnedFacts ?? [];

    const factSystemPrompt = [
      "【任务背景】你是一位剧情事实归档员。请从以下虚构剧本对话中，提炼出 1 到 3 条「剧本内已确认的关键事实或经常发生的习惯默契」。",
      "【提炼判定规则】",
      "1. 重要时刻/里程碑：如两人确立了新身份/关系、做出了重大约定与承诺、解开了重大秘密或心结；",
      "2. 经常发生的事情/习惯偏好：如两人固定的相处模式、常去的专属地点、彼此心照不宣的偏好与默契；",
      "3. 简练客观：每条15~45字，例如“角色找到遗失的地图”或“队伍约定次日出发”；",
      "4. 语言简洁准确，遵守内容策略，不添加原文未确认的细节；",
      "5. 如果对话只是普通闲聊、没有产生值得长期记住的重要时刻或固定模式，请直接返回空数组 []；",
      "6. 【输出格式】：必须严格输出标准 JSON 字符串数组，例如 [\"事实1\", \"事实2\"]，不要输出任何 Markdown 标记或多余文字。",
    ].join("\n");

    const sanitizedMessages = sceneMessages.slice(-16).map(message => {
      const role = message.role === "assistant" ? "人物" : "用户";
      const rawContent = (message.content ?? "").trim().slice(0, 260);
      const cleanContent = rawContent;
      return `${role}：${cleanContent}`;
    });

    const userPrompt = [
      scene.name.trim() ? `【场景】：${scene.name.trim()}` : "",
      scene.description?.trim() ? `【设定】：${scene.description.trim()}` : "",
      existingFacts.length > 0
        ? `【已有事实（不要重复提炼类似内容）】：\n${existingFacts.map(f => `- ${f.fact}`).join("\n")}`
        : "",
      "",
      "【最近对话】：",
      ...sanitizedMessages,
    ].filter(Boolean).join("\n");

    const raw = await llmService.invoke({
      messages: [
        { role: "system" as const, content: factSystemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      options: {
        purpose: "scene_memory_summary" as const,
        maxTokens: 260,
        temperature: 0.2,
        usageContext: {
          userId: params.userId,
          personaId: params.personaId,
          route: "social.scene.confirmed_facts",
          purpose: "scene_memory_summary",
        },
      },
    });

    if (!raw || isRefusalOutput(raw)) return existingFacts;

    // 解析 JSON 数组
    let newFactStrings: string[] = [];
    try {
      const cleanRaw = raw.trim().replace(/^```json\s*|```$/g, "").trim();
      const parsed = JSON.parse(cleanRaw);
      if (Array.isArray(parsed)) {
        newFactStrings = parsed
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map(s => s.trim().slice(0, 120));
      }
    } catch {
      // 容错匹配多行
      const lines = raw.split("\n")
        .map(l => l.replace(/^[-*•\d.、"'\s]+/, "").replace(/["',]+$/, "").trim())
        .filter(l => l.length >= 6 && l.length <= 120 && !l.startsWith("[") && !l.startsWith("]"));
      if (lines.length > 0) {
        newFactStrings = lines.slice(0, 3);
      }
    }

    if (newFactStrings.length === 0) return existingFacts;

    // 智能去重：与已有事实进行相似度/包含检查
    const newFacts: SceneMemoryPinnedFact[] = [];

    for (const factStr of newFactStrings) {
      const isDuplicate = existingFacts.some(
        ef => ef.fact.includes(factStr) || factStr.includes(ef.fact) || ef.fact === factStr,
      );
      if (!isDuplicate) {
        newFacts.push({
          id: `fact-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fact: factStr,
          source: "llm",
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (newFacts.length === 0) return existingFacts;
    const updated = await db.mutateSceneMemoryState(
      params.personaId, params.userId, params.sceneId,
      current => {
        const latestCache = current.cache ?? buildInitialSceneMemoryCache();
        const mergedFacts = [...latestCache.pinnedFacts];
        for (const candidate of newFacts) {
          const duplicate = mergedFacts.some(fact =>
            fact.fact.includes(candidate.fact) || candidate.fact.includes(fact.fact),
          );
          if (!duplicate && mergedFacts.length < SCENE_MEMORY_LIMITS.pinnedFactsMax) mergedFacts.push(candidate);
        }
        return { cache: { ...latestCache, pinnedFacts: mergedFacts, updatedAt: new Date().toISOString() } };
      },
      { stateId, revision },
    );
    return updated?.cache?.pinnedFacts ?? [];
  } catch (error) {
    console.warn("[SceneMemory] extractSceneConfirmedFacts failed", error);
    return [];
  }
}

/**
 * 组合刷新：同时更新摘要与自动沉淀事实
 */
export async function refreshSceneMemoryAndFacts(
  params: SceneRefreshParams,
): Promise<{ summary: string | null; facts: SceneMemoryPinnedFact[] }> {
  try {
    const snapshot = await readSceneMemorySnapshot(params);
    if (!snapshot) return { summary: null, facts: [] };
    const [summary, facts] = await Promise.all([
      refreshSceneMemorySummary(params, snapshot),
      extractSceneConfirmedFacts(params, snapshot),
    ]);
    return { summary, facts };
  } catch (error) {
    console.warn("[SceneMemory] refresh snapshot failed", error);
    return { summary: null, facts: [] };
  }
}

