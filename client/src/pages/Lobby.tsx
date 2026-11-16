import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { formatBeijingDate } from "@/lib/beijing-time";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Award,
  BookOpen,
  Bookmark,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  CloudRain,
  Coffee,
  FileText,
  Flame,
  Gift,
  GraduationCap,
  Heart,
  Leaf,
  Lightbulb,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Orbit,
  Palette,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Settings,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Theater,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { useTilt } from "@/hooks/useTilt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CollapseSection,
  EASE_OUT_EXPO,
  MotionModal,
  MotionPopover,
  SPRING_SILKY,
  SegmentedControl,
} from "@/components/ui/motion";
import { toast } from "sonner";
import ForewordModal from "@/components/ForewordModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EMOTIONAL_STATES: Record<
  string,
  {
    label: string;
    color: string;
    Icon: ComponentType<{ className?: string }>;
  }
> = {
  warm: { label: "温柔", color: "#C8875E", Icon: Heart },
  playful: { label: "俏皮", color: "#B89A3E", Icon: Sparkles },
  nostalgic: { label: "思念", color: "#7689BE", Icon: Moon },
  melancholy: { label: "忧郁", color: "#8778BE", Icon: CloudRain },
  happy: { label: "欢欣", color: "#56987A", Icon: Sun },
  distant: { label: "疏离", color: "#8A8E93", Icon: Snowflake },
};

const STATUS_CONFIG: Record<string, { label: string; dotClass: string }> = {
  pending: { label: "待上传", dotClass: "bg-amber-400" },
  analyzing: { label: "解析中", dotClass: "bg-primary animate-pulse" },
  ready: { label: "可对话", dotClass: "bg-emerald-500" },
  error: { label: "解析失败", dotClass: "bg-destructive" },
};

const ANALYSIS_STAGES: Record<number, string> = {
  10: "读取文件内容",
  30: "AI 分析聊天记录",
  70: "提炼记忆与图片细节",
  100: "分析完成",
};

const TIPS = [
  { icon: Lightbulb, text: "上传更多聊天记录可以让 AI 更准确地还原 TA 的说话方式" },
  { icon: Zap, text: "在设置中调整 Temperature 参数可以控制回复的创造性" },
  { icon: Heart, text: "编辑角色资料，添加你们的共同回忆，让对话更有温度" },
  { icon: Brain, text: "每个角色可以选择不同的 AI 提供商，找到最适合的风格" },
  { icon: Coffee, text: "试试在不同情感状态下对话，TA 会有不同的回应方式" },
  { icon: Star, text: "绑定 QQ 后，TA 可以在 QQ 上直接和你聊天" },
];

const LOVE_QUOTES = [
  "所谓永恒，就是每一个当下都在想你。",
  "世界上最温暖的两个字，是从你口中说出的晚安。",
  "想你的时候，连呼吸都是甜的。",
  "你是我写过最美的故事。",
  "有些人，光是想起就觉得温暖。",
  "思念不需要理由，就像呼吸不需要提醒。",
  "你在的地方，就是我想去的远方。",
  "最好的时光，是有你在身边的每一天。",
  "爱是想触碰又收回手。",
  "你笑起来真好看，像春天的花一样。",
  "我见过银河，但只有你是星星。",
  "时间会告诉你，谁是真正在乎你的人。",
];

const MILESTONES = [
  { threshold: 1000, label: "千言万语" },
  { threshold: 500, label: "深度连接" },
  { threshold: 100, label: "默契老友" },
  { threshold: 50, label: "渐入佳境" },
  { threshold: 10, label: "温润初识" },
];

type FilterTabKey = "all" | "ready" | "analyzing" | "pending";

const FILTER_TABS: ReadonlyArray<{ key: FilterTabKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "ready", label: "可对话" },
  { key: "analyzing", label: "解析中" },
  { key: "pending", label: "待上传" },
];

const SORT_OPTIONS = [
  { key: "recent", label: "最近对话" },
  { key: "created", label: "创建时间" },
  { key: "chats", label: "对话最多" },
  { key: "name", label: "按名称" },
];

const DAILY_GREETINGS = [
  "今天也想你了呢~",
  "你今天开心吗？",
  "好想和你聊聊天",
  "今天的天气让我想起了你",
  "你吃饭了吗？记得好好吃饭哦",
  "想你想到发呆了...",
  "今天有什么有趣的事吗？",
  "看到好看的东西就想分享给你",
  "你最近忙不忙呀？",
  "突然好想抱抱你",
];

const ACHIEVEMENTS = [
  { id: "first_chat", Icon: MessageCircle, label: "初次对话", desc: "完成第一次对话", check: (s: any) => s.totalChats >= 1 },
  { id: "ten_chats", Icon: Sparkles, label: "渐生默契", desc: "累计 10 次对话", check: (s: any) => s.totalChats >= 10 },
  { id: "fifty_chats", Icon: BookOpen, label: "故事成册", desc: "累计 50 次对话", check: (s: any) => s.totalChats >= 50 },
  { id: "hundred_chats", Icon: Award, label: "长卷知己", desc: "累计 100 次对话", check: (s: any) => s.totalChats >= 100 },
  { id: "multi_persona", Icon: Users, label: "群星相伴", desc: "创建 3 个以上分身", check: (s: any) => s.totalPersonas >= 3 },
  { id: "daily_active", Icon: Flame, label: "今日热络", desc: "今天至少对话 5 次", check: (s: any) => s.todayChats >= 5 },
  { id: "veteran", Icon: CalendarDays, label: "长情岁月", desc: "陪伴超过 30 天", check: (s: any) => s.memberDays >= 30 },
  { id: "collector", Icon: Star, label: "记忆馆藏", desc: "创建 5 个以上分身", check: (s: any) => s.totalPersonas >= 5 },
];

const CONVERSATION_STARTERS = [
  "你还记得我们第一次见面的场景吗？",
  "如果可以一起去旅行，你最想去哪里？",
  "你觉得我们之间最美好的回忆是什么？",
  "今天发生了一件有趣的事，想听吗？",
  "你最近在想什么呢？",
  "如果给我们的故事起个名字，你会叫什么？",
  "你觉得什么时候最想我？",
  "有没有什么话你一直想对我说但没说出口的？",
  "你最喜欢我什么地方？",
  "如果时间可以倒流，你想回到哪一天？",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getGreeting(): {
  text: string;
  sub: string;
  Icon: ComponentType<{ className?: string }>;
} {
  const h = new Date().getHours();
  if (h < 6) return { text: "夜深了", sub: "夜色安静，TA 一直在这里陪你", Icon: Moon };
  if (h < 9) return { text: "早上好", sub: "晨光微熹，新的一天开始了", Icon: Sunrise };
  if (h < 12) return { text: "上午好", sub: "愿你今天拥有从容笃定的心情", Icon: Sun };
  if (h < 14) return { text: "中午好", sub: "忙里偷闲，记得好好吃顿午饭", Icon: Coffee };
  if (h < 18) return { text: "下午好", sub: "午后微风轻缓，随时回来聊聊", Icon: Sun };
  if (h < 22) return { text: "晚上好", sub: "卸下一天的奔波，说说今天的故事吧", Icon: Sunset };
  return { text: "夜深了", sub: "把心事放下，愿你今夜好眠", Icon: Moon };
}

function getAvatarUrl(name: string, avatarUrl?: string | null): string {
  if (avatarUrl && avatarUrl.trim()) return avatarUrl.trim();
  return generateAvatar(name);
}

function generateAvatar(name: string): string {
  const colors = [
    ["#6B9E88", "#4E826B"],
    ["#C6986E", "#AD7E54"],
    ["#7F9FB5", "#61839A"],
    ["#AD8FAD", "#917291"],
    ["#93AD7E", "#789363"],
    ["#C2A685", "#A68A69"],
  ];
  const safeName = name || "M";
  const idx = safeName.charCodeAt(0) % colors.length;
  const [c1, c2] = colors[idx];
  const char = safeName.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient></defs>
    <rect width="80" height="80" rx="20" fill="url(#g)"/>
    <text x="40" y="52" font-family="sans-serif" font-size="32" font-weight="600" fill="white" text-anchor="middle">${char}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return formatBeijingDate(date);
}

function daysBetween(from: string | Date, to?: string | Date): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(1, Math.floor((end - start) / 86400000));
}

function getAnalysisStage(progress: number): string {
  for (const [t, l] of Object.entries(ANALYSIS_STAGES).sort(
    (a, b) => Number(b[0]) - Number(a[0])
  )) {
    if (progress >= Number(t)) return l;
  }
  return "准备中";
}

function getMilestone(chatCount: number) {
  return MILESTONES.find(m => chatCount >= m.threshold);
}

function getDaysUntilAnniversary(togetherFrom: string): number | null {
  const start = new Date(togetherFrom);
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), start.getMonth(), start.getDate());
  if (thisYear < now) thisYear.setFullYear(thisYear.getFullYear() + 1);
  const diff = Math.ceil((thisYear.getTime() - now.getTime()) / 86400000);
  return diff <= 30 ? diff : null;
}

function getMissYouLevel(lastChatAt: string | Date | null): string | null {
  if (!lastChatAt) return null;
  const days = Math.floor((Date.now() - new Date(lastChatAt).getTime()) / 86400000);
  if (days >= 7) return "很想你";
  if (days >= 3) return "想你了";
  return null;
}

