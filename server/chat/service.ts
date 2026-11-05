import { sourceLibraryService } from "../source-library";
import { getContextHistory, withContextRevision } from './context-state';
/**
 * The conversation pipeline.
 *
 * Before this existed, the same sequence — assemble the prompt, call the
 * model, store the reply, work out the emotional state, update intimacy, look
 * for a graduation moment — was written out four times: once per tRPC
 * procedure and once for the WeChat channel. Any change to it had to be
 * applied four times, and the streaming path would have made it five.
 *
 * Everything now goes through this module. The tRPC mutations, the SSE route
 * and the channel bridge all call the same functions.
 */
import type { LLMMessage, LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt, computeIntimacy } from "../_core/persona-utils";
import { inferEmotionalState } from "../_core/emotion";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { buildCrisisResponse, buildGentleCheckIn, detectCrisis } from "../safety/crisis";
import { evaluateUsage, pickCareNote, type CareNote } from "../safety/usage-monitor";
import { assessTrajectory, getStoredTrajectory } from "../safety/trajectory";
import { checkGraduationEligibility } from "../_core/persona-utils";
import { buildSceneMemoryInstruction } from "../social/scene-memory";
import {
  buildSceneIdentityOverrideInstruction,
  buildSceneStorySystemInstruction,
  buildSceneStoryUserDirectionInstruction,
  formatScenePromptOverlay,
  getSceneIdentityOverrides,
  isSceneStoryStartMarker,
} from "../social/scene-story";
import { refreshSceneMemoryAndFacts, SCENE_MEMORY_SUMMARY_INTERVAL_TURNS } from "../social/scene-memory-service";

export type ChatMode = "stream" | "once";

/** A summary is written at most this often, and only after this many messages. */
const SUMMARY_MIN_NEW_MESSAGES = 10;

/** A summary older than this is refreshed, whatever the message count says. */
const SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The emotional trajectory is assessed at most once a day per persona. */
const TRAJECTORY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "emotion"; state: string; reason?: string }
  | {
      type: "done";
      messageId: number;
      emotionalState: string;
      graduationSuggested: boolean;
      careNote: CareNote | null;
      crisis: boolean;
    }
  | { type: "error"; message: string; partial: boolean };

export interface ConversationOptions {
  persona: Persona;
  userId: number;
  /** The user's message. */
  message: string;
  /** Explicit provider override (from `persona.llmProvider`). */
  providerName?: string;
  /** Channel the message arrived on. */
  channel?: "web" | "wechat" | "feishu";
  /** Whether the user message has already been stored. */
  alreadyPersisted?: boolean;
  /** Media attached to the message. */
  media?: { url: string; type: "image" | "voice"; mimeType?: string };
  /** Locale for prompt language and trigger words. */
  locale?: "zh" | "en";
  /** Cancels the model call when the client goes away. */
  signal?: AbortSignal;
  now?: Date;
}

/**
 * Summarises the conversation history that no longer fits in the window.
 *
 * Failing here is not fatal: the old behaviour (drop the old turns) still
 * applies, so a summarisation failure only costs some context.
 *
 * The summarisation is throttled: a persona is summarised again only after
 * at least ten new messages have arrived, or after a day has passed. Without
 * the throttle every turn past the window would pay for a fresh model call.
 */
