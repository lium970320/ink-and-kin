import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CheckSquare,
  Database,
  Eye,
  EyeOff,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatBeijingTime } from "@/lib/beijing-time";

type ChatHistoryManagerProps = {
  personaId: number;
  personaName: string;
  onClose: () => void;
  onHistoryChanged: () => void;
};

export default function ChatHistoryManager({
  personaId,
  personaName,
  onClose,
  onHistoryChanged,
}: ChatHistoryManagerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteIds, setDeleteIds] = useState<number[] | null>(null);
  const [deleteLinkedMemories, setDeleteLinkedMemories] = useState(false);
  const [resetRuntimeCaches, setResetRuntimeCaches] = useState(true);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const { data, isLoading, refetch } = trpc.chat.getContextState.useQuery({
    personaId,
    limit: 500,
  });

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const refresh = async () => {
    await refetch();
    onHistoryChanged();
  };

  const inclusionMutation = trpc.chat.setContextInclusion.useMutation({
    onSuccess: async result => {
      toast.success(`已更新 ${result.updated} 条消息`);
      setSelectedIds(new Set());
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const restoreMutation = trpc.chat.restoreAllContext.useMutation({
    onSuccess: async () => {
      toast.success("全部聊天记录已重新加入上下文");
      setSelectedIds(new Set());
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const deleteMutation = trpc.chat.deleteMessages.useMutation({
    onSuccess: async result => {
      toast.success(
        result.deletedMemories > 0
          ? `已删除 ${result.deletedMessages} 条消息和 ${result.deletedMemories} 条关联记忆`
          : `已删除 ${result.deletedMessages} 条消息，删除前备份已保存`,
      );
      setDeleteIds(null);
      setSelectedIds(new Set());
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const rows = data?.messages ?? [];
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => (
      sortOrder === "newest"
        ? right.id - left.id
        : left.id - right.id
    )),
    [rows, sortOrder],
  );
  const visibleCount = rows.filter(row => row.effectiveInContext).length;
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const selectedRows = useMemo(
    () => rows.filter(row => selectedIds.has(row.id)),
    [rows, selectedIds],
  );

  const toggleSelection = (id: number) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map(row => row.id)));
  };

  const setIncluded = (messageIds: number[], included: boolean | null) => {
    inclusionMutation.mutate({ personaId, messageIds, included });
  };

  const openDelete = (messageIds: number[]) => {
    setDeleteLinkedMemories(false);
    setResetRuntimeCaches(true);
    setDeleteIds(messageIds);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      <header className="min-h-16 border-b border-border flex items-center px-3 sm:px-4 py-2 gap-2 sm:gap-3 flex-shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 inline-flex items-center justify-center hover:bg-muted rounded-md"
          title="关闭"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-foreground truncate">聊天记录管理</h2>
          <p className="text-xs text-muted-foreground truncate">
            {personaName} · 模型可见 {visibleCount}/{rows.length}
            {data?.startAfterMessageId ? ` · 边界 ${data.startAfterMessageId}` : ""}
          </p>
        </div>
        <button
          onClick={() => {
            if (window.confirm("将清除当前会话边界和所有手动排除，让全部历史重新进入模型上下文。继续？")) {
              restoreMutation.mutate({ personaId });
            }
          }}
          disabled={restoreMutation.isPending}
          className="h-9 px-2 sm:px-3 inline-flex items-center gap-2 text-sm border border-border hover:bg-muted rounded-md disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">全部加入上下文</span>
        </button>
      </header>

      <div className="min-h-12 border-b border-border px-3 sm:px-4 py-2 flex flex-wrap items-center gap-1 sm:gap-2 flex-shrink-0 bg-muted/20">
        <button
          onClick={toggleAll}
          className="w-8 h-8 inline-flex items-center justify-center hover:bg-muted rounded-md"
          title={allSelected ? "取消全选" : "全选"}
        >
          {allSelected
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4" />}
        </button>
        <span className="text-xs text-muted-foreground">
          {selectedIds.size > 0 ? `已选择 ${selectedIds.size} 条` : "最近 500 条"}
        </span>
        <div className="flex-1" />
        <label className="h-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowDownUp className="w-3.5 h-3.5" />
          <select
            aria-label="消息排序"
            value={sortOrder}
            onChange={event => setSortOrder(event.target.value as "newest" | "oldest")}
            className="h-8 bg-background border border-border rounded-md px-2 text-xs text-foreground"
          >
            <option value="newest">最新优先</option>
            <option value="oldest">最早优先</option>
          </select>
        </label>
        {selectedIds.size > 0 && (
          <>
            <button
              onClick={() => setIncluded(Array.from(selectedIds), true)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs hover:bg-muted rounded-md disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              加入上下文
            </button>
            <button
              onClick={() => setIncluded(Array.from(selectedIds), false)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs hover:bg-muted rounded-md disabled:opacity-50"
            >
              <EyeOff className="w-3.5 h-3.5" />
              排除上下文
            </button>
            <button
              onClick={() => setIncluded(Array.from(selectedIds), null)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs hover:bg-muted rounded-md disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              跟随边界
            </button>
            <button
              onClick={() => openDelete(Array.from(selectedIds))}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </>
        )}
      </div>

      <main className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            正在读取聊天记录…
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            暂无聊天记录
          </div>
        ) : (
          <div className="max-w-4xl mx-auto divide-y divide-border">
            {sortedRows.map(row => {
              const selected = selectedIds.has(row.id);
              return (
                <div
                  key={row.id}
                  data-message-id={row.id}
                  className={`grid grid-cols-[32px_minmax(0,1fr)] sm:grid-cols-[36px_minmax(0,1fr)_auto] gap-2 sm:gap-3 px-3 sm:px-4 py-3 items-start ${
                    selected ? "bg-primary/5" : "hover:bg-muted/20"
                  }`}
                >
                  <button
                    onClick={() => toggleSelection(row.id)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-muted"
                    title={selected ? "取消选择" : "选择"}
                  >
                    {selected
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-foreground">
                        {row.role === "user" ? "我" : personaName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">#{row.id}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatBeijingTime(row.createdAt)}
                      </span>
                      {row.contextOverride !== null && (
                        <span className="text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded">
                          手动
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-4">
                      {row.content}
                    </p>
                  </div>
                  <div className="col-start-2 sm:col-start-auto flex items-center justify-end gap-1">
                    <button
                      onClick={() => setIncluded([row.id], !row.effectiveInContext)}
                      disabled={inclusionMutation.isPending}
                      className={`h-8 px-2.5 inline-flex items-center gap-1.5 text-xs rounded-md ${
                        row.effectiveInContext
                          ? "text-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/15"
                          : "text-muted-foreground bg-muted hover:bg-muted/80"
                      } disabled:opacity-50`}
                      title={row.effectiveInContext ? "从模型上下文排除" : "加入模型上下文"}
                    >
                      {row.effectiveInContext
                        ? <Eye className="w-3.5 h-3.5" />
                        : <EyeOff className="w-3.5 h-3.5" />}
                      {row.effectiveInContext ? "上下文中" : "已排除"}
                    </button>
                    {row.contextOverride !== null && (
                      <button
                        onClick={() => setIncluded([row.id], null)}
                        disabled={inclusionMutation.isPending}
                        className="w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:bg-muted rounded-md disabled:opacity-50"
                        title="恢复为跟随会话边界"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => openDelete([row.id])}
                      className="w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                      title="删除消息"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {deleteIds && (
        <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-background border border-border shadow-xl rounded-lg">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-destructive" />
              <div>
                <h3 className="font-semibold text-foreground">删除 {deleteIds.length} 条消息</h3>
                <p className="text-xs text-muted-foreground">删除前会在当前账户的数据库中保存备份</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteLinkedMemories}
                  onChange={event => setDeleteLinkedMemories(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-foreground">同时删除关联长期记忆</span>
                  <span className="block text-xs text-muted-foreground">
                    仅删除直接引用这些消息作为证据的记忆
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={resetRuntimeCaches}
                  disabled
                  onChange={event => setResetRuntimeCaches(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-foreground">使旧对话摘要失效</span>
                  <span className="block text-xs text-muted-foreground">
                    删除或排除消息后会自动重建适用的摘要
                  </span>
                </span>
              </label>
              {selectedRows.some(row => row.role === "user") && deleteIds.length > 1 && (
                <div className="flex gap-2 text-xs text-amber-700 bg-amber-500/10 px-3 py-2 rounded-md">
                  <Database className="w-4 h-4 flex-shrink-0" />
                  当前选择包含你的消息。
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setDeleteIds(null)}
                className="h-9 px-3 text-sm hover:bg-muted rounded-md"
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate({
                  personaId,
                  messageIds: deleteIds,
                  deleteLinkedMemories,
                  resetRuntimeCaches,
                })}
                disabled={deleteMutation.isPending}
                className="h-9 px-3 inline-flex items-center gap-2 text-sm bg-destructive text-destructive-foreground hover:opacity-90 rounded-md disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
