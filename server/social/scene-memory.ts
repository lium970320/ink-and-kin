/**
 * 场景记忆缓存的纯函数契约与容量校验。
 *
 * 数据落在 scene_memory_states 表；本文件不访问数据库，只负责把外部 JSON 归一化成
 * 受上限约束的可注入结构，供 db helper 与 Phase 2 的运行时注入共同使用。
 */

export const SCENE_MEMORY_LIMITS = {
  summaryMaxChars: 2_000,
  openThreadsMax: 10,
  pinnedFactsMax: 20,
  recentMessageIdsMax: 12,
} as const;

export type SceneMemoryStoryState = {
  sceneKey: string;
  turn: number;
  startedAt: string;
  updatedAt: string;
  lastMessageId?: number | null;
  lastExitAt?: string | null;
};

export type SceneMemoryOpenThread = {
  id: string;
  summary: string;
  status: "open" | "resolved";
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SceneMemoryPinnedFact = {
  id: string;
  fact: string;
  source: "user" | "llm";
  createdAt?: string | null;
};

export type SceneMemoryCache = {
  version: 1;
  summary: string | null;
  openThreads: SceneMemoryOpenThread[];
  pinnedFacts: SceneMemoryPinnedFact[];
  recentMessageIds: number[];
  updatedAt: string;
};

function clipText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function buildInitialSceneMemoryStoryState(
  sceneKey: string,
  now = new Date().toISOString(),
): SceneMemoryStoryState {
  const key = (sceneKey ?? "").trim();
  if (!key) throw new Error("scene memory story state requires a scene key");
  return {
    sceneKey: key,
    turn: 0,
    startedAt: now,
    updatedAt: now,
    lastMessageId: null,
    lastExitAt: null,
  };
}

export function normalizeSceneMemoryStoryState(value: unknown): SceneMemoryStoryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  const sceneKey = asString(state.sceneKey);
  const turn = asSafeInteger(state.turn);
  const startedAt = asString(state.startedAt);
  const updatedAt = asString(state.updatedAt);
  if (!sceneKey || turn === null || turn < 0 || !startedAt || !updatedAt) return null;
  const lastMessageId = state.lastMessageId == null ? null : asSafeInteger(state.lastMessageId);
  const lastExitAt = asString(state.lastExitAt);
  return {
    sceneKey,
    turn,
    startedAt,
    updatedAt,
    lastMessageId,
    lastExitAt,
  };
}

export function normalizeSceneMemoryCache(value: unknown): SceneMemoryCache | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cache = value as Record<string, unknown>;
  const summary = asString(cache.summary);
  const openThreads = Array.isArray(cache.openThreads)
    ? cache.openThreads
      .map(item => normalizeSceneMemoryOpenThread(item))
      .filter((item): item is SceneMemoryOpenThread => Boolean(item))
      .slice(0, SCENE_MEMORY_LIMITS.openThreadsMax)
    : [];
  const pinnedFacts = Array.isArray(cache.pinnedFacts)
    ? cache.pinnedFacts
      .map(item => normalizeSceneMemoryPinnedFact(item))
      .filter((item): item is SceneMemoryPinnedFact => Boolean(item))
      .slice(0, SCENE_MEMORY_LIMITS.pinnedFactsMax)
    : [];
  const recentMessageIds = Array.isArray(cache.recentMessageIds)
    ? cache.recentMessageIds
      .map(id => asSafeInteger(id))
      .filter((id): id is number => id !== null && id > 0)
      .slice(-SCENE_MEMORY_LIMITS.recentMessageIdsMax)
    : [];
  return {
    version: 1,
    summary: summary ? clipText(summary, SCENE_MEMORY_LIMITS.summaryMaxChars) : null,
    openThreads,
    pinnedFacts,
    recentMessageIds,
    updatedAt: asString(cache.updatedAt) ?? new Date().toISOString(),
  };
}