async function maybeCompactHistory(params: {
  persona: Persona;
  userId: number;
  history: Array<{ id: number; role: string; content: string; createdAt: Date }>;
  keepCount: number;
  contextRevision: number;
  providerName?: string;
  now: Date;
  signal?: AbortSignal;
}): Promise<string> {
  params.signal?.throwIfAborted();
  const evicted = params.history.slice(0, Math.max(0, params.history.length - params.keepCount));
  if (evicted.length < 10) return "";

  const latest = await db.getLatestChatSummary(params.persona.id, params.userId);
  if (latest) {
    const age = params.now.getTime() - new Date(latest.createdAt).getTime();
    // The stored summary knows which message it covered, so the number of
    // messages that arrived since then is simply the ones after it.
    const sinceLastSummary = params.history.filter(
      (m) => m.id > (latest.toMessageId ?? 0),
    ).length;
    if (age < SUMMARY_MAX_AGE_MS && sinceLastSummary < SUMMARY_MIN_NEW_MESSAGES) {
      // Summarised recently — do not pay for another LLM call.
      return latest.summary;
    }
  }

  const transcript = evicted
    .map((m) => `${m.role === "user" ? "用户" : "分身"}：${m.content}`)
    .join("\n");

  try {
    const provider = await resolveProviderForUser({
      userId: params.userId,
      providerName: params.providerName,
    });
    const summary = await llmService.invokeWithProvider(provider!, {
      messages: [
        {
          role: "system",
          content:
            "你是一个对话记录整理助手。把下面的聊天记录压缩成不超过 300 字的中文摘要，保留关键事件、约定、称呼和情感转折，不要评论，只输出摘要本身。",
        },
        { role: "user", content: transcript },
      ],
      options: { provider: params.providerName, temperature: 0.2, maxTokens: 500, signal: params.signal,
        usageContext: { userId: params.userId, personaId: params.persona.id, route: "chat.summary", purpose: "summary" } },
    });

    params.signal?.throwIfAborted();
    const trimmed = (summary || "").trim();
    if (!trimmed) return "";

    await withContextRevision(params.userId, params.persona.id, params.contextRevision, tx => db.createChatSummary({
      personaId: params.persona.id,
      userId: params.userId,
      summary: trimmed,
      fromMessageId: evicted[0]?.id ?? null,
      toMessageId: evicted[evicted.length - 1]?.id ?? null,
    }, tx));

    return trimmed;
  } catch (e) {
    params.signal?.throwIfAborted();
    console.warn("[Chat] History summarisation failed, continuing without it:", (e as Error).message);
    return "";
  }
}

/**
 * Maps a stored message to the shape the providers consume.
 *
 * An image keeps its media URL: the model has to see the picture, not the
 * "[图片]" placeholder. Everything else stays a plain string.
 */
function toLLMMessage(message: {
  role: string;
  content: string;
  messageType?: string | null;
  mediaUrl?: string | null;
}): LLMMessage {
  const role = message.role as "user" | "assistant";
  if (message.messageType === "image" && message.mediaUrl) {
    return {
      role,
      content: [
        { type: "text", text: message.content },
        { type: "image_url", url: message.mediaUrl },
      ],
    };
  }
  return { role, content: message.content };
}

/**
 * Builds the message list sent to the model.
 */
