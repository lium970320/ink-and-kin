import { TRPCError } from "@trpc/server";
import { Router, type Express, type Request, type Response } from "express";
import { z } from "zod";
import { PROACTIVE_TARGET_MODES } from "../../shared/mobile";
import type { User } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { verifyPassword } from "../_core/password";
import { rateLimiter, RATE_LIMITS, type RateLimitRule } from "../_core/rate-limit";
import * as db from "../db";
import { listMobileMessages, mobileSceneState, runMobileTurn, stopMobileDeviceTurns, stopMobileTurn } from "./chat";
import { apkFileName, getMobileApkInfo, getMobileNetwork, mobileIdentity, pairLink } from "./network";
import { mobileSettingsForUser } from "./router";
import { consumeMobilePairingCode, issueMobileSession, readMobileSession, revokeMobileDevice, updateMobileSettings } from "./settings-store";
import { broadcastToMobileUser, disconnectMobileDevice } from "./ws-hub";

const codeSchema = z.string().regex(/^\d{6}$/);
const deviceName = z.string().max(100).optional();
const personaIdSchema = z.coerce.number().int().positive().max(2_147_483_647);
const messageIdSchema = z.number().int().positive().max(2_147_483_647);
const messageMeta = z.object({
  clientMsgId: z.string().uuid().optional(),
  replyToMessageId: messageIdSchema.optional(),
});
const historyInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: personaIdSchema.optional(),
  afterId: personaIdSchema.optional(),
  scope: z.enum(["current", "all"]).default("current"),
}).refine(data => data.beforeId === undefined || data.afterId === undefined);
const pairLimit = { name: "mobile-pair", limit: 5, windowMs: 60_000, scope: "ip" } as const;
const totalPairs = { ...pairLimit, name: "mobile-pair-total", limit: 30 };

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ ok: false, error });
}

function limited(res: Response, key: string, rule: RateLimitRule) {
  const check = rateLimiter.check(key, rule);
  if (check.allowed) return false;
  res.setHeader("Retry-After", Math.ceil(check.retryAfterMs / 1000));
  fail(res, 429, "请求过于频繁，请稍后重试。");
  return true;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    fail(res, 400, "请求参数无效。");
  } else if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR") {
    const status: Partial<Record<TRPCError["code"], number>> = {
      BAD_REQUEST: 400, PRECONDITION_FAILED: 422, NOT_FOUND: 404, CONFLICT: 409,
      FORBIDDEN: 403, UNAUTHORIZED: 401, TOO_MANY_REQUESTS: 429,
    };
    fail(res, status[error.code] ?? 400, error.message);
  } else {
    fail(res, 503, "手机直连服务暂不可用，请检查服务器与模型设置。");
  }
}

type Session = NonNullable<Awaited<ReturnType<typeof readMobileSession>>>;

function endpoint(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (error) { sendError(res, error); }
  };
}

function authenticated(handler: (req: Request, res: Response, session: Session) => unknown | Promise<unknown>) {
  return endpoint(async (req, res) => {
    const session = await readMobileSession(req.headers.authorization, true);
    if (!session) { fail(res, 401, "设备会话已失效，请重新登录或配对。"); return; }
    await handler(req, res, session);
  });
}

async function startSession(res: Response, user: User, name?: string) {
  res.json({ ok: true, ...await issueMobileSession(user, name) });
}

