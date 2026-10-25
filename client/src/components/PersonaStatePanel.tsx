import { useMemo, useState, type ElementType, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  Layers,
  Mic2,
  MessageSquare,
  Image as ImageIcon,
  Radio,
  RefreshCw,
  Route,
  Sparkles,
  Timer,
  X,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTime } from "@/lib/beijing-time";
import { Button } from "@/components/ui/button";

interface PersonaStatePanelProps {
  personaId: number;
  onClose: () => void;
}

const LIFE_STATE_LABELS: Record<string, string> = {
  scene_awake: "场景中清醒",
  drowsy_awake: "半睡半醒",
  sleeping: "睡眠",
  morning_waking: "晨起",
  commuting_to_work: "去所里路上",
  working_morning: "上午工作",
  lunch_break: "午饭休息",
  midday_rest: "午间休息",
  working_afternoon: "下午工作",
  commuting_home: "下班路上",
  dinner_at_home: "晚饭在家",
  evening_home: "晚间在家",
  night_reading: "夜间阅读",
  pre_sleep: "准备睡觉",
  weekend_morning: "周末早晨",
  weekend_home: "周末在家",
  weekend_errands: "周末外出",
  sunday_work_prep: "周日准备工作",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  silent_unless_urgent: "普通消息静默，只回应叫醒/急事",
  brief: "只适合短回复",
  normal: "正常回复",
  open: "适合展开聊天或语音",
};

const INTENT_LABELS: Record<string, string> = {
  daily_chat: "日常聊天",
  affection_expression: "爱意表达",
  emotional_support: "情绪支持",
  source_recall: "原著回忆",
  correction: "纠错",
  media: "媒体回应",
  voice: "语音回应",
  teasing: "玩笑调侃",
  technical: "技术问题",
  unknown: "未识别",
};

const PLATFORM_LABELS: Record<string, string> = {
  web: "网页",
  qq: "QQ",
  wechat: "微信",
};

const MODE_LABELS: Record<string, string> = {
  reply: "被动回复",
  proactive: "主动消息",
};

const TRIGGER_LABELS: Record<string, string> = {
  scheduled: "定时触发",
  ambient: "环境触发",
  incoming_message: "收到消息触发",
  user_message: "用户消息",
  manual: "手动触发",
  webhook: "Webhook 上报",
};

const OUTPUT_MODE_LABELS: Record<string, string> = {
  text: "文字",
  voice: "语音",
  sticker: "表情包",
  mixed: "混合输出",
  auto: "自动判断",
};

const MEMORY_MODE_LABELS: Record<string, string> = {
  none: "不召回",
  light: "轻量召回",
  normal: "常规召回",
  deep: "深度召回",
  source: "原著优先",
};

const REPLY_LENGTH_LABELS: Record<string, string> = {
  short: "短回复",
  medium: "中等回复",
  long: "长回复",
  brief: "简短回复",
};

const VOICE_MODE_LABELS: Record<string, string> = {
  never: "永不发语音",
  requested: "仅明确要求",
  smart: "智能判定",
  sometimes: "低频自然发送",
  always: "总是语音",
};

const TTS_PROVIDER_LABELS: Record<string, string> = {
  "windows-sapi": "Windows SAPI",
  edge: "Edge TTS",
  voxcpm: "VoxCPM",
  minimax: "MiniMax",
  none: "无降级",
};

const LLM_PURPOSE_LABELS: Record<string, string> = {
  chat: "聊天",
  source_recall: "原著召回",
  reflection: "隐藏反思",
  persona_analysis: "人物分析",
  skill_pipeline: "技能流水线",
  graduation: "毕业判断",
  roleplay: "角色群聊",
  unknown: "未知用途",
};

function formatTime(value?: string | null): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return formatBeijingDateTime(date, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
}

function formatNumber(value?: number | null): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function intentLabel(value?: string): string {
  if (!value) return "暂无";
  return INTENT_LABELS[value] || value;
}

function stateLabel(value?: string): string {
  if (!value) return "未知";
  return LIFE_STATE_LABELS[value] || value;
}

