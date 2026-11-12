import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CollapseSection } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatBeijingTime } from "@/lib/beijing-time";
import {
  formatQqDeliverySummary,
  type QqDeliveryBatch,
  type QqDeliveryPartStatus,
} from "@shared/qq-delivery";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";

const statusText: Record<QqDeliveryPartStatus, string> = {
  pending: "未发送",
  sending: "发送中",
  sent: "接口已确认",
  failed: "发送失败",
  unknown: "结果未知",
  cancelled: "已取消",
};

const statusBadgeStyles: Record<QqDeliveryPartStatus, string> = {
  pending: "border-border/70 bg-muted/55 text-muted-foreground",
  sending: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  sent: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  unknown: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cancelled: "border-border/60 bg-muted/40 text-muted-foreground/80",
};

function PartStatusIcon({ status }: { status: QqDeliveryPartStatus }) {
  if (status === "sent") return <CheckCircle2 className="h-3 w-3 shrink-0" />;
  if (status === "sending") return <Loader2 className="h-3 w-3 shrink-0 animate-spin" />;
  if (status === "failed") return <XCircle className="h-3 w-3 shrink-0" />;
  if (status === "unknown") return <HelpCircle className="h-3 w-3 shrink-0" />;
  return <Clock className="h-3 w-3 shrink-0" />;
}

function hasRetryVersion(version: number | undefined): version is number {
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0;
}

