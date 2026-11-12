import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownUp,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Database,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
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

type SceneChatHistoryManagerProps = {
  sceneId: number;
  personaId: number;
  sceneName: string;
  personaName: string;
  onClose: () => void;
  onHistoryChanged?: () => void;
};

const CONTEXT_LABEL = {
  included: {
    text: "上下文中",
    className: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
  },
  excluded: {
    text: "已排除",
    className: "text-muted-foreground bg-muted/60 border-border/70",
  },
  auto: {
    text: "自动",
    className: "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/25",
  },
} as const;

export default function SceneChatHistoryManager({
  sceneId,
  personaId,
  sceneName,
  personaName,
  onClose,
  onHistoryChanged,
}: SceneChatHistoryManagerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [deleteIds, setDeleteIds] = useState<number[] | null>(null);
  const [deleteCountSnapshot, setDeleteCountSnapshot] = useState(0);
  const [deleteLinkedMemories, setDeleteLinkedMemories] = useState(false);
  const [resetRuntimeCaches, setResetRuntimeCaches] = useState(true);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, refetch } = trpc.scene.getChatHistory.useQuery({
    sceneId,
    personaId,
    limit: 500,
  });

  useBodyScrollLock(true);
  useEscapeClose(deleteIds === null && !confirmClearAll, onClose);

  const refresh = async () => {
    await refetch();
    onHistoryChanged?.();
  };

  const inclusionMutation = trpc.scene.setContextInclusion.useMutation({
    onSuccess: async result => {
      toast.success(`已更新 ${result.updated} 条消息`);
      setSelectedIds(new Set());
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const allInclusionMutation = trpc.scene.setAllContextInclusion.useMutation({
    onSuccess: async result => {
      toast.success(result.updated > 0
        ? `已更新 ${result.updated} 条场景消息`
        : "场景上下文设置已更新");
      setSelectedIds(new Set());
      await refresh();
    },
    onError: error => toast.error(error.message),
  });

  const deleteMutation = trpc.scene.deleteMessages.useMutation({
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

  const clearAllMutation = trpc.scene.clearAllMessages.useMutation({
    onSuccess: async result => {
      toast.success(`已清空场景聊天记录，删除前备份已保存（${result.deletedMessages} 条）`);
      setConfirmClearAll(false);
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
  const assistantCount = useMemo(() => rows.filter(r => r.role === "assistant").length, [rows]);
  const userCount = useMemo(() => rows.filter(r => r.role === "user").length, [rows]);
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

  const toggleExpanded = (id: number) => {
    setExpandedIds(current => {
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
    inclusionMutation.mutate({ sceneId, personaId, messageIds, included });
  };

  const setAllIncluded = (included: boolean | null) => {
    allInclusionMutation.mutate({ sceneId, personaId, included });
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
      aria-label={`${sceneName} · 场景聊天记录管理`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={SPRING_SILKY}
      className="fixed inset-0 z-[70] bg-background flex flex-col overflow-hidden"
    >
      <header className="min-h-16 border-b border-border/80 bg-card/85 backdrop-blur-xl flex items-center px-3 sm:px-5 py-2.5 gap-2.5 sm:gap-3.5 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-xl transition-colors"
          title="关闭 (ESC)"
          aria-label="关闭场景聊天记录管理"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary hidden sm:inline-flex items-center justify-center ring-1 ring-primary/20 shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-sm sm:text-base text-foreground tracking-tight truncate">场景聊天记录管理</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold truncate max-w-[160px]">
              {sceneName}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {personaName} · 共{" "}
            <span className="font-mono tabular-nums font-semibold text-foreground">{rows.length}</span> 条（
            <span className="font-mono tabular-nums">{userCount}</span> 条导演/用户，
            <span className="font-mono tabular-nums">{assistantCount}</span> 轮人物回复）· 上下文有效{" "}
            <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{visibleCount}</span> 条
            {data?.startAfterMessageId ? (
              <span>
                {" "}· 全局边界 <span className="font-mono tabular-nums">#{data.startAfterMessageId}</span>
              </span>
            ) : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("将当前场景全部消息强制加入模型上下文（不影响其他场景）。继续？")) {
              setAllIncluded(true);
            }
          }}
          disabled={allInclusionMutation.isPending}
          className="h-9 px-2.5 sm:px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold border border-border/80 bg-background hover:bg-muted/70 text-foreground rounded-xl transition-colors shadow-2xs disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">全部加入上下文</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmClearAll(true)}
          disabled={clearAllMutation.isPending}
          className="h-9 px-2.5 sm:px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/15 rounded-xl transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">清空场景聊天</span>
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
            placeholder="搜索剧情对话或 #编号…"
            aria-label="搜索场景聊天记录"
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

        <button
          type="button"
          onClick={() => setAllIncluded(false)}
          disabled={allInclusionMutation.isPending}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-background hover:bg-muted border border-border/75 rounded-xl transition-colors disabled:opacity-50"
          title="把该场景全部消息排除出模型上下文"
        >
          <EyeOff className="w-3.5 h-3.5" />
          全部排除
        </button>
        <button
          type="button"
          onClick={() => setAllIncluded(null)}
          disabled={allInclusionMutation.isPending}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-background hover:bg-muted border border-border/75 rounded-xl transition-colors disabled:opacity-50"
          title="清除该场景全部手动标记，恢复跟随全局会话边界"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          跟随边界
        </button>

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
            <span>正在读取场景聊天记录…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            暂无场景聊天记录
          </div>
        ) : filteredSortedRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground p-6">
            <p>未找到匹配「{searchQuery}」的场景消息</p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs font-semibold text-primary hover:underline"
            >
              清除筛选条件
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-3 sm:px-5 py-4 space-y-3">
            {filteredSortedRows.map(row => {
              const isUser = row.role === "user";
              const selected = selectedIds.has(row.id);
              const isExplicit = row.contextOverride !== null;
              const contextInfo = row.effectiveInContext
                ? CONTEXT_LABEL.included
                : isExplicit
                  ? CONTEXT_LABEL.excluded
                  : CONTEXT_LABEL.auto;
              const isImage = row.messageType === "image" && row.role === "assistant";
              const isLong = !isImage && row.content.length > 120;
              const expanded = expandedIds.has(row.id);
              return (
                <div
                  key={row.id}
                  data-message-id={row.id}
                  className={`flex gap-2 sm:gap-3 items-start transition-colors p-1 -m-1 ${isUser ? "flex-row-reverse" : ""} ${
                    selected ? "rounded-2xl bg-primary/[0.06] ring-1 ring-primary/25" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelection(row.id)}
                    className={`mt-2.5 w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-xl hover:bg-muted transition-colors ${
                      isUser ? "order-2" : "order-0"
                    }`}
                    title={selected ? "取消选择" : "选择"}
                  >
                    {selected
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>

                  <div
                    className={`min-w-0 max-w-[84%] sm:max-w-[76%] text-left rounded-2xl border bg-card px-3.5 sm:px-4 py-3 shadow-2xs transition-colors ${
                      isUser
                        ? "border-primary/30 ring-1 ring-primary/10 rounded-tr-sm"
                        : "border-border/75 rounded-tl-sm"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 flex-wrap">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          isUser
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {isUser ? "我" : personaName}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono tabular-nums">#{row.id}</span>
                      <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                        {formatBeijingTime(row.createdAt)}
                      </span>
                      {isImage && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground border border-border/70 bg-muted/40 px-1.5 py-0.5 rounded-md">
                          <ImageIcon className="w-3 h-3" />
                          图片
                        </span>
                      )}
                      {row.messageType && row.messageType !== "text" && !isImage && (
                        <span className="text-[10px] text-muted-foreground border border-border/70 bg-muted/40 px-1.5 py-0.5 rounded-md">
                          {row.messageType}
                        </span>
                      )}
                      <span className={`text-[10px] font-medium border px-1.5 py-0.5 rounded-md ${contextInfo.className}`}>
                        {contextInfo.text}
                      </span>
                      {isExplicit && (
                        <span className="text-[10px] font-medium text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
                          手动
                        </span>
                      )}
                    </div>

                    <div className={`${isLong && !expanded ? "max-h-20 overflow-hidden relative" : ""}`}>
                      <p className={`text-sm text-foreground/95 whitespace-pre-wrap break-words leading-relaxed ${isLong && !expanded ? "line-clamp-3" : ""}`}>
                        {isImage ? (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <ImageIcon className="w-4 h-4" />
                            [图片]
                          </span>
                        ) : (
                          row.content
                        )}
                      </p>
                      {isLong && !expanded && (
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card via-card/85 to-transparent pointer-events-none" />
                      )}
                    </div>
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.id)}
                        aria-expanded={expanded}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        {expanded ? (
                          <><ChevronUp className="w-3 h-3" />收起</>
                        ) : (
                          <><ChevronDown className="w-3 h-3" />展开全文</>
                        )}
                      </button>
                    )}

                    <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIncluded([row.id], !row.effectiveInContext)}
                        disabled={inclusionMutation.isPending}
                        className={`h-7 px-2.5 inline-flex items-center gap-1 text-[11px] font-medium rounded-lg border transition-colors ${
                          row.effectiveInContext
                            ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25 hover:bg-emerald-500/20"
                            : "text-muted-foreground bg-muted/70 border-border/70 hover:bg-muted hover:text-foreground"
                        } disabled:opacity-50`}
                        title={row.effectiveInContext ? "从模型上下文排除" : "加入模型上下文"}
                      >
                        {row.effectiveInContext ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        {row.effectiveInContext ? "排除" : "加入上下文"}
                      </button>
                      {isExplicit && (
                        <button
                          type="button"
                          onClick={() => setIncluded([row.id], null)}
                          disabled={inclusionMutation.isPending}
                          className="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                          title="恢复为跟随全局会话边界"
                        >
                          <RotateCcw className="w-3 h-3" />
                          跟随边界
                        </button>
                      )}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => openDelete([row.id])}
                        className="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                        title="删除消息"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
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
        zIndexClassName="z-[80]"
        ariaLabel="确认删除场景消息"
        className="max-w-md rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border/70 bg-muted/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-foreground">
              删除 <span className="font-mono tabular-nums">{activeDeleteIds.length || deleteCountSnapshot}</span> 条场景消息
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
              onChange={event => setResetRuntimeCaches(event.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-xs font-semibold text-foreground">清除人物临时理解缓存</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                清除隐藏心理、诊断和主动消息缓存，保留人物卡与场景模式
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
                sceneId,
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

      <MotionModal
        open={confirmClearAll}
        onClose={() => {
          if (!clearAllMutation.isPending) setConfirmClearAll(false);
        }}
        zIndexClassName="z-[80]"
        ariaLabel="确认清空场景全部聊天记录"
        className="max-w-md rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border/70 bg-muted/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-foreground">清空该场景全部聊天记录？</h3>
            <p className="text-xs text-muted-foreground">删除前会在当前账户的数据库中保存备份，并重置剧情摘要与自动提炼事实；手工确认事实保留。</p>
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
        </div>
        <div className="px-5 py-3.5 border-t border-border/70 bg-muted/15 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmClearAll(false)}
            disabled={clearAllMutation.isPending}
            className="h-9 px-3.5 text-xs font-semibold text-foreground hover:bg-muted rounded-xl transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => clearAllMutation.mutate({
              sceneId,
              personaId,
              deleteLinkedMemories,
              resetRuntimeCaches,
            })}
            disabled={clearAllMutation.isPending}
            className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold bg-destructive text-destructive-foreground hover:opacity-90 rounded-xl shadow-xs transition-opacity disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {clearAllMutation.isPending ? "正在清空…" : "确认清空"}
          </button>
        </div>
      </MotionModal>
    </motion.div>
  );
}