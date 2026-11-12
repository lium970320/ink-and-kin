import { type ComponentType, useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  EASE_OUT_EXPO,
  MotionModal,
  SPRING_SILKY,
  SPRING_SNAPPY,
} from "@/components/ui/motion";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Feather,
  Heart,
  Loader2,
  MessageCircle,
  Moon,
  Quote,
  Snowflake,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const EMOTION_META: Record<
  string,
  { label: string; Icon: ComponentType<{ className?: string }>; badgeClass: string }
> = {
  warm: {
    label: "温柔",
    Icon: Heart,
    badgeClass: "bg-primary/10 text-primary border-primary/20",
  },
  playful: {
    label: "俏皮",
    Icon: Sparkles,
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  },
  nostalgic: {
    label: "思念",
    Icon: Moon,
    badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  },
  melancholy: {
    label: "忧郁",
    Icon: CloudRain,
    badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
  },
  happy: {
    label: "欢欣",
    Icon: Sun,
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  },
  distant: {
    label: "疏离",
    Icon: Snowflake,
    badgeClass: "bg-muted text-muted-foreground border-border/70",
  },
};

function formatMonth(year: number, month: number) {
  return `${year}年${month + 1}月`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function EmotionBadge({ state }: { state: string }) {
  const meta = EMOTION_META[state];
  if (!meta) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-border/70 bg-muted/60 text-muted-foreground">
        {state}
      </span>
    );
  }
  const { Icon, label, badgeClass } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${badgeClass}`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </span>
  );
}

function DiaryCard({
  entry,
  dateLabel,
  onRequestDelete,
}: {
  entry: any;
  dateLabel?: string | null;
  onRequestDelete: (entry: any) => void;
}) {
  const arcs: string[] = Array.isArray(entry.emotionalArc) ? entry.emotionalArc.map(String) : [];
  const highlights: string[] = Array.isArray(entry.highlights) ? entry.highlights.map(String) : [];
  const quotes: string[] = Array.isArray(entry.quotes) ? entry.quotes.map(String) : [];
  const displayDate = entry.date || dateLabel || "";

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={SPRING_SILKY}
      className="warm-card warm-card-static rounded-3xl border border-border/70 p-6 sm:p-7 relative overflow-hidden"
    >
      {/* 手账信笺顶栏装饰线 */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/35 via-primary/15 to-transparent"
      />

      {/* 信纸抬头：日期、对话计数与移除操作 */}
      <div className="flex items-center justify-between gap-3 pb-4 mb-5 border-b border-dashed border-border/70">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/[0.08] border border-primary/15 flex items-center justify-center shrink-0">
            <Feather className="w-3.5 h-3.5 text-primary" />
          </div>
          <div>
            {displayDate && (
              <p className="text-sm font-semibold font-mono tabular-nums tracking-wide text-foreground">
                {displayDate}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <MessageCircle className="w-3 h-3 text-primary/70" />
              <span>
                收录自当日 <span className="font-mono tabular-nums text-foreground/85">{entry.messageCount || 0}</span> 条对话记忆
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRequestDelete(entry)}
          title="移除此篇日记"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 日记正文 */}
      <div className="space-y-5">
        <p className="text-[15px] leading-[1.85] text-foreground/92 whitespace-pre-wrap">
          {entry.summary}
        </p>

        {arcs.length > 0 && (
          <div className="pt-1">
            <p className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground mb-2">
              情绪脉络
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {arcs.map((e, i) => (
                <EmotionBadge key={`${e}-${i}`} state={e} />
              ))}
            </div>
          </div>
        )}

        {highlights.length > 0 && (
          <div className="rounded-2xl bg-muted/30 border border-border/55 p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground/85 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>对话吉光</span>
            </p>
            <ul className="space-y-1.5">
              {highlights.map((h, i) => (
                <li key={i} className="text-sm text-foreground/80 leading-relaxed flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {quotes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground/85 flex items-center gap-1.5">
              <Quote className="w-3.5 h-3.5 text-primary" />
              <span>难忘片语</span>
            </p>
            <div className="space-y-2">
              {quotes.map((q, i) => (
                <blockquote
                  key={i}
                  className="text-sm italic text-foreground/80 leading-relaxed border-l-2 border-primary/40 pl-3.5 py-0.5"
                >
                  “{q}”
                </blockquote>
              ))}
            </div>
          </div>
        )}

        {entry.reflection && (
          <div className="pt-4 border-t border-dashed border-border/65">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">心绪回响</p>
            <p className="text-sm text-foreground/80 leading-relaxed">{entry.reflection}</p>
          </div>
        )}
      </div>
    </motion.article>
  );
}

export default function Diary() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const { isAuthenticated } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const queryPersonaId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("personaId")
      : null;
  const initialPersonaId = params.id
    ? parseInt(params.id, 10)
    : queryPersonaId
      ? parseInt(queryPersonaId, 10)
      : null;
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(
    initialPersonaId && !isNaN(initialPersonaId) ? initialPersonaId : null
  );

  const { data: personas } = trpc.persona.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (params.id) {
      const pid = parseInt(params.id, 10);
      if (!isNaN(pid) && pid !== selectedPersonaId) {
        setSelectedPersonaId(pid);
      }
    } else if (!selectedPersonaId && personas && personas.length > 0) {
      setSelectedPersonaId(personas[0].id);
    }
  }, [params.id, personas, selectedPersonaId]);

  const { data: diaryDates, refetch: refetchDates } = trpc.diary.getDates.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: missingDates, refetch: refetchMissingDates } = trpc.diary.getMissingDates.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: entries, refetch: refetchEntries } = trpc.diary.list.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: dayEntry } = trpc.diary.getByDate.useQuery(
    { personaId: selectedPersonaId || 0, date: selectedDate || "" },
    { enabled: isAuthenticated && !!selectedPersonaId && !!selectedDate }
  );

  const generateMutation = trpc.diary.generate.useMutation({
    onSuccess: () => {
      toast.success("日记生成成功");
      refetchDates();
      refetchEntries();
      refetchMissingDates();
    },
    onError: (e: any) => toast.error("生成失败：" + e.message),
  });

  const generateAllMissingMutation = trpc.diary.generateAllMissing.useMutation({
    onSuccess: res => {
      toast.success(`成功补全 ${res.count} 篇未填写的历史日记`);
      refetchDates();
      refetchEntries();
      refetchMissingDates();
    },
    onError: (e: any) => toast.error("批量生成失败：" + e.message),
  });

  const deleteMutation = trpc.diary.delete.useMutation({
    onSuccess: () => {
      toast.success("日记已移除");
      setDeleteTarget(null);
      setSelectedDate(null);
      refetchDates();
      refetchEntries();
      refetchMissingDates();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const datesSet = new Set((diaryDates || []).map((d: any) => d.date));
  const missingSet = new Set(missingDates || []);
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
  };
  const nextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
  };

  const handleGenerate = async (date: string) => {
    if (!selectedPersonaId) return;
    setGenerating(true);
    try {
      await generateMutation.mutateAsync({ personaId: selectedPersonaId, date });
      setSelectedDate(date);
    } finally {
      setGenerating(false);
    }
  };

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else if (selectedPersonaId) {
      navigate(`/chat/${selectedPersonaId}`);
    } else {
      navigate("/");
    }
  };

  const totalDiaryCount = diaryDates?.length || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-28 left-1/3 w-96 h-96 rounded-full bg-primary/[0.04] blur-3xl"
      />

      <header className="sticky top-0 z-30 app-header">
        <div className="container app-nav max-w-2xl">
          <button
            type="button"
            onClick={handleBack}
            className="app-nav-back -ml-1"
            title="返回上一个页面"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <BookOpen className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <h1 className="app-nav-title">对话日记</h1>
              <p className="app-nav-subtitle">按日装订你们的吉光片羽</p>
            </div>
          </div>
          <div className="app-nav-spacer" />

          {/* 单一清晰的顶栏主操作：一键补全缺失日记（无缺失时显示已装订篇数徽章） */}
          {missingDates && missingDates.length > 0 && selectedPersonaId ? (
            <Button
              size="sm"
              onClick={() => generateAllMissingMutation.mutate({ personaId: selectedPersonaId })}
              disabled={generateAllMissingMutation.isPending}
              title={`存在 ${missingDates.length} 天对话尚未收录为日记：${missingDates.slice(0, 3).join("、")}`}
              className="rounded-xl gap-1.5 h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs text-xs font-medium"
            >
              {generateAllMissingMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {generateAllMissingMutation.isPending
                  ? "正在补全..."
                  : `一键补全 (${missingDates.length})`}
              </span>
            </Button>
          ) : selectedPersonaId ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/65 border border-border/60 text-[11px] text-muted-foreground">
              <CalendarDays className="w-3 h-3 text-primary/75" />
              <span>
                已收录 <span className="font-mono tabular-nums text-foreground font-medium">{totalDiaryCount}</span> 篇
              </span>
            </span>
          ) : null}
        </div>
      </header>

      <main className="flex-1 container max-w-2xl mx-auto py-6 px-4 space-y-6 relative z-10">
        {/* 分身筛选：柔和弹簧滑动胶囊条 */}
        {personas && personas.length > 0 && (
          <div className="overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            <div className="inline-flex items-center gap-1 rounded-2xl border border-border/65 bg-muted/60 p-1 backdrop-blur-sm min-w-max">
              {personas.map((p: any) => {
                const active = selectedPersonaId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPersonaId(p.id);
                      setSelectedDate(null);
                    }}
                    className={`relative px-4 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-colors select-none whitespace-nowrap ${
                      active
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground/85"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="diary-persona-pill"
                        transition={SPRING_SNAPPY}
                        className="pointer-events-none absolute inset-0 rounded-xl border border-border/60 bg-card shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!selectedPersonaId && (
          <div className="warm-card warm-card-static rounded-3xl border border-border/70 text-center py-16 px-6">
            <div className="w-12 h-12 rounded-2xl bg-primary/[0.08] border border-primary/15 flex items-center justify-center mx-auto mb-3.5">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">尚未选择分身</p>
            <p className="text-xs text-muted-foreground">请先创建或选择一个分身以翻阅专属对话日记</p>
          </div>
        )}

        {selectedPersonaId && (
          <>
            {/* 待补全日期轻提示说明条（仅作信息提示，不放置重复按钮） */}
            {missingDates && missingDates.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-primary/[0.06] border border-primary/15 text-xs text-muted-foreground"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="truncate">
                    尚有 <span className="font-mono tabular-nums text-foreground font-medium">{missingDates.length}</span> 天历史对话待整理（含{" "}
                    <span className="font-mono tabular-nums">{missingDates.slice(0, 2).join("、")}</span>
                    {missingDates.length > 2 ? " 等" : ""}），可点选日期单独生成或由右上角一键补全
                  </span>
                </div>
              </motion.div>
            )}

            {/* 手账月历卡片 */}
            <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                  aria-label="上个月"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight text-foreground font-mono tabular-nums">
                    {formatMonth(year, month)}
                  </span>
                  {selectedDate && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      查看近况列表
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                  aria-label="下个月"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground/80 mb-2">
                {["日", "一", "二", "三", "四", "五", "六"].map(d => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`e-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const hasDiary = datesSet.has(dateStr);
                  const isMissing = missingSet.has(dateStr);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                      className={`relative aspect-square flex flex-col items-center justify-center rounded-xl text-xs sm:text-sm font-mono tabular-nums transition-all ${
                        isSelected
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : isToday
                            ? "ring-1 ring-primary/45 text-primary font-semibold bg-primary/[0.05]"
                            : hasDiary
                              ? "bg-primary/[0.06] text-foreground hover:bg-primary/12"
                              : "text-foreground/80 hover:bg-muted/65"
                      }`}
                    >
                      <span>{day}</span>
                      {hasDiary && (
                        <span
                          className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${
                            isSelected ? "bg-primary-foreground" : "bg-primary"
                          }`}
                        />
                      )}
                      {!hasDiary && isMissing && (
                        <span
                          title="该日有对话可生成日记"
                          className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full border ${
                            isSelected
                              ? "border-primary-foreground"
                              : "border-primary/70 bg-transparent"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-4 mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  已生成日记
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full border border-primary/70" />
                  有对话待整理
                </span>
              </div>
            </div>

            {/* 选中日期详情 / 生成引导 */}
            <AnimatePresence mode="wait">
              {selectedDate ? (
                <motion.div
                  key={`day-${selectedDate}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                  className="space-y-4"
                >
                  {dayEntry ? (
                    <DiaryCard
                      entry={dayEntry}
                      dateLabel={selectedDate}
                      onRequestDelete={entry => setDeleteTarget(entry)}
                    />
                  ) : (
                    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-7 text-center space-y-4">
                      <div className="w-11 h-11 rounded-2xl bg-primary/[0.08] border border-primary/15 flex items-center justify-center mx-auto">
                        <Feather className="w-5 h-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <h2 className="text-sm font-semibold font-mono tabular-nums text-foreground">
                          {selectedDate}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          这一天尚未装订成篇，点击下方按钮由 AI 回顾当日对话并提炼手账日记
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleGenerate(selectedDate)}
                        disabled={generating}
                        className="rounded-xl gap-1.5 px-5 h-9 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
                      >
                        {generating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>{generating ? "正在提炼手账..." : "生成当日日记"}</span>
                      </Button>
                    </div>
                  )}
                </motion.div>
              ) : entries && entries.length > 0 ? (
                <motion.div
                  key="recent-list"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                      最近收录手账
                    </h2>
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      共 {entries.length} 篇
                    </span>
                  </div>

                  {entries.map((entry: any) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedDate(entry.date)}
                      className="w-full text-left warm-card rounded-2xl border border-border/70 p-4 sm:p-5 group transition-all"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-sm font-semibold font-mono tabular-nums text-foreground group-hover:text-primary transition-colors">
                          {entry.date}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {entry.messageCount ? `${entry.messageCount} 条对话` : entry.personaName || ""}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                        {entry.summary}
                      </p>
                      {Array.isArray(entry.emotionalArc) && entry.emotionalArc.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mt-3">
                          {entry.emotionalArc.slice(0, 4).map((e: unknown, i: number) => (
                            <EmotionBadge key={`${String(e)}-${i}`} state={String(e)} />
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="empty-entries"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="warm-card warm-card-static rounded-3xl border border-border/70 p-8 text-center space-y-2"
                >
                  <Feather className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">暂未收录日记</p>
                  <p className="text-xs text-muted-foreground">
                    在日历上点选有过对话的日期，即可生成专属手账记录
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </main>

      {/* 删除日记二次确认弹窗（丝滑弹簧进退场） */}
      <MotionModal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
        ariaLabel="确认删除日记"
        className="max-w-sm p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-destructive" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">移除这篇手账日记？</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                即将移除{" "}
                <span className="font-mono tabular-nums text-foreground font-medium">
                  {deleteTarget?.date || selectedDate || "当日"}
                </span>{" "}
                的日记卡片。原始聊天记录不会受到影响，你随时可以重新生成。
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
              className="rounded-xl h-9 px-4"
            >
              保留日记
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              disabled={deleteMutation.isPending}
              className="rounded-xl h-9 px-4 gap-1.5"
            >
              {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{deleteMutation.isPending ? "正在移除..." : "确认移除"}</span>
            </Button>
          </div>
        </div>
      </MotionModal>
    </div>
  );
}