export async function composeMessages(params: {
  persona: Persona;
  userId: number;
  userMessage: string;
  contextLimit: number;
  providerName?: string;
  locale?: "zh" | "en";
  now?: Date;
  extraConfig?: Record<string, any>;
  signal?: AbortSignal;
  /** 本轮用户消息 id：场景模式下，导演指令只追加在这一条用户消息上。 */
  userMessageId?: number;
  generation?: Awaited<ReturnType<typeof db.getSceneGenerationSnapshot>>;
}): Promise<LLMMessage[]> {
  const now = params.now ?? new Date();
  const contextLimit = Math.max(4, params.contextLimit);
  const { scene, revision } = params.generation
    ?? await db.getSceneGenerationSnapshot(params.persona.id, params.userId);
  await withContextRevision(params.userId, params.persona.id, revision, async () => undefined);
  const activeSceneId = scene?.id ?? null;

  // 场景模式按场景精确回放：只取当前场景的消息，绝不混入日常或别的场景（A/B 不串）。
  const sceneMemory = activeSceneId !== null
    ? await db.getSceneMemoryStateSnapshot(params.persona.id, params.userId, activeSceneId)
    : null;
  const sceneTurn = sceneMemory?.storyState?.turn ?? 0;
  const history = activeSceneId !== null
    ? (await db.getSceneConversationMessagesBySceneId(params.persona.id, params.userId, activeSceneId, 200))
      .filter(message => message.sceneId === activeSceneId || message.id === params.userMessageId)
    : (await getContextHistory(params.userId, params.persona.id, 200)).history;

  const retrieved = await retrieveMemories({
    personaId: params.persona.id,
    userId: params.userId,
    userMessage: params.userMessage,
    topK: params.extraConfig?.retrievalK,
    now: now.getTime(),
  });
  const anchors = retrieved.filter((m) => m.category === "anchor");
  const ordinary = retrieved.filter((m) => m.category !== "anchor");

  // 日常对话才有滚动摘要；场景剧情由 scene_memory_states 的摘要/事实承接，
  // 场景回合不推进日常摘要，日常摘要也不会被写进场景提示词。
  const summarySection = activeSceneId === null
    ? await maybeCompactHistory({
      persona: params.persona,
      userId: params.userId,
      history: history as any,
      keepCount: contextLimit - 1,
      contextRevision: revision,
      providerName: params.providerName,
      signal: params.signal,
      now,
    })
    : "";

  // 场景模式的三段注入（顺序与自用版 persona-text-chat 一致）：
  // 故事线 → 场景记忆缓存 → 场景身份覆盖。
  const scenePromptSections = activeSceneId !== null && scene
    ? [
      buildSceneStorySystemInstruction({ turn: sceneTurn }),
      buildSceneMemoryInstruction({ turn: sceneTurn, cache: sceneMemory?.cache ?? null }),
      buildSceneIdentityOverrideInstruction(getSceneIdentityOverrides(scene)),
    ].filter(Boolean)
    : [];

  const systemPrompt = buildSystemPrompt(params.persona, {
    sceneOverlay: scene ? formatScenePromptOverlay(scene) : null,
    memorySection: formatMemoriesForPrompt(ordinary),
    anchorSection: formatAnchorsForPrompt(anchors),
    summarySection: summarySection ? `【以往对话摘要】\n${summarySection}` : "",
    realismLevel: params.extraConfig?.realismLevel,
    locale: params.locale,
    now,
  });

  // 当前轮导演指令：把用户这条消息作为当前场景的最高优先推进指令。
  const sceneDirectionInstruction = activeSceneId !== null && params.userMessageId !== undefined
    ? buildSceneStoryUserDirectionInstruction({ text: params.userMessage, turn: sceneTurn })
    : "";

  const recent = history.slice(-(contextLimit - 1)).map((m) => {
    const message = toLLMMessage(m);
    if (sceneDirectionInstruction && m.id === params.userMessageId && typeof message.content === "string") {
      return { ...message, content: message.content + "\n\n" + sceneDirectionInstruction };
    }
    return message;
  });

  // 场景是虚构剧情、不是原著考据：自用版同样在沉浸态跳过 source recall，
  // 否则考据改写会删掉场景里的【】旁白。
  const sourceContext = activeSceneId !== null
    ? null
    : await sourceLibraryService.context(params.userId, params.persona.id, params.userMessage,
      history.filter(m => m.role === "user").slice(0, -1).map(m => m.content));
  if (sourceContext) {
    const evidence: LLMMessage = { role: "user", content: sourceContext.evidence };
    recent.splice(Math.max(0, recent.length - 1), 0, evidence);
  }
  await withContextRevision(params.userId, params.persona.id, revision, async () => undefined);
  const sceneHeader = scenePromptSections.length > 0 ? "\n\n" + scenePromptSections.join("\n\n") : "";
  return [{ role: "system", content: systemPrompt + sceneHeader + (sourceContext ? "\n\n" + sourceContext.instruction : "") }, ...recent];
}

/**
 * Runs the full conversation pipeline.
 *
 * Yields `ChatEvent`s. In `"once"` mode exactly one `done` event is produced
 * (plus optional `emotion`); in `"stream"` mode the reply text is emitted as
 * `delta` events as it arrives.
 */
