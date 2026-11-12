import express, { type Express, type ErrorRequestHandler, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { qqChannelConfigs } from "../../../drizzle/qq-channel-schema";
import { channelBindings, chatContextStates } from "../../../drizzle/schema";
import { encryptSecret, decryptSecret } from "../../_core/crypto";
import { handleChannelChat } from "../bridge";
import type { ChannelAdapter } from "../types";
import { QqError, QQ_MAX_BODY, type QqConfig, type QqErrorCode } from "./core";
import { createQqRepository } from "./repository";
import { createQqRouter } from "./router";
import { createQqSceneImageInbound, QqService } from "./service";
import { QqRoleplayService } from "./roleplay-service";
import { createQqRoleplayRepository } from "./roleplay-repository";
import { assertQqPrivateMediaRoute, QqMediaService } from "./media-service";
import { getDb, getSceneGenerationSnapshot, lockQqChannelConfig, type DbTransaction } from "../../db";
import { runConversation } from "../../chat/service";
import { getVoiceConfig, isVoiceConfigCurrent } from "../../voice/config";
import { transcribeForUser } from "../../voice/service";
import { createQqVoiceInbound } from "./voice-inbound";
import { loadQqSceneImageAsset } from "./media-assets";
import {
  cancelSceneImageOperation, parseSceneImageRequest, prepareSceneImageRequest, startSceneImageJob, waitForSceneImageJob,
  type PreparedSceneImageRequest,
} from "../../scene-image/service";

const repository = createQqRepository();
const roleplayRepository = createQqRoleplayRepository();
const voiceInbound = createQqVoiceInbound({
  async handleChannel({ config, messageId, signal, reply }) {
    if (!await roleplayRepository.getRoute(config.userId)) return false;
    return qqRoleplayService.handleInbound({ config, messageId, signal, reply, text: "", unsupportedMedia: true });
  },
  async checkRoute(config, expectedRevision) {
    const db = await getDb();
    if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
    return db.transaction(async tx => {
      await lockQqChannelConfig(tx, config.userId);
      return assertQqPrivateMediaRoute(tx, config, expectedRevision);
    });
  },
  async guardReply(tx, config, revision) { await assertQqPrivateMediaRoute(tx, config, revision); },
  async readContext(config, expectedRevision) {
    if (!config.personaId) throw new QqError("PRECONDITION_FAILED", "QQ 尚未绑定角色。");
    const snapshot = await getSceneGenerationSnapshot(config.personaId, config.userId, { expectedRevision });
    if (snapshot.persona.analysisStatus !== "ready") throw new QqError("PRECONDITION_FAILED", "绑定的角色尚未就绪。");
    return snapshot;
  },
  readVoiceConfig: getVoiceConfig,
  checkVoiceConfig: isVoiceConfigCurrent,
  transcribe: transcribeForUser,
  async chat(config, snapshot, transcription, signal) {
    let text = "";
    for await (const event of runConversation({
      persona: snapshot.persona, userId: config.userId, message: transcription,
      providerName: snapshot.persona.llmProvider ?? undefined,
      channel: "qq", mode: "once", locale: "zh", signal,
      expectedContextRevision: snapshot.revision, allowSceneStartMarker: false,
    })) {
      if (event.type === "delta") text += event.text;
    }
    return text.trim() || null;
  },
});
/** Caller holds the same QQ configuration lock used to change bindings and enter a channel. */
async function checkPrivateImageRoute(tx: DbTransaction, config: QqConfig, expectedRevision?: number) {
  if (!config.personaId) throw new QqError("PRECONDITION_FAILED", "QQ 尚未绑定角色。");
  const [binding] = await tx.select({ id: channelBindings.id }).from(qqChannelConfigs).innerJoin(channelBindings, and(
    eq(channelBindings.userId, qqChannelConfigs.userId), eq(channelBindings.channel, "qq"),
    eq(channelBindings.targetId, `private:${config.targetId}`), eq(channelBindings.personaId, config.personaId),
    eq(channelBindings.isActive, true),
  )).where(and(
    eq(qqChannelConfigs.id, config.id), eq(qqChannelConfigs.userId, config.userId), eq(qqChannelConfigs.enabled, true),
    eq(qqChannelConfigs.generation, config.generation), eq(qqChannelConfigs.personaId, config.personaId),
    eq(qqChannelConfigs.botId, config.botId), eq(qqChannelConfigs.targetId, config.targetId),
  )).limit(1);
  if (!binding) throw new QqError("PRECONDITION_FAILED", "QQ 已停用或目标绑定已变更。");
  return assertQqPrivateMediaRoute(tx, config, expectedRevision);
}

async function runPrivateImageCommandChat(config: QqConfig, request: Pick<PreparedSceneImageRequest, "contextRevision" | "sceneId">,
  message: string, signal: AbortSignal) {
  if (!config.personaId) return null;
  const snapshot = await getSceneGenerationSnapshot(config.personaId, config.userId, { expectedRevision: request.contextRevision });
  if (snapshot.persona.analysisStatus !== "ready" || (snapshot.scene?.id ?? null) !== request.sceneId) return null;
  return runConversation({
    persona: snapshot.persona, userId: config.userId, message, channel: "qq", mode: "once", locale: "zh", signal,
    providerName: snapshot.persona.llmProvider ?? undefined,
    expectedContextRevision: snapshot.revision, allowSceneStartMarker: false,
  });
}

const sceneImageInbound = createQqSceneImageInbound({
  isCommand: text => parseSceneImageRequest(text).requested,
  async checkRoute(config, expectedRevision) {
    const db = await getDb();
    if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
    return db.transaction(async tx => {
      await lockQqChannelConfig(tx, config.userId);
      return checkPrivateImageRoute(tx, config, expectedRevision);
    });
  },
  guardDispatch: (config, routeRevision, request) => async tx => {
    await assertQqPrivateMediaRoute(tx, config, routeRevision);
    if (!config.personaId) throw new QqError("PRECONDITION_FAILED", "QQ 尚未绑定角色。");
    // Delivery already holds a persona share lock. Do not acquire the context row out of order.
    // Scene-image publication, separately, takes the context lock before it saves the chat image.
    const [context] = await tx.select({ revision: chatContextStates.revision }).from(chatContextStates).where(and(
      eq(chatContextStates.userId, config.userId), eq(chatContextStates.personaId, config.personaId),
    )).limit(1);
    if (context?.revision !== request.contextRevision) throw new QqError("CONFLICT", "对话上下文已变化，请重新请求图片。");
  },
  guardPublication: (config, routeRevision) => async tx => {
    await lockQqChannelConfig(tx, config.userId);
    await checkPrivateImageRoute(tx, config, routeRevision);
  },
  prepare: prepareSceneImageRequest,
  chat: runPrivateImageCommandChat,
  chatWithoutImage: runPrivateImageCommandChat,
  cancel: cancelSceneImageOperation,
  start: startSceneImageJob,
  wait: waitForSceneImageJob,
  load: loadQqSceneImageAsset,
});

export const qqService: QqService = new QqService({
  repository, encrypt: encryptSecret, decrypt: decryptSecret,
  fetch: (...args) => globalThis.fetch(...args), chat: handleChannelChat,
  async handleInbound(input) {
    if (input.unsupportedMedia && !await roleplayRepository.getRoute(input.config.userId)) {
      await input.reply("当前私聊只支持文字或单条语音，请分开发送。");
      return true;
    }
    return qqRoleplayService.handleInbound(input);
  },
  voiceInbound, sceneImageInbound,
});
export const qqRoleplayService: QqRoleplayService = new QqRoleplayService({ repository: roleplayRepository, prepare: userId => qqService.prepareOutbound(userId) });
export const qqMediaService = new QqMediaService(qqService, roleplayRepository);
export const qqRouter = createQqRouter(qqService, qqMediaService);

async function currentGeneration(userId: number): Promise<number | null> {
  return (await repository.get(userId))?.generation ?? null;
}

export const qqAdapter: ChannelAdapter = {
  id: "qq", label: "QQ", requiresCredentials: true,
  async start(userId) { await qqService.start(userId, await currentGeneration(userId)); },
  async stop(userId) { await qqService.stop(userId, await currentGeneration(userId)); },
  async status(userId) {
    const view = await qqService.read(userId);
    return { channel: "qq", connected: view.connected, status: view.status, detail: { enabled: view.enabled, credentialsUnreadable: view.credentialsUnreadable } };
  },
  async send() {
    throw new QqError("PRECONDITION_FAILED", "当前 QQ 接入仅回复收到的私聊消息，主动发送尚未启用。");
  },
  async setDefaultPersona(userId, personaId) { await qqService.setDefaultPersona(userId, personaId, await currentGeneration(userId)); },
  restore: userId => qqService.restore(userId),
};

const httpStatus: Record<QqErrorCode, number> = {
  BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PRECONDITION_FAILED: 409, TOO_MANY_REQUESTS: 429,
};

/** 必须在全局 JSON 与浏览器 CSRF 中间件前挂载；签名只覆盖收到的原始字节。 */
export function registerQqRoutes(app: Express, service: QqService = qqService): void {
  const bodyError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.setHeader("Cache-Control", "no-store");
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "事件体积超过上限。" }); return; }
    if (error?.type === "encoding.unsupported") { res.status(415).json({ error: "只接受未压缩的原始事件。" }); return; }
    res.status(400).json({ error: "事件格式无效。" });
  };
  app.post("/api/channels/qq/events/:hookId", express.raw({ type: () => true, limit: QQ_MAX_BODY, inflate: false }), async (req: Request<{ hookId: string }>, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: "需要原始事件内容。" }); return; }
    try {
      const result = await service.receive(String(req.params.hookId), req.body, req.get("X-Signature"), req.get("Authorization"));
      res.status(200).json(result);
    } catch (error) {
      const status = error instanceof QqError ? httpStatus[error.code] : 503;
      res.status(status).json({ error: error instanceof QqError ? error.message : "事件暂未处理。" });
    }
  }, bodyError);
}

export { QqService } from "./service";
export type { QqConfigView } from "./service";
