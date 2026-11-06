import express, { type Express, type ErrorRequestHandler, type Request, type Response } from "express";
import { encryptSecret, decryptSecret } from "../../_core/crypto";
import { handleChannelChat } from "../bridge";
import type { ChannelAdapter } from "../types";
import { QqError, QQ_MAX_BODY, type QqErrorCode } from "./core";
import { createQqRepository } from "./repository";
import { createQqRouter } from "./router";
import { QqService } from "./service";
import { QqRoleplayService } from "./roleplay-service";
import { createQqRoleplayRepository } from "./roleplay-repository";
import { QqMediaService } from "./media-service";

const repository = createQqRepository();
export const qqService: QqService = new QqService({
  repository, encrypt: encryptSecret, decrypt: decryptSecret,
  fetch: (...args) => globalThis.fetch(...args), chat: handleChannelChat,
  handleInbound: input => qqRoleplayService.handleInbound(input),
});
const roleplayRepository = createQqRoleplayRepository();
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
    throw new QqError("PRECONDITION_FAILED", "当前 QQ 接入仅回复收到的私聊文字，主动发送尚未启用。");
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
