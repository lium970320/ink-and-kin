import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { messages, sceneMemoryStates } from "../../drizzle/schema";
import { getContextState, isIncluded } from "../chat/context-state";
import { runConversation, type ConversationOptions } from "../chat/service";
import * as db from "../db";
import { generateTTS } from "../_core/tts";
import { resolveProviderForUser } from "../llm/user-provider";
import { resolveStoredPath, storagePut } from "../storage";
import { getVoiceConfig } from "../voice/config";
import { decodeVoiceBase64, transcribeForUser, voiceFailure } from "../voice/service";
import { broadcastToMobileUser, toMobileMessage, type MobileSceneState } from "./ws-hub";

function mobileMessages(userId: number, personaId: number) {
  return and(eq(messages.userId, userId), eq(messages.personaId, personaId),
    inArray(messages.channel, ["web", "mobile"]));
}

async function database() {
  const connection = await db.getDb();
  if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用。" });
  return connection;
}

export async function mobileSceneState(userId: number, personaId: number): Promise<MobileSceneState> {
  const { scene } = await db.getSceneGenerationSnapshot(personaId, userId);
  return { personaId, activeSceneId: scene?.id ?? null, activeSceneTitle: scene?.name ?? null,
    immersiveDailyScene: false };
}

export async function listMobileMessages(userId: number, personaId: number, input: {
  limit: number; beforeId?: number; afterId?: number; scope: "current" | "all";
}) {
  const [state, daily, connection] = await Promise.all([
    mobileSceneState(userId, personaId), getContextState(userId, personaId), database(),
  ]);
  const scope = state.activeSceneId === null
    ? isNull(messages.sceneId) : eq(messages.sceneId, state.activeSceneId);
  const cursor = input.afterId !== undefined ? gt(messages.id, input.afterId)
    : input.beforeId !== undefined ? lt(messages.id, input.beforeId) : undefined;
  const rows = await connection.select().from(messages).where(and(
    mobileMessages(userId, personaId), input.scope === "current" ? scope : undefined, cursor,
  )).orderBy(input.afterId !== undefined ? asc(messages.id) : desc(messages.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  if (input.afterId === undefined) page.reverse();

  const sceneIds = page.flatMap(row => row.sceneId === null ? [] : [row.sceneId]);
  const sceneBoundaries = sceneIds.length ? await connection.select({
    sceneId: sceneMemoryStates.sceneId, start: sceneMemoryStates.startAfterMessageId,
  }).from(sceneMemoryStates).where(and(eq(sceneMemoryStates.userId, userId),
    eq(sceneMemoryStates.personaId, personaId), inArray(sceneMemoryStates.sceneId, sceneIds))) : [];
  const boundaries = new Map(sceneBoundaries.map(row => [row.sceneId, row.start]));
  return {
    activeSceneId: state.activeSceneId, activeSceneTitle: state.activeSceneTitle,
    hasMore: rows.length > input.limit,
    messages: page.map(row => toMobileMessage(row, row.sceneId === null
      ? !isIncluded(daily, row.id)
      : !db.isMessageIncludedInContext(row.id, row.contextOverride, boundaries.get(row.sceneId) ?? 0))),
  };
}

type TurnInput = {
  clientMsgId?: string;
  replyToMessageId?: number;
} & ({ kind: "text"; text: string }
  | { kind: "voice"; audioBase64: string }
  | { kind: "image"; imageBase64: string; text?: string });

type TurnResult = {
  turnId: string;
  userMessageId?: number;
  assistantMessageId?: number;
  replyText: string;
  transcription?: string;
  audioUrl?: string;
  imageUrl?: string;
};

type ActiveTurn = {
  clientMsgId?: string;
  deviceId: string;
  controller: AbortController;
  promise: Promise<TurnResult>;
};

const turns = new Map<string, ActiveTurn>();
const scopeKey = (userId: number, personaId: number) => `${userId}:${personaId}`;

export function stopMobileTurn(userId: number, personaId: number, deviceId?: string) {
  const turn = turns.get(scopeKey(userId, personaId));
  if (turn && (!deviceId || turn.deviceId === deviceId)) turn.controller.abort();
}

export function stopMobileDeviceTurns(userId: number, deviceId: string) {
  turns.forEach((turn, key) => {
    if (key.startsWith(`${userId}:`) && turn.deviceId === deviceId) turn.controller.abort();
  });
}

function imageData(input: string) {
  if (input.length > 11_184_812 || input.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片无效或超过 8 MiB。" });
  }
  const image = Buffer.from(input, "base64");
  if (image.length < 12 || image.length > 8 * 1024 * 1024 || image.toString("base64") !== input) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片无效或超过 8 MiB。" });
  }
  const ext = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff ? "jpeg"
    : image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "png"
    : image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP" ? "webp"
    : null;
  if (!ext) throw new TRPCError({ code: "BAD_REQUEST", message: "请发送 JPEG、PNG 或 WebP 图片。" });
  return { ext, image, mimeType: `image/${ext}` };
}

async function executeTurn(userId: number, personaId: number, input: TurnInput, signal: AbortSignal) {
  signal.throwIfAborted();
  const snapshot = await db.getSceneGenerationSnapshot(personaId, userId);
  const { persona, scene, revision } = snapshot;
  if (persona.analysisStatus !== "ready") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "角色还在准备中。" });
  }
  const connection = await database();
  const turnId = randomUUID();
  const owner = mobileMessages(userId, personaId);
  const publish = async (id: number) => {
    const [row] = await connection.select().from(messages).where(and(owner, eq(messages.id, id))).limit(1);
    if (row) await broadcastToMobileUser(userId, { type: "bubble", personaId, turnId, message: toMobileMessage(row) });
    return row;
  };
  if (input.clientMsgId) {
    const [saved] = await connection.select({ id: messages.id }).from(messages)
      .where(and(owner, eq(messages.clientMessageId, input.clientMsgId))).limit(1);
    if (saved) {
      await publish(saved.id);
      return { turnId, userMessageId: saved.id, replyText: "" };
    }
  }
  let referencedId: number | undefined;
  let quote = "";
  if (input.replyToMessageId) {
    const [reference] = await connection.select().from(messages).where(and(owner,
      eq(messages.id, input.replyToMessageId), scene ? eq(messages.sceneId, scene.id) : isNull(messages.sceneId))).limit(1);
    if (reference) {
      referencedId = reference.id;
      quote = `[引用消息] ${reference.content.slice(0, 400)}\n\n`;
    }
  }
  const providerName = persona.llmProvider ?? undefined;
  let content = input.kind === "text" ? input.text : "";
  let media: ConversationOptions["media"];
  let storedKey: string | undefined;
  let userMessageId: number | undefined;
  let assistantMessageId: number | undefined;
  let userMessagePublished = false;
  let replyText = "";
  await broadcastToMobileUser(userId, { type: "typing", personaId, isTyping: true });
  try {
    if (input.kind === "voice") {
      const result = await transcribeForUser(userId, decodeVoiceBase64(input.audioBase64), signal)
        .catch(err => voiceFailure(err, signal));
      content = result.transcription;
      storedKey = `chat/${userId}/${personaId}/${turnId}-voice.wav`;
      const { url } = await storagePut(storedKey, result.audio.buffer, result.audio.mimeType);
      media = { url, type: "voice", mimeType: result.audio.mimeType, duration: result.audio.durationSeconds };
    } else if (input.kind === "image") {
      const provider = await resolveProviderForUser({ userId, providerName });
      if (!provider?.capabilities.vision) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先给角色配置支持图片理解的模型。" });
      }
      const { image, ext, mimeType } = imageData(input.imageBase64);
      storedKey = `chat/${userId}/${personaId}/${turnId}.${ext}`;
      const { url } = await storagePut(storedKey, image, mimeType);
      content = input.text || "[图片]";
      media = { url, type: "image", mimeType, inlineImage: `data:${mimeType};base64,${input.imageBase64}` };
    }

    for await (const event of runConversation({
      persona, userId, message: content, quote, mode: "once", channel: "mobile", providerName,
      signal, expectedContextRevision: revision, allowSceneStartMarker: input.kind === "text",
      media, clientMessageId: input.clientMsgId, replyToMessageId: referencedId,
      onUserMessageSaved: id => { userMessageId = id; },
    })) {
      if (userMessageId !== undefined && !userMessagePublished) {
        await publish(userMessageId);
        userMessagePublished = true;
      }
      if (event.type === "delta") replyText += event.text;
      if (event.type === "error") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "模型未完成回复，请检查模型设置。" });
      if (event.type === "done") assistantMessageId = event.messageId;
    }
    if (!assistantMessageId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "本次回复未完成。" });
    if (input.kind === "voice" && replyText.trim() && (await getVoiceConfig(userId)).ttsEnabled) {
      try {
        const [reply] = await connection.select({ content: messages.content }).from(messages)
          .where(and(owner, eq(messages.id, assistantMessageId))).limit(1);
        if (reply) {
          const clip = await generateTTS(reply.content.slice(0, 500), undefined, userId, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
          signal.throwIfAborted();
          await connection.update(messages).set({ mediaUrl: clip, messageType: "voice" })
            .where(and(owner, eq(messages.id, assistantMessageId)));
        }
      } catch { /* 朗读不可用时仍发送已保存的文字回复。 */ }
    }
    await publish(assistantMessageId);
    return {
      turnId, userMessageId, assistantMessageId, replyText,
      transcription: input.kind === "voice" ? content : undefined,
      audioUrl: media?.type === "voice" ? media.url : undefined,
      imageUrl: media?.type === "image" ? media.url : undefined,
    };
  } finally {
    if (userMessageId !== undefined && !userMessagePublished) {
      await publish(userMessageId).catch(() => undefined);
    }
    if (storedKey && userMessageId === undefined) {
      const file = resolveStoredPath(storedKey);
      if (file) await unlink(file).catch(() => undefined);
    }
    await broadcastToMobileUser(userId, { type: "typing", personaId, isTyping: false });
  }
}

export function runMobileTurn(userId: number, deviceId: string, personaId: number, input: TurnInput) {
  const key = scopeKey(userId, personaId);
  const previous = turns.get(key);
  if (input.clientMsgId && previous?.clientMsgId === input.clientMsgId) return previous.promise;
  previous?.controller.abort();
  const controller = new AbortController();
  const promise = (async () => {
    try {
      await previous?.promise.catch(() => undefined);
      return await executeTurn(userId, personaId, input, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new TRPCError({ code: "CONFLICT", message: "本轮对话已停止。" });
      throw error;
    } finally {
      if (turns.get(key)?.controller === controller) turns.delete(key);
    }
  })();
  turns.set(key, { clientMsgId: input.clientMsgId, deviceId, controller, promise });
  return promise;
}
