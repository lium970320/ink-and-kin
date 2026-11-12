import { type ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  EASE_OUT_EXPO,
  SPRING_SILKY,
  SegmentedControl,
} from "@/components/ui/motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Calendar,
  Clock,
  Flame,
  MessageCircle,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const EMOTION_COLORS: Record<string, string> = {
  warm: "var(--color-chart-1)",
  playful: "var(--color-chart-2)",
  nostalgic: "var(--color-chart-3)",
  melancholy: "var(--color-muted-foreground)",
  happy: "var(--color-chart-5)",
  distant: "var(--color-chart-4)",
};

const EMOTION_LABELS: Record<string, string> = {
  warm: "温柔",
  playful: "俏皮",
  nostalgic: "思念",
  melancholy: "忧郁",
  happy: "开心",
  distant: "疏离",
};

type DayPeriod = "7" | "30" | "90";

const PERIOD_OPTIONS: ReadonlyArray<{ value: DayPeriod; label: string }> = [
  { value: "7", label: "7天" },
  { value: "30", label: "30天" },
  { value: "90", label: "90天" },
];

const TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 24px -4px rgba(0, 0, 0, 0.08)",
};

export default function Analytics() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [days, setDays] = useState<number>(30);

  const { data, isLoading } = trpc.analytics.overview.useQuery(
    { days },
    { enabled: isAuthenticated }
  );

  const stats = data?.stats || {
    totalMessages: 0,
    activeDays: 0,
    longestStreak: 0,
    avgPerDay: 0,
  };

  const emotionByDate: Record<string, Record<string, number | string>> = {};
  (data?.emotionTimeline || []).forEach((r: any) => {
    if (!emotionByDate[r.date]) emotionByDate[r.date] = { date: r.date };
    emotionByDate[r.date][r.emotionalState] = Number(r.count);
  });
  const emotionChartData = Object.values(emotionByDate);

  const hourlyData = Array.from({ length: 24 }, (_, h) => {
    const found = (data?.hourlyDistribution || []).find((r: any) => r.hour === h);
    return { hour: `${String(h).padStart(2, "0")}:00`, count: found ? Number(found.count) : 0 };
  });

  const messageVolume = data?.messageVolume || [];
  const hasMessageVolume = messageVolume.some((item: any) => Number(item.count) > 0);
  const hasEmotionData = emotionChartData.length > 0;
  const hasHourlyData = hourlyData.some(item => item.count > 0);
  const personaEngagement = data?.personaEngagement || [];

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-32 right-1/4 w-96 h-96 rounded-full bg-primary/[0.04] blur-3xl"
      />

      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav max-w-4xl">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="app-nav-back -ml-1"
            title="返回大厅"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <Activity className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <h1 className="app-nav-title">数据看板</h1>
              <p className="app-nav-subtitle">对话节奏与情绪脉络洞察</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
          <SegmentedControl<DayPeriod>
            size="xs"
            layoutId="analytics-period-pill"
            ariaLabel="统计周期选择"
            options={PERIOD_OPTIONS}
            value={String(days) as DayPeriod}
            onChange={val => setDays(Number(val))}
          />
        </div>
      </header>

      <main className="container py-6 sm:py-8 max-w-4xl mx-auto space-y-6 relative z-10">
        {isLoading && !data ? (
          <AnalyticsSkeleton />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
            className="space-y-6"
          >
            {/* 顶部四项核心指标 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              <StatCard
                icon={<MessageCircle className="w-4 h-4 text-primary" />}
                label="总消息数"
                value={stats.totalMessages}
                unit="条"
              />
              <StatCard
                icon={<Calendar className="w-4 h-4 text-primary" />}
                label="活跃天数"
                value={stats.activeDays}
                unit="天"
              />
              <StatCard
                icon={<Flame className="w-4 h-4 text-primary" />}
                label="最长连续"
                value={stats.longestStreak}
                unit="天"
              />
              <StatCard
                icon={<TrendingUp className="w-4 h-4 text-primary" />}
                label="日均互动"
                value={stats.avgPerDay}
                unit="条"
              />
            </div>

            {/* 每日消息量趋势 */}
            <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary/80" />
                  <h2 className="text-sm font-semibold text-foreground">每日消息量趋势</h2>
                </div>
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  近 {days} 天
                </span>
              </div>

              {hasMessageVolume ? (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={messageVolume} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        stroke="var(--color-muted-foreground)"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="var(--color-muted-foreground)"
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: "var(--color-foreground)", fontWeight: 600, marginBottom: 4 }}
                        formatter={(value: any) => [`${value} 条`, "当日消息"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="当日消息"
                        stroke="var(--color-chart-1)"
                        fill="url(#msgGrad)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<BarChart3 className="w-5 h-5 text-muted-foreground/50" />}
                  text="当前统计周期内暂无对话消息记录"
                />
              )}
            </div>

            {/* 情绪分布趋势 & 聊天时段分布 */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5 sm:p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary/80" />
                      <h2 className="text-sm font-semibold text-foreground">情绪分布趋势</h2>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                    {Object.keys(EMOTION_COLORS).map(key => (
                      <span key={key} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: EMOTION_COLORS[key] }}
                        />
                        {EMOTION_LABELS[key] || key}
                      </span>
                    ))}
                  </div>
                </div>

                {hasEmotionData ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={emotionChartData} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          stroke="var(--color-muted-foreground)"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          stroke="var(--color-muted-foreground)"
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          labelStyle={{ color: "var(--color-foreground)", fontWeight: 600, marginBottom: 4 }}
                          formatter={(value: any, name: any) => [
                            `${value} 次`,
                            EMOTION_LABELS[String(name)] || String(name),
                          ]}
                        />
                        {Object.keys(EMOTION_COLORS).map(key => (
                          <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={EMOTION_LABELS[key] || key}
                            stackId="1"
                            stroke={EMOTION_COLORS[key]}
                            fill={EMOTION_COLORS[key]}
                            fillOpacity={0.38}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmptyState
                    icon={<Sparkles className="w-5 h-5 text-muted-foreground/50" />}
                    text="暂无情绪共鸣轨迹数据"
                  />
                )}
              </div>

              <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5 sm:p-6 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary/80" />
                    <h2 className="text-sm font-semibold text-foreground">聊天时段分布</h2>
                  </div>
                  <span className="text-[11px] text-muted-foreground">24 小时节律</span>
                </div>

                {hasHourlyData ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={hourlyData.filter((_, i) => i % 2 === 0)}>
                        <PolarGrid stroke="var(--color-border)" />
                        <PolarAngleAxis
                          dataKey="hour"
                          tick={{ fontSize: 10 }}
                          stroke="var(--color-muted-foreground)"
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value: any) => [`${value} 条`, "时段消息"]}
                        />
                        <Radar
                          name="时段消息"
                          dataKey="count"
                          stroke="var(--color-chart-1)"
                          fill="var(--color-chart-1)"
                          fillOpacity={0.28}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmptyState
                    icon={<Clock className="w-5 h-5 text-muted-foreground/50" />}
                    text="暂无活跃时段分布记录"
                  />
                )}
              </div>
            </div>

            {/* 分身互动排行 */}
            <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary/80" />
                  <h2 className="text-sm font-semibold text-foreground">分身互动排行</h2>
                </div>
                {personaEngagement.length > 0 && (
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    共 {personaEngagement.length} 位分身
                  </span>
                )}
              </div>

              {personaEngagement.length === 0 ? (
                <ChartEmptyState
                  icon={<Users className="w-5 h-5 text-muted-foreground/50" />}
                  text="暂无分身互动统计，去大厅开启一段对话吧"
                />
              ) : (
                <div className="space-y-3">
                  {personaEngagement.map((p: any, i: number) => {
                    const max = Math.max(
                      ...personaEngagement.map((x: any) => Number(x.messageCount))
                    );
                    const count = Number(p.messageCount) || 0;
                    const pct = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <div key={p.personaId} className="flex items-center gap-3.5">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono tabular-nums font-semibold shrink-0 ${
                            i === 0
                              ? "bg-primary/14 text-primary border border-primary/20"
                              : "bg-muted/65 text-muted-foreground border border-border/50"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium text-foreground w-24 sm:w-28 truncate">
                          {p.name}
                        </span>
                        <div className="flex-1 h-2.5 bg-muted/70 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={SPRING_SILKY}
                            className="h-full rounded-full bg-primary/75"
                          />
                        </div>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground w-14 text-right">
                          {count} 条
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="warm-card warm-card-static rounded-2xl border border-border/70 p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <div className="w-7 h-7 rounded-lg bg-primary/[0.08] border border-primary/15 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-foreground">
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function ChartEmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="h-44 flex flex-col items-center justify-center text-center rounded-2xl bg-muted/25 border border-dashed border-border/60 px-4">
      <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center mb-2.5">
        {icon}
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="warm-card warm-card-static rounded-2xl border border-border/60 p-4 space-y-3"
          >
            <div className="h-4 w-20 rounded-md bg-muted/75" />
            <div className="h-7 w-16 rounded-md bg-muted/85" />
          </div>
        ))}
      </div>
      <div className="warm-card warm-card-static rounded-3xl border border-border/60 p-6 space-y-4">
        <div className="h-4 w-32 rounded-md bg-muted/75" />
        <div className="h-48 rounded-2xl bg-muted/45" />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="warm-card warm-card-static rounded-3xl border border-border/60 p-6 space-y-4">
          <div className="h-4 w-28 rounded-md bg-muted/75" />
          <div className="h-44 rounded-2xl bg-muted/45" />
        </div>
        <div className="warm-card warm-card-static rounded-3xl border border-border/60 p-6 space-y-4">
          <div className="h-4 w-28 rounded-md bg-muted/75" />
          <div className="h-44 rounded-2xl bg-muted/45" />
        </div>
      </div>
    </div>
  );
}