export function normalizeSceneMemoryOpenThread(value: unknown): SceneMemoryOpenThread | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const thread = value as Record<string, unknown>;
  const id = asString(thread.id);
  const summary = asString(thread.summary);
  if (!id || !summary) return null;
  const status = thread.status === "resolved" ? "resolved" : "open";
  return {
    id: id.slice(0, 80),
    summary: clipText(summary, 240),
    status,
    createdAt: asString(thread.createdAt),
    updatedAt: asString(thread.updatedAt),
  };
}

export function normalizeSceneMemoryPinnedFact(value: unknown): SceneMemoryPinnedFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fact = value as Record<string, unknown>;
  const text = asString(fact.fact);
  if (!text) return null;
  return {
    id: (asString(fact.id) ?? `fact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80),
    fact: clipText(text, 320),
    source: fact.source === "llm" ? "llm" : "user",
    createdAt: asString(fact.createdAt),
  };
}

export function buildInitialSceneMemoryCache(now = new Date().toISOString()): SceneMemoryCache {
  return {
    version: 1,
    summary: null,
    openThreads: [],
    pinnedFacts: [],
    recentMessageIds: [],
    updatedAt: now,
  };
}

export function appendSceneMemoryRecentMessages(
  cache: SceneMemoryCache,
  messageIds: number[],
  now = new Date().toISOString(),
): SceneMemoryCache {
  const ids = messageIds
    .map(id => (Number.isSafeInteger(id) && id > 0 ? id : null))
    .filter((id): id is number => id !== null);
  return {
    ...cache,
    recentMessageIds: [...cache.recentMessageIds, ...ids].slice(-SCENE_MEMORY_LIMITS.recentMessageIdsMax),
    updatedAt: now,
  };
}

export function removeSceneMemoryMessageIds(
  cache: SceneMemoryCache,
  messageIds: number[],
  now = new Date().toISOString(),
): SceneMemoryCache {
  const removed = new Set(messageIds.filter(id => Number.isSafeInteger(id) && id > 0));
  if (removed.size === 0) return cache;
  return {
    ...cache,
    recentMessageIds: cache.recentMessageIds.filter(id => !removed.has(id)),
    updatedAt: now,
  };
}

/**
 * 把场景记忆缓存压缩成可注入系统提示词的一小段。空缓存且尚未推进时返回空串，
 * 避免给新场景强加一段“上次讲到这里”。
 */
export function buildSceneMemoryInstruction(params: {
  turn: number;
  cache: SceneMemoryCache | null;
}): string {
  const cache = params.cache;
  const hasContent = Boolean(
    cache?.summary?.trim()
    || (cache?.openThreads ?? []).some(thread => thread.status === "open")
    || (cache?.pinnedFacts ?? []).length > 0,
  );
  if (params.turn <= 0 && !hasContent) return "";

  const lines: string[] = [];
  const hasPlotContext = Boolean(cache?.summary?.trim()
    || (cache?.openThreads ?? []).some(thread => thread.status === "open"));
  lines.push(params.turn <= 0 && !hasPlotContext
    ? "这是新一段场景对话的第 1 个回复回合，从当前输入重新开场；已确认事实可保留，但不要续接旧段剧情。"
    : `这是这个场景的第 ${Math.max(0, params.turn) + 1} 个回复回合，继续已经发生的剧情，不要重新开场。`);
  if (cache?.summary?.trim()) {
    lines.push(`前情提要：${cache.summary.trim()}`);
  }
  const openThreads = (cache?.openThreads ?? []).filter(thread => thread.status === "open");
  if (openThreads.length > 0) {
    lines.push(`未完成的事：${openThreads.map(thread => thread.summary).join("；")}`);
  }
  const pinnedFacts = cache?.pinnedFacts ?? [];
  if (pinnedFacts.length > 0) {
    lines.push(`场景内已确认事实：${pinnedFacts.map(fact => fact.fact).join("；")}`);
  }
  lines.push(params.turn <= 0 && !hasPlotContext
    ? "这些只是场景内已确认事实，不是旧聊天记录；不要把旧段剧情或台词带入新段，也不要写成日常事实。"
    : "这些只是这个场景的剧情记忆；把它当成上一段的延续，不要写成日常事实，也不要重播开场。");
  return `【场景记忆缓存·上次讲到这里】
${lines.join("\n")}`;
}

