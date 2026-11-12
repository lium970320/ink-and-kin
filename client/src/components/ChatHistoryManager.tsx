import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownUp,
  CheckSquare,
  Database,
  Eye,
  EyeOff,
  History,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatBeijingTime } from "@/lib/beijing-time";
import {
  MotionModal,
  SPRING_SILKY,
  useBodyScrollLock,
  useEscapeClose,
} from "@/components/ui/motion";

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
  const [deleteCountSnapshot, setDeleteCountSnapshot] = useState(0);
  const [deleteLinkedMemories, setDeleteLinkedMemories] = useState(false);
  const [resetRuntimeCaches, setResetRuntimeCaches] = useState(true);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, refetch } = trpc.chat.getContextState.useQuery({
    personaId,
    limit: 500,
  });

  useBodyScrollLock(true);
  useEscapeClose(deleteIds === null, onClose);

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
  const filteredSortedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = q
      ? rows.filter(row => {
          const idTag = `#${row.id}`;
          return (
            row.content.toLowerCase().includes(q) ||
            idTag.includes(q) ||
            String(row.id) === q
          );
        })
      : rows;
    return [...base].sort((left, right) => (
      sortOrder === "newest"
        ? right.id - left.id
        : left.id - right.id
    ));
  }, [rows, sortOrder, searchQuery]);

  const visibleCount = rows.filter(row => row.effectiveInContext).length;
  const allSelected =
    filteredSortedRows.length > 0 &&
    filteredSortedRows.every(row => selectedIds.has(row.id));
  const activeDeleteIds = deleteIds ?? [];
  const deletingRows = useMemo(
    () => rows.filter(row => activeDeleteIds.includes(row.id)),
    [rows, activeDeleteIds],
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
    if (allSelected) {
      setSelectedIds(current => {
        const next = new Set(current);
        for (const row of filteredSortedRows) next.delete(row.id);
        return next;
      });
    } else {
      setSelectedIds(current => {
        const next = new Set(current);
        for (const row of filteredSortedRows) next.add(row.id);
        return next;
      });
    }
  };

  const setIncluded = (messageIds: number[], included: boolean | null) => {
    inclusionMutation.mutate({ personaId, messageIds, included });
  };

  const openDelete = (messageIds: number[]) => {
    setDeleteLinkedMemories(false);
    setResetRuntimeCaches(true);
    setDeleteCountSnapshot(messageIds.length);
    setDeleteIds(messageIds);
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${personaName} · 聊天记录管理`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={SPRING_SILKY}
      className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden"
    >
      <header className="min-h-16 border-b border-border/80 bg-card/85 backdrop-blur-xl flex items-center px-3 sm:px-5 py-2.5 gap-2.5 sm:gap-3.5 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-xl transition-colors"
          title="关闭 (ESC)"
          aria-label="关闭聊天记录管理"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary hidden sm:inline-flex items-center justify-center ring-1 ring-primary/20 shrink-0">
          <History className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-sm sm:text-base text-foreground tracking-tight truncate">聊天记录管理</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold shrink-0">
              {personaName}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            模型可见{" "}
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {visibleCount}/{rows.length}
            </span>
            {data?.startAfterMessageId ? (
              <span>
                {" "}· 会话边界 <span className="font-mono tabular-nums">#{data.startAfterMessageId}</span>
              </span>
            ) : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("将清除当前会话边界和所有手动排除，让全部历史重新进入模型上下文。继续？")) {
              restoreMutation.mutate({ personaId });
            }
          }}
          disabled={restoreMutation.isPending}
          className="h-9 px-3 sm:px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold border border-border/80 bg-background hover:bg-muted/70 text-foreground rounded-xl transition-colors shadow-2xs disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">全部加入上下文</span>
        </button>
      </header>

      <div className="border-b border-border/70 px-3 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 flex-shrink-0 bg-muted/20">
        <button
          type="button"
          onClick={toggleAll}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:bg-muted rounded-xl transition-colors"
          title={allSelected ? "取消全选" : "全选当前列表"}
        >
          {allSelected
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4 text-muted-foreground" />}
          <span className="font-mono tabular-nums text-muted-foreground">
            {selectedIds.size > 0
              ? `已选 ${selectedIds.size} 条`
              : searchQuery.trim()
                ? `匹配 ${filteredSortedRows.length} 条`
                : `最近 ${rows.length || 0} 条`}
          </span>
        </button>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索消息内容或 #编号…"
            aria-label="搜索聊天记录"
            className="h-8 w-full rounded-xl border border-border/75 bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-shadow"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="清除搜索"
              aria-label="清除搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 hidden md:block" />

        <label className="h-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-background border border-border/75 rounded-xl px-2.5 shadow-2xs">
          <ArrowDownUp className="w-3.5 h-3.5 text-primary/80 shrink-0" />
          <select
            aria-label="消息排序"
            value={sortOrder}
            onChange={event => setSortOrder(event.target.value as "newest" | "oldest")}
            className="h-full bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer"
          >
            <option value="newest">最新优先</option>
            <option value="oldest">最早优先</option>
          </select>
        </label>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-1 border-l border-border/70">
            <button
              type="button"
              onClick={() => setIncluded(Array.from(selectedIds), true)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 rounded-xl transition-colors disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              加入上下文
            </button>
            <button
              type="button"
              onClick={() => setIncluded(Array.from(selectedIds), false)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-background hover:bg-muted border border-border/75 rounded-xl transition-colors disabled:opacity-50"
            >
              <EyeOff className="w-3.5 h-3.5" />
              排除上下文
            </button>
            <button
              type="button"
              onClick={() => setIncluded(Array.from(selectedIds), null)}
              disabled={inclusionMutation.isPending}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-background hover:bg-muted border border-border/75 rounded-xl transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              跟随边界
            </button>
            <button
              type="button"
              onClick={() => openDelete(Array.from(selectedIds))}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-destructive bg-destructive/5 hover:bg-destructive/15 border border-destructive/25 rounded-xl transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </div>
        )}
      </div>

      <main className="flex-1 overflow-y-auto panel-scrollbar bg-muted/10">
        {isLoading ? (
          <div className="h-full flex items-center justify-center gap-2.5 text-sm text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span>正在读取聊天记录…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            暂无聊天记录
          </div>
        ) : filteredSortedRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground p-6">
            <p>未找到匹配「{searchQuery}」的消息记录</p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs font-semibold text-primary hover:underline"
            >
              清除筛选条件
            </button>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-3 sm:px-5 py-4 space-y-2">
            {filteredSortedRows.map(row => {
              const selected = selectedIds.has(row.id);
              const isUser = row.role === "user";
              return (
                <div
                  key={row.id}
                  data-message-id={row.id}
                  className={`grid grid-cols-[32px_minmax(0,1fr)] sm:grid-cols-[36px_minmax(0,1fr)_auto] gap-2.5 sm:gap-3.5 px-3 sm:px-4 py-3 items-start rounded-2xl border transition-all ${
                    selected
                      ? "bg-primary/[0.06] border-primary/35 ring-1 ring-primary/20 shadow-2xs"
                      : "bg-card border-border/70 hover:border-border shadow-2xs"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelection(row.id)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-xl hover:bg-muted transition-colors"
                    title={selected ? "取消选择" : "选择"}
                  >
                    {selected
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          isUser
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {isUser ? "我" : personaName}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono tabular-nums">#{row.id}</span>
                      <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        {formatBeijingTime(row.createdAt)}
                      </span>
                      {row.contextOverride !== null && (
                        <span className="text-[10px] font-medium text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
                          手动锁定
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground/95 whitespace-pre-wrap break-words leading-relaxed line-clamp-4">
                      {row.content}
                    </p>
                  </div>
                  <div className="col-start-2 sm:col-start-auto flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setIncluded([row.id], !row.effectiveInContext)}
                      disabled={inclusionMutation.isPending}
                      className={`h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-xl border transition-colors ${
                        row.effectiveInContext
                          ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25 hover:bg-emerald-500/20"
                          : "text-muted-foreground bg-muted/70 border-border/70 hover:bg-muted hover:text-foreground"
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
                        type="button"
                        onClick={() => setIncluded([row.id], null)}
                        disabled={inclusionMutation.isPending}
                        className="w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors disabled:opacity-50"
                        title="恢复为跟随会话边界"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openDelete([row.id])}
                      className="w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
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

      <MotionModal
        open={deleteIds !== null}
        onClose={() => {
          if (!deleteMutation.isPending) setDeleteIds(null);
        }}
        zIndexClassName="z-[60]"
        ariaLabel="确认删除消息"
        className="max-w-md rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border/70 bg-muted/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-foreground">
              删除 <span className="font-mono tabular-nums">{activeDeleteIds.length || deleteCountSnapshot}</span> 条消息
            </h3>
            <p className="text-xs text-muted-foreground">删除前会在当前账户的数据库中保存备份</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="flex items-start gap-3 p-2.5 rounded-2xl border border-border/60 bg-background/60 hover:border-border cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={deleteLinkedMemories}
              onChange={event => setDeleteLinkedMemories(event.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-xs font-semibold text-foreground">同时删除关联长期记忆</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                仅删除直接引用这些消息作为证据的记忆
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 p-2.5 rounded-2xl border border-border/60 bg-background/60 hover:border-border cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={resetRuntimeCaches}
              disabled
              onChange={event => setResetRuntimeCaches(event.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-xs font-semibold text-foreground">使旧对话摘要失效</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                删除或排除消息后会自动重建适用的摘要
              </span>
            </span>
          </label>
          {deletingRows.some(row => row.role === "user") && activeDeleteIds.length > 1 && (
            <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 rounded-xl">
              <Database className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <span>当前选择包含你的发言消息。</span>
            </div>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-border/70 bg-muted/15 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDeleteIds(null)}
            disabled={deleteMutation.isPending}
            className="h-9 px-3.5 text-xs font-semibold text-foreground hover:bg-muted rounded-xl transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (!deleteIds) return;
              deleteMutation.mutate({
                personaId,
                messageIds: deleteIds,
                deleteLinkedMemories,
                resetRuntimeCaches,
              });
            }}
            disabled={deleteMutation.isPending || !deleteIds}
            className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold bg-destructive text-destructive-foreground hover:opacity-90 rounded-xl shadow-xs transition-opacity disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleteMutation.isPending ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </MotionModal>
    </motion.div>
  );
}