function availabilityLabel(value?: string): string {
  if (!value) return "未知";
  return AVAILABILITY_LABELS[value] || value;
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "info" | "danger";
}) {
  const tones = {
    neutral: "border-border bg-muted/45 text-muted-foreground",
    good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    info: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    danger: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
  return (
    <span className={`inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  color = "primary",
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  note?: string;
  color?: "primary" | "amber" | "emerald" | "indigo";
}) {
  const iconTones = {
    primary: "bg-primary/10 text-primary border-primary/20",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/30 p-3.5 shadow-2xs transition-all duration-200 hover:bg-muted/50 hover:border-border">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${iconTones[color]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-2 text-base font-bold tracking-tight text-foreground font-sans">{value}</div>
      {note && <div className="mt-1 text-[10px] leading-tight text-muted-foreground font-medium">{note}</div>}
    </div>
  );
}

function CollapsibleCard({
  title,
  icon: Icon,
  children,
  aside,
  defaultOpen = true,
}: {
  title: string;
  icon: ElementType;
  children: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs transition-all overflow-hidden">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer select-none hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary border border-primary/15">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="truncate text-xs font-bold text-foreground tracking-wide uppercase">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {aside}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground/80" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground/80" />
          )}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-border bg-card animate-fade-in space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}

function TextBlock({ children }: { children?: ReactNode }) {
  if (!children) return <p className="text-xs text-muted-foreground">暂无数据</p>;
  return (
    <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-xs leading-relaxed text-foreground">
      {children}
    </p>
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordEntries(value: unknown): Array<[string, any]> {
  return isRecord(value) ? Object.entries(value) : [];
}

function flattenRandomizedSchedule(schedule: unknown) {
  if (!isRecord(schedule) || !isRecord(schedule.days)) return [];
  return Object.entries(schedule.days)
    .flatMap(([date, day]) => {
      if (!isRecord(day)) return [];
      return Object.entries(day).map(([baseTime, slot]) => {
        const item = isRecord(slot) ? slot : {};
        return {
          date,
          baseTime: String(item.baseTime || baseTime),
          actualDate: typeof item.actualDate === "string" ? item.actualDate : "",
          actualTime: typeof item.actualTime === "string" ? item.actualTime : "",
          offsetMinutes: typeof item.offsetMinutes === "number" ? item.offsetMinutes : null,
        };
      });
    });
}

function offsetLabel(value: number | null): string {
  if (value === null) return "未知";
  if (value === 0) return "准点";
  return value > 0 ? `+${value} 分` : `${value} 分`;
}

function yesNo(value: unknown): string {
  return value ? "是" : "否";
}

function enabledLabel(value: unknown): string {
  return value ? "启用" : "关闭";
}

function percentLabel(value: unknown): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "未知";
}

function displayLabel(value: unknown, labels?: Record<string, string>): string {
  if (typeof value !== "string" || !value) return "未知";
  return labels?.[value] || value;
}

function outputModeLabel(value: unknown): string {
  return displayLabel(value, OUTPUT_MODE_LABELS);
}

function memoryModeLabel(value: unknown): string {
  return displayLabel(value, MEMORY_MODE_LABELS);
}

function replyLengthLabel(value: unknown): string {
  return displayLabel(value, REPLY_LENGTH_LABELS);
}

function replyStrategyLabel(value: unknown): string {
  if (typeof value !== "string") return displayLabel(value);
  return REPLY_LENGTH_LABELS[value] || value;
}

function voiceModeLabel(value: unknown): string {
  return displayLabel(value, VOICE_MODE_LABELS);
}

function ttsProviderLabel(value: unknown): string {
  return displayLabel(value, TTS_PROVIDER_LABELS);
}

function llmPurposeLabel(value: unknown): string {
  return displayLabel(value, LLM_PURPOSE_LABELS);
}

function diagnosticsTone(value: unknown): "neutral" | "good" | "warn" | "info" | "danger" {
  if (value === "qq") return "info";
  if (value === "wechat") return "good";
  if (value === "web") return "neutral";
  if (value === "proactive") return "warn";
  return "neutral";
}

export default function PersonaStatePanel({ personaId, onClose }: PersonaStatePanelProps) {
  const { data: runtime, isLoading, refetch, isFetching } = trpc.persona.getRuntimeState.useQuery(
    { id: personaId },
    { refetchOnWindowFocus: false },
  );

  const diag = runtime?.runtimeDiagnostics as any;
  const turnPlan = diag?.turnPlan;
  const reflection = diag?.reflection;
  const voiceRequestDecision = diag?.voiceRequestDecision;
  const photo = diag?.photo as { gate?: string; mark?: { includeFace: boolean; atHome: boolean; scene: string } | null; explicit?: { kind: string } | null } | undefined;
  const diagnosticPlatform = diag?.platform;
  const diagnosticChannel = diag?.channel;
  const diagnosticMode = diag?.mode;
  const diagnosticTrigger = diag?.trigger;
  const delivery = diag?.delivery;
  const llmUsage = (runtime as any)?.llmUsage;
  const outputStrategy = (runtime as any)?.outputStrategy;
  const voiceStrategy = outputStrategy?.voice;
  const stickerStrategy = outputStrategy?.stickers;
  const proactiveStrategy = outputStrategy?.proactiveMessages;
  const platformRuntime = outputStrategy?.platformRuntime;
  const personaRuntime = (runtime as any)?.personaRuntime || {};
  const proactiveRuntime = personaRuntime?.proactiveMessages || {};
  const runtimeDataKeys = (((runtime as any)?.personaDataKeys || []) as string[]);
  const runtimeStorageLabel = runtimeDataKeys.includes("personaRuntime") ? "personaRuntime" : "legacy-compatible";

  const sourceChunkCount = useMemo(() => {
    const sourceLibrary = runtime?.sourceLibrary as any;
    return sourceLibrary?.chunkCount ?? sourceLibrary?.chunks ?? 0;
  }, [runtime?.sourceLibrary]);

  const randomizedSlots = useMemo(
    () => flattenRandomizedSchedule(proactiveRuntime?.randomizedSchedule),
    [proactiveRuntime?.randomizedSchedule],
  );
  const lastSentEntries = useMemo(
    () => recordEntries(proactiveRuntime?.lastSent).sort(([a], [b]) => a.localeCompare(b)),
    [proactiveRuntime?.lastSent],
  );
  const ambientPresence = proactiveRuntime?.ambientPresence;
  const ambientCountEntries = useMemo(
    () => recordEntries(ambientPresence?.counts),
    [ambientPresence?.counts],
  );
  const ambientTargetEntries = useMemo(
    () => recordEntries(ambientPresence?.targets),
    [ambientPresence?.targets],
  );
  const hasProactiveRuntime = randomizedSlots.length > 0 || lastSentEntries.length > 0 || isRecord(ambientPresence);

  const runtimeState = runtime?.runtimeLifeState as any;
  const currentIntent = intentLabel(turnPlan?.intent || reflection?.intent);
  const currentState = turnPlan?.immersiveMode
    ? "scene_awake"
    : runtimeState?.status === "drowsy_awake"
      ? "drowsy_awake"
      : runtime?.scheduleState?.stateId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <aside className="relative flex h-full max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl animate-modal-pop z-10" onClick={e => e.stopPropagation()}>
        {/* Header (Aligned with MemoryTimeline & SourceLibrary standards) */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border/60 bg-card shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">角色运行诊断</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 shadow-2xs">
                  正常运行中
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {runtime?.name || "当前角色"} · planner / reflection / memory / source / LLM usage
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-muted/60 hover:bg-muted text-foreground border border-border/70 rounded-xl transition-all shadow-2xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 panel-scrollbar ">
          {isLoading ? (
            <div className="flex h-full min-h-[420px] items-center justify-center">
              <div className="rounded-xl border border-border bg-card px-6 py-5 text-center shadow-sm">
                <Cpu className="mx-auto h-8 w-8 animate-spin text-primary/60" />
                <p className="mt-3 text-sm font-medium text-foreground">正在读取运行状态</p>
                <p className="mt-1 text-xs text-muted-foreground">这不会触发新的角色回复</p>
              </div>
            </div>
          ) : !runtime ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              没有拿到运行状态，请刷新后重试。
            </div>
          ) : (
            <div className="space-y-5">
              {/* 总览仪表盘 */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                  icon={Calendar}
                  label="生活状态"
                  value={stateLabel(currentState)}
                  note={`${runtime.scheduleState?.start || "?"} - ${runtime.scheduleState?.end || "?"}`}
                  color="indigo"
                />
                <MetricCard
                  icon={Route}
                  label="本轮意图"
                  value={currentIntent}
                  note={turnPlan?.replyLength ? `回复长度：${replyLengthLabel(turnPlan.replyLength)}` : "等待下一轮消息"}
                  color="amber"
                />
                <MetricCard
                  icon={Database}
                  label="有效记忆"
                  value={runtime.memoryStats?.active ?? 0}
                  note={`高重要 ${runtime.memoryStats?.highImportance ?? 0} · 低可信 ${runtime.memoryStats?.lowConfidence ?? 0}`}
                  color="emerald"
                />
                <MetricCard
                  icon={Gauge}
                  label="今日 LLM"
                  value={formatNumber(llmUsage?.today?.totalTokens)}
                  note={`${llmUsage?.today?.calls ?? 0} 次调用 · 均 ${formatDuration(llmUsage?.today?.averageDurationMs)}`}
                  color="primary"
                />
              </div>

              {diag && (
                <div className="rounded-xl border border-border bg-card px-3.5 py-3 text-xs shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 font-bold text-foreground">
                      <Route className="h-3.5 w-3.5 text-primary" />
                      最近运行事件
                    </span>
                    <Chip tone={diagnosticsTone(diagnosticPlatform)}>
                      平台 {displayLabel(diagnosticPlatform, PLATFORM_LABELS)}
                    </Chip>
                    <Chip tone={diagnosticsTone(diagnosticChannel)}>
                      通道 {displayLabel(diagnosticChannel, PLATFORM_LABELS)}
                    </Chip>
                    <Chip tone={diagnosticsTone(diagnosticMode)}>
                      {displayLabel(diagnosticMode, MODE_LABELS)}
                    </Chip>
                    {diagnosticTrigger && (
                      <Chip tone="warn">
                        {displayLabel(diagnosticTrigger, TRIGGER_LABELS)}
                      </Chip>
                    )}
                    {turnPlan?.outputMode && <Chip>输出 {outputModeLabel(turnPlan.outputMode)}</Chip>}
                    {photo && (
                      <Chip tone={photo.gate === "allow" ? "good" : "neutral"}>
                        拍照门控 {photo.gate === "allow" ? "允许" : photo.gate}
                        {photo.mark ? ` · LLM已出图(${photo.mark.includeFace ? "带人" : "无人"}/${photo.mark.atHome ? "在家" : "在外"})` : ""}
                      </Chip>
                    )}
                    {delivery && (
                      <Chip tone={delivery.sent ? "good" : "danger"}>
                        投递 {delivery.sent ? "成功" : delivery.reason || "失败"} · {displayLabel(delivery.channel, PLATFORM_LABELS)}
                      </Chip>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <p className="min-w-0 truncate text-muted-foreground">
                      输入：<span className="text-foreground">{diag.inputPreview || "暂无"}</span>
                    </p>
                    <p className="min-w-0 truncate text-muted-foreground">
                      回复：<span className="text-foreground">{diag.replyPreview || "暂无"}</span>
                    </p>
                  </div>
                </div>
              )}

              {/* 1. 规划与反思诊断 */}
              <CollapsibleCard
                title="规划与反思诊断 (Planner & Reflection)"
                icon={Brain}
                defaultOpen={true}
                aside={diag?.lastTurnAt ? <Chip>{formatTime(diag.lastTurnAt)}</Chip> : <Chip>暂无回合</Chip>}
              >
                {/* 隐藏反思(Inner Reflection) & 回复策略 */}
                {reflection && (
                  <div className="space-y-3.5 pb-4 border-b border-border/30">
                    {reflection.innerReaction && (
                      <div className="rounded-xl border border-violet-500/10 bg-gradient-to-r from-violet-500/5 via-fuchsia-500/5 to-transparent p-3.5 space-y-1.5 backdrop-blur-xs">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                          </span>
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          隐藏反思 (Reflection)
                        </div>
                        <p className="text-xs text-foreground/85 leading-relaxed font-sans pl-5">
                          {reflection.innerReaction}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs py-1 px-1 border-b border-dashed border-border/60">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">反思意图:</span>
                        <span className="font-semibold text-foreground">{intentLabel(reflection.intent)}</span>
                      </div>
                      <div className="h-4 w-px bg-border/60 self-center hidden sm:block" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">记忆检索:</span>
                        <Chip tone={reflection.shouldRecallMemory ? "good" : "neutral"}>
                          {reflection.shouldRecallMemory ? "需要" : "跳过"}
                        </Chip>
                      </div>
                      <div className="h-4 w-px bg-border/60 self-center hidden sm:block" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">记忆沉淀:</span>
                        <Chip tone={reflection.shouldRecordMemory ? "good" : "neutral"}>
                          {reflection.shouldRecordMemory ? "写入" : "跳过"}
                        </Chip>
                      </div>
                    </div>

                    {reflection.replyStrategy && (
                      <div className="rounded-xl border border-amber-500/15 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-transparent p-3.5 space-y-1.5 backdrop-blur-xs">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 dark:text-primary tracking-wide uppercase">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </span>
                          <Route className="h-3.5 w-3.5 text-amber-500" />
                          回复策略 (Strategy)
                        </div>
                        <p className="text-xs text-foreground/85 leading-relaxed font-sans pl-5">{replyStrategyLabel(reflection.replyStrategy)}</p>
                      </div>
                    )}
                    {reflection.memoryQueries?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">记忆检索词:</span>
                        {reflection.memoryQueries.map((query: string) => (
                          <Chip key={query} tone="info">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 mr-1.5" />
                            {query}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 回合判断(Diag) */}
                {diag ? (
                  <div className="space-y-4 pt-1">
                    <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border/30">
                      <Chip tone={diagnosticsTone(diagnosticPlatform)}>
                        平台: {displayLabel(diagnosticPlatform, PLATFORM_LABELS)}
                      </Chip>
                      <Chip tone={diagnosticsTone(diagnosticChannel)}>
                        通道: {displayLabel(diagnosticChannel, PLATFORM_LABELS)}
                      </Chip>
                      <Chip tone={diagnosticsTone(diagnosticMode)}>
                        模式: {displayLabel(diagnosticMode, MODE_LABELS)}
                      </Chip>
                      {diagnosticTrigger && (
                        <Chip tone="warn">
                          触发: {displayLabel(diagnosticTrigger, TRIGGER_LABELS)}
                        </Chip>
                      )}
                      <Chip tone={diag.memoryRecallUsed ? "good" : "neutral"}>
                        记忆召回: {diag.memoryRecallUsed ? "ON" : "OFF"}
                      </Chip>
                      <Chip tone={diag.sourceRecallUsed ? "good" : "neutral"}>
                        原著召回: {diag.sourceRecallUsed ? "ON" : "OFF"}
                      </Chip>
                      {diag.visionUsed !== undefined && (
                        <Chip tone={diag.visionUsed ? "good" : "neutral"}>
                          视觉识别: {diag.visionUsed ? "ON" : "OFF"}
                        </Chip>
                      )}
                      {turnPlan?.memoryMode && <Chip>记忆模式: {memoryModeLabel(turnPlan.memoryMode)}</Chip>}
                      {turnPlan?.currentActivity && <Chip>当前活动: {turnPlan.currentActivity}</Chip>}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/5 px-3.5 py-3 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-muted-foreground">
                          <Route className="h-3.5 w-3.5 text-primary/80" />
                          Runtime 路由
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="平台" value={displayLabel(diagnosticPlatform, PLATFORM_LABELS)} />
                          <KeyValue label="消息通道" value={displayLabel(diagnosticChannel, PLATFORM_LABELS)} />
                          <KeyValue label="运行模式" value={displayLabel(diagnosticMode, MODE_LABELS)} />
                          {diagnosticTrigger && <KeyValue label="触发来源" value={displayLabel(diagnosticTrigger, TRIGGER_LABELS)} />}
                          {turnPlan?.outputMode && <KeyValue label="输出倾向" value={outputModeLabel(turnPlan.outputMode)} />}
                          {diag.mediaKind && <KeyValue label="媒体类型" value={<span className="font-mono">{diag.mediaKind}</span>} />}
                          {diag.mediaUrl && <KeyValue label="媒体地址" value={<span className="break-all font-mono text-[11px]">{diag.mediaUrl}</span>} />}
                        </div>
                      </div>

                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/5 px-3.5 py-3 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-muted-foreground">
                          <Radio className="h-3.5 w-3.5 text-primary/80" />
                          投递与触发
                        </div>
                        <div className="space-y-2">
                          {delivery ? (
                            <>
                              <KeyValue label="投递结果" value={<Chip tone={delivery.sent ? "good" : "danger"}>{delivery.sent ? "成功" : delivery.reason || "失败"}</Chip>} />
                              <KeyValue label="投递平台" value={displayLabel(delivery.platform, PLATFORM_LABELS)} />
                              <KeyValue label="投递通道" value={displayLabel(delivery.channel, PLATFORM_LABELS)} />
                            </>
                          ) : (
                            <KeyValue label="投递结果" value="非主动投递或暂无记录" />
                          )}
                          {isRecord(diag.scheduledSlot) && (
                            <KeyValue
                              label="定时槽位"
                              value={
                                <span className="font-mono text-[11px]">
                                  {diag.scheduledSlot.baseTime || "?"} -&gt; {diag.scheduledSlot.actualTime || "?"}
                                  {" · "}
                                  {diag.scheduledSlot.actualDate || diag.scheduledSlot.baseDate || "未知日期"}
                                </span>
                              }
                            />
                          )}
                          {diag.eventText && <KeyValue label="环境事件" value={diag.eventText} />}
                          {diag.period && <KeyValue label="时段" value={<span className="font-mono">{diag.period}</span>} />}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-2xl bg-muted/10 p-4 border border-border/60 text-xs shadow-inner">
                      {/* 用户输入 (User Input Bubble) */}
                      <div className="flex flex-col items-end gap-1.5 max-w-[90%] ml-auto">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                          <span>用户 (User)</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/80" />
                        </div>
                        <div className="rounded-[18px] rounded-tr-[3px] bg-primary/5 dark:bg-primary/10 border border-primary/15 dark:border-primary/25 text-foreground px-4 py-2.5 leading-relaxed text-left break-words w-full font-sans">
                          {diag.inputPreview || "暂无输入"}
                        </div>
                      </div>

                      {/* 角色回复 (Bot Response Bubble) */}
                      <div className="flex flex-col items-start gap-1.5 max-w-[90%] mr-auto">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80" />
                          <span>角色 (Bot)</span>
                        </div>
                        <div className="rounded-[18px] rounded-tl-[3px] bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/15 dark:border-amber-500/25 text-foreground px-4 py-2.5 leading-relaxed text-left break-words w-full font-sans">
                          {diag.replyPreview || "暂无回复"}
                        </div>
                      </div>
                    </div>

                    {turnPlan?.risks?.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          对话风险控制 (Safety & Risk)
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {turnPlan.risks.map((risk: string) => <Chip key={risk} tone="warn">{risk}</Chip>)}
                        </div>
                      </div>
                    )}

                    {voiceRequestDecision && (
                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/5 px-3.5 py-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-semibold text-muted-foreground">
                            <Mic2 className="h-3.5 w-3.5 text-primary/80" />
                            语音请求判定
                          </div>
                          <Chip tone={voiceRequestDecision.explicitVoiceRequest ? "good" : "neutral"}>
                            {voiceRequestDecision.explicitVoiceRequest ? "用户明确要语音" : "未明确要求语音"}
                          </Chip>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <KeyValue label="置信度" value={<span className="font-mono">{percentLabel(voiceRequestDecision.confidence)}</span>} />
                          <KeyValue label="判定原因" value={voiceRequestDecision.reason || "暂无"} />
                        </div>
                      </div>
                    )}

                    {photo && (
                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/5 px-3.5 py-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-semibold text-muted-foreground">
                            <ImageIcon className="h-3.5 w-3.5 text-primary/80" />
                            拍照判定 (Photo Decision)
                          </div>
                          <Chip tone={photo.gate === "allow" ? "good" : "neutral"}>
                            {photo.gate === "allow" ? "本轮允许拍" : "本轮不主动拍"}
                          </Chip>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <KeyValue label="门控" value={
                            photo.gate === "allow" ? "允许（可自然拍）"
                              : photo.gate === "off(asleep)" ? "关闭（睡眠静默）"
                                : photo.gate === "off(cooldown)" ? "关闭（冷却中）"
                                  : photo.gate === "off(recall)" ? "关闭（原著考据轮）"
                                    : (photo.gate || "未知")
                          } />
                          <KeyValue label="LLM 标记" value={photo.mark ? `已出图（${photo.mark.includeFace ? "带人" : "无人"} / ${photo.mark.atHome ? "在家" : "在外"}）` : "本轮未出标记"} />
                          <KeyValue label="明确指令" value={photo.explicit ? `命中 · ${photo.explicit.kind === "environment" ? "拍环境/家" : "自拍"}（必发·破门控）` : "无"} />
                        </div>
                        {photo.mark?.scene ? <KeyValue label="画面" value={photo.mark.scene} /> : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground leading-normal py-2">还没有最近一轮诊断。发送消息后，这里将实时更新 Planner 和隐藏反思结果。</p>
                )}
              </CollapsibleCard>

              {/* 2. 生活行程 */}
              <CollapsibleCard
                title="生活行程 (Schedule & Status)"
                icon={Clock}
                defaultOpen={false}
              >
                <div className="space-y-4">
                  <div className="divide-y divide-border/50 border border-border/80 rounded-xl overflow-hidden bg-muted/5 text-xs">
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">当前时段</span>
                      <div className="flex items-center gap-2">
                        <Chip tone="info">{stateLabel(currentState)}</Chip>
                        <span className="text-muted-foreground font-mono text-[11px]">({runtime.scheduleState?.start || "?"} - {runtime.scheduleState?.end || "?"})</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">日期类型</span>
                      <span className="font-semibold text-foreground">{runtime.scheduleState?.dayKind || "未知"}</span>
                    </div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">可回复性</span>
                      <div>
                        <Chip tone={runtime.scheduleState?.availability === "open" ? "good" : "warn"}>
                          {availabilityLabel(runtime.scheduleState?.availability)}
                        </Chip>
                      </div>
                    </div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">行为策略</span>
                      <span className="text-foreground/85">{runtime.scheduleState?.behavior || "暂无"}</span>
                    </div>
                    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3.5 hover:bg-muted/10 transition-colors">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">状态说明</span>
                      <p className="text-foreground/80 leading-relaxed font-sans">{runtime.scheduleState?.description || "暂无"}</p>
                    </div>
                  </div>

                  {runtimeState?.status && (
                    <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 backdrop-blur-md">
                      <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-full blur-xl -mr-6 -mt-6" />
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-primary">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        <Timer className="h-3.5 w-3.5 text-amber-500" />
                        临时状态：{stateLabel(runtimeState.status)}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground font-medium pl-5">
                        预计结束时间：{formatTime(runtimeState.until)}
                      </p>
                    </div>
                  )}

                  <div className="rounded-xl border border-border/80 bg-muted/5 p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                      <div className="flex items-center gap-2 font-bold text-foreground">
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        运行态容器
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip tone={runtimeStorageLabel === "personaRuntime" ? "good" : "warn"}>
                          {runtimeStorageLabel}
                        </Chip>
                        <Chip tone={runtimeState?.status ? "warn" : "neutral"}>
                          生活临时态：{runtimeState?.status || "无"}
                        </Chip>
                        <Chip tone={diag ? "info" : "neutral"}>
                          回合诊断：{diag ? "已记录" : "暂无"}
                        </Chip>
                      </div>
                    </div>

                    <div className="mt-3 space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                            <MessageSquare className="h-3.5 w-3.5 text-primary/80" />
                            主动消息随机计划
                          </h4>
                          {isRecord(proactiveRuntime?.randomizedSchedule) && (
                            <Chip tone="info">
                              窗口：±{proactiveRuntime.randomizedSchedule.windowMinutes ?? "?"} 分
                            </Chip>
                          )}
                        </div>

                        {randomizedSlots.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-border/70 bg-background/40">
                            <div className="min-w-[34rem] divide-y divide-border/45">
                              <div className="grid grid-cols-[7rem_7rem_8rem_5rem_minmax(0,1fr)] gap-2 bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                <span>日期</span>
                                <span>原始时间</span>
                                <span>实际触发</span>
                                <span>偏移</span>
                                <span>状态</span>
                              </div>
                              {randomizedSlots.slice(0, 8).map((slot) => {
                                const sentDate = lastSentEntries.find(([baseTime]) => baseTime === slot.baseTime)?.[1];
                                const sent = sentDate === slot.date;
                                return (
                                  <div key={`${slot.date}-${slot.baseTime}`} className="grid grid-cols-[7rem_7rem_8rem_5rem_minmax(0,1fr)] gap-2 px-3 py-2 text-[11px]">
                                    <span className="font-mono text-muted-foreground">{slot.date}</span>
                                    <span className="font-mono text-foreground">{slot.baseTime}</span>
                                    <span className="font-mono text-foreground">{slot.actualDate || "?"} {slot.actualTime || "?"}</span>
                                    <span className="font-mono text-muted-foreground">{offsetLabel(slot.offsetMinutes)}</span>
                                    <span className={sent ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                                      {sent ? "已发送" : "待触发或已错过窗口"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-muted-foreground">
                            暂无随机化计划。主动消息未启用、未设置时间，或 scheduler 尚未生成今日计划。
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            已发送槽位
                          </h4>
                          {lastSentEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {lastSentEntries.map(([time, date]) => (
                                <Chip key={time} tone="good">{time} · {String(date)}</Chip>
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-muted-foreground">今天还没有记录已发送的固定槽位。</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                            <Activity className="h-3.5 w-3.5 text-sky-500" />
                            Ambient 存在感
                          </h4>
                          {isRecord(ambientPresence) ? (
                            <div className="space-y-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
                              <KeyValue label="日期" value={<span className="font-mono">{ambientPresence.date || "未知"}</span>} />
                              <KeyValue label="最近发送" value={<span className="font-mono">{formatTime(ambientPresence.lastSentAt)}</span>} />
                              <KeyValue
                                label="已发计数"
                                value={ambientCountEntries.length > 0 ? (
                                  <span className="flex flex-wrap gap-1.5">
                                    {ambientCountEntries.map(([period, count]) => <Chip key={period}>{period}: {String(count)}</Chip>)}
                                  </span>
                                ) : "暂无"}
                              />
                              <KeyValue
                                label="今日目标"
                                value={ambientTargetEntries.length > 0 ? (
                                  <span className="flex flex-wrap gap-1.5">
                                    {ambientTargetEntries.map(([period, target]) => <Chip key={period} tone="info">{period}: {String(target)}</Chip>)}
                                  </span>
                                ) : "暂无"}
                              />
                            </div>
                          ) : (
                            <p className="rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-muted-foreground">暂无 ambient 运行态。</p>
                          )}
                        </div>
                      </div>

                      {!hasProactiveRuntime && (
                        <TextBlock>
                          当前没有主动消息运行态。若主动消息已开启，等待 scheduler tick 后会出现随机计划、已发送槽位或 ambient 统计。
                        </TextBlock>
                      )}
                    </div>
                  </div>
                </div>
              </CollapsibleCard>

              {/* 3. 平台输出策略 */}
              {outputStrategy && (
                <CollapsibleCard
                  title="平台输出策略 (Output Strategy)"
                  icon={Radio}
                  defaultOpen={false}
                  aside={<Chip tone={outputStrategy.qq?.enabled ? "good" : "warn"}>QQ {enabledLabel(outputStrategy.qq?.enabled)}</Chip>}
                >
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-border/75 bg-muted/5 p-3.5 text-xs">
                        <div className="mb-2 flex items-center gap-1.5 font-bold text-foreground">
                          <MessageSquare className="h-3.5 w-3.5 text-primary/80" />
                          QQ 接入
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="OneBot" value={<span className="break-all font-mono text-[11px]">{outputStrategy.qq?.onebotBaseUrl || "未配置"}</span>} />
                          <KeyValue label="群聊" value={enabledLabel(outputStrategy.qq?.allowGroups)} />
                          <KeyValue label="自动绑定" value={enabledLabel(outputStrategy.qq?.autoBindSingleReadyPersona)} />
                          <KeyValue
                            label="密钥"
                            value={
                              <span className="flex flex-wrap gap-1.5">
                                <Chip tone={outputStrategy.qq?.accessTokenConfigured ? "good" : "neutral"}>token {yesNo(outputStrategy.qq?.accessTokenConfigured)}</Chip>
                                <Chip tone={outputStrategy.qq?.webhookSecretConfigured ? "good" : "neutral"}>webhook {yesNo(outputStrategy.qq?.webhookSecretConfigured)}</Chip>
                              </span>
                            }
                          />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/75 bg-muted/5 p-3.5 text-xs">
                        <div className="mb-2 flex items-center gap-1.5 font-bold text-foreground">
                          <Mic2 className="h-3.5 w-3.5 text-primary/80" />
                          语音策略
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="回复模式" value={<Chip tone={voiceStrategy?.policy?.enabled ? "good" : "neutral"}>{voiceModeLabel(voiceStrategy?.policy?.mode)}</Chip>} />
                          <KeyValue label="触发概率" value={<span className="font-mono">{percentLabel(voiceStrategy?.policy?.probability)}</span>} />
                          <KeyValue label="冷却" value={<span className="font-mono">{voiceStrategy?.policy?.cooldownSeconds ?? "?"} s</span>} />
                          <KeyValue label="文本上限" value={<span className="font-mono">{voiceStrategy?.policy?.maxTextLength ?? "?"} 字</span>} />
                          <KeyValue label="ASR" value={`${voiceStrategy?.asr?.provider || "未知"} / ${voiceStrategy?.asr?.model || "未知"}`} />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/75 bg-muted/5 p-3.5 text-xs">
                        <div className="mb-2 flex items-center gap-1.5 font-bold text-foreground">
                          <ImageIcon className="h-3.5 w-3.5 text-primary/80" />
                          表情包策略
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="状态" value={<Chip tone={stickerStrategy?.policy?.enabled ? "good" : "neutral"}>{enabledLabel(stickerStrategy?.policy?.enabled)}</Chip>} />
                          <KeyValue label="触发概率" value={<span className="font-mono">{percentLabel(stickerStrategy?.policy?.probability)}</span>} />
                          <KeyValue label="冷却" value={<span className="font-mono">{stickerStrategy?.policy?.cooldownSeconds ?? "?"} s</span>} />
                          <KeyValue label="可用数量" value={<span className="font-mono">{stickerStrategy?.enabled ?? 0} / {stickerStrategy?.total ?? 0}</span>} />
                          <KeyValue
                            label="类型"
                            value={
                              recordEntries(stickerStrategy?.enabledByType).length > 0 ? (
                                <span className="flex flex-wrap gap-1.5">
                                  {recordEntries(stickerStrategy?.enabledByType).map(([type, count]) => (
                                    <Chip key={type}>{type}: {String(count)}</Chip>
                                  ))}
                                </span>
                              ) : "暂无"
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2 rounded-xl border border-border/75 bg-muted/5 p-3.5 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-foreground">
                          <Bell className="h-3.5 w-3.5 text-primary/80" />
                          主动消息配置
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="状态" value={<Chip tone={proactiveStrategy?.enabled ? "good" : "neutral"}>{enabledLabel(proactiveStrategy?.enabled)}</Chip>} />
                          <KeyValue label="固定槽位" value={<span className="font-mono">{proactiveStrategy?.configuredSlotCount ?? 0} 个</span>} />
                          <KeyValue
                            label="时间"
                            value={proactiveStrategy?.times?.length ? (
                              <span className="flex flex-wrap gap-1.5">
                                {proactiveStrategy.times.map((time: string) => <Chip key={time}>{time}</Chip>)}
                              </span>
                            ) : "未设置"}
                          />
                          <KeyValue label="风格提示" value={proactiveStrategy?.stylePromptConfigured ? proactiveStrategy.stylePromptPreview : "未设置"} />
                        </div>
                      </div>

                      <div className="space-y-2 rounded-xl border border-border/75 bg-muted/5 p-3.5 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-foreground">
                          <Layers className="h-3.5 w-3.5 text-primary/80" />
                          Runtime 输出能力
                        </div>
                        <div className="space-y-2">
                          <KeyValue label="网页" value={<Chip tone="good">文本入口启用</Chip>} />
                          <KeyValue
                            label="QQ"
                            value={
                              <span className="flex flex-wrap gap-1.5">
                                <Chip tone={platformRuntime?.qq?.text ? "good" : "neutral"}>文本 {enabledLabel(platformRuntime?.qq?.text)}</Chip>
                                <Chip tone={platformRuntime?.qq?.voiceInput ? "good" : "neutral"}>语音输入 {enabledLabel(platformRuntime?.qq?.voiceInput)}</Chip>
                                <Chip tone={platformRuntime?.qq?.voiceOutput ? "good" : "neutral"}>语音输出 {enabledLabel(platformRuntime?.qq?.voiceOutput)}</Chip>
                                <Chip tone={platformRuntime?.qq?.stickers ? "good" : "neutral"}>表情 {enabledLabel(platformRuntime?.qq?.stickers)}</Chip>
                              </span>
                            }
                          />
                          <KeyValue label="TTS" value={`${ttsProviderLabel(voiceStrategy?.tts?.provider)} / 降级 ${ttsProviderLabel(voiceStrategy?.tts?.fallbackProvider)}`} />
                        </div>
                      </div>
                    </div>
                  </div>
                </CollapsibleCard>
              )}

              {/* 4. 记忆状态与 LLM 统计 */}
              <CollapsibleCard
                title="记忆状态与 LLM 统计 (Memory & LLM Stats)"
                icon={Database}
                defaultOpen={false}
                aside={<Chip tone="info">原著库块：{formatNumber(sourceChunkCount)}</Chip>}
              >
                <div className="space-y-5">
                  {/* 长期记忆与召回 */}
                  <div className="border-b border-border/30 pb-4.5">
                    <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-primary/80" /> 长期记忆召回 (Recently Recalled Memories)
                    </h4>
                    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
                      {/* 扁平化指标栏，拒绝卡片嵌套 */}
                      <div className="grid grid-cols-2 gap-2.5 self-start">
                        <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-muted/5 p-3 hover:bg-muted/10 transition-colors">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase">活跃记忆</span>
                          <span className="mt-1 text-base font-extrabold text-foreground font-mono">{runtime.memoryStats?.active ?? 0}</span>
                        </div>
                        <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-muted/5 p-3 hover:bg-muted/10 transition-colors">
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">高重要度</span>
                          <span className="mt-1 text-base font-extrabold text-foreground font-mono">{runtime.memoryStats?.highImportance ?? 0}</span>
                        </div>
                        <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-muted/5 p-3 hover:bg-muted/10 transition-colors">
                          <span className="text-[10px] font-bold text-amber-600 dark:text-primary uppercase">低可信度</span>
                          <span className="mt-1 text-base font-extrabold text-foreground font-mono">{runtime.memoryStats?.lowConfidence ?? 0}</span>
                        </div>
                        <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-muted/5 p-3 hover:bg-muted/10 transition-colors">
                          <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">近期读取</span>
                          <span className="mt-1 text-base font-extrabold text-foreground font-mono">{runtime.memoryStats?.recentlyAccessed ?? 0}</span>
                        </div>
                      </div>

                      {/* 召回列表 */}
                      <div className="min-w-0">
                        {runtime.recentlyAccessedMemories?.length ? (
                          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                            {runtime.recentlyAccessedMemories.slice(0, 5).map((memory: any) => (
                              <div key={memory.id} className="group relative pl-3.5 border-l border-primary/20 py-2 hover:bg-muted/10 transition-colors border-b border-dashed border-border/40 last:border-0">
                                <div className="absolute left-0 top-[14px] -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-primary/60 transition-transform group-hover:scale-125" />
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">{memory.title}</span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/8 text-amber-600 dark:text-primary font-medium border border-amber-500/15 scale-95 origin-left">重要 {memory.importance || 3}</span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/8 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/15 scale-95 origin-left">可信 {memory.confidence || 3}</span>
                                </div>
                                {memory.description && (
                                  <p className="text-[11px] mt-1.5 leading-relaxed text-muted-foreground/90 font-sans">{memory.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-border/60 bg-muted/5 py-4 text-center">
                            <p className="text-xs text-muted-foreground leading-normal">最近无长期记忆被召回</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* LLM 用量 & 路由 */}
                  {llmUsage && (
                    <div className="border-b border-border/30 pb-4.5 space-y-4">
                      <h4 className="text-xs font-bold text-foreground flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-primary/80" /> LLM 用量与耗时 (LLM Usage)
                        </span>
                        <Chip tone={llmUsage.today?.failedCalls ? "warn" : "good"}>
                          今日失败：{llmUsage.today?.failedCalls ?? 0}
                        </Chip>
                      </h4>

                      {/* 扁平化指标仪表栏，拒绝卡片嵌套 */}
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 bg-muted/10 border border-border/50 rounded-xl p-4">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">今日调用</span>
                          <span className="mt-1 text-xl font-extrabold text-foreground font-mono">{llmUsage.today?.calls ?? 0} <span className="text-xs font-semibold text-muted-foreground">次</span></span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">估算输入</span>
                          <span className="mt-1 text-xl font-extrabold text-foreground font-mono">{formatNumber(llmUsage.today?.inputTokens)} <span className="text-xs font-semibold text-muted-foreground">Tks</span></span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">估算输出</span>
                          <span className="mt-1 text-xl font-extrabold text-foreground font-mono">{formatNumber(llmUsage.today?.outputTokens)} <span className="text-xs font-semibold text-muted-foreground">Tks</span></span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">平均耗时</span>
                          <span className="mt-1 text-xl font-extrabold text-foreground font-mono">{formatDuration(llmUsage.today?.averageDurationMs)}</span>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2 pt-2">
                        {/* 按服务商统计 */}
                        <div className="space-y-3.5">
                          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">按服务商统计 (By Provider)</div>
                          <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/5 divide-y divide-border/50">
                            <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 bg-muted/40 px-3.5 py-2 text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
                              <span>服务商</span>
                              <span className="text-right">调用次数</span>
                              <span className="text-right">Token 占比</span>
                            </div>
                            {(llmUsage.byProvider || []).slice(0, 5).map((row: any) => {
                              const pct = Math.min(100, Math.max(0, Math.round((row.totalTokens / (llmUsage.today?.totalTokens || 1)) * 100)));
                              return (
                                <div key={row.provider} className="group flex flex-col gap-1.5 px-3.5 py-2.5 hover:bg-muted/15 transition-colors">
                                  <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 text-xs items-center">
                                    <span className="truncate text-foreground font-mono text-[11px] font-bold group-hover:text-primary transition-colors">{row.provider}</span>
                                    <span className="text-right text-muted-foreground font-medium">{row.calls} 次</span>
                                    <span className="text-right text-foreground font-mono font-semibold">{formatNumber(row.totalTokens)}</span>
                                  </div>
                                  <div className="w-full bg-muted/65 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-primary h-1.5 rounded-full transition-all duration-500 group-hover:bg-primary/95" style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                            {(!llmUsage.byProvider || llmUsage.byProvider.length === 0) && (
                              <div className="px-3.5 py-4 text-xs text-muted-foreground text-center">暂无记录</div>
                            )}
                          </div>
                        </div>

                        {/* 按模型用途统计 */}
                        <div className="space-y-3.5">
                          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">按模型用途统计 (By Purpose)</div>
                          <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/5 divide-y divide-border/50">
                            <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 bg-muted/40 px-3.5 py-2 text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
                              <span>用途</span>
                              <span className="text-right">调用次数</span>
                              <span className="text-right">Token 占比</span>
                            </div>
                            {(llmUsage.byPurpose || []).slice(0, 5).map((row: any) => {
                              const pct = Math.min(100, Math.max(0, Math.round((row.totalTokens / (llmUsage.today?.totalTokens || 1)) * 100)));
                              return (
                                <div key={row.purpose} className="group flex flex-col gap-1.5 px-3.5 py-2.5 hover:bg-muted/15 transition-colors">
                                  <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 text-xs items-center">
                                    <span className="truncate text-foreground font-mono text-[11px] font-bold group-hover:text-indigo-500 transition-colors">{row.purpose}</span>
                                    <span className="text-right text-muted-foreground font-medium">{row.calls} 次</span>
                                    <span className="text-right text-foreground font-mono font-semibold">{formatNumber(row.totalTokens)}</span>
                                  </div>
                                  <div className="w-full bg-muted/65 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500 group-hover:bg-indigo-400" style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                            {(!llmUsage.byPurpose || llmUsage.byPurpose.length === 0) && (
                              <div className="px-3.5 py-4 text-xs text-muted-foreground text-center">暂无记录</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 最近调用链路 */}
                      {llmUsage.recent?.length > 0 && (
                        <div className="space-y-3 pt-2">
                          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">最近调用链路 (Recent Call Log)</div>
                          <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/5">
                            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem_4.5rem] gap-2 bg-muted/40 px-3.5 py-2 text-[10px] font-bold text-muted-foreground tracking-wide uppercase border-b border-border/50">
                              <span>时间</span>
                              <span>提供商 / 模型 / 用途</span>
                              <span className="text-right">Tokens</span>
                              <span className="text-right">状态</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
                              {llmUsage.recent.slice(0, 10).map((item: any) => (
                                <div key={item.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem_4.5rem] gap-2 px-3.5 py-2.5 text-xs items-center hover:bg-muted/10 transition-colors">
                                  <span className="text-muted-foreground font-mono text-[10.5px]">{formatTime(item.startedAt)}</span>
                                  <span className="min-w-0 truncate text-foreground/80 font-mono text-[11px] font-medium">
                                    {item.provider}{item.model ? ` · ${item.model}` : ""} · {llmPurposeLabel(item.purpose)}
                                  </span>
                                  <span className="text-right text-muted-foreground font-mono font-medium">{formatNumber(item.totalTokens)}</span>
                                  <span className="text-right">
                                    {item.success ? (
                                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold font-mono text-[10.5px]">
                                        <span className="relative flex h-1.5 w-1.5">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                        </span>
                                        OK
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold font-mono text-[10.5px]">
                                        <span className="relative flex h-1.5 w-1.5">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                                        </span>
                                        ERR
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 架构模块链路 */}
                  {runtime.architecture && (
                    <div className="space-y-3 pt-2">
                      <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-primary/70 animate-pulse" /> 模块架构链路 (System Architecture)
                      </h4>
                      <div className="overflow-hidden rounded-xl border border-border/80 bg-muted/5 divide-y divide-border/50">
                        {Object.entries(runtime.architecture).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2.5 text-xs items-center hover:bg-muted/10 transition-colors">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">{key}</span>
                            <span className="break-all font-mono text-[11.5px] leading-normal text-foreground/80 font-medium">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleCard>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