export default function QqDeliveryPanel({
  channelId,
  busy,
}: {
  channelId: number;
  busy: boolean;
}) {
  const utils = trpc.useUtils();
  const mounted = useRef(true);
  const retrying = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const query = trpc.roleplay.qqDeliveries.useQuery(
    { channelId },
    { refetchInterval: busy ? 1500 : 5000 }
  );
  const retry = trpc.roleplay.retryQqDelivery.useMutation();
  const batches = query.data?.channelId === channelId ? query.data.batches : [];
  const sending = batches.some(batch => batch.summary.sending > 0);
  const incomplete = batches.filter(
    batch => batch.summary.failed + batch.summary.unknown + batch.summary.pending > 0
  );

  const [panelOpen, setPanelOpen] = useState(() => incomplete.length > 0);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const prevIncompleteCount = useRef(incomplete.length);

  useEffect(() => {
    if (incomplete.length > 0 && prevIncompleteCount.current === 0) {
      setPanelOpen(true);
    }
    prevIncompleteCount.current = incomplete.length;
  }, [incomplete.length]);

  const toggleBatch = (batchId: string) => {
    setExpandedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const handleRetry = async (batch: QqDeliveryBatch) => {
    if (busy || sending || retrying.current || batch.retryable === false || !hasRetryVersion(batch.version)) return;
    const allowUnknown = batch.summary.unknown > 0;
    if (allowUnknown && !window.confirm("部分消息可能已经发到 QQ，只是没有收到确认。重发这些原文可能造成重复消息。确定仍要重发吗？")) return;
    retrying.current = true;
    try {
      const result = await retry.mutateAsync({
        channelId, batchId: batch.id, expectedVersion: batch.version, operationId: crypto.randomUUID(),
        ...(allowUnknown ? { allowUnknown: true } : {}),
      });
      if (!mounted.current) return;
      await utils.roleplay.qqDeliveries.invalidate({ channelId });
      if (!mounted.current) return;
      if (result.summary.sent === result.summary.total) toast.success("QQ 原文交付完成（接口已确认）");
      else toast.warning(`QQ 交付仍未完成：${formatQqDeliverySummary(result)}`);
    } catch (error) {
      if (mounted.current) toast.error(error instanceof Error ? error.message : "QQ 重发失败");
      if (mounted.current) void utils.roleplay.qqDeliveries.invalidate({ channelId });
    } finally {
      retrying.current = false;
    }
  };

  if (query.isError) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>QQ 交付记录暂时无法读取，请恢复后再处理重发。</span>
      </div>
    );
  }

  if (!batches.length) return null;

  const hasIssues = incomplete.length > 0;

  return (
    <div className="border-b border-border/60 bg-card/65 backdrop-blur-md">
      <button
        type="button"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-lg border",
              sending
                ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : hasIssues
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </span>
          <span className="text-xs font-semibold text-foreground">QQ 交付</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
              sending
                ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : hasIssues
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {sending
              ? "正在投递中"
              : hasIssues
                ? `${incomplete.length} 批未完成`
                : "近期批次已处理"}
          </span>
          <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
            共 {batches.length} 批
          </span>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            panelOpen && "rotate-180"
          )}
        />
      </button>

      <CollapseSection open={panelOpen}>
        <div className="border-t border-border/50 px-4 pb-3 pt-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            确认表示 QQ 接口返回成功。结果未知时，重发可能重复；重发使用已保存原文。
          </p>

          <div className="panel-scrollbar mt-2.5 max-h-56 space-y-2 overflow-y-auto pr-1">
            {batches.map(batch => {
              const hasUnknown = batch.summary.unknown > 0;
              const hasFailed = batch.summary.failed > 0;
              const isSendingBatch = batch.summary.sending > 0;
              const needsAction =
                batch.summary.failed + batch.summary.unknown + batch.summary.pending > 0;
              const isRetryingThis =
                retry.isPending && retry.variables?.batchId === batch.id;
              const detailOpen = expandedBatchIds.has(batch.id);
              const tailDigits = batch.contactId.split(":").at(-1)?.slice(-4) || "----";

              const summaryBadgeClass = isSendingBatch
                ? statusBadgeStyles.sending
                : hasFailed
                  ? statusBadgeStyles.failed
                  : hasUnknown
                    ? statusBadgeStyles.unknown
                    : needsAction
                      ? statusBadgeStyles.pending
                      : statusBadgeStyles.sent;

              return (
                <div
                  key={batch.id}
                  className="rounded-xl border border-border/70 bg-card/90 p-2.5 text-xs shadow-2xs transition-colors hover:border-border"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatBeijingTime(batch.createdAt)}
                    </span>
                    <span className="rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[10px] font-medium text-foreground/85">
                      {batch.source === "duet"
                        ? "对戏"
                        : batch.source === "web"
                          ? "网页推进"
                          : "QQ 频道"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {batch.contactId.includes(":group:") ? "群聊" : "私聊"}尾号{" "}
                      <span className="font-mono tabular-nums text-foreground/85">
                        {tailDigits}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                        summaryBadgeClass
                      )}
                    >
                      {formatQqDeliverySummary(batch)}
                    </span>

                    {needsAction && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "ml-auto h-7 rounded-lg px-2.5 text-[11px] font-medium",
                          hasUnknown &&
                            "border-amber-500/35 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                        )}
                        disabled={busy || sending || retry.isPending || batch.retryable === false || !hasRetryVersion(batch.version)}
                        onClick={() => void handleRetry(batch)}
                      >
                        {isRetryingThis ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 h-3 w-3" />
                        )}
                        {batch.retryable === false || !hasRetryVersion(batch.version) ? "重发不可用" : isRetryingThis
                          ? "正在重发…"
                          : hasUnknown
                            ? "确认后重发原文"
                            : "重发未完成原文"}
                      </Button>
                    )}
                  </div>

                  {batch.retryable === false && <p className="mt-1 text-[11px] text-muted-foreground">原消息或绑定已变化，历史记录仅供核对。</p>}
                  <div className="mt-2 border-t border-border/45 pt-1.5">
                    <button
                      type="button"
                      aria-expanded={detailOpen}
                      onClick={() => toggleBatch(batch.id)}
                      className="inline-flex items-center gap-1 rounded-md py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
                          detailOpen && "rotate-180"
                        )}
                      />
                      <span>查看各段原文与结果（{batch.parts.length} 段）</span>
                    </button>

                    <CollapseSection open={detailOpen}>
                      <ol className="mt-2 space-y-1.5">
                        {batch.parts.map(part => (
                          <li
                            key={part.id}
                            className="rounded-lg border border-border/55 bg-muted/25 px-2.5 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="font-mono tabular-nums">
                                第 {part.beatIndex + 1} 拍 · 第 {part.partIndex + 1} 段
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.2 text-[10px] font-medium",
                                  statusBadgeStyles[part.status]
                                )}
                              >
                                <PartStatusIcon status={part.status} />
                                {statusText[part.status]}
                              </span>
                              {part.qqMessageId && (
                                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                  QQ 消息编号 {part.qqMessageId}
                                </span>
                              )}
                            </div>
                            {part.duplicateRisk && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">本段此前结果未知，可能重复送达。</p>}
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                              {part.text}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </CollapseSection>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CollapseSection>
    </div>
  );
}
