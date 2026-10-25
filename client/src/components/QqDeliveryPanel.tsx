import { useLayoutEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatBeijingTime } from "@/lib/beijing-time";
import { formatQqDeliverySummary, type QqDeliveryBatch, type QqDeliveryPartStatus } from "@shared/qq-delivery";

const statusText: Record<QqDeliveryPartStatus, string> = {
  pending: "未发送", sending: "发送中", sent: "接口已确认", failed: "发送失败", unknown: "结果未知", cancelled: "已取消",
};

export default function QqDeliveryPanel({ channelId, busy }: { channelId: number; busy: boolean }) {
  const utils = trpc.useUtils();
  const mounted = useRef(true);
  const retrying = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const query = trpc.roleplay.qqDeliveries.useQuery({ channelId }, { refetchInterval: busy ? 1500 : 5000 });
  const retry = trpc.roleplay.retryQqDelivery.useMutation();
  const batches = query.data?.channelId === channelId ? query.data.batches : [];
  const sending = batches.some(batch => batch.summary.sending > 0);
  const incomplete = batches.filter(batch => batch.summary.failed + batch.summary.unknown + batch.summary.pending > 0);

  const handleRetry = async (batch: QqDeliveryBatch) => {
    if (busy || sending || retrying.current) return;
    const allowUnknown = batch.summary.unknown > 0;
    if (allowUnknown && !window.confirm("部分消息可能已经发到 QQ，只是没有收到确认。重发这些原文可能造成重复消息。确定仍要重发吗？")) return;
    retrying.current = true;
    try {
      const result = await retry.mutateAsync({ channelId, batchId: batch.id, ...(allowUnknown ? { allowUnknown: true } : {}) });
      if (!mounted.current) return;
      await utils.roleplay.qqDeliveries.invalidate({ channelId });
      if (!mounted.current) return;
      if (result.summary.sent === result.summary.total) toast.success("QQ 原文交付完成（接口已确认）");
      else toast.warning(`QQ 交付仍未完成：${formatQqDeliverySummary(result)}`);
    } catch (error) {
      if (mounted.current) toast.error(error instanceof Error ? error.message : "QQ 重发失败");
    } finally {
      retrying.current = false;
    }
  };

  if (query.isError) return <div className="border-b px-4 py-2 text-xs text-amber-700">QQ 交付记录暂时无法读取，请恢复后再处理重发。</div>;
  if (!batches.length) return null;
  return (
    <details className="border-b border-border/50 bg-muted/20 px-4 py-2" open={incomplete.length > 0}>
      <summary className="cursor-pointer text-xs font-medium">QQ 交付 · {incomplete.length ? `${incomplete.length} 批未完成` : "近期批次已处理"}</summary>
      <p className="mt-2 text-[11px] text-muted-foreground">确认表示 QQ 接口返回成功。结果未知时，重发可能重复；重发使用已保存原文。</p>
      <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
        {batches.map(batch => (
          <div key={batch.id} className="rounded-lg border border-border/60 bg-background/70 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{formatBeijingTime(batch.createdAt)} · {batch.source === "duet" ? "对戏" : batch.source === "web" ? "网页推进" : "QQ 频道"} · {batch.contactId.includes(":group:") ? "群聊" : "私聊"}尾号 {batch.contactId.split(":").at(-1)?.slice(-4)}</span>
              <span className={batch.summary.failed + batch.summary.unknown > 0 ? "text-amber-700" : "text-muted-foreground"}>{formatQqDeliverySummary(batch)}</span>
              {batch.summary.failed + batch.summary.unknown + batch.summary.pending > 0 && (
                <Button size="sm" variant="outline" className="h-6 text-[11px] ml-auto" disabled={busy || sending || retry.isPending} onClick={() => void handleRetry(batch)}>
                  {retry.isPending && retry.variables?.batchId === batch.id ? "正在重发…" : batch.summary.unknown > 0 ? "确认后重发原文" : "重发未完成原文"}
                </Button>
              )}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">查看各段原文与结果</summary>
              <ol className="mt-1 space-y-1">
                {batch.parts.map(part => <li key={part.id} className="rounded bg-muted/30 p-2">
                  <div className="text-[11px] text-muted-foreground">第 {part.beatIndex + 1} 拍 · 第 {part.partIndex + 1} 段 · {statusText[part.status]}{part.qqMessageId ? ` · QQ 消息编号 ${part.qqMessageId}` : ""}</div>
                  <p className="whitespace-pre-wrap break-words mt-1">{part.text}</p>
                </li>)}
              </ol>
            </details>
          </div>
        ))}
      </div>
    </details>
  );
}
