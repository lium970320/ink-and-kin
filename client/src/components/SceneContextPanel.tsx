import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Eye,
  EyeOff,
  RotateCcw,
  ListChecks,
  Loader2,
  Search,
  X,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SPRING_SILKY, useEscapeClose } from "@/components/ui/motion";

type SceneContextPanelProps = {
  sceneId: number;
  personaId: number;
  sceneName: string;
  personaName: string;
  onOpenFullManager: () => void;
  onClose?: () => void;
  isFloating?: boolean;
};

export default function SceneContextPanel({
  sceneId,
  personaId,
  sceneName,
  personaName,
  onOpenFullManager,
  onClose,
  isFloating = false,
}: SceneContextPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  useEscapeClose(Boolean(!isFloating && onClose), () => onClose?.());

  const { data, isLoading } = trpc.scene.getChatHistory.useQuery({
    sceneId,
    personaId,
    limit: 500,
  });
  const allInclusionMutation = trpc.scene.setAllContextInclusion.useMutation({
    onSuccess: result => {
      toast.success(result.updated > 0
        ? `已更新 ${result.updated} 条场景消息上下文`
        : "场景上下文设置已更新");
    },
    onError: error => toast.error(error.message),
  });
  const inclusionMutation = trpc.scene.setContextInclusion.useMutation({
    onSuccess: result => {
      toast.success(`已更新 ${result.updated} 条消息`);
    },
    onError: error => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const msgs = data?.messages ?? [];
    const sorted = [...msgs].sort((a, b) => b.id - a.id);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted.slice(0, 30);
    return sorted
      .filter(row => (
        row.content.toLowerCase().includes(q) ||
        `#${row.id}`.includes(q) ||
        String(row.id) === q
      ))
      .slice(0, 50);
  }, [data?.messages, searchQuery]);

  const visibleCount = data?.messages.filter(m => m.effectiveInContext).length ?? 0;
  const totalCount = data?.messages.length ?? 0;

  const content = (
    <div className={`space-y-2.5 ${isFloating ? "h-full flex flex-col min-h-0" : ""}`}>
      {!isFloating && (
        <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-border/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm ring-1 ring-primary/20 shadow-inner shrink-0">
              <Layers className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground tracking-tight truncate">{sceneName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-semibold shrink-0">
                  上下文管理
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenFullManager}
              className="h-7 px-2.5 rounded-xl bg-card hover:bg-muted text-foreground border border-border/75 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              title="打开完整场景聊天记录管理弹窗"
            >
              <ListChecks className="w-3.5 h-3.5 text-primary" />
              <span>完整管理</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center transition-colors cursor-pointer"
                title="收起上下文管理 (ESC)"
                aria-label="收起上下文管理"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-6 flex-1">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>正在加载剧本上下文状态…</span>
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-6 text-muted-foreground bg-muted/20 rounded-2xl border border-dashed border-border/60 flex-1 flex items-center justify-center">
          <p className="text-xs">该剧本暂无消息记录</p>
        </div>
      ) : (
        <>
          {/* Controls Bar */}
          <div className="flex items-center justify-between gap-2 p-2 sm:p-2.5 rounded-2xl bg-card border border-border/75 shadow-2xs shrink-0 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>模型可见：</span>
              <span className="font-mono tabular-nums font-bold text-foreground bg-muted/60 border border-border/60 px-2 py-0.5 rounded-lg text-xs">
                {visibleCount} / {totalCount} 条
              </span>
            </div>

            <div className="relative min-w-[132px] flex-1 max-w-[210px]">
              <Search className="w-3 h-3 text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="筛选消息或 #编号…"
                aria-label="筛选场景上下文消息"
                className="h-7 w-full rounded-xl border border-border/70 bg-background pl-7 pr-6 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-shadow"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="清除筛选"
                  aria-label="清除筛选"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: true })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                title="将该场景全部消息纳入 LLM 上下文"
              >
                <Eye className="w-3 h-3" />
                <span>全选纳入</span>
              </button>
              <button
                type="button"
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: false })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/70 transition-colors disabled:opacity-50 cursor-pointer"
                title="将该场景全部消息移出上下文"
              >
                <EyeOff className="w-3 h-3" />
                <span>全部排除</span>
              </button>
              <button
                type="button"
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: null })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/70 transition-colors disabled:opacity-50 cursor-pointer"
                title="重置为默认滑动窗口边界"
              >
                <RotateCcw className="w-3 h-3" />
                <span>跟随边界</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div
            className={`space-y-1.5 pr-1 panel-scrollbar ${
              isFloating ? "flex-1 min-h-0 overflow-y-auto" : "max-h-[38vh] overflow-y-auto"
            }`}
          >
            {rows.length === 0 ? (
              <div className="py-5 text-center text-xs text-muted-foreground bg-muted/15 rounded-2xl border border-dashed border-border/60">
                未找到匹配「{searchQuery}」的消息
              </div>
            ) : (
              rows.map(row => {
                const isUser = row.role === "user";
                return (
                  <div
                    key={row.id}
                    data-message-id={row.id}
                    className={`flex items-start justify-between gap-2.5 p-2.5 rounded-2xl border transition-colors ${
                      isUser
                        ? "bg-primary/[0.025] border-primary/20 hover:border-primary/35"
                        : "bg-card border-border/70 hover:border-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs mb-1 flex-wrap">
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded-md text-[11px] ${
                            isUser ? "bg-primary/10 text-primary" : "bg-muted text-foreground"
                          }`}
                        >
                          {isUser ? "我" : personaName}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">#{row.id}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold border ${
                            row.effectiveInContext
                              ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                              : "text-muted-foreground bg-muted/70 border-border/60"
                          }`}
                        >
                          {row.effectiveInContext ? "上下文中" : "已排除"}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/85 line-clamp-2 leading-relaxed">
                        {row.content}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => inclusionMutation.mutate({
                        sceneId, personaId,
                        messageIds: [row.id],
                        included: !row.effectiveInContext,
                      })}
                      disabled={inclusionMutation.isPending}
                      className={`h-7 px-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0 mt-0.5 cursor-pointer disabled:opacity-50 ${
                        row.effectiveInContext
                          ? "text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/60"
                          : "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25"
                      }`}
                      title={row.effectiveInContext ? "排除本条" : "加入上下文"}
                    >
                      {row.effectiveInContext ? (
                        <>
                          <EyeOff className="w-3 h-3" />
                          <span>排除</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3 h-3" />
                          <span>加入</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );

  if (isFloating) {
    return content;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_SILKY}
      className="border-b border-border/80 bg-background/95 backdrop-blur-xl px-3 sm:px-6 py-3 sm:py-4 text-xs shadow-lg shrink-0 max-h-[50vh] overflow-y-auto panel-scrollbar"
    >
      <div className="max-w-3xl mx-auto">
        {content}
      </div>
    </motion.div>
  );
}