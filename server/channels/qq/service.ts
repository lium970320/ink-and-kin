import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  apiBase, deliveryResult, parseInbound, plainText, QqError, qqId, verifyWebhook,
  QQ_MAX_BODY, QQ_SECRET_MASK, type DeliveryResult, type QqConfig, type QqSaveInput, type QqSecrets,
} from "./core";
import type { QqRepository } from "./repository";
import type { QqPreparedTransport } from "./roleplay-types";
import { readQqRecording, QQ_RECORD_RESPONSE_BYTES, type QqVoiceInbound, type QqVoiceReplyGuard } from "./voice-inbound";

export interface QqConfigView {
  configured: boolean; enabled: boolean; connected: boolean; generation: number | null;
  apiBaseUrl: string; botId: string; targetId: string; personaId: number | null;
  hookPath: string | null; apiTokenConfigured: boolean; receiveTokenConfigured: boolean; webhookSecretConfigured: boolean;
  secretMask: string; credentialsUnreadable: boolean;
  status: "unconfigured" | "stopped" | "configured" | "connected";
}

export interface QqChatInput {
  userId: number; conversationKey: string; personaId: number; messageText: string;
  channel: "qq"; signal: AbortSignal;
}

export interface QqDependencies {
  repository: QqRepository;
  encrypt(text: string): Promise<string>;
  decrypt(text: string): Promise<string | null>;
  fetch: typeof fetch;
  chat(input: QqChatInput): Promise<string | null>;
  handleInbound?(input: { config: QqConfig; messageId: string; text: string; unsupportedMedia?: boolean; signal: AbortSignal; reply(text: string): Promise<void> }): Promise<boolean>;
  voiceInbound?: QqVoiceInbound;
  timeoutMs?: number;
}

type Session = { generation: number; controller: AbortController; connected: boolean };
type InboundStatus = "ignored" | "done" | "failed" | "cancelled";
const EMPTY_SECRETS: QqSecrets = { apiToken: "", receiveToken: "", webhookSecret: "" };
const QUEUE_LIMIT = 16;
const EVENT_LIMIT_PER_MINUTE = 30;
const RESPONSE_BYTES = 32 * 1024;

function checkGeneration(config: QqConfig | null, expected: number | null) {
  if ((config?.generation ?? null) !== expected) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重新操作。");
}

function newSecret(value?: string): string | undefined {
  if (value === undefined || value === QQ_SECRET_MASK) return undefined;
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new QqError("BAD_REQUEST", "密钥格式无效。");
  return value.trim() || undefined;
}

export class QqService {
  private sessions = new Map<number, Session>();
  private queues = new Map<number, Promise<void>>();
  private queueSizes = new Map<number, number>();
  private budgets = new Map<number, { until: number; used: number }>();

  constructor(public readonly dependencies: QqDependencies) {}

  private cancelSession(userId: number, session: Session) {
    session.controller.abort();
    if (this.sessions.get(userId) === session) this.sessions.delete(userId);
  }

  private cancelThrough(userId: number, generation: number | null) {
    const session = this.sessions.get(userId);
    if (session && generation !== null && session.generation <= generation) this.cancelSession(userId, session);
  }

  private alive(userId: number, session: Session) {
    return this.sessions.get(userId) === session && !session.controller.signal.aborted;
  }

  private requireAlive(userId: number, session: Session) {
    if (!this.alive(userId, session)) throw new QqError("PRECONDITION_FAILED", "QQ 已停用或配置已变更。");
  }

  private async readSecrets(config: QqConfig): Promise<QqSecrets | null> {
    try {
      const plaintext = await this.dependencies.decrypt(config.secretsEnc);
      const value = JSON.parse(plaintext ?? "null") as Partial<QqSecrets> | null;
      if (typeof value?.apiToken !== "string" || typeof value.receiveToken !== "string" || typeof value.webhookSecret !== "string") return null;
      return { apiToken: value.apiToken, receiveToken: value.receiveToken, webhookSecret: value.webhookSecret };
    } catch { return null; }
  }

  private async requireSecrets(config: QqConfig): Promise<QqSecrets> {
    const secrets = await this.readSecrets(config);
    if (!secrets) throw new QqError("PRECONDITION_FAILED", "QQ 密钥不可读，请重新保存配置。");
    return secrets;
  }

  async read(userId: number): Promise<QqConfigView> {
    const config = await this.dependencies.repository.get(userId);
    const secrets = config ? await this.readSecrets(config) : EMPTY_SECRETS;
    const session = this.sessions.get(userId);
    const connected = !!(config?.enabled && config.personaId && secrets?.webhookSecret
      && session?.connected && session.generation === config.generation && this.alive(userId, session));
    return {
      configured: !!config, enabled: config?.enabled ?? false, connected, generation: config?.generation ?? null,
      apiBaseUrl: config?.apiBaseUrl ?? "", botId: config?.botId ?? "", targetId: config?.targetId ?? "", personaId: config?.personaId ?? null,
      hookPath: config ? `/api/channels/qq/events/${config.hookId}` : null,
      apiTokenConfigured: !!secrets?.apiToken, receiveTokenConfigured: !!secrets?.receiveToken,
      webhookSecretConfigured: !!secrets?.webhookSecret, secretMask: QQ_SECRET_MASK,
      credentialsUnreadable: !!config && !secrets,
      status: connected ? "connected" : config?.enabled ? "configured" : config ? "stopped" : "unconfigured",
    };
  }

  async save(userId: number, input: QqSaveInput): Promise<QqConfigView> {
    const before = await this.dependencies.repository.get(userId);
    checkGeneration(before, input.expectedGeneration);
    const apiToken = newSecret(input.apiToken);
    const receiveToken = newSecret(input.receiveToken);
    const webhookSecret = newSecret(input.webhookSecret);
    if ((apiToken && input.clearApiToken) || (receiveToken && input.clearReceiveToken)) {
      throw new QqError("BAD_REQUEST", "不能同时填写并清除同一令牌。");
    }
    const previous = before ? await this.readSecrets(before) : EMPTY_SECRETS;
    if (!previous && !(webhookSecret && (apiToken || input.clearApiToken) && (receiveToken || input.clearReceiveToken))) {
      throw new QqError("PRECONDITION_FAILED", "旧密钥不可读。请重填签名密钥，并分别重填或明确清除两个令牌。");
    }
    const secrets: QqSecrets = {
      apiToken: input.clearApiToken ? "" : apiToken ?? previous?.apiToken ?? "",
      receiveToken: input.clearReceiveToken ? "" : receiveToken ?? previous?.receiveToken ?? "",
      webhookSecret: webhookSecret ?? previous?.webhookSecret ?? "",
    };
    if (!secrets.webhookSecret) throw new QqError("BAD_REQUEST", "请设置反向事件签名密钥。");
    const fields = {
      apiBaseUrl: apiBase(input.apiBaseUrl), botId: qqId(input.botId), targetId: qqId(input.targetId),
      personaId: input.personaId, secretsEnc: await this.dependencies.encrypt(JSON.stringify(secrets)),
    };
    await this.dependencies.repository.save(userId, input.expectedGeneration, fields);
    // 仅成功的版本变更才取消旧会话；过期或无效的表单不能停掉当前连接。
    this.cancelThrough(userId, input.expectedGeneration);
    return this.read(userId);
  }

  private async request(config: QqConfig, secrets: QqSecrets, action: "get_login_info" | "send_private_msg" | "get_record", data: object, session: Session, signal?: AbortSignal): Promise<unknown> {
    this.requireAlive(config.userId, session);
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    session.controller.signal.addEventListener("abort", abort, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.dependencies.timeoutMs ?? 8000);
    try {
      // dispatchDelivery 依赖此处在首次 await 前启动请求。
      const response = await this.dependencies.fetch(`${config.apiBaseUrl}/${action}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(secrets.apiToken ? { Authorization: `Bearer ${secrets.apiToken}` } : {}) },
        body: JSON.stringify(data),
      });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("http_unconfirmed");
      }
      const maxBytes = action === "get_record" ? QQ_RECORD_RESPONSE_BYTES : RESPONSE_BYTES;
      if (Number(response.headers.get("Content-Length")) > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new Error("oversized_response");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty_response");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          controller.signal.throwIfAborted();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > maxBytes) throw new Error("oversized_response");
          chunks.push(part.value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
      clearTimeout(timer);
      session.controller.signal.removeEventListener("abort", abort);
      signal?.removeEventListener("abort", abort);
    }
  }

  async start(userId: number, expectedGeneration: number | null, restoreOnly = false): Promise<boolean> {
    const config = await this.dependencies.repository.get(userId);
    checkGeneration(config, expectedGeneration);
    if (restoreOnly && !config?.enabled) return false;
    if (!config?.personaId) throw new QqError("PRECONDITION_FAILED", "请先保存 QQ 配置并选择当前账号下的角色。");
    const secrets = await this.requireSecrets(config);
    if (!secrets.webhookSecret) throw new QqError("PRECONDITION_FAILED", "请先设置事件签名密钥。");
    checkGeneration(await this.dependencies.repository.get(userId), config.generation);

    const previous = this.sessions.get(userId);
    if (previous && previous.generation > config.generation) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重新连接。");
    this.cancelThrough(userId, config.generation);
    const session: Session = { generation: config.generation, controller: new AbortController(), connected: false };
    this.sessions.set(userId, session);
    try {
      const response = await this.request(config, secrets, "get_login_info", {}, session) as { status?: unknown; retcode?: unknown; data?: { user_id?: unknown } } | null;
      this.requireAlive(userId, session);
      let verified = false;
      try { verified = response?.status === "ok" && response.retcode === 0 && qqId(response.data?.user_id) === config.botId; } catch { /* 无效身份不能启用。 */ }
      if (!verified) throw new QqError("PRECONDITION_FAILED", "API 返回的机器人身份与配置不一致。");
      await this.dependencies.repository.enable(userId, config.generation);
      this.requireAlive(userId, session);
      session.connected = true;
      return true;
    } catch (error) {
      this.cancelSession(userId, session);
      if (error instanceof QqError) throw error;
      throw new QqError("PRECONDITION_FAILED", "QQ 接口身份验证未完成，请检查地址、令牌与绑定。");
    }
  }

  async restore(userId: number): Promise<boolean> {
    const config = await this.dependencies.repository.get(userId);
    return config?.enabled ? this.start(userId, config.generation, true) : false;
  }

  async stop(userId: number, expectedGeneration: number | null): Promise<void> {
    await this.dependencies.repository.disable(userId, expectedGeneration);
    this.cancelThrough(userId, expectedGeneration);
  }

  async setDefaultPersona(userId: number, personaId: number, expectedGeneration: number | null): Promise<void> {
    const config = await this.dependencies.repository.get(userId);
    checkGeneration(config, expectedGeneration);
    if (!config) throw new QqError("PRECONDITION_FAILED", "请先保存 QQ 配置。");
    await this.save(userId, {
      expectedGeneration, apiBaseUrl: config.apiBaseUrl, botId: config.botId, targetId: config.targetId, personaId,
    });
  }

  private reserve(userId: number) {
    const size = this.queueSizes.get(userId) ?? 0;
    const now = Date.now();
    const previous = this.budgets.get(userId);
    const budget = previous && previous.until > now ? previous : { until: now + 60_000, used: 0 };
    if (size >= QUEUE_LIMIT || budget.used >= EVENT_LIMIT_PER_MINUTE) throw new QqError("TOO_MANY_REQUESTS", "消息处理繁忙，请稍后再试。");
    // 在异步持久占键前同步保留槽位，避免并发请求同时绕过队列上限。
    this.queueSizes.set(userId, size + 1);
    this.budgets.set(userId, { ...budget, used: budget.used + 1 });
  }

  private release(userId: number) {
    const size = this.queueSizes.get(userId) ?? 0;
    if (size <= 1) this.queueSizes.delete(userId);
    else this.queueSizes.set(userId, size - 1);
  }

  async receive(hookId: string, raw: Buffer, signature?: string, authorization?: string): Promise<{ accepted: boolean; duplicate: boolean }> {
    if (raw.length > QQ_MAX_BODY) throw new QqError("BAD_REQUEST", "事件体积超过上限。");
    if (!/^[a-f0-9]{48}$/.test(hookId)) throw new QqError("FORBIDDEN", "事件认证失败。");
    const config = await this.dependencies.repository.byHook(hookId);
    if (!config?.enabled) throw new QqError("FORBIDDEN", "事件认证失败或通道未启用。");
    const secrets = await this.readSecrets(config);
    if (!secrets || !verifyWebhook(raw, signature, authorization, secrets)) throw new QqError("FORBIDDEN", "事件认证失败。");
    const event = parseInbound(raw, config, !!this.dependencies.handleInbound, !!this.dependencies.voiceInbound);
    const { userId } = config;
    const session = this.sessions.get(userId);
    if (!session?.connected || session.generation !== config.generation || !this.alive(userId, session)) {
      throw new QqError("PRECONDITION_FAILED", "QQ 接口尚未验证连接。");
    }

    this.reserve(userId);
    let id: number | null;
    try { id = await this.dependencies.repository.claimInbound(config, event.messageId); }
    catch (error) { this.release(userId); throw error; }
    if (id == null) {
      this.release(userId);
      return { accepted: false, duplicate: true };
    }

    const previous = this.queues.get(userId) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      let status: InboundStatus = "ignored";
      try {
        this.requireAlive(userId, session);
        const current = await this.dependencies.repository.get(userId);
        if (!current?.enabled || current.id !== config.id || current.generation !== config.generation || !current.personaId) return;
        this.requireAlive(userId, session);
        const key = `inbound:${config.botId}:${config.targetId}:${event.messageId}`;
        const reply: Parameters<QqVoiceInbound>[0]["reply"] = (text, guard) => this.deliver(config, secrets, session, text, key, guard);
        if (event.voiceRecord && this.dependencies.voiceInbound) {
          const isCurrent = async () => {
            if (!this.alive(userId, session)) return false;
            const latest = await this.dependencies.repository.get(userId);
            return !!(this.alive(userId, session) && latest?.enabled && latest.id === current.id
              && latest.generation === current.generation && latest.personaId === current.personaId);
          };
          const recordId = event.voiceRecord.id;
          const handled = await this.dependencies.voiceInbound({
            config: current, messageId: event.messageId, signal: session.controller.signal, reply, isCurrent,
            loadAudio: async () => {
              if (!recordId || !await isCurrent()) throw new Error("record_unavailable");
              return readQqRecording(await this.request(current, secrets, "get_record", {
                file_id: recordId, out_format: "mp3",
              }, session));
            },
          });
          status = handled ? "done" : this.alive(userId, session) ? "ignored" : "cancelled";
          return;
        }
        if (await this.dependencies.handleInbound?.({
          config: current, messageId: event.messageId, text: event.text, unsupportedMedia: event.unsupportedMedia, signal: session.controller.signal, reply,
        })) { status = "done"; return; }
        if (event.unsupportedMedia) return;
        const text = await this.dependencies.chat({
          userId, personaId: current.personaId, channel: "qq", messageText: event.text,
          conversationKey: `qq:${config.id}:${config.botId}:private:${config.targetId}`,
          signal: session.controller.signal,
        });
        this.requireAlive(userId, session);
        if (!text) return;
        await reply(text);
        status = "done";
      } catch {
        status = this.alive(userId, session) ? "failed" : "cancelled";
      } finally {
        await this.dependencies.repository.finishInbound(config, id, status).catch(() => {});
        this.release(userId);
      }
    });
    this.queues.set(userId, job);
    void job.finally(() => { if (this.queues.get(userId) === job) this.queues.delete(userId); }).catch(() => {});
    return { accepted: true, duplicate: false };
  }

  private async deliver(config: QqConfig, secrets: QqSecrets, session: Session, text: string, key: string,
    guard?: QqVoiceReplyGuard) {
    const message = plainText(text);
    this.requireAlive(config.userId, session);
    const id = await this.dependencies.repository.claimDelivery(config, key);
    if (id == null) return;

    let result: DeliveryResult;
    let started = false;
    try {
      const dispatch = await this.dependencies.repository.dispatchDelivery(config, id, () => {
        this.requireAlive(config.userId, session);
        started = true;
        return this.request(config, secrets, "send_private_msg", {
          user_id: Number(config.targetId), message, auto_escape: true,
        }, session);
      }, guard);
      result = deliveryResult(await dispatch.result);
    } catch {
      result = started
        ? { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" }
        : { status: "failed", remoteMessageId: null, reason: this.alive(config.userId, session) ? "dispatch_rejected" : "cancelled_before_dispatch" };
    }
    try {
      await this.dependencies.repository.finishDelivery(config.userId, id, result.status, result.remoteMessageId, result.reason);
    } catch {
      throw new QqError("PRECONDITION_FAILED", "交付结果未能保存，请在 QQ 核对；系统不会重发。");
    }
    if (result.status !== "confirmed") {
      throw new QqError("PRECONDITION_FAILED", result.status === "failed"
        ? "QQ 交付失败，系统不会自动重发。"
        : "QQ 投递结果未知，请在 QQ 核对；系统不会重发。");
    }
  }

  async send(userId: number, targetId: string, text: string): Promise<void> {
    const config = await this.dependencies.repository.get(userId);
    const session = this.sessions.get(userId);
    if (!config?.enabled || !session?.connected || session.generation !== config.generation) {
      throw new QqError("PRECONDITION_FAILED", "QQ 接口尚未验证连接。");
    }
    if (targetId !== `private:${config.targetId}`) throw new QqError("FORBIDDEN", "目标未绑定到当前账号。");
    // 这是内部适配器的一次显式发送；入站回复始终用可重放检测的稳定键。
    await this.deliver(config, await this.requireSecrets(config), session, text, `manual:${randomUUID()}`);
  }

  /** 调用方必须先完成持久占键和锁内派发校验；此闭包在首次 await 前启动 I/O。 */
  async prepareOutbound(userId: number): Promise<QqPreparedTransport> {
    const prepared = await this.prepareMessageTransport(userId);
    return { config: prepared.config, signal: prepared.signal,
      send: (text, signal) => prepared.send(plainText(text), signal) };
  }

  async prepareMessageTransport(userId: number) {
    const config = await this.dependencies.repository.get(userId);
    const session = this.sessions.get(userId);
    if (!config?.enabled || !config.personaId || !session?.connected || session.generation !== config.generation) {
      throw new QqError("PRECONDITION_FAILED", "QQ 接口尚未验证连接。");
    }
    const secrets = await this.requireSecrets(config);
    this.requireAlive(userId, session);
    return {
      config, signal: session.controller.signal,
      send: async (message: string | Array<{ type: "image"; data: { file: string } }>, signal?: AbortSignal): Promise<DeliveryResult> => {
        this.requireAlive(userId, session);
        signal?.throwIfAborted();
        try {
          return deliveryResult(await this.request(config, secrets, "send_private_msg", {
            user_id: Number(config.targetId), message, auto_escape: true,
          }, session, signal));
        } catch { return { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" }; }
      },
    };
  }

  async waitForIdle(userId: number): Promise<void> { await this.queues.get(userId); }
}