function formatCompactTraitTag(raw: unknown): { short: string; full: string } | null {
  if (typeof raw !== "string") return null;
  const full = raw.trim();
  if (!full) return null;
  const head = full.split(/[:：—－\n（(；;]/)[0]?.trim() || "";
  if (head.length >= 2 && head.length <= 16) {
    return { short: head, full };
  }
  const short = full.length > 16 ? `${full.slice(0, 15)}…` : full;
  return { short, full };
}

function getCompatibilityScore(persona: any): number {
  const chatWeight = Math.min((persona.chatCount || 0) / 100, 1) * 40;
  const daysWeight = persona.togetherFrom
    ? Math.min(daysBetween(persona.togetherFrom) / 365, 1) * 30
    : 15;
  const dataWeight = persona.personaData ? 20 : 0;
  const recentWeight =
    persona.lastChatAt &&
    Date.now() - new Date(persona.lastChatAt).getTime() < 86400000 * 3
      ? 10
      : 0;
  return Math.min(99, Math.round(chatWeight + daysWeight + dataWeight + recentWeight));
}

// ─── ANIMATED COUNTER HOOK ───────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const prevTarget = useRef(target);
  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    prevTarget.current = target;
    const startTime = Date.now();
    let frameId = 0;
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration]);
  return value;
}

// ─── HERO BANNER（整句柔和渐入切换 + 等宽数字排版） ─────────────────────────

function HeroBanner({
  username,
  stats,
  readyCount = 0,
  onCreate,
}: {
  username?: string;
  stats?: any;
  readyCount?: number;
  onCreate: () => void;
}) {
  const greeting = getGreeting();
  const GreetingIcon = greeting.Icon;
  const fullGreeting = username ? `${username}，${greeting.text}` : greeting.text;
  const [quoteIdx, setQuoteIdx] = useState(() =>
    Math.floor(Math.random() * LOVE_QUOTES.length)
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteIdx(prev => (prev + 1) % LOVE_QUOTES.length);
    }, 9000);
    return () => clearInterval(timer);
  }, []);

  const memberDays = stats?.memberSince
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86400000))
    : 0;
  const animatedDays = useAnimatedCounter(memberDays);
  const animatedChats = useAnimatedCounter(stats?.totalChats || 0);
  const animatedToday = useAnimatedCounter(stats?.todayChats || 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
      className="warm-card warm-card-static rounded-3xl p-6 sm:p-8 mb-6 relative overflow-hidden border border-border/70 bg-gradient-to-br from-card/95 via-card/88 to-primary/[0.05]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-primary/[0.07] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-16 w-60 h-60 rounded-full bg-primary/[0.04] blur-3xl"
      />

      <div className="relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <GreetingIcon className="w-4 h-4 text-primary" />
              </div>
              <motion.h1
                key={fullGreeting}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
                className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
              >
                {fullGreeting}
              </motion.h1>
            </div>
            <p className="text-muted-foreground text-sm pl-0.5">{greeting.sub}</p>
          </div>

          <Button
            size="sm"
            onClick={onCreate}
            className="self-start rounded-xl h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium shadow-xs gap-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建分身</span>
          </Button>
        </div>

        {/* 整句柔和渐入切换寄语条 */}
        <button
          type="button"
          onClick={() => setQuoteIdx(prev => (prev + 1) % LOVE_QUOTES.length)}
          title="点击切换寄语"
          className="mt-5 w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 bg-muted/35 hover:bg-muted/55 border border-border/55 rounded-2xl transition-colors group"
        >
          <Quote className="w-3.5 h-3.5 text-primary/60 shrink-0" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={quoteIdx}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                className="text-xs text-muted-foreground italic leading-relaxed truncate"
              >
                {LOVE_QUOTES[quoteIdx]}
              </motion.p>
            </AnimatePresence>
          </div>
          <RefreshCw className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary/70 transition-colors shrink-0" />
        </button>

        {/* 等宽数字概览指标栏 */}
        {(memberDays > 0 || (stats && stats.totalPersonas > 0)) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-border/55">
            {stats && stats.totalPersonas > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="w-3.5 h-3.5 text-primary/80" />
                <span>
                  分身{" "}
                  <span className="text-foreground font-semibold font-mono tabular-nums">
                    {stats.totalPersonas}
                  </span>{" "}
                  · 在线{" "}
                  <span className="text-primary font-semibold font-mono tabular-nums">
                    {readyCount}
                  </span>
                </span>
              </div>
            )}
            {memberDays > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="w-3.5 h-3.5 text-primary/80" />
                <span>
                  相伴{" "}
                  <span className="text-foreground font-semibold font-mono tabular-nums">
                    {animatedDays}
                  </span>{" "}
                  天
                </span>
              </div>
            )}
            {stats && stats.totalChats > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageCircle className="w-3.5 h-3.5 text-primary/80" />
                <span>
                  累计{" "}
                  <span className="text-foreground font-semibold font-mono tabular-nums">
                    {animatedChats}
                  </span>{" "}
                  次对话
                </span>
              </div>
            )}
            {stats && stats.todayChats > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Flame className="w-3.5 h-3.5 text-primary/80" />
                <span>
                  今日{" "}
                  <span className="text-foreground font-semibold font-mono tabular-nums">
                    {animatedToday}
                  </span>{" "}
                  条
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}

// ─── TODAY'S RECOMMENDATION ──────────────────────────────────────────────────

