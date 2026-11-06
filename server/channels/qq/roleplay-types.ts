import type { QqDeliveryBatch } from "../../../shared/qq-delivery";
import type { DbTransaction } from "../../db";
import type { DeliveryResult, QqConfig } from "./core";

/** 已授权私聊路由快照；每次派发必须在锁内重新核对。 */
export type QqRoleplayTicket = {
  userId: number;
  configId: number;
  configGeneration: number;
  botId: string;
  targetId: string;
  channelId: number;
  routeRevision: number;
  channelRevision: number;
};

export type QqRoleplayBatchRecord = {
  ticket: QqRoleplayTicket;
  batch: QqDeliveryBatch & { version: number };
  activeOperationId: string;
};

export type QqRoleplayBeatInput = {
  operationId: string;
  source: "web" | "qq";
  messageId: number;
  beatIndex: number;
  texts: string[];
};

/** 单实例发送；持久记录不提供进程重启后的自动补发。 */
export interface QqRoleplayRepository {
  getRoute(userId: number): Promise<QqRoleplayTicket | null>;
  setRoute(config: QqConfig, channelId: number | null): Promise<QqRoleplayTicket | null>;
  /** 必须在角色消息事务取频道锁以前调用，统一 QQ -> 频道锁序。 */
  validateRoute(tx: DbTransaction, ticket: QqRoleplayTicket): Promise<void>;
  createBeat(tx: DbTransaction, ticket: QqRoleplayTicket, input: QqRoleplayBeatInput): Promise<QqRoleplayBatchRecord>;
  recent(userId: number, channelId: number): Promise<QqRoleplayBatchRecord[]>;
  get(userId: number, channelId: number, batchId: string): Promise<QqRoleplayBatchRecord>;
  beginRetry(input: {userId: number; channelId: number; batchId: string; operationId: string; expectedVersion: number; allowUnknown: boolean}): Promise<{record: QqRoleplayBatchRecord; started: boolean}>;
  /** 提交一次尝试后才允许网络派发。重复操作键返回 null，不重新发送。 */
  reserveAttempt(ticket: QqRoleplayTicket, batchId: string, partId: string, operationId: string): Promise<string | null>;
  /** start 必须在首个 await 前发起 I/O；锁内最终校验，返回后不持锁等网络。 */
  dispatchAttempt<T>(ticket: QqRoleplayTicket, batchId: string, partId: string, attemptId: string, start: () => Promise<T>): Promise<{result: Promise<T>}>;
  finishAttempt(userId: number, attemptId: string, result: DeliveryResult): Promise<void>;
  cancelPending(userId: number, channelId: number, batchId?: string): Promise<void>;
}

/** 凭据在 prepare 时封装，调用方既不读取也不记录密钥。 */
export type QqPreparedTransport = {
  config: QqConfig;
  signal: AbortSignal;
  send(text: string, signal?: AbortSignal): Promise<DeliveryResult>;
};
