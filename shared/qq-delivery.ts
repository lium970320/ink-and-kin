export type QqDeliveryPartStatus = "pending" | "sending" | "sent" | "failed" | "unknown" | "cancelled";

export type QqDeliveryPart = {
  id: string;
  messageId?: number;
  beatIndex: number;
  partIndex: number;
  text: string;
  status: QqDeliveryPartStatus;
  qqMessageId?: string;
  attempts: number;
  error?: string;
  /** 早先有未确认尝试，后来确认也不能排除重复投递。 */
  duplicateRisk?: boolean;
};

export type QqDeliverySummary = {
  total: number;
  sent: number;
  failed: number;
  unknown: number;
  pending: number;
  cancelled: number;
  sending: number;
};

export type QqDeliveryBatch = {
  id: string;
  channelId: number;
  userId: number;
  contactId: string;
  source: "qq" | "web" | "duet";
  createdAt: string;
  updatedAt: string;
  parts: QqDeliveryPart[];
  summary: QqDeliverySummary;
  /** 持久批次的修订号；旧只读预览不带此字段。 */
  version?: number;
  /** 归属或原发言失效时只保留历史，不再参与推进阻挡或人工重发。 */
  retryable?: boolean;
};

export function summarizeQqDeliveryParts(parts: QqDeliveryPart[]): QqDeliverySummary {
  const summary: QqDeliverySummary = {
    total: parts.length, sent: 0, failed: 0, unknown: 0, pending: 0, cancelled: 0, sending: 0,
  };
  for (const part of parts) summary[part.status] += 1;
  return summary;
}

export function isQqDeliveryComplete(batch: QqDeliveryBatch): boolean {
  return batch.summary.sent === batch.summary.total;
}

export function formatQqDeliverySummary(batch: QqDeliveryBatch): string {
  const { total, sent, failed, unknown, pending, cancelled, sending } = batch.summary;
  const details = [
    failed ? `失败 ${failed}` : "",
    unknown ? `状态未知 ${unknown}` : "",
    pending ? `未发送 ${pending}` : "",
    sending ? `发送中 ${sending}` : "",
    cancelled ? `已取消 ${cancelled}` : "",
  ].filter(Boolean);
  return `已确认 ${sent}/${total}${details.length ? `；${details.join("、")}` : ""}`;
}