function TodayRecommendation({
  personas,
  onChat,
}: {
  personas: any[];
  onChat: (id: number) => void;
}) {
  const recommended = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready");
    if (ready.length === 0) return null;
    return [...ready].sort((a, b) => {
      const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
      const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
      return aTime - bTime;
    })[0];
  }, [personas]);

  if (!recommended) return null;
  const emotion =
    EMOTIONAL_STATES[recommended.emotionalState] || EMOTIONAL_STATES.warm;
  const EmotionIcon = emotion.Icon;
  const pd = (recommended.personaData as any) || {};
  const missLevel = getMissYouLevel(recommended.lastChatAt);

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-4 sm:p-5 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 bg-primary/[0.06] rounded-full blur-2xl"
      />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <Bookmark className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-semibold tracking-wide text-foreground">今日重逢推荐</h3>
          {missLevel && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
              {missLevel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3.5">
          <div className="mood-ring-sm shrink-0" style={{ "--mood-color": emotion.color } as any}>
            <img
              src={getAvatarUrl(recommended.name, recommended.avatarUrl)}
              alt={recommended.name}
              className="w-11 h-11 rounded-2xl object-cover border border-border/60"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground truncate">
                {recommended.name}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <EmotionIcon className="w-3 h-3 text-primary/75" />
                {emotion.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {recommended.lastChatAt
                ? `上次交谈于 ${relativeTime(recommended.lastChatAt)}`
                : "尚未开启第一段对话"}
              {pd.summary && ` · ${(pd.summary as string).slice(0, 28)}`}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => onChat(recommended.id)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-8.5 px-3.5 shadow-2xs shrink-0 gap-1"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>去聊聊</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── "TA 想对你说" DAILY MESSAGES ────────────────────────────────────────────

function DailyMessages({
  personas,
  onChat,
}: {
  personas: any[];
  onChat: (id: number) => void;
}) {
  const messages = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready");
    if (ready.length === 0) return [];
    const today = new Date().getDate();
    return ready.slice(0, 3).map((p, i) => {
      const pd = (p.personaData as any) || {};
      const catchphrases: string[] = pd.catchphrases || [];
      const greetingIdx = (p.name.charCodeAt(0) + today + i) % DAILY_GREETINGS.length;
      let msg = DAILY_GREETINGS[greetingIdx];
      if (catchphrases.length > 0) {
        const cp = catchphrases[(today + i) % catchphrases.length];
        msg = `${cp}，${msg}`;
      }
      if (pd.nickname) msg += ` —— ${pd.nickname}`;
      return {
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        message: msg,
        emotion: p.emotionalState || "warm",
      };
    });
  }, [personas]);

  if (messages.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="w-3.5 h-3.5 text-primary/80" />
        <h2 className="text-sm font-semibold text-foreground">TA 想对你说</h2>
      </div>
      <div className="space-y-2">
        {messages.map(m => {
          const emotion = EMOTIONAL_STATES[m.emotion] || EMOTIONAL_STATES.warm;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChat(m.id)}
              className="w-full text-left warm-card rounded-2xl border border-border/65 px-4 py-3 flex items-start gap-3 group"
            >
              <div
                className="mood-ring-sm flex-shrink-0"
                style={{ "--mood-color": emotion.color } as any}
              >
                <img
                  src={getAvatarUrl(m.name, m.avatarUrl)}
                  alt={m.name}
                  className="w-8 h-8 rounded-xl object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                    {m.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground/75">今日低语</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                  {m.message}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ACTIVITY HEATMAP（深浅色双模式语义适配，根除浅色白斑） ──────────────────

function getHeatmapToneClass(intensity: number): string {
  if (intensity <= 0) return "bg-muted/65 border border-border/45";
  if (intensity < 0.3) return "bg-primary/25 border border-primary/20";
  if (intensity < 0.6) return "bg-primary/50 border border-primary/30";
  if (intensity < 0.85) return "bg-primary/75 border border-primary/40";
  return "bg-primary border border-primary/60";
}

function ActivityHeatmap() {
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const { cells, maxCount } = useMemo(() => {
    const map = new Map<string, number>();
    if (dailyActivity) {
      for (const row of dailyActivity) {
        map.set(String(row.date), Number(row.count));
      }
    }
    const cells: Array<{ date: string; count: number; label: string }> = [];
    let maxCount = 1;
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = map.get(key) || 0;
      if (count > maxCount) maxCount = count;
      cells.push({
        date: key,
        count,
        label: `${d.getMonth() + 1}/${d.getDate()}：${count} 条消息`,
      });
    }
    return { cells, maxCount };
  }, [dailyActivity]);

  const totalMessages = cells.reduce((s, c) => s + c.count, 0);
  if (totalMessages === 0) return null;

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-primary/80" />
          <h3 className="text-xs font-semibold text-foreground">对话热力图</h3>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          近 30 天 · {totalMessages} 条
        </span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {cells.map(cell => {
          const intensity = cell.count === 0 ? 0 : Math.max(0.15, cell.count / maxCount);
          return (
            <div
              key={cell.date}
              title={cell.label}
              className={`w-3.5 h-3.5 rounded-[4px] transition-colors ${getHeatmapToneClass(intensity)}`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 mt-3 justify-end">
        <span className="text-[10px] text-muted-foreground">少</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-[3px] ${getHeatmapToneClass(v)}`}
          />
        ))}
        <span className="text-[10px] text-muted-foreground">多</span>
      </div>
    </div>
  );
}

// ─── PRESENCE EVENT INDICATOR（100% 保留 ambientPresence 副作用契约） ─────────

type PresenceRhythm = {
  initialDelay: [number, number];
  repeatDelay: [number, number];
  visibleFor: [number, number];
  messages: string[];
};

const MINUTE = 60_000;

function randomBetween([min, max]: [number, number]) {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getPresenceRhythm(date = new Date()): PresenceRhythm {
  const h = date.getHours();

  if (h >= 0 && h < 5) {
    return {
      initialDelay: [12 * MINUTE, 30 * MINUTE],
      repeatDelay: [50 * MINUTE, 120 * MINUTE],
      visibleFor: [14_000, 22_000],
      messages: [
        "{name}看着窗外的夜色，安静地想起你",
        "{name}把灯留得很低，忽然很想知道你睡了没有",
        "{name}在夜里想起旧事，也想起了你",
        "{name}没有打扰你，只是在心里低低叫了你一声",
      ],
    };
  }

  if (h >= 5 && h < 8) {
    return {
      initialDelay: [4 * MINUTE, 10 * MINUTE],
      repeatDelay: [18 * MINUTE, 40 * MINUTE],
      visibleFor: [9_000, 14_000],
      messages: [
        "{name}出门前看了看天色，想提醒你吃早饭",
        "{name}收拾好东西，忽然想到你今天也该早点出门",
        "{name}在清早的安静里想起你",
      ],
    };
  }

  if (h >= 8 && h < 18) {
    return {
      initialDelay: [6 * MINUTE, 16 * MINUTE],
      repeatDelay: [22 * MINUTE, 55 * MINUTE],
      visibleFor: [8_000, 13_000],
      messages: [
        "{name}忙完手边的事，短短地想起你一下",
        "{name}整理资料时停了一会儿，想知道你在做什么",
        "{name}看见窗外的光，顺手想起你",
        "{name}在一天的间隙里想起你，又继续去忙了",
      ],
    };
  }

  if (h >= 18 && h < 23) {
    return {
      initialDelay: [1 * MINUTE, 4 * MINUTE],
      repeatDelay: [6 * MINUTE, 15 * MINUTE],
      visibleFor: [10_000, 16_000],
      messages: [
        "{name}在下班后的路上想起你",
        "{name}泡茶的时候想问你今天累不累",
        "{name}收起今天的事情，心里慢慢转到你这里",
        "{name}看着屋里的灯亮起来，忽然很想和你说句话",
        "{name}想知道你有没有好好吃晚饭",
      ],
    };
  }

  return {
    initialDelay: [7 * MINUTE, 18 * MINUTE],
    repeatDelay: [28 * MINUTE, 70 * MINUTE],
    visibleFor: [12_000, 18_000],
    messages: [
      "{name}看了一眼时间，心里惦记你该休息了",
      "{name}把杯子放下，想起你今天也许累了",
      "{name}在夜里安静下来，想跟你说早点睡",
      "{name}没有多说，只是很轻地想起你",
    ],
  };
}

function buildPresenceText(persona: any, rhythm: PresenceRhythm) {
  return pickRandom(rhythm.messages).replaceAll("{name}", persona.name || "TA");
}

function TypingIndicator({ personas }: { personas: any[] }) {
  const [event, setEvent] = useState<{ personaIdx: number; text: string } | null>(null);
  const ready = useMemo(
    () => personas.filter((p: any) => p.analysisStatus === "ready"),
    [personas]
  );
  const readyRef = useRef(ready);
  const ambientPresenceMutation = trpc.proactive.requestAmbient.useMutation({ retry: false });
  const ambientPresenceRef = useRef(ambientPresenceMutation.mutate);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    ambientPresenceRef.current = ambientPresenceMutation.mutate;
  }, [ambientPresenceMutation.mutate]);

  useEffect(() => {
    if (ready.length === 0) {
      setEvent(null);
      return;
    }

    let disposed = false;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = (initial: boolean) => {
      if (disposed) return;
      const rhythm = getPresenceRhythm();
      const delay = randomBetween(initial ? rhythm.initialDelay : rhythm.repeatDelay);

      showTimer = setTimeout(() => {
        const currentReady = readyRef.current;
        if (disposed || currentReady.length === 0) return;

        const idx = Math.floor(Math.random() * currentReady.length);
        const currentRhythm = getPresenceRhythm();
        const text = buildPresenceText(currentReady[idx], currentRhythm);
        setEvent({
          personaIdx: idx,
          text,
        });
        if (currentReady[idx]?.id) {
          ambientPresenceRef.current({ personaId: currentReady[idx].id });
        }

        hideTimer = setTimeout(() => {
          setEvent(null);
          scheduleNext(false);
        }, randomBetween(currentRhythm.visibleFor));
      }, delay);
    };

    scheduleNext(true);
    return () => {
      disposed = true;
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [ready.length]);

  const activePersona =
    event && ready.length > 0 ? ready[event.personaIdx % ready.length] : null;
  const emotion = activePersona
    ? EMOTIONAL_STATES[activePersona.emotionalState] || EMOTIONAL_STATES.warm
    : EMOTIONAL_STATES.warm;

  return (
    <AnimatePresence>
      {event && activePersona && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={SPRING_SILKY}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
        >
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-card/95 backdrop-blur-xl rounded-full border border-border/75 shadow-lg">
            <div className="mood-ring-sm" style={{ "--mood-color": emotion.color } as any}>
              <img
                src={getAvatarUrl(activePersona.name, activePersona.avatarUrl)}
                alt={activePersona.name}
                className="w-6 h-6 rounded-full object-cover"
              />
            </div>
            <span className="text-xs text-foreground/85">{event.text}</span>
            <span className="flex gap-0.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── ACHIEVEMENT BADGES ──────────────────────────────────────────────────────

function AchievementBadges({ stats }: { stats: any }) {
  const memberDays = stats?.memberSince
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86400000))
    : 0;
  const checkData = { ...stats, memberDays };
  const unlocked = ACHIEVEMENTS.filter(a => a.check(checkData));
  const locked = ACHIEVEMENTS.filter(a => !a.check(checkData));

  if (unlocked.length === 0 && !stats) return null;

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <Award className="w-3.5 h-3.5 text-primary/80" />
          <h3 className="text-xs font-semibold text-foreground">陪伴纪念章</h3>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {unlocked.length}/{ACHIEVEMENTS.length} 已点亮
        </span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {unlocked.map(a => {
          const Icon = a.Icon;
          return (
            <div
              key={a.id}
              title={a.desc}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/[0.08] border border-primary/20 text-primary"
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{a.label}</span>
            </div>
          );
        })}
        {locked.slice(0, 3).map(a => (
          <div
            key={a.id}
            title={a.desc}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/45 border border-border/55 text-muted-foreground/65"
          >
            <Lock className="w-3 h-3" />
            <span className="text-xs">{a.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CHAT STREAK ─────────────────────────────────────────────────────────────

function ChatStreak() {
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const streak = useMemo(() => {
    if (!dailyActivity || dailyActivity.length === 0) return 0;
    const dateSet = new Set(dailyActivity.map(r => String(r.date)));
    let count = 0;
    const d = new Date();
    const todayKey = d.toISOString().slice(0, 10);
    if (!dateSet.has(todayKey)) {
      d.setDate(d.getDate() - 1);
      if (!dateSet.has(d.toISOString().slice(0, 10))) return 0;
    }
    while (dateSet.has(d.toISOString().slice(0, 10))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [dailyActivity]);

  if (streak < 2) return null;

  return (
    <div className="warm-card warm-card-static rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center">
          <Flame className="w-4 h-4 text-primary" />
        </div>
        <div>
          <span className="text-sm font-semibold text-foreground">
            已连续对话{" "}
            <span className="font-mono tabular-nums text-primary">{streak}</span> 天
          </span>
          <p className="text-[11px] text-muted-foreground">日复一日的问候，让默契自然生长</p>
        </div>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
          <div
            key={i}
            className="w-1.5 h-3.5 rounded-full bg-primary"
            style={{ opacity: 0.3 + ((i + 1) / 7) * 0.7 }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── CONVERSATION STARTERS（100% 保持 Hooks 顺序在提前 return 之前！） ───────

function ConversationStarters({
  personas,
  onChat,
}: {
  personas: any[];
  onChat: (id: number) => void;
}) {
  const ready = personas.filter((p: any) => p.analysisStatus === "ready");
  const [starterIdx, setStarterIdx] = useState(() =>
    Math.floor(Math.random() * CONVERSATION_STARTERS.length)
  );

  const starters = useMemo(() => {
    const result: Array<{ text: string; personaId: number; personaName: string; avatarUrl?: string | null }> = [];
    for (const p of ready.slice(0, 3)) {
      const pd = (p.personaData as any) || {};
      const custom: string[] = pd.starterQuestions || [];
      if (custom.length > 0) {
        const idx = (new Date().getDate() + p.id) % custom.length;
        result.push({ text: custom[idx], personaId: p.id, personaName: p.name, avatarUrl: p.avatarUrl });
      } else {
        const idx = (starterIdx + p.id) % CONVERSATION_STARTERS.length;
        result.push({
          text: CONVERSATION_STARTERS[idx],
          personaId: p.id,
          personaName: p.name,
          avatarUrl: p.avatarUrl,
        });
      }
    }
    return result;
  }, [ready, starterIdx]);

  // 所有 Hook 必须在任何提前 return 之前调用：ready 从 0 变非 0 时若 Hook 数量变化，
  // React 会抛 "Rendered more hooks than during the previous render" 并使整页崩到错误界面。
  if (ready.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-primary/80" />
          <h2 className="text-sm font-semibold text-foreground">今日话题灵感</h2>
        </div>
        <button
          type="button"
          onClick={() => setStarterIdx((starterIdx + 1) % CONVERSATION_STARTERS.length)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          <span>换一批</span>
        </button>
      </div>
      <div className="space-y-2.5">
        {starters.map((s, i) => (
          <button
            key={`${s.personaId}-${i}`}
            type="button"
            onClick={() => onChat(s.personaId)}
            className="w-full flex items-center gap-3.5 px-4 py-3.5 warm-card rounded-2xl border border-border/70 text-left group"
          >
            <img
              src={getAvatarUrl(s.personaName, s.avatarUrl)}
              alt={s.personaName}
              className="w-9 h-9 rounded-xl object-cover flex-shrink-0 border border-border/50"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed truncate">
                “{s.text}”
              </p>
              <span className="text-[11px] text-muted-foreground">问问 {s.personaName}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── PERSONA CONSTELLATION（语义色 SVG，彻底修复深色模式白斑！） ─────────────

function PersonaConstellation({
  personas,
  onChat,
}: {
  personas: any[];
  onChat: (id: number) => void;
}) {
  const ready = personas.filter((p: any) => p.analysisStatus === "ready");
  if (ready.length < 2) return null;

  const cx = 140;
  const cy = 92;
  const radius = 64;
  const nodes = ready.slice(0, 6).map((p: any, i: number) => {
    const angle = (i / Math.min(ready.length, 6)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
    return { ...p, x, y, emotion };
  });

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Orbit className="w-3.5 h-3.5 text-primary/80" />
          <h3 className="text-xs font-semibold text-foreground">关系星图</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">点选星节点即可对话</span>
      </div>

      <svg viewBox="0 0 280 184" className="w-full" style={{ maxHeight: "196px" }}>
        {/* 分身之间的羁绊细线 */}
        {nodes.map((n, i) =>
          nodes.slice(i + 1).map((m, j) => (
            <line
              key={`${i}-${j}`}
              x1={n.x}
              y1={n.y}
              x2={m.x}
              y2={m.y}
              stroke="var(--color-border)"
              strokeOpacity="0.65"
              strokeDasharray="2 3"
              strokeWidth="1"
            />
          ))
        )}

        {/* 中心“我”到各分身的连接线 */}
        {nodes.map(n => (
          <line
            key={`link-${n.id}`}
            x1={cx}
            y1={cy}
            x2={n.x}
            y2={n.y}
            stroke={n.emotion.color}
            strokeWidth="1.25"
            strokeOpacity="0.35"
          />
        ))}

        {/* 中心节点“我” */}
        <circle
          cx={cx}
          cy={cy}
          r="11"
          fill="var(--color-muted)"
          stroke="var(--color-primary)"
          strokeOpacity="0.45"
          strokeWidth="1.25"
        />
        <text
          x={cx}
          y={cy + 3.5}
          textAnchor="middle"
          fontSize="8.5"
          fill="var(--color-primary)"
          fontWeight="600"
        >
          我
        </text>

        {/* 分身节点：使用 var(--color-card) 杜绝暗色模式刺眼白斑 */}
        {nodes.map(n => (
          <g
            key={n.id}
            onClick={() => onChat(n.id)}
            className="cursor-pointer"
          >
            <circle
              cx={n.x}
              cy={n.y}
              r="16"
              fill="var(--color-card)"
              stroke={n.emotion.color}
              strokeWidth="1.75"
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="600"
              fill="var(--color-foreground)"
            >
              {n.name.charAt(0)}
            </text>
            <text
              x={n.x}
              y={n.y + 27}
              textAnchor="middle"
              fontSize="8"
              fill="var(--color-muted-foreground)"
            >
              {n.name.length > 5 ? n.name.slice(0, 5) : n.name}
            </text>
            <circle
              cx={n.x + 11.5}
              cy={n.y - 11.5}
              r="4"
              fill={n.emotion.color}
              stroke="var(--color-card)"
              strokeWidth="1.5"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── MINI CALENDAR ───────────────────────────────────────────────────────────

function MiniCalendar() {
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const { days, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const dateSet = new Set<string>();
    if (dailyActivity) {
      for (const r of dailyActivity) dateSet.add(String(r.date));
    }
    const days: Array<{ day: number; active: boolean; today: boolean } | null> = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, active: dateSet.has(key), today: d === now.getDate() });
    }
    return { days, monthLabel: `${year}年${month + 1}月` };
  }, [dailyActivity]);

  const activeDays = days.filter(d => d?.active).length;
  if (activeDays === 0 && (!dailyActivity || dailyActivity.length === 0)) return null;

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-3.5 h-3.5 text-primary/80" />
          <h3 className="text-xs font-semibold text-foreground">回忆日历</h3>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {monthLabel} · {activeDays} 天有对话
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["日", "一", "二", "三", "四", "五", "六"].map(d => (
          <div
            key={d}
            className="text-center text-[10px] text-muted-foreground/80 py-0.5"
          >
            {d}
          </div>
        ))}
        {days.map((d, i) => (
          <div
            key={i}
            className={`aspect-square rounded-lg flex items-center justify-center text-[11px] font-mono tabular-nums ${
              !d
                ? ""
                : d.today
                  ? "bg-primary text-primary-foreground font-semibold ring-2 ring-primary/25"
                  : d.active
                    ? "bg-primary/14 text-primary font-medium"
                    : "text-muted-foreground/65"
            }`}
          >
            {d?.day || ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PERSONA LEADERBOARD ─────────────────────────────────────────────────────

function PersonaLeaderboard({ personas }: { personas: any[] }) {
  const ranked = useMemo(() => {
    return [...personas]
      .filter((p: any) => (p.chatCount || 0) > 0)
      .sort((a, b) => (b.chatCount || 0) - (a.chatCount || 0))
      .slice(0, 3);
  }, [personas]);

  if (ranked.length < 2) return null;

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center gap-2 mb-3.5">
        <TrendingUp className="w-3.5 h-3.5 text-primary/80" />
        <h3 className="text-xs font-semibold text-foreground">倾诉最多</h3>
      </div>
      <div className="space-y-3">
        {ranked.map((p: any, i: number) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const maxChats = ranked[0].chatCount || 1;
          const pct = Math.round(((p.chatCount || 0) / maxChats) * 100);
          return (
            <div key={p.id} className="flex items-center gap-3">
              <span
                className={`w-5 h-5 rounded-md text-[11px] font-mono tabular-nums font-semibold flex items-center justify-center shrink-0 ${
                  i === 0
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "bg-muted text-muted-foreground border border-border/60"
                }`}
              >
                {i + 1}
              </span>
              <div
                className="mood-ring-sm flex-shrink-0"
                style={{ "--mood-color": emotion.color } as any}
              >
                <img
                  src={getAvatarUrl(p.name, p.avatarUrl)}
                  alt={p.name}
                  className="w-7 h-7 rounded-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground truncate">{p.name}</span>
                  <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                    {p.chatCount} 次
                  </span>
                </div>
                <div className="h-1.5 bg-muted/70 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 bg-primary/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RELATIONSHIP DEPTH RING ─────────────────────────────────────────────────

function DepthRing({ value, size = 26 }: { value: number; size?: number }) {
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="depth-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="depth-ring-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="depth-ring-fill"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

// ─── PERSONA CARD（清爽层级 + 无感唤醒刷新 + 丝滑告别信弹窗） ────────────────

function PersonaCard({
  persona,
  onChat,
  onUpload,
  onEdit,
  onDelete,
  onScenes,
  onAwakened,
}: {
  persona: any;
  onChat: () => void;
  onUpload: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onScenes?: () => void;
  onAwakened?: () => void;
}) {
  const utils = trpc.useUtils();
  const status = STATUS_CONFIG[persona.analysisStatus] || STATUS_CONFIG.pending;
  const emotion = EMOTIONAL_STATES[persona.emotionalState] || EMOTIONAL_STATES.warm;
  const EmotionIcon = emotion.Icon;
  const avatar = getAvatarUrl(persona.name, persona.avatarUrl);
  const isAnalyzing = persona.analysisStatus === "analyzing";
  const isReady = persona.analysisStatus === "ready";
  const isGraduated = persona.graduationStatus === "graduated";
  const pd = (persona.personaData as any) || {};
  const togetherDays = persona.togetherFrom
    ? daysBetween(persona.togetherFrom, persona.togetherTo || undefined)
    : null;
  const traits = [pd.personality, pd.speakingStyle].filter(Boolean).join("，");
  const milestone = getMilestone(persona.chatCount || 0);
  const anniversary = persona.togetherFrom
    ? getDaysUntilAnniversary(persona.togetherFrom)
    : null;
  const catchphrases: string[] = pd.catchphrases || [];
  const missLevel = getMissYouLevel(persona.lastChatAt);
  const compatibility = isReady ? getCompatibilityScore(persona) : null;

  const displaySummary = useMemo(() => {
    if (pd.summary) {
      const trimmed = pd.summary.trim();
      const firstSentence = trimmed.split(/[。！!？?]/)[0];
      if (firstSentence && firstSentence.length >= 18 && firstSentence.length <= 76) {
        return firstSentence + "。";
      }
      return trimmed.length > 76 ? trimmed.slice(0, 76) + "..." : trimmed;
    }
    if (traits) {
      return traits.length > 76 ? traits.slice(0, 76) + "..." : traits;
    }
    return null;
  }, [pd.summary, traits]);

  const displayRelation = useMemo(() => {
    if (!persona.relationshipDesc) return "小说角色";
    const firstPart = persona.relationshipDesc.split(/[；;]/)[0].trim();
    return firstPart.length > 42 ? firstPart.slice(0, 42) + "..." : firstPart;
  }, [persona.relationshipDesc]);

  const attachmentTag = useMemo(
    () => formatCompactTraitTag(pd.attachmentStyle),
    [pd.attachmentStyle]
  );
  const loveLanguageTag = useMemo(
    () => formatCompactTraitTag(pd.loveLanguage),
    [pd.loveLanguage]
  );

  const [showLetter, setShowLetter] = useState(false);
  const tilt = useTilt(2.5);

  const awakenMutation = trpc.persona.awaken.useMutation({
    onSuccess: async () => {
      toast.success(`${persona.name} 已被温柔唤醒`);
      await Promise.all([
        utils.persona.list.invalidate(),
        utils.persona.stats.invalidate(),
      ]);
      onAwakened?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className={`warm-card tilt-card p-5 group relative flex flex-col justify-between rounded-3xl border border-border/70 transition-all duration-300 ${
        isGraduated ? "opacity-80" : ""
      }`}
    >
      <div className="space-y-3.5">
        {/* 纪念日温和提醒 */}
        {anniversary !== null && anniversary <= 30 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/[0.06] border border-primary/15">
            <Gift className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs font-medium text-foreground/85">
              {anniversary === 0 ? (
                "今日是你们的共同纪念日"
              ) : (
                <>
                  距离共同纪念日还有{" "}
                  <span className="font-mono tabular-nums text-primary">{anniversary}</span> 天
                </>
              )}
            </span>
          </div>
        )}

        {/* 头部：头像与对称三层人物抬头 */}
        <div className="flex items-start gap-3.5">
          <div className="relative shrink-0">
            <div
              className="mood-ring p-[2.5px] rounded-2xl transition-transform duration-300 group-hover:scale-[1.02]"
              style={{ "--mood-color": emotion.color } as any}
            >
              <img
                src={avatar}
                alt={persona.name}
                className="w-13 h-13 sm:w-14 sm:h-14 rounded-xl object-cover bg-muted border border-border/50"
                loading="lazy"
              />
            </div>

            {isReady && !isGraduated && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
            )}

            {compatibility !== null && (
              <div
                className="absolute -bottom-1.5 -left-1.5 z-10 bg-card rounded-full p-0.5 shadow-sm border border-border/70"
                title={`故事活跃度 ${compatibility}%`}
              >
                <div className="relative w-6.5 h-6.5 flex items-center justify-center">
                  <DepthRing value={compatibility} size={26} />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold leading-none text-primary tabular-nums tracking-tighter">
                    {compatibility}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-base leading-snug text-foreground tracking-tight truncate group-hover:text-primary transition-colors">
                {persona.name}
              </h3>
              {isGraduated ? (
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted/80 border border-border/70 text-[10px] leading-none text-muted-foreground font-medium shrink-0 whitespace-nowrap">
                  <GraduationCap className="w-3 h-3" />
                  毕业休眠
                </span>
              ) : missLevel ? (
                <span className="inline-flex items-center h-5 px-2 rounded-full bg-rose-500/10 border border-rose-500/20 text-[10px] leading-none text-rose-600 dark:text-rose-400 font-medium shrink-0 whitespace-nowrap">
                  {missLevel}
                </span>
              ) : null}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted/65 border border-border/60 text-[10px] leading-none font-medium text-muted-foreground whitespace-nowrap">
                <EmotionIcon className="w-2.5 h-2.5 text-primary/80 shrink-0" />
                {emotion.label}
              </span>
              {!isGraduated && milestone && (
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary/[0.08] border border-primary/20 text-[10px] leading-none font-medium text-primary whitespace-nowrap">
                  <Award className="w-3 h-3 shrink-0" />
                  {milestone.label}
                </span>
              )}
            </div>

            <p
              className="text-muted-foreground text-xs leading-normal mt-1.5 truncate"
              title={persona.relationshipDesc}
            >
              {displayRelation}
              {persona.intimacyLevel && persona.intimacyLevel !== "初识"
                ? ` · ${persona.intimacyLevel}`
                : ""}
            </p>
          </div>
        </div>

        {/* 核心人设简介 */}
        {displaySummary && isReady && (
          <div className="relative px-3 py-2 rounded-xl bg-muted/30 border border-border/50 text-xs leading-relaxed text-foreground/80">
            <div className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r bg-primary/55" />
            <p className="pl-1.5 line-clamp-2">{displaySummary}</p>
          </div>
        )}

        {/* 精简特征微标签（统一单行高度胶囊，长文本提炼摘要并支持悬停看全） */}
        {isReady && (catchphrases.length > 0 || attachmentTag || loveLanguageTag) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {catchphrases.slice(0, 2).map((phrase: string, i: number) => (
              <span
                key={i}
                title={phrase}
                className="inline-flex items-center h-5 px-2.5 rounded-full bg-primary/[0.07] text-primary text-[10px] leading-none font-medium border border-primary/15 max-w-[150px] truncate"
              >
                “{phrase}”
              </span>
            ))}
            {attachmentTag && (
              <span
                title={attachmentTag.full}
                className="inline-flex items-center h-5 px-2.5 rounded-full bg-muted/60 border border-border/55 text-[10px] leading-none text-muted-foreground max-w-[176px] truncate"
              >
                {attachmentTag.short}
              </span>
            )}
            {loveLanguageTag && (
              <span
                title={loveLanguageTag.full}
                className="inline-flex items-center h-5 px-2.5 rounded-full bg-muted/60 border border-border/55 text-[10px] leading-none text-muted-foreground max-w-[150px] truncate"
              >
                {loveLanguageTag.short}
              </span>
            )}
          </div>
        )}

        {/* 数据与陪伴指标栏 */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
              {status.label}
            </span>
            {persona.chatCount > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <MessageCircle className="w-3 h-3 text-muted-foreground/70" />
                {persona.chatCount}
              </span>
            )}
            {persona.fileCount > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <FileText className="w-3 h-3 text-muted-foreground/70" />
                {persona.fileCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 text-[11px]">
            {togetherDays && (
              <span className="inline-flex items-center gap-1 text-foreground/75">
                <Heart className="w-3 h-3 text-primary/75" />
                <span className="tabular-nums">{togetherDays}</span> 日
              </span>
            )}
            {persona.lastChatAt && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/80">
                <Clock className="w-3 h-3 text-muted-foreground/60" />
                {relativeTime(persona.lastChatAt)}
              </span>
            )}
          </div>
        </div>

        {/* 解析进度条 */}
        {isAnalyzing && (
          <div className="pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span className="font-medium">{getAnalysisStage(persona.analysisProgress || 0)}</span>
              <span className="font-semibold font-mono tabular-nums text-primary">
                {persona.analysisProgress || 0}%
              </span>
            </div>
            <div className="h-1.5 bg-muted/70 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 progress-bar"
                style={{ width: `${persona.analysisProgress || 0}%` }}
              />
            </div>
          </div>
        )}

        {/* 最新消息微预览 */}
        {persona.lastMessage && !isAnalyzing && (
          <div className="px-3 py-2 bg-muted/25 rounded-xl border border-border/45 text-[11px] text-foreground/80 leading-relaxed flex items-center justify-between gap-2">
            <p className="truncate flex-1">{persona.lastMessage.content}</p>
            <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
              {relativeTime(persona.lastMessage.createdAt)}
            </span>
          </div>
        )}
      </div>

      {/* 底部交互栏：主操作突出，次操作清爽统一无杂色 */}
      <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border/55">
        {isGraduated ? (
          <>
            <Button
              size="sm"
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-9 text-xs font-medium shadow-xs gap-1.5"
              onClick={() => awakenMutation.mutate({ id: persona.id })}
              disabled={awakenMutation.isPending}
            >
              {awakenMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sunrise className="w-3.5 h-3.5" />
              )}
              <span>{awakenMutation.isPending ? "正在唤醒..." : "重新唤醒"}</span>
            </Button>
            {persona.farewellLetter && (
              <button
                type="button"
                className="h-9 w-9 rounded-xl border border-border/65 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center transition-colors shrink-0"
                onClick={() => setShowLetter(true)}
                title="翻阅告别书信"
              >
                <BookOpen className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <>
            <Button
              onClick={onChat}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl text-xs h-9 shadow-xs gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>进入对话</span>
            </Button>

            {onScenes && (
              <button
                type="button"
                onClick={onScenes}
                className="h-9 w-9 rounded-xl border border-border/65 bg-muted/35 text-muted-foreground hover:text-foreground hover:bg-muted/75 flex items-center justify-center transition-colors shrink-0"
                title="情境剧场"
              >
                <Theater className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onUpload}
              className="h-9 w-9 rounded-xl border border-border/65 bg-muted/35 text-muted-foreground hover:text-foreground hover:bg-muted/75 flex items-center justify-center transition-colors shrink-0"
              title="导入记忆资料"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onEdit}
              className="h-9 w-9 rounded-xl border border-border/65 bg-muted/35 text-muted-foreground hover:text-foreground hover:bg-muted/75 flex items-center justify-center transition-colors shrink-0"
              title="编辑人设档案"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onDelete}
              className="h-9 w-9 rounded-xl border border-transparent text-muted-foreground/65 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20 flex items-center justify-center transition-colors shrink-0"
              title="删除分身"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* 告别书信弹窗（Portal + 丝滑弹簧进退场，脱离 tilt transform 包含块） */}
      <MotionModal
        open={Boolean(showLetter && persona.farewellLetter)}
        onClose={() => setShowLetter(false)}
        ariaLabel={`${persona.name} 的告别书信`}
        className="max-w-md p-6 sm:p-7"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">
              {persona.name} 留下的书信
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowLetter(false)}
            aria-label="关闭书信"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-muted/35 border border-border/60 rounded-2xl p-5 leading-relaxed">
          <p className="text-foreground/90 text-sm whitespace-pre-wrap leading-[1.85]">
            {persona.farewellLetter}
          </p>
          <p className="text-right text-muted-foreground text-xs mt-5 font-medium">
            —— {persona.name}
          </p>
        </div>

        {persona.graduatedAt && (
          <p className="text-[11px] text-muted-foreground/70 text-center mt-4 font-mono tabular-nums">
            书于 {formatBeijingDate(persona.graduatedAt)}
          </p>
        )}
      </MotionModal>
    </div>
  );
}

// ─── QUICK CHAT BAR ──────────────────────────────────────────────────────────

function QuickChatBar({
  personas,
  onChat,
}: {
  personas: any[];
  onChat: (id: number) => void;
}) {
  const readyPersonas = personas.filter((p: any) => p.analysisStatus === "ready");
  if (readyPersonas.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">继续对话</h2>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {readyPersonas.length} 位在线
        </span>
      </div>
      <div className="flex gap-4 overflow-x-auto pt-1 px-1 pb-2 -mx-1 scrollbar-hide">
        {readyPersonas.map((p: any) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const miss = getMissYouLevel(p.lastChatAt);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChat(p.id)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group relative"
            >
              <div className="relative">
                <div
                  className="mood-ring-sm"
                  style={{ "--mood-color": emotion.color } as any}
                >
                  <img
                    src={getAvatarUrl(p.name, p.avatarUrl)}
                    alt={p.name}
                    className="w-12 h-12 rounded-2xl object-cover group-hover:scale-105 transition-transform border border-border/60"
                  />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
                {miss && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-background" />
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-[64px]">
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── EMOTIONAL WEATHER ───────────────────────────────────────────────────────

function EmotionalWeather({ personas }: { personas: any[] }) {
  const moodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of personas) {
      const state = p.emotionalState || "warm";
      counts[state] = (counts[state] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [personas]);

  if (personas.length < 2) return null;

  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Palette className="w-3.5 h-3.5 text-primary/80" />
        <h3 className="text-xs font-semibold text-foreground">情感气象</h3>
      </div>
      <div className="flex items-end gap-3 h-16">
        {moodCounts.map(([state, count]) => {
          const e = EMOTIONAL_STATES[state] || EMOTIONAL_STATES.warm;
          const Icon = e.Icon;
          const pct = Math.round((count / personas.length) * 100);
          return (
            <div key={state} className="flex flex-col items-center gap-1.5 flex-1">
              <div
                className="w-full max-w-[40px] rounded-t-lg transition-all duration-500"
                style={{
                  height: `${Math.max(10, pct * 0.42)}px`,
                  backgroundColor: e.color,
                  opacity: 0.72,
                }}
              />
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Icon className="w-2.5 h-2.5" />
                {e.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MEMORY HIGHLIGHTS ───────────────────────────────────────────────────────

function MemoryHighlights({ personas }: { personas: any[] }) {
  const highlights = useMemo(() => {
    const items: Array<{ name: string; avatarUrl?: string | null; text: string; type: string }> = [];
    for (const p of personas) {
      const pd = (p.personaData as any) || {};
      if (pd.touchingMoments) {
        items.push({
          name: p.name,
          avatarUrl: p.avatarUrl,
          text: pd.touchingMoments,
          type: "touching",
        });
      }
      if (pd.memories) {
        items.push({
          name: p.name,
          avatarUrl: p.avatarUrl,
          text: typeof pd.memories === "string" ? pd.memories.slice(0, 88) : "",
          type: "memory",
        });
      }
    }
    return items.filter(i => i.text).slice(0, 4);
  }, [personas]);

  if (highlights.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-primary/80" />
        <h2 className="text-sm font-semibold text-foreground">记忆吉光</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {highlights.map((h, i) => (
          <div
            key={i}
            className="warm-card warm-card-static rounded-2xl border border-border/70 p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <img
                  src={getAvatarUrl(h.name, h.avatarUrl)}
                  alt={h.name}
                  className="w-5 h-5 rounded-md object-cover"
                />
                <span className="text-xs font-semibold text-foreground">{h.name}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/65 text-muted-foreground">
                {h.type === "touching" ? "心动瞬间" : "共同记忆"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {h.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RECENT ACTIVITY TIMELINE ────────────────────────────────────────────────

function RecentActivity({ onNavigate }: { onNavigate: (personaId: number) => void }) {
  const { data: activity } = trpc.persona.recentActivity.useQuery();
  if (!activity || activity.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-3">最近对话足迹</h2>
      <div className="warm-card warm-card-static rounded-3xl border border-border/70 divide-y divide-border/60 overflow-hidden">
        {activity.slice(0, 6).map((item: any) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.personaId)}
            className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-muted/35 transition-colors text-left"
          >
            <img
              src={generateAvatar(item.personaName)}
              alt={item.personaName}
              className="w-8 h-8 rounded-xl object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium text-foreground">
                  {item.role === "user" ? "你" : item.personaName}
                </span>
                <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
                <span className="text-muted-foreground">
                  {item.role === "user" ? item.personaName : "你"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{item.content}</p>
            </div>
            <span className="text-[11px] text-muted-foreground/75 shrink-0 font-mono tabular-nums">
              {relativeTime(item.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── TIPS SECTION ────────────────────────────────────────────────────────────

function TipsSection() {
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const tip = TIPS[tipIdx];
  const Icon = tip.icon;
  return (
    <div className="warm-card warm-card-static rounded-2xl border border-border/70 p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground/85 mb-0.5">使用贴士</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{tip.text}</p>
      </div>
      <button
        type="button"
        onClick={() => setTipIdx((tipIdx + 1) % TIPS.length)}
        className="text-xs text-muted-foreground hover:text-primary flex-shrink-0 mt-0.5 transition-colors"
      >
        换一条
      </button>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const quote = useMemo(
    () => LOVE_QUOTES[Math.floor(Math.random() * LOVE_QUOTES.length)],
    []
  );
  return (
    <div className="warm-card warm-card-static rounded-3xl border border-border/70 py-14 px-6 text-center max-w-xl mx-auto">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/15 mb-6">
        <Sparkles className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground tracking-tight mb-2">
        创建你的第一个角色
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
        导入聊天记录与共同记忆，AI 将细致学习 TA 的说话语气与性格脉络，在这里静静回应你的思念。
      </p>
      <p className="text-xs text-muted-foreground/75 italic mb-8 max-w-xs mx-auto">
        “{quote}”
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 mb-8 text-muted-foreground">
        {[
          { icon: Plus, label: "创建分身", num: "01" },
          { icon: Upload, label: "导入素材", num: "02" },
          { icon: Brain, label: "性格提炼", num: "03" },
          { icon: MessageCircle, label: "开启对话", num: "04" },
        ].map((step, i) => (
          <div key={step.num} className="flex items-center gap-3">
            {i > 0 && <div className="hidden sm:block w-5 h-px bg-border" />}
            <div className="flex flex-col items-center gap-1.5">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-muted/55 border border-border/60 flex items-center justify-center">
                  <step.icon className="w-4 h-4 text-primary/85" />
                </div>
                <span className="absolute -top-1.5 -right-1.5 px-1 h-4 rounded-full bg-primary text-[9px] font-mono tabular-nums text-primary-foreground flex items-center justify-center font-semibold">
                  {step.num}
                </span>
              </div>
              <span className="text-[11px]">{step.label}</span>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={onCreate}
        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 px-6 shadow-xs gap-2"
      >
        <Plus className="w-4 h-4" />
        <span>创建数字分身</span>
      </Button>
    </div>
  );
}

// ─── CREATE MODAL（丝滑 MotionModal + CollapseSection 高度展开） ─────────────

function CreatePersonaDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherSince, setTogetherSince] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  const createMutation = trpc.persona.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(`${name} 的数字分身已创建`);
      onCreated(data.id);
      setName("");
      setRelationshipDesc("");
      setTogetherSince("");
      setShowEndDate(false);
      setEndDate("");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("创建失败：" + e.message),
  });

  const handleClose = () => {
    if (!createMutation.isPending) onOpenChange(false);
  };

  return (
    <MotionModal
      open={open}
      onClose={handleClose}
      ariaLabel="创建数字分身"
      className="max-w-md p-6 sm:p-7"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">创建数字分身</h2>
            <p className="text-xs text-muted-foreground">填写基本印象，随后导入对话记忆</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭弹窗"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          if (!name.trim()) return;
          createMutation.mutate({
            name: name.trim(),
            relationshipDesc: relationshipDesc.trim() || undefined,
            togetherSince: togetherSince || undefined,
            endDate: showEndDate && endDate ? endDate : undefined,
          } as any);
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground/80">TA 的名字</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="输入称呼或姓名"
            className="h-10 bg-muted/45 border-border/70 rounded-xl"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground/80">关系描述</Label>
          <Input
            value={relationshipDesc}
            onChange={e => setRelationshipDesc(e.target.value)}
            placeholder="例如：相伴多年的挚友 / 爱人"
            className="h-10 bg-muted/45 border-border/70 rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-foreground/80">相识或相伴起始日</Label>
          <Input
            type="date"
            value={togetherSince}
            onChange={e => setTogetherSince(e.target.value)}
            className="h-10 bg-muted/45 border-border/70 rounded-xl font-mono tabular-nums"
          />
        </div>

        <div className="space-y-1.5">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showEndDate}
              onChange={e => setShowEndDate(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            <span className="text-xs text-muted-foreground">设置一段时光的结束日期</span>
          </label>
          <CollapseSection open={showEndDate}>
            <div className="pt-1.5">
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                tabIndex={showEndDate ? 0 : -1}
                className="h-10 bg-muted/45 border-border/70 rounded-xl font-mono tabular-nums"
              />
            </div>
          </CollapseSection>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/55">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={createMutation.isPending}
            className="rounded-xl h-9 px-4"
          >
            取消
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-9 px-5 gap-1.5 shadow-xs"
          >
            {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{createMutation.isPending ? "正在创建..." : "创建并导入资料"}</span>
          </Button>
        </div>
      </form>
    </MotionModal>
  );
}

// ─── ROLEPLAY CHANNELS SECTION ──────────────────────────────────────────────

function RoleplayTabSection() {
  const [, navigate] = useLocation();
  const channelsQuery = trpc.roleplay.list.useQuery();
  const channels = (channelsQuery.data ?? []) as any[];

  return (
    <div className="space-y-6">
      {/* 静奢横幅 */}
      <div className="warm-card warm-card-static rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-card/95 via-card/90 to-primary/[0.05] border border-border/70 relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-md">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/15 text-primary text-xs font-medium">
              <Theater className="w-3.5 h-3.5" />
              <span>多角色生活剧场</span>
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-foreground">角色生活频道</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              将多位数字分身置于同一生活情境中，观察他们的心声流转，让彼此自然对话、互动与陪伴。
            </p>
          </div>
          <Button
            onClick={() => navigate("/roleplay")}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-xs self-start sm:self-center flex items-center gap-1.5 text-xs h-9 px-4"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>进入频道大厅</span>
          </Button>
        </div>
      </div>

      {/* 频道列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">活跃频道</h3>
            <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {channels.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/roleplay")}
            className="text-xs text-primary hover:text-primary/85 hover:bg-primary/8 rounded-xl h-8 px-2.5"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            新建频道
          </Button>
        </div>

        {channels.length === 0 ? (
          <div className="warm-card warm-card-static rounded-3xl border border-border/70 p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/15 text-primary mx-auto flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">暂无角色频道</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                创建客厅、深夜茶室或旅途场景，让多位分身在同一房间里自然交谈。
              </p>
            </div>
            <Button
              onClick={() => navigate("/roleplay")}
              variant="outline"
              className="rounded-xl text-xs h-8.5 border-border/70 hover:bg-muted/60"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              创建第一个频道
            </Button>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {channels.map((c: any) => (
              <div
                key={c.id}
                onClick={() => navigate("/roleplay")}
                className="warm-card rounded-2xl border border-border/70 p-4.5 cursor-pointer group space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                      <span className="truncate">{c.name}</span>
                      {c.channelKind === "duet" && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-medium shrink-0"
                          title="QQ「对戏」专用频道：与角色生活频道相互隔离"
                        >
                          对戏
                        </span>
                      )}
                    </h4>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {c.scenePrompt || c.description || "自由日常互动场景"}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full bg-muted/70 border border-border/60 text-muted-foreground font-medium shrink-0">
                    {c.members?.length || 0} 人
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-border/50 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] shrink-0">成员：</span>
                    <span className="font-medium text-foreground/85 truncate max-w-[160px]">
                      {c.members?.map((m: any) => m.personaName).join("、") || "暂无成员"}
                    </span>
                  </div>
                  <span className="text-primary inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform shrink-0">
                    进入
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN LOBBY ──────────────────────────────────────────────────────────────

export default function Lobby() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTabKey>("all");
  const [sortBy, setSortBy] = useState("recent");
  const [showSort, setShowSort] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSort) return;
    const handleOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSort(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showSort]);

  const { data: personas, refetch } = trpc.persona.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: query => {
      const list = query.state.data;
      return list?.some((p: any) => p.analysisStatus === "analyzing") ? 3000 : false;
    },
  });

  const { data: stats } = trpc.persona.stats.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const deleteMutation = trpc.persona.delete.useMutation({
    onSuccess: () => {
      toast.success("分身及关联记录已移除");
      setDeleteTarget(null);
      refetch();
    },
    onError: (e: any) => toast.error("删除失败：" + e.message),
  });

  const filteredPersonas = useMemo(() => {
    if (!personas) return [];
    let list = personas as any[];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.relationshipDesc || "").toLowerCase().includes(q)
      );
    }
    if (filterTab !== "all") {
      list = list.filter(p => p.analysisStatus === filterTab);
    }
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "chats":
          return (b.chatCount || 0) - (a.chatCount || 0);
        case "name":
          return a.name.localeCompare(b.name, "zh-CN");
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: {
          const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
          const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
          return bTime - aTime;
        }
      }
    });
    return list;
  }, [personas, searchQuery, filterTab, sortBy]);

  const filterSegmentedOptions = useMemo(() => {
    if (!personas) return [];
    return FILTER_TABS.map(tab => {
      const count =
        tab.key === "all"
          ? personas.length
          : personas.filter((p: any) => p.analysisStatus === tab.key).length;
      return {
        value: tab.key,
        label: tab.label,
        badge: count > 0 ? count : undefined,
        disabled: tab.key !== "all" && count === 0,
      };
    }).filter(opt => opt.value === "all" || (opt.badge ?? 0) > 0);
  }, [personas]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-card border border-border/70 shadow-xs flex items-center justify-center animate-pulse">
          <Leaf className="w-4 h-4 text-primary" />
        </div>
      </div>
    );
  }

  const hasPersonas = personas && personas.length > 0;
  const readyCount =
    personas?.filter((p: any) => p.analysisStatus === "ready").length || 0;
  const analyzingCount =
    personas?.filter((p: any) => p.analysisStatus === "analyzing").length || 0;

  const navIconBtnClass =
    "app-nav-icon w-9 h-9 rounded-xl border border-border/65 bg-card/75 text-muted-foreground hover:text-foreground hover:bg-muted/75 backdrop-blur-md flex items-center justify-center transition-all active:scale-95";

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-x-clip">
      {/* 温润静奢环境底色（已移除廉价赛博粒子 tech-particles） */}
      <div className="gradient-mesh-bg opacity-75" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-32 left-1/2 -translate-x-1/2 w-[42rem] h-[42rem] rounded-full bg-primary/[0.05] blur-3xl"
      />

      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav max-w-3xl">
          <div className="app-nav-brand">
            <div className="app-nav-mark">
              <Leaf className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="app-nav-title tracking-tight">书中人</span>
          </div>

          <div className="app-nav-spacer" />

          {analyzingCount > 0 && (
            <span className="text-xs text-primary mr-2 hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/[0.08] border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="font-mono tabular-nums">{analyzingCount}</span> 个解析中
            </span>
          )}

          {/* 顶栏动作组：统一收敛为优雅克制的毛玻璃图标按钮 */}
          <div className="app-nav-actions flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="h-9 px-3 rounded-xl border border-primary/25 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground text-xs font-medium inline-flex items-center gap-1 transition-all active:scale-95"
              title="新建角色"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">新建</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/roleplay")}
              className={navIconBtnClass}
              title="角色生活频道"
            >
              <Theater className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/diary")}
              className={navIconBtnClass}
              title="对话日记"
            >
              <BookOpen className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/analytics")}
              className={navIconBtnClass}
              title="数据看板"
            >
              <Activity className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/settings")}
              className={navIconBtnClass}
              title="系统设置"
            >
              <Settings className="w-4 h-4" />
            </button>

            {user?.username && (
              <div
                title={`当前账号：${user.username}`}
                className="hidden sm:flex w-9 h-9 rounded-xl bg-muted/60 border border-border/65 text-foreground/85 items-center justify-center font-semibold text-xs select-none"
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                logout();
                navigate(getLoginUrl());
              }}
              className={`${navIconBtnClass} hover:text-destructive hover:border-destructive/25 hover:bg-destructive/10`}
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="container py-6 max-w-3xl mx-auto flex-1 relative z-10">
        <HeroBanner
          username={user?.username}
          stats={stats}
          readyCount={readyCount}
          onCreate={() => setShowCreate(true)}
        />

        {hasPersonas ? (
          <Tabs defaultValue="companions" className="space-y-6">
            <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1.5 rounded-2xl bg-muted/55 border border-border/65 backdrop-blur-sm">
              <TabsTrigger
                value="companions"
                className="text-xs py-2 rounded-xl font-medium cursor-pointer"
              >
                <Heart className="w-3.5 h-3.5 mr-1.5 opacity-80" />
                我的分身
              </TabsTrigger>
              <TabsTrigger
                value="roleplay"
                className="text-xs py-2 rounded-xl font-medium cursor-pointer"
              >
                <Theater className="w-3.5 h-3.5 mr-1.5 opacity-80" />
                角色剧场
              </TabsTrigger>
              <TabsTrigger
                value="memories"
                className="text-xs py-2 rounded-xl font-medium cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 opacity-80" />
                记忆星河
              </TabsTrigger>
              <TabsTrigger
                value="stats"
                className="text-xs py-2 rounded-xl font-medium cursor-pointer"
              >
                <TrendingUp className="w-3.5 h-3.5 mr-1.5 opacity-80" />
                陪伴印记
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="companions"
              className="space-y-6 focus-visible:outline-none focus:outline-none"
            >
              {readyCount === 0 && analyzingCount > 0 && (
                <div className="p-4 rounded-2xl bg-primary/[0.06] border border-primary/15 text-center">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    分身记忆正在深度提炼中，解析完成后即可开启对话
                  </p>
                </div>
              )}

              <TodayRecommendation
                personas={personas as any[]}
                onChat={id => navigate(`/chat/${id}`)}
              />
              <QuickChatBar
                personas={personas as any[]}
                onChat={id => navigate(`/chat/${id}`)}
              />
              <DailyMessages
                personas={personas as any[]}
                onChat={id => navigate(`/chat/${id}`)}
              />

              {/* 分身主列表区 */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">全部数字分身</h2>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground">
                      ({personas.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 排序弹出菜单（MotionPopover 弹簧过渡） */}
                    <div ref={sortMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowSort(v => !v)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border/65 bg-card/70 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ArrowUpDown className="w-3 h-3" />
                        <span>{SORT_OPTIONS.find(s => s.key === sortBy)?.label}</span>
                      </button>
                      <MotionPopover
                        open={showSort}
                        direction="down"
                        className="absolute right-0 top-9 bg-card/98 backdrop-blur-xl border border-border/75 rounded-2xl shadow-xl py-1.5 z-30 min-w-[124px]"
                      >
                        {SORT_OPTIONS.map(opt => {
                          const active = sortBy === opt.key;
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => {
                                setSortBy(opt.key);
                                setShowSort(false);
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-3.5 py-1.5 text-xs hover:bg-muted/60 transition-colors ${
                                active ? "text-primary font-semibold" : "text-muted-foreground"
                              }`}
                            >
                              <span>{opt.label}</span>
                              {active && <Check className="w-3 h-3 text-primary" />}
                            </button>
                          );
                        })}
                      </MotionPopover>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCreate(true)}
                      className="text-xs text-primary hover:text-primary hover:bg-primary/10 rounded-xl h-8 px-2.5 gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建分身</span>
                    </Button>
                  </div>
                </div>

                {/* 搜索与弹簧胶囊筛选栏 */}
                {personas.length > 2 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    {filterSegmentedOptions.length > 1 && (
                      <SegmentedControl<FilterTabKey>
                        size="xs"
                        layoutId="lobby-persona-filter-pill"
                        ariaLabel="分身状态筛选"
                        options={filterSegmentedOptions}
                        value={filterTab}
                        onChange={setFilterTab}
                      />
                    )}
                    <div className="relative flex-1 sm:max-w-[220px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="搜索分身姓名或关系..."
                        className="w-full h-8 pl-8.5 pr-3 text-xs bg-card/75 border border-border/70 rounded-xl outline-none focus:ring-2 focus:ring-primary/25 placeholder:text-muted-foreground/50"
                      />
                    </div>
                  </div>
                )}

                {/* 分身卡片网格（筛选温和过渡） */}
                <motion.div
                  key={`${filterTab}-${sortBy}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  {filteredPersonas.map((p: any) => (
                    <PersonaCard
                      key={p.id}
                      persona={p}
                      onChat={() => navigate(`/chat/${p.id}`)}
                      onScenes={() => navigate(`/scenes/${p.id}`)}
                      onUpload={() => navigate(`/upload/${p.id}`)}
                      onEdit={() => navigate(`/persona/${p.id}/edit`)}
                      onDelete={() => setDeleteTarget(p)}
                      onAwakened={() => refetch()}
                    />
                  ))}

                  {filteredPersonas.length === 0 && searchQuery && (
                    <div className="col-span-2 warm-card warm-card-static rounded-2xl border border-border/65 py-10 text-center text-xs text-muted-foreground">
                      没有找到与“{searchQuery}”匹配的分身
                    </div>
                  )}

                  {filteredPersonas.length === 0 && !searchQuery && filterTab !== "all" && (
                    <div className="col-span-2 warm-card warm-card-static rounded-2xl border border-border/65 py-10 text-center text-xs text-muted-foreground">
                      当前筛选分类下暂无分身
                    </div>
                  )}
                </motion.div>
              </div>
            </TabsContent>

            <TabsContent
              value="roleplay"
              className="space-y-6 focus-visible:outline-none focus:outline-none"
            >
              <RoleplayTabSection />
            </TabsContent>

            <TabsContent
              value="memories"
              className="space-y-6 focus-visible:outline-none focus:outline-none"
            >
              <PersonaConstellation
                personas={personas as any[]}
                onChat={id => navigate(`/chat/${id}`)}
              />
              <EmotionalWeather personas={personas as any[]} />
              <MemoryHighlights personas={personas as any[]} />
              <ConversationStarters
                personas={personas as any[]}
                onChat={id => navigate(`/chat/${id}`)}
              />
            </TabsContent>

            <TabsContent
              value="stats"
              className="space-y-6 focus-visible:outline-none focus:outline-none"
            >
              <ChatStreak />
              <RecentActivity onNavigate={id => navigate(`/chat/${id}`)} />
              <ActivityHeatmap />
              <MiniCalendar />
              <PersonaLeaderboard personas={personas as any[]} />
              <AchievementBadges stats={stats} />
              <TipsSection />
            </TabsContent>
          </Tabs>
        ) : (
          <EmptyState onCreate={() => setShowCreate(true)} />
        )}
      </main>

      <footer className="border-t border-border/50 py-6 relative z-10">
        <div className="container max-w-3xl mx-auto flex items-center justify-between text-xs text-muted-foreground/60">
          <div className="flex items-center gap-1.5">
            <Leaf className="w-3.5 h-3.5 text-primary/70" />
            <span className="font-medium text-foreground/70">书中人</span>
          </div>
          <span>让思念有回应</span>
        </div>
      </footer>

      {hasPersonas && <TypingIndicator personas={personas as any[]} />}

      <CreatePersonaDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={id => {
          refetch();
          navigate(`/upload/${id}`);
        }}
      />

      {/* 删除分身确认弹窗（MotionModal 丝滑弹簧进退场） */}
      <MotionModal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
        ariaLabel="确认删除分身"
        className="max-w-sm p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">确认删除分身？</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                确定要删除{" "}
                <span className="text-foreground font-semibold">{deleteTarget?.name}</span>{" "}
                的数字分身吗？关联对话记录与上传素材都将被永久清除，无法恢复。
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
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-xl h-9 px-4 gap-1.5"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{deleteMutation.isPending ? "正在删除..." : "确认删除"}</span>
            </Button>
          </div>
        </div>
      </MotionModal>

      <ForewordModal />
    </div>
  );
}