export async function* runConversation(
  options: ConversationOptions & { mode: ChatMode },
): AsyncGenerator<ChatEvent> {
  options.signal?.throwIfAborted();
  const { userId, message } = options;
  const now = options.now ?? new Date();
  const locale = options.locale ?? "zh";

  // 场景和版本号一并读取；「开始」也在同一事务内推进当前场景的起点。
  const generation = await db.getSceneGenerationSnapshot(options.persona.id, userId, {
    startNewScene: isSceneStoryStartMarker(message),
  });
  const { persona, scene: activeScene, revision: generationRevision } = generation;
  const activeSceneId = activeScene?.id ?? null;

  const defaultConfig = await db.getDefaultLlmConfig(userId);
  const extraConfig = (defaultConfig?.extraConfig as any) ?? {};
  const contextLimit = extraConfig.contextLimit || 20;

  // The last activity has to be read *before* this turn is stored: afterwards
  // the newest message is the turn itself and the session duration is always
  // zero, which would make the long-conversation signal impossible to fire.
  const lastActivityAt = (await db.getLastMessageAt(persona.id, userId)) ?? null;

  // The user's turn is stored first so the history and any summarisation see it.
  // 场景消息带 sceneId（db.createMessage 据此把 mode 记为 scene），日常消息不带。
  let userMessageId: number | null = null;
  if (!options.alreadyPersisted) {
    userMessageId = await withContextRevision(userId, persona.id, generationRevision, tx => db.createMessage({
      personaId: persona.id,
      userId,
      role: "user",
      content: message,
      emotionalState: persona.emotionalState,
      channel: options.channel ?? "web",
      messageType: options.media?.type ?? "text",
      mediaUrl: options.media?.url ?? null,
      sceneId: activeSceneId,
    }, tx), { sceneId: activeSceneId });
  }

  // Crisis handling short-circuits the model entirely.
  const crisis = detectCrisis(message);
  if (crisis.crisis) {
    const replyText = buildCrisisResponse(persona.name, locale);
    const messageId = await withContextRevision(userId, persona.id, generationRevision, tx => db.createMessage({
      personaId: persona.id,
      userId,
      role: "assistant",
      content: replyText,
      emotionalState: persona.emotionalState,
      channel: options.channel ?? "web",
      sceneId: activeSceneId,
    }, tx), { sceneId: activeSceneId });
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: "crisis",
      severity: "critical",
      excerpt: crisis.matched.join(", "),
    }).catch((e) => console.warn("[Safety] Failed to record crisis event:", e));

    yield { type: "delta", text: replyText };
    yield {
      type: "done",
      messageId,
      emotionalState: persona.emotionalState,
      graduationSuggested: false,
      careNote: null,
      crisis: true,
    };
    return;
  }

  // A weak signal is ordinary distress, not a crisis: the persona still
  // answers normally and checks in afterwards.
  const gentleCheckIn = crisis.weakSignal ? buildGentleCheckIn(persona.name, locale) : null;

  const llmMessages = await composeMessages({
    persona,
    userId,
    userMessage: message,
    contextLimit,
    providerName: options.providerName,
    locale,
    now,
    extraConfig,
    signal: options.signal,
    userMessageId: userMessageId ?? undefined,
    generation,
  });
  options.signal?.throwIfAborted();

  await withContextRevision(userId, persona.id, generationRevision, async () => undefined);

  const provider = await resolveProviderForUser({
    userId,
    providerName: options.providerName,
  });
  if (!provider) {
    throw new Error(
      `No LLM provider available${options.providerName ? ` (requested: ${options.providerName})` : ""}. Configure at least one provider in .env`,
    );
  }

  let replyText = "";
  let failed = false;
  let failureMessage = "";

  try {
    if (options.mode === "stream" && provider.stream && provider.capabilities.streaming) {
      for await (const chunk of llmService.streamWithProvider(provider, {
        messages: llmMessages,
        options: {
          provider: options.providerName,
          temperature: extraConfig.temperature,
          maxTokens: extraConfig.maxTokens,
          signal: options.signal,
          usageContext: { userId, personaId: persona.id, route: options.channel ?? "web", purpose: "chat" },
        },
      })) {
        replyText += chunk.text;
        yield { type: "delta", text: chunk.text };
      }
    } else {
      replyText = await llmService.invokeWithProvider(provider, {
        messages: llmMessages,
        options: {
          provider: options.providerName,
          temperature: extraConfig.temperature,
          maxTokens: extraConfig.maxTokens,
          signal: options.signal,
          usageContext: { userId, personaId: persona.id, route: options.channel ?? "web", purpose: "chat" },
        },
      });
      await withContextRevision(userId, persona.id, generationRevision, async () => undefined);
      replyText = replyText || "（沉默）";
      yield { type: "delta", text: replyText };
    }
  } catch (e) {
    if (options.signal?.aborted || (e instanceof Error && e.name === "AbortError")) return;
    failed = true;
    failureMessage = (e as Error).message;
    console.error("[Chat] LLM call failed:", e);
    yield { type: "error", message: failureMessage, partial: replyText.length > 0 };
  }

  if (options.signal?.aborted) return;
  await withContextRevision(userId, persona.id, generationRevision, async () => undefined);

  // The care note is decided before the reply is stored, so it can be part
  // of what the persona actually says — the plan asks for the persona itself
  // to say the caring words, not for a separate system notice.
  const signals = await evaluateUsage({
    userId,
    personaId: persona.id,
    now: now.getTime(),
    lastActivityAt,
  });
  const careNote = pickCareNote(signals, locale);
  if (careNote) {
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: careNote.kind === "dependency" ? "dependency" : "usage",
      severity: careNote.showBanner ? "warning" : "info",
    }).catch((e) => console.warn("[Safety] Failed to record usage event:", e));
  }

  // Even a partial answer is kept — half a sentence is still worth more than
  // nothing when the user is waiting.
  const baseText = replyText || "（沉默）";
  const appended = [gentleCheckIn, careNote?.text].filter((part): part is string => !!part);
  const finalText = appended.length > 0 ? `${baseText}\n\n${appended.join("\n\n")}` : baseText;

  const { messageId, turn } = await withContextRevision(
    userId, persona.id, generationRevision, async tx => {
      const messageId = await db.createMessage({
        personaId: persona.id,
        userId,
        role: "assistant",
        content: finalText,
        emotionalState: persona.emotionalState,
        channel: options.channel ?? "web",
        sceneId: activeSceneId,
      }, tx);
      const turn = activeSceneId === null ? 0 : await db.recordSceneMemoryTurn(
        persona.id,
        userId,
        activeSceneId,
        "scene:" + activeSceneId,
        [userMessageId, messageId].filter((id): id is number => typeof id === "number"),
        tx,
      );
      return { messageId, turn };
    }, { sceneId: activeSceneId, exclusive: activeSceneId !== null },
  );

  if (activeScene && turn > 0 && turn % SCENE_MEMORY_SUMMARY_INTERVAL_TURNS === 0) {
    void refreshSceneMemoryAndFacts({
      userId,
      personaId: persona.id,
      sceneId: activeScene.id,
      expectedRevision: generationRevision,
    });
  }

  const emotion = failed ? { state: persona.emotionalState, source: "heuristic" as const, reason: undefined } : await inferEmotionalState({
    userMessage: message,
    assistantReply: finalText,
    currentState: persona.emotionalState,
    provider: options.providerName,
    // The classifier has to run on the same credentials as the reply —
    // otherwise a user who configured their own key silently falls back to
    // the environment one.
    providerInstance: provider,
    signal: options.signal,
    usageContext: { userId, personaId: persona.id, route: options.channel ?? "web", purpose: "emotion" },
    locale,
  });
  if (options.signal?.aborted) return;
  const newEmotionalState = emotion.state;
  const intimacy = await withContextRevision(userId, persona.id, generationRevision, async () => {
  await db.updatePersona(persona.id, userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newEmotionalState as any,
  });

  const todayStr = now.toISOString().slice(0, 10);
  const existing = await db.getTodaySnapshot(persona.id, userId);
  if (!existing) {
    await db.createEmotionSnapshot({
      personaId: persona.id,
      userId,
      emotionalState: newEmotionalState,
      messageCount: 1,
      date: todayStr,
    });
  }

  const intimacyData = await db.getIntimacyData(persona.id, userId);
  const value = computeIntimacy(intimacyData);
  await db.updateIntimacy(persona.id, userId, value.score, value.level);
  return value;
  });
  yield { type: "emotion", state: newEmotionalState, reason: emotion.reason };

  // The trajectory has to be assessed before the graduation check, which
  // reads the stored assessment — otherwise the early-graduation branch never
  // sees a trajectory at all.
  if (!failed) await maybeAssessTrajectory({
    contextRevision: generationRevision,
    personaId: persona.id,
    userId,
    providerName: options.providerName,
    providerInstance: provider,
    signal: options.signal,
    now,
  });

  const graduationSuggested = await withContextRevision(userId, persona.id, generationRevision, async () => evaluateGraduation({
    persona,
    userId,
    intimacyLevel: intimacy.level,
    chatCount: (persona.chatCount || 0) + 1,
  }));

  // The streaming path already emitted the reply text; the check-in and the
  // care note have to be pushed as well so the user sees the same thing
  // either way.
  if (gentleCheckIn) {
    yield { type: "delta", text: `\n\n${gentleCheckIn}` };
  }
  if (careNote) {
    yield { type: "delta", text: `\n\n${careNote.text}` };
  }

  yield {
    type: "done",
    messageId,
    emotionalState: newEmotionalState,
    graduationSuggested,
    careNote,
    crisis: false,
  };
}

