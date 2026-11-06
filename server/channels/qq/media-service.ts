import { and, eq } from "drizzle-orm";
import { qqRoleplayRoutes } from "../../../drizzle/qq-roleplay-schema";
import { roleplayChannels } from "../../../drizzle/schema";
import { QqError, type DeliveryResult, type QqConfig } from "./core";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../../db";
import { listQqMediaAssets, loadQqMediaAsset } from "./media-assets";
import type { QqService } from "./service";
import type { QqRoleplayRepository } from "./roleplay-types";

export type QqMediaInput = { expectedGeneration: number; assetId: number; expectedSha256: string; operationId: string };

/** 由 dispatchDelivery 在 QQ 配置锁内调用，与进入频道的写入共用顺序。 */
export async function assertQqPrivateMediaRoute(tx: DbTransaction, config: QqConfig, expectedRevision?: number) {
  const [route] = await tx.select({ id: qqRoleplayRoutes.channelId, revision: qqRoleplayRoutes.routeRevision }).from(qqRoleplayRoutes).where(and(
    eq(qqRoleplayRoutes.userId, config.userId), eq(qqRoleplayRoutes.configId, config.id),
    eq(qqRoleplayRoutes.configGeneration, config.generation),
    eq(qqRoleplayRoutes.botId, config.botId), eq(qqRoleplayRoutes.targetId, config.targetId),
  )).limit(1);
  const revision = route?.revision ?? 0;
  if (expectedRevision !== undefined && revision !== expectedRevision) throw new QqError("CONFLICT", "QQ 频道模式已变化，请重新选择图片后发送。");
  if (!route?.id) return revision;
  const [channel] = await tx.select({ isActive: roleplayChannels.isActive, channelKind: roleplayChannels.channelKind }).from(roleplayChannels).where(and(
    eq(roleplayChannels.id, route.id), eq(roleplayChannels.userId, config.userId),
  )).limit(1).for("share");
  if (channel?.isActive && channel.channelKind === "channel") throw new QqError("PRECONDITION_FAILED", "请先退出 QQ 频道模式，再发送普通私聊图片。");
  return revision;
}

async function snapshotPrivateRoute(config: QqConfig) {
  const db = await getDb();
  if (!db) throw new QqError("PRECONDITION_FAILED", "数据库暂不可用。");
  return db.transaction(async tx => {
    await lockQqChannelConfig(tx, config.userId);
    return assertQqPrivateMediaRoute(tx, config);
  });
}

export class QqMediaService {
  constructor(private readonly service: QqService, private readonly routes: QqRoleplayRepository,
    private readonly assets = { list: listQqMediaAssets, load: loadQqMediaAsset },
    private readonly guard: (tx: DbTransaction, config: QqConfig, revision: number) => Promise<unknown> = assertQqPrivateMediaRoute,
    private readonly snapshot = snapshotPrivateRoute) {}

  async list(userId: number) {
    const config = await this.service.dependencies.repository.get(userId);
    const view = await this.service.read(userId);
    const blockedByChannel = !!await this.routes.getRoute(userId);
    const available = !!config?.personaId && view.connected && !blockedByChannel;
    return { available, blockedByChannel, assets: available ? await this.assets.list(userId, config!.personaId!) : [] };
  }

  async send(userId: number, input: QqMediaInput): Promise<DeliveryResult> {
    const transport = await this.service.prepareMessageTransport(userId);
    const { config } = transport;
    if (config.generation !== input.expectedGeneration) throw new QqError("CONFLICT", "QQ 配置已变更，请刷新后重新选择图片。");
    if (await this.routes.getRoute(userId)) throw new QqError("PRECONDITION_FAILED", "请先退出 QQ 频道模式，再发送普通私聊图片。");
    const routeRevision = await this.snapshot(config);
    const asset = await this.assets.load(userId, config.personaId!, input.assetId, input.expectedSha256);
    transport.signal.throwIfAborted();
    const repository = this.service.dependencies.repository;
    // 操作键不包含资产，换资产重复相同操作编号也不能产生第二次发送。
    const id = await repository.claimDelivery(config, `media:${input.operationId.toLowerCase()}`);
    if (id === null) return { status: "unknown", remoteMessageId: null, reason: "operation_already_processed" };
    let began = false;
    let result: DeliveryResult;
    try {
      const dispatch = await repository.dispatchDelivery(config, id, () => {
        transport.signal.throwIfAborted();
        began = true;
        return transport.send([{ type: "image", data: { file: `base64://${asset.data.toString("base64")}` } }]);
      }, async tx => { await this.guard(tx, config, routeRevision); });
      result = await dispatch.result;
    } catch {
      result = { status: began ? "unknown" : "failed", remoteMessageId: null,
        reason: began ? "transport_unconfirmed" : "dispatch_rejected" };
    }
    try { await repository.finishDelivery(userId, id, result.status, result.remoteMessageId, result.reason); }
    catch { throw new QqError("PRECONDITION_FAILED", "图片交付结果未能保存，请到 QQ 核对；系统不会自动重发。"); }
    return result;
  }
}