function pairingPage(req: Request, res: Response) {
  const code = codeSchema.parse(req.query.code);
  const network = getMobileNetwork();
  const origin = `${req.protocol}://${req.get("host") ?? ""}`;
  const base = [...network.lanUrls, ...ENV.allowedOrigins].find(url => url === origin) ?? network.primaryLanUrl;
  const link = base ? pairLink(base, code).replace(/&/g, "&amp;") : null;
  const apk = getMobileApkInfo().info;
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.type("html").send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>书中人手机直连</title>
<style>
body{font:1rem/1.65 system-ui,sans-serif;margin:3rem auto;padding:0 1.25rem;max-width:32rem;color:#172623;background:#f6f8f6}
code{font-size:2rem;letter-spacing:.14em} a{color:#14674d;display:inline-block;margin:.4rem .8rem .4rem 0}
</style>
<h1>书中人手机直连</h1><p>在手机 App 内输入一次性配对码。</p><p><code>${code}</code></p>
${link ? `<a href="${link}">打开书中人直连</a>` : ""}
${apk.available ? `<a href="${apk.downloadUrl}">下载安卓安装包</a>` : ""}</html>`);
}

export function registerMobileRoutes(app: Express) {
  const mobile = Router();
  app.use("/api/mobile", mobile);
  mobile.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ENV.mobileEnabled) { fail(res, 404, "此实例未启用手机直连。"); return; }
    next();
  });

  mobile.get("/ping", (_req, res) => { res.json({ ok: true, ...mobileIdentity }); });
  mobile.get("/version", endpoint((_req, res) => { res.json(getMobileApkInfo().info); }));
  mobile.get("/download/apk", endpoint((_req, res) => {
    const { path } = getMobileApkInfo();
    if (!path) { fail(res, 404, "部署者尚未提供安卓安装包。"); return; }
    res.download(path, apkFileName, error => { if (error && !res.headersSent) fail(res, 404, "安装包不可用。"); });
  }));
  mobile.get("/pair/landing", endpoint(pairingPage));

  mobile.post("/pair/exchange", endpoint(async (req, res) => {
    if (limited(res, req.socket.remoteAddress ?? "unknown", pairLimit) || limited(res, "instance", totalPairs)) return;
    const input = z.object({ code: codeSchema, deviceName }).parse(req.body);
    const userId = consumeMobilePairingCode(input.code);
    const user = userId === null ? null : await db.getUserById(userId);
    if (!user) { fail(res, 401, "配对码无效或已过期，请重新生成。"); return; }
    await startSession(res, user, input.deviceName);
  }));
  mobile.post("/auth/login", endpoint(async (req, res) => {
    if (limited(res, req.socket.remoteAddress ?? "unknown", RATE_LIMITS.auth)) return;
    const input = z.object({
      username: z.string().trim().min(1).max(100), password: z.string().min(1).max(1024), deviceName,
    }).parse(req.body);
    const user = await db.getUserByUsername(input.username);
    if (!user?.passwordHash || !await verifyPassword(input.password, user.passwordHash)) {
      fail(res, 401, "账号或密码错误。");
      return;
    }
    await db.updateUserLastSignedIn(user.id);
    await startSession(res, user, input.deviceName);
  }));
  mobile.post("/auth/logout", authenticated(async (_req, res, session) => {
    await revokeMobileDevice(session.user.id, session.deviceId);
    stopMobileDeviceTurns(session.user.id, session.deviceId);
    disconnectMobileDevice(session.user.id, session.deviceId);
    res.json({ ok: true });
  }));
  mobile.get("/settings", authenticated(async (_req, res, { user }) => {
    res.json({ ok: true, ...await mobileSettingsForUser(user.id) });
  }));
  mobile.put("/settings", authenticated(async (req, res, { user }) => {
    const input = z.object({ proactiveTargetMode: z.enum(PROACTIVE_TARGET_MODES) }).parse(req.body);
    res.json({ ok: true, ...await updateMobileSettings(user.id, input.proactiveTargetMode) });
  }));

  mobile.get("/personas", authenticated(async (_req, res, { user }) => {
    const [personas, scenes] = await Promise.all([db.getPersonasWithStats(user.id), db.getScenes(user.id)]);
    const sceneNames = new Map(scenes.map(scene => [scene.id, scene.name]));
    res.json({ ok: true, personas: personas.filter(persona => persona.analysisStatus === "ready").map(persona => {
      const activeSceneTitle = persona.activeSceneId === null ? null : sceneNames.get(persona.activeSceneId) ?? null;
      return {
        id: persona.id, name: persona.name, avatarUrl: persona.avatarUrl, relationshipDesc: persona.relationshipDesc,
        emotionalState: persona.emotionalState, intimacyScore: persona.intimacyScore, intimacyLevel: persona.intimacyLevel,
        activeSceneId: activeSceneTitle ? persona.activeSceneId : null, activeSceneTitle,
        scheduleSummary: activeSceneTitle ? `场景中 · ${activeSceneTitle}` : null,
        lastMessageAt: persona.lastChatAt?.toISOString() ?? null,
      };
    }) });
  }));

  mobile.get("/personas/:personaId/scenes", authenticated(async (req, res, { user }) => {
    const personaId = personaIdSchema.parse(req.params.personaId);
    const state = await mobileSceneState(user.id, personaId);
    const scenes = await db.getScenes(user.id);
    res.json({ ok: true, ...state, scenes: scenes.map(scene => ({
      id: scene.id, title: scene.name, name: scene.name, icon: scene.icon,
      description: scene.description, isBuiltin: scene.isBuiltin,
    })) });
  }));
  mobile.post("/personas/:personaId/scene", authenticated(async (req, res, { user }) => {
    const personaId = personaIdSchema.parse(req.params.personaId);
    const input = z.object({ sceneId: messageIdSchema.nullable(), immersiveDailyScene: z.literal(false).optional() }).parse(req.body);
    if (!await db.getPersonaById(personaId, user.id)) { fail(res, 404, "角色不存在。"); return; }
    await db.activateScene(personaId, input.sceneId, user.id);
    stopMobileTurn(user.id, personaId);
    const state = await mobileSceneState(user.id, personaId);
    await broadcastToMobileUser(user.id, { type: "scene_state", ...state });
    res.json({ ok: true, ...state });
  }));
  mobile.post("/personas/:personaId/reset-segment", authenticated(async (req, res, { user }) => {
    const personaId = personaIdSchema.parse(req.params.personaId);
    const state = await db.startNewActiveConversationContext(personaId, user.id);
    stopMobileTurn(user.id, personaId);
    res.json({ ok: true, startMessageId: state.startAfterMessageId });
  }));
  mobile.get("/personas/:personaId/messages", authenticated(async (req, res, { user }) => {
    res.json(await listMobileMessages(user.id, personaIdSchema.parse(req.params.personaId), historyInput.parse(req.query)));
  }));
  mobile.post("/personas/:personaId/messages/text", authenticated(async (req, res, { user, deviceId }) => {
    if (limited(res, String(user.id), RATE_LIMITS.llm)) return;
    const input = messageMeta.extend({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const result = await runMobileTurn(user.id, deviceId, personaIdSchema.parse(req.params.personaId), { ...input, kind: "text" });
    res.json({ ok: true, accepted: true, ...result });
  }));
  mobile.post("/personas/:personaId/messages/voice", authenticated(async (req, res, { user, deviceId }) => {
    if (limited(res, String(user.id), RATE_LIMITS.llm)) return;
    const input = messageMeta.extend({ audioBase64: z.string().min(4).max(11_184_812) }).parse(req.body);
    const result = await runMobileTurn(user.id, deviceId, personaIdSchema.parse(req.params.personaId), { ...input, kind: "voice" });
    res.json({ ok: true, ...result });
  }));
  mobile.post("/personas/:personaId/messages/image", authenticated(async (req, res, { user, deviceId }) => {
    if (limited(res, String(user.id), RATE_LIMITS.llm)) return;
    const input = messageMeta.extend({ imageBase64: z.string().min(4).max(11_184_812),
      caption: z.string().trim().max(2000).optional() }).parse(req.body);
    const result = await runMobileTurn(user.id, deviceId, personaIdSchema.parse(req.params.personaId),
      { ...input, kind: "image", text: input.caption });
    res.json({ ok: true, ...result });
  }));
}