/**
 * Assesses the emotional trajectory, at most once a day per persona.
 *
 * The assessment is a model call over a month of messages, so running it on
 * every turn would be expensive; the stored assessment says whether it is
 * time again. A failure is never fatal — the turn goes on without a fresh
 * trajectory.
 */
async function maybeAssessTrajectory(params: {
  contextRevision: number;
  personaId: number;
  userId: number;
  providerName?: string;
  providerInstance?: LLMProvider;
  signal?: AbortSignal;
  now: Date;
}): Promise<void> {
  try {
    const latest = await db.getLatestGraduationAssessment(params.personaId, params.userId);
    if (latest) {
      const age = params.now.getTime() - new Date(latest.createdAt).getTime();
      if (age < TRAJECTORY_INTERVAL_MS) return;
    }

    await assessTrajectory({
      history: (await getContextHistory(params.userId, params.personaId, 200)).history,
      store: write => withContextRevision(params.userId, params.personaId, params.contextRevision, write),
      userId: params.userId,
      personaId: params.personaId,
      provider: params.providerName,
      providerInstance: params.providerInstance,
      signal: params.signal,
      now: params.now.getTime(),
    });
  } catch (e) {
    console.warn("[Safety] Trajectory assessment failed:", (e as Error).message);
  }
}

