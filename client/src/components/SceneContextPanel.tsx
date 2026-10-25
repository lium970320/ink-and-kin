import { useMemo } from "react";
import { Layers, Eye, EyeOff, RotateCcw, ListChecks, Loader2, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

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
    return [...msgs].sort((a, b) => b.id - a.id).slice(0, 30);
  }, [data?.messages]);

  const visibleCount = data?.messages.filter(m => m.effectiveInContext).length ?? 0;
  const totalCount = data?.messages.length ?? 0;

  const content = (
    <div className={`space-y-2.5 ${isFloating ? "h-full flex flex-col min-h-0" : ""}`}>
      {!isFloating && (
        <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm shadow-inner shrink-0">
              <Layers className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground truncate">{sceneName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                  上下文管理
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onOpenFullManager}
              className="px-2.5 py-1 rounded-xl bg-muted hover:bg-muted/80 text-foreground border border-border/60 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
              title="打开完整场景聊天记录管理弹窗"
            >
              <ListChecks className="w-3.5 h-3.5 text-primary" />
              <span>完整管理</span>
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="w-6 h-6 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center transition-colors cursor-pointer"
                title="收起上下文管理"
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
          <div className="flex items-center justify-between gap-2 p-2 sm:p-2.5 rounded-2xl bg-card border border-border/70 shadow-2xs shrink-0 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>模型可见：</span>
              <span className="font-bold text-foreground bg-muted/50 px-1.5 py-0.5 rounded-md text-xs">
                {visibleCount} / {totalCount} 条
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <button
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: true })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer"
                title="将该场景全部消息纳入 LLM 上下文"
              >
                <Eye className="w-3 h-3" />
                <span>全选纳入</span>
              </button>
              <button
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: false })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/60 transition-all disabled:opacity-50 cursor-pointer"
                title="将该场景全部消息移出上下文"
              >
                <EyeOff className="w-3 h-3" />
                <span>全部排除</span>
              </button>
              <button
                onClick={() => allInclusionMutation.mutate({ sceneId, personaId, included: null })}
                disabled={allInclusionMutation.isPending}
                className="h-7 px-2.5 inline-flex items-center gap-1 text-xs rounded-xl font-semibold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/60 transition-all disabled:opacity-50 cursor-pointer"
                title="重置为默认滑动窗口边界"
              >
                <RotateCcw className="w-3 h-3" />
                <span>跟随边界</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className={`space-y-1.5 pr-1 ${isFloating ? "flex-1 min-h-0 overflow-y-auto" : "max-h-[38vh] overflow-y-auto"}`}>
            {rows.map(row => {
              const isUser = row.role === "user";
              return (
                <div
                  key={row.id}
                  data-message-id={row.id}
                  className={`flex items-start justify-between gap-2.5 p-2 sm:p-2.5 rounded-xl border transition-all ${
                    isUser
                      ? "bg-primary/[0.02] border-primary/15 hover:border-primary/30"
                      : "bg-card border-border/60 hover:border-border"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs mb-0.5">
                      <span className={`font-bold ${isUser ? "text-primary" : "text-foreground"}`}>
                        {isUser ? "我" : personaName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-mono">#{row.id}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold border ${
                        row.effectiveInContext
                          ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                          : "text-muted-foreground bg-muted/70 border-border/60"
                      }`}>
                        {row.effectiveInContext ? "上下文中" : "已排除"}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                      {row.content}
                    </p>
                  </div>

                  <button
                    onClick={() => inclusionMutation.mutate({
                      sceneId, personaId,
                      messageIds: [row.id],
                      included: !row.effectiveInContext,
                    })}
                    disabled={inclusionMutation.isPending}
                    className={`h-6.5 px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all shrink-0 mt-0.5 cursor-pointer ${
                      row.effectiveInContext
                        ? "text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border/50"
                        : "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30"
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
            })}
          </div>
        </>
      )}
    </div>
  );

  if (isFloating) {
    return content;
  }

  return (
    <div className="border-b border-border/80 bg-background/95 backdrop-blur-xl px-3 sm:px-6 py-3 sm:py-4 text-xs animate-fade-in shadow-lg shrink-0 max-h-[50vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        {content}
      </div>
    </div>
  );
}