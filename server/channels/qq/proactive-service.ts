import { and, eq } from "drizzle-orm";
import { qqRoleplayRoutes } from "../../../drizzle/qq-roleplay-schema";
import { roleplayChannels } from "../../../drizzle/schema";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../../db";
import { isQuiet } from "../../proactive/policy";
import type { ProactiveClaim, ProactiveRepository, ProactiveDispatchSnapshot } from "../../proactive/types";
import type { QqService } from "./service";
import { QqError, type QqConfig, type DeliveryResult } from "./core";

export async function assertProactivePrivateRoute(tx: DbTransaction, config: QqConfig, expectedRevision?: number): Promise<number> {
  const [route] = await tx.select({ channelId: qqRoleplayRoutes.channelId, revision: qqRoleplayRoutes.routeRevision })
    .from(qqRoleplayRoutes).where(and(eq(qqRoleplayRoutes.userId, config.userId),
      eq(qqRoleplayRoutes.configId, config.id), eq(qqRoleplayRoutes.configGeneration, config.generation),
      eq(qqRoleplayRoutes.botId, config.botId), eq(qqRoleplayRoutes.targetId, config.targetId))).limit(1);
  const revision = route?.revision ?? 0;
  if (expectedRevision !== undefined && revision !== expectedRevision) throw new QqError("CONFLICT", "QQ频道模式已变化，本次主动消息已停止。");
  if (route?.channelId) {
    const [channel] = await tx.select({ active: roleplayChannels.isActive, kind: roleplayChannels.channelKind })
      .from(roleplayChannels).where(and(eq(roleplayChannels.id, route.channelId), eq(roleplayChannels.userId, config.userId))).limit(1).for("share");
    if (channel?.active && channel.kind === "channel") throw new QqError("PRECONDITION_FAILED", "QQ频道模式下暂停主动消息。");
  }
  return revision;
}
async function snapshotRoute(config: QqConfig) {
  const db = await getDb();
  if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
  return db.transaction(async tx => { await lockQqChannelConfig(tx, config.userId); return assertProactivePrivateRoute(tx, config); });
}
function assertConsent(claim: ProactiveClaim, config: QqConfig) {
  const consent = claim.policy.qqConsent;
  if (claim.policy.delivery !== "qq" || !consent || config.userId !== claim.job.userId || config.personaId !== claim.job.personaId
    || consent.configId !== config.id || consent.generation !== config.generation || consent.targetId !== config.targetId) {
    throw new QqError("PRECONDITION_FAILED", "QQ主动消息绑定已变化，请重新保存主动消息设置。");
  }
}
export class QqProactiveService {
  constructor(private readonly qq: QqService, private readonly repository: ProactiveRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly snapshot = snapshotRoute,
    private readonly guard = assertProactivePrivateRoute) {}

  async beforeGenerate(claim: ProactiveClaim, signal: AbortSignal): Promise<ProactiveDispatchSnapshot | void> {
    if (claim.policy.delivery !== "qq") return;
    signal.throwIfAborted();
    const transport = await this.qq.prepareOutbound(claim.job.userId);
    assertConsent(claim, transport.config);
    const routeRevision = await this.snapshot(transport.config);
    signal.throwIfAborted();
    return { configId: transport.config.id, generation: transport.config.generation, routeRevision };
  }

  async deliver(claim: ProactiveClaim, signal: AbortSignal, snapshot?: ProactiveDispatchSnapshot): Promise<void> {
    const { job } = claim;
    let began = false;
    let reserved = false;
    let qqId: number | null = null;
    const qqRepository = this.qq.dependencies.repository;
    let result: DeliveryResult;
    try {
      signal.throwIfAborted();
      if (!job.text || job.text.length > 4000) throw new QqError("BAD_REQUEST", "主动消息正文无效。");
      const transport = await this.qq.prepareOutbound(job.userId);
      assertConsent(claim, transport.config);
      if (!snapshot || snapshot.configId !== transport.config.id || snapshot.generation !== transport.config.generation) {
        throw new QqError("PRECONDITION_FAILED", "生成前的QQ绑定快照已失效。");
      }
      const revision = snapshot.routeRevision;
      signal.throwIfAborted();
      reserved = await this.repository.reserveDispatch(claim, this.clock(), signal);
      if (!reserved) return;
      qqId = await qqRepository.claimDelivery(transport.config, `proactive:${job.id}`);
      if (qqId === null) {
        // Existing transport reservation may have reached QQ. Never reinterpret it as safe to resend.
        await this.repository.finish(claim, { status: "unknown", remoteMessageId: null, reason: "delivery_already_reserved" });
        return;
      }
      const dispatch = await qqRepository.dispatchDelivery(transport.config, qqId, () => {
        signal.throwIfAborted(); transport.signal.throwIfAborted();
        const dispatchNow = this.clock();
        if (dispatchNow >= job.expiresAt || isQuiet(dispatchNow, claim.policy)) throw new QqError("PRECONDITION_FAILED", "本次主动消息已到期或进入免打扰。");
        began = true;
        return transport.send(job.text!, signal);
      }, async tx => {
        await this.guard(tx, transport.config, revision);
        await this.repository.guardDispatch(tx, claim, this.clock(), signal);
        signal.throwIfAborted();
      });
      result = await dispatch.result;
    } catch {
      result = { status: began ? "unknown" : "failed", remoteMessageId: null,
        reason: began ? "transport_unconfirmed" : signal.aborted ? "cancelled_before_dispatch" : "dispatch_rejected" };
      if (!reserved) { await this.repository.failBeforeDispatch(claim, result.reason); return; }
    }
    // The persistent job reservation remains unknown if either final write fails; the sweep does not retry it.
    if (qqId !== null) {
      try { await qqRepository.finishDelivery(job.userId, qqId, result.status, result.remoteMessageId, result.reason); }
      catch { result = { status: "unknown", remoteMessageId: null, reason: "settlement_unconfirmed" }; }
    }
    await this.repository.finish(claim, result);
  }
}