/**
 * Decides whether to suggest graduation.
 *
 * The hard thresholds decide; the emotional trajectory can make the app
 * mention it earlier, as a gentle nudge rather than a decision.
 */
async function evaluateGraduation(params: {
  persona: Persona;
  userId: number;
  intimacyLevel: string;
  chatCount: number;
}): Promise<boolean> {
  const { persona, userId } = params;
  if (persona.graduationStatus) return false;

  const recentEmotions = await db.getRecentEmotionTrend(persona.id, userId, 14);
  const recentFreq = await db.getMessageCountInRange(persona.id, userId, 7, 0);
  const prevFreq = await db.getMessageCountInRange(persona.id, userId, 14, 7);

  const eligibility = checkGraduationEligibility({
    intimacyLevel: params.intimacyLevel,
    recentEmotions,
    chatCount: params.chatCount,
    recentChatFrequency: recentFreq,
    previousChatFrequency: prevFreq,
  });

  if (eligibility.eligible) {
    await db.setGraduationStatus(persona.id, userId, "suggested");
    return true;
  }

  // A clearly improving trajectory is worth surfacing even below the hard
  // thresholds.
  const trajectory = await getStoredTrajectory(persona.id, userId);
  if (trajectory?.trajectory === "improving" && params.chatCount >= 20) {
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: "graduation_trajectory",
      severity: "info",
    }).catch(() => undefined);
    return true;
  }

  return false;
}
