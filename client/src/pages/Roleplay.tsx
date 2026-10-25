import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { formatBeijingTime, formatBeijingDate, formatBeijingDateTime, beijingDateKey } from "@/lib/beijing-time";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PersonaStatePanel from "@/components/PersonaStatePanel";
import QqDeliveryPanel from "@/components/QqDeliveryPanel";
import { isQqDeliveryComplete } from "@shared/qq-delivery";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Compass,
  Copy,
  Database,
  Edit2,
  Eye,
  EyeOff,
  Film,
  Filter,
  Flame,
  History,
  Info,
  Layers,
  LayoutGrid,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquareQuote,
  MoreVertical,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sliders,
  Sparkles,
  Square,
  Star,
  Trash2,
  TrendingUp,
  User,
  Users,
  Volume2,
  VolumeX,
  Wand2,
  X,
  Zap,
  BookOpen,
  Archive,
  AlertTriangle,
  Calendar,
  Activity,
  BarChart3,
  Gauge,
  Heart,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";

type RoleplayPageView = "chat" | "studio";
type WebAdvanceMode = "single" | "multi" | "auto";
type WebAdvanceTask = {
  channelId: number;
  taskId: string;
  mode: WebAdvanceMode;
  cancelled: boolean;
};

const MOOD_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  warm: { label: "温柔", emoji: "🌸", color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  playful: { label: "俏皮", emoji: "😄", color: "text-yellow-600 bg-yellow-500/10 border-yellow-500/20" },
  nostalgic: { label: "思念", emoji: "🌙", color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/20" },
  melancholy: { label: "低落", emoji: "🌧️", color: "text-purple-600 bg-purple-500/10 border-purple-500/20" },
  happy: { label: "开心", emoji: "✨", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  distant: { label: "疏离", emoji: "❄️", color: "text-slate-600 bg-slate-500/10 border-slate-500/20" },
};

const EMOJI_PRESETS = [
  "🎭", "🛋️", "🌙", "🌧️", "☕", "❄️", "📖", "🍳", "🏖️", "🚗", "🏡", "🌸", "🕯️", "🍸", "🌲", "🩺", "✈️", "🍂"
];

const INSPIRATION_TEMPLATES = [
  {
    "title": "古城档案馆",
    "icon": "📚",
    "description": "两位调查员在旧城档案馆核对地图，寻找失落展品的线索。",
    "persona1Role": "认真细致的档案管理员，擅长查阅目录和核对记录。",
    "persona2Role": "受博物馆委托的调查员，负责整理线索与提出问题。",
    "prompt": "围绕地图、记录与证词展开推理。保留不确定性，每轮推进一个可核对的新发现。",
    "starters": "这张地图的标记与馆藏目录不一致。\n我们先核对哪一份记录？"
  },
  {
    "title": "星港检修站",
    "icon": "🚀",
    "description": "工程师与领航员在出航前协作排查飞船的导航故障。",
    "persona1Role": "负责飞船维护的工程师，习惯先核对仪表数据。",
    "persona2Role": "熟悉航线的领航员，带来最新的航行日志。",
    "prompt": "描写工具、仪表与普通检修流程。故障线索前后连贯，人物通过协作逐步排查问题。",
    "starters": "导航信号出现了三次相同偏移。\n请把上一段航行日志调出来。"
  },
  {
    "title": "山间驿站",
    "icon": "🌲",
    "description": "旅行者与向导在山间驿站清点物资，规划下一段行程。",
    "persona1Role": "熟悉山路与天气的向导，尊重同行者的选择。",
    "persona2Role": "记录沿途地理风物的旅行者，携带地图与笔记。",
    "prompt": "通过天气、地形和有限物资形成具体选择，让人物通过讨论制定计划，保持行动连贯。",
    "starters": "前方山口可能有雨，我们有两条路线。\n先清点一下剩余物资。"
  },
  {
    "title": "海边观测站",
    "icon": "🌊",
    "description": "两位自然观察员在海边记录潮汐与候鸟迁徙，整理当天的观察笔记。",
    "persona1Role": "负责记录潮位与风向的观察员，重视可复核的证据。",
    "persona2Role": "擅长速写与辨认鸟类的同行者，协助整理观察记录。",
    "prompt": "用潮汐、海风与候鸟形成普通自然观察情境。区分已观察事实与推测，通过讨论推进任务。",
    "starters": "今天的潮线比昨日高了一点。\n我们先复核时间记录，再整理这页速写。"
  }
];

const PROMPT_TAGS = [
  "突出环境细节",
  "对话推进情节",
  "保留线索悬念",
  "动作清晰连贯",
  "保持角色一致性",
  "展现不同观点",
  "留出自主选择",
  "区分事实与推测"
];

const QUICK_ACTION_CATEGORIES = [
  {
    category: "🍵 日常相处",
    icon: "🍵",
    actions: [
      "两人在客厅喝茶聊起过去",
      "给对方递了一杯温热的红茶",
      "一起动手收拾屋里的琐碎物品",
      "准备洗菜做饭，屋里飘起饭菜香气",
      "递过去一条柔软干燥的毛毯",
    ],
  },
  {
    category: "🌧️ 气候环境",
    icon: "🌧️",
    actions: [
      "窗外下起了大暴雨，风声呼啸",
      "夜幕降临，屋里亮起一盏柔光台灯",
      "风雪封山，两人围在火炉旁取暖",
      "清晨阳光洒进窗台，微风吹拂窗帘",
      "走到窗边看着外面的万家灯火",
    ],
  },
  {
    category: "🤝 协作交流",
    icon: "🤍",
    actions: [
      "轻轻拍了拍对方的肩膀安慰",
      "相视一笑，彼此心照不宣",
      "轻声询问对方接下来的打算",
      "将桌上的地图转向对方",
      "并肩查看地图，讨论路线",
    ],
  },
  {
    category: "🌙 静默沉思",
    icon: "🌙",
    actions: [
      "相视而笑，室内陷入安静深思",
      "翻看桌上的旧相册，陷入回忆",
      "静静听着窗外的雨声，各自思索",
      "停下手中的动作，专注地看着对方",
      "轻叹一口气，眼神满是宽慰",
    ],
  },
];

function initials(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function getMoodBadge(value: unknown) {
  const mood = typeof value === "object" && value && "emotionalState" in value
    ? String((value as { emotionalState?: unknown }).emotionalState || "")
    : typeof value === "string" ? value : "";
  const cfg = MOOD_CONFIG[mood] || { label: mood || "自然", emoji: "💭", color: "text-muted-foreground bg-muted border-border/50" };
  return cfg;
}

interface MessageSection {
  type: "narration" | "dialogue";
  text: string;
}

function cleanDialogueText(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  // 1. 压缩多余连续换行，杜绝气泡内断层大空白
  cleaned = cleaned.replace(/\n\s*\n+/g, "\n");

  // 2. 剥离外层多余的双引号 / 单引号 / 中文引号（如 "外头冷,先坐着。" -> 外头冷,先坐着。）
  const lines = cleaned.split("\n").map(line => {
    let l = line.trim();
    l = l.replace(/^["'“‘「]+/, "").replace(/["'”’」]+$/, "").trim();
    return l;
  });

  return lines.filter(Boolean).join("\n");
}

/** 工坊各页签对应的分段标签：与 handleSaveStudio 写入 scenePrompt 的格式一一对应。 */
const STUDIO_SECTION_LABELS = [
  "行为偏好",
  "左位角色身份",
  "右位角色身份",
  "前情提要/上下文",
  "破冰引导",
  "画面视觉基准",
] as const;

const STUDIO_SECTION_SPLIT = new RegExp(`【(?:${STUDIO_SECTION_LABELS.join("|")})】`);

/**
 * 把 scenePrompt 拆回工坊各页签。
 * 保存时【左位角色身份】【右位角色身份】【行为偏好】等会被压平进 scenePrompt；
 * 以前重新打开编辑一律把这些字段置空，导致「角色与身份 / 心智与偏好」两页签永远是空的。
 * 没有分段标签的旧数据会整段留在 scenePrompt，行为与以前完全一致。
 */
function splitStudioScenePrompt(raw: string) {
  const text = raw || "";
  const pick = (label: string) => {
    const re = new RegExp(`【${label}】([\\s\\S]*?)(?=【(?:${STUDIO_SECTION_LABELS.join("|")})】|$)`);
    const matched = text.match(re);
    return matched ? matched[1].trim() : "";
  };
  return {
    scenePrompt: text.split(STUDIO_SECTION_SPLIT)[0].trim(),
    systemPromptOverlay: pick("行为偏好"),
    persona1Role: pick("左位角色身份"),
    persona2Role: pick("右位角色身份"),
    contextSeed: pick("前情提要/上下文"),
    starters: pick("破冰引导"),
    visualBaseline: pick("画面视觉基准"),
  };
}

function parseRoleplayMessage(rawContent: string): MessageSection[] {
  if (!rawContent) return [];
  const sections: MessageSection[] = [];
  const regex = /【([^】]+)】/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(rawContent)) !== null) {
    if (match.index > lastIdx) {
      const dText = rawContent.slice(lastIdx, match.index).trim();
      const cleanedD = cleanDialogueText(dText);
      if (cleanedD) {
        sections.push({ type: "dialogue", text: cleanedD });
      }
    }
    const nText = match[1].trim();
    if (nText) {
      sections.push({ type: "narration", text: nText });
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < rawContent.length) {
    const remaining = rawContent.slice(lastIdx).trim();
    const cleanedD = cleanDialogueText(remaining);
    if (cleanedD) {
      sections.push({ type: "dialogue", text: cleanedD });
    }
  }

  if (sections.length === 0 && rawContent.trim()) {
    const cleanedD = cleanDialogueText(rawContent.trim());
    if (cleanedD) {
      sections.push({ type: "dialogue", text: cleanedD });
    }
  }

  return sections;
}

export default function Roleplay() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();

  // Page View state: "chat" (Main dialogue stage) or "studio" (Full page 1:1 Studio)
  const [currentView, setCurrentView] = useState<RoleplayPageView>("chat");
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const selectedChannelIdRef = useRef(selectedChannelId);
  selectedChannelIdRef.current = selectedChannelId;

  // Workbench Modal States (左侧陪伴工作台各面板)
  const [workbenchPersonaId, setWorkbenchPersonaId] = useState<number | null>(null);
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [showStateModal, setShowStateModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showSourceLibraryModal, setShowSourceLibraryModal] = useState(false);
  const [showEmotionModal, setShowEmotionModal] = useState(false);
  const [showTheaterDrawer, setShowTheaterDrawer] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [collapsedThoughtIds, setCollapsedThoughtIds] = useState<Set<number>>(new Set());

  const toggleThoughtCollapse = (msgId: number) => {
    setCollapsedThoughtIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  // 1:1 Studio Form State
  type StudioTab = "overview" | "cast" | "prompt" | "history";
  const [studioTab, setStudioTab] = useState<StudioTab>("overview");
  const [studioChannelId, setStudioChannelId] = useState<number | null>(null);
  const [studioName, setStudioName] = useState("驿站议事");
  const [studioIcon, setStudioIcon] = useState("🛋️");
  const [studioDescription, setStudioDescription] = useState("两位旅行者在驿站整理线索、讨论下一步行程。");
  const [studioScenePrompt, setStudioScenePrompt] = useState("傍晚，驿站亮起灯光，桌上放着地图和旅行笔记。");
  const [studioSystemPromptOverlay, setStudioSystemPromptOverlay] = useState("通过对话与具体动作推进情节，描写环境、服饰与关键道具。");
  const [studioPersona1Role, setStudioPersona1Role] = useState("");
  const [studioPersona2Role, setStudioPersona2Role] = useState("");
  const [studioContextSeed, setStudioContextSeed] = useState("");
  const [studioStarters, setStudioStarters] = useState("");
  const [studioVisualBaseline, setStudioVisualBaseline] = useState("");
  const [studioContinuationEnabled, setStudioContinuationEnabled] = useState(true);
  const [studioMemberIds, setStudioMemberIds] = useState<number[]>([]);

  // Studio Context Management Sub-States
  const [contextSelectedIds, setContextSelectedIds] = useState<Set<number>>(new Set());
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState("");

  // Modals inside Studio View
  const [showSceneImportDialog, setShowSceneImportDialog] = useState(false);
  const [showChannelCloneDialog, setShowChannelCloneDialog] = useState(false);
  const [sceneSearchQuery, setSceneSearchQuery] = useState("");

  const [note, setNote] = useState("");

  // Multi-turn & Continuous Tick State
  const [multiTurnCount, setMultiTurnCount] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("ink-and-kin_roleplay_multi_turns"));
      return saved > 0 ? saved : 3;
    } catch {
      return 3;
    }
  });
  const [customTurnsInput, setCustomTurnsInput] = useState("3");
  const [activeWebTask, setActiveWebTask] = useState<WebAdvanceTask | null>(null);
  const activeWebTaskRef = useRef<WebAdvanceTask | null>(null);
  const advanceClientIdRef = useRef<string | null>(null);
  const advanceSequenceRef = useRef(0);
  const isSingleTicking = activeWebTask?.mode === "single";
  const isMultiTicking = activeWebTask?.mode === "multi";
  const isAutoTicking = activeWebTask?.mode === "auto";
  const [currentTurnProgress, setCurrentTurnProgress] = useState(0);

  // Chat Toolbar Controls
  const [showTurnCountMenu, setShowTurnCountMenu] = useState(false);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [showQuickActionMatrix, setShowQuickActionMatrix] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  // Preferences & Toggles
  const [allowSilence, setAllowSilence] = useState<boolean>(() => {
    try {
      return localStorage.getItem("ink-and-kin_roleplay_allow_silence") === "true";
    } catch {
      return false;
    }
  });

  const [expandThoughts, setExpandThoughts] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("ink-and-kin_roleplay_expand_thoughts");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const messageEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jumpToMessage = (messageId: number | string) => {
    const el = document.getElementById(`roleplay-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-2xl", "transition-all", "duration-500");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "rounded-2xl");
      }, 2500);
    }
  };

  const jumpToDate = (dayKey: string) => {
    const el = document.getElementById(`date-divider-${dayKey}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, loading, navigate]);

  const personasQuery = trpc.persona.list.useQuery(undefined, { enabled: isAuthenticated });
  const channelsQuery = trpc.roleplay.list.useQuery(undefined, { enabled: isAuthenticated });
  const scenesQuery = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });

  const channelQuery = trpc.roleplay.get.useQuery(
    { channelId: selectedChannelId || 0, limit: 120 },
    { enabled: isAuthenticated && Boolean(selectedChannelId) },
  );
  const studioChannelQuery = trpc.roleplay.get.useQuery(
    { channelId: studioChannelId || 0, limit: 120 },
    { enabled: isAuthenticated && currentView === "studio" && Boolean(studioChannelId) },
  );

  // QQ 端 /R 的推进循环跑在服务端，网页这里把它的状态读出来，好显示"正在推进"。
  // 空闲时 5 秒兜底轮询（否则新的 QQ 推进开始时网页不会察觉），推进中切到 1.5 秒。
  const [advanceFastPoll, setAdvanceFastPoll] = useState(false);
  const advanceStatusQuery = trpc.roleplay.advanceStatus.useQuery(
    { channelId: selectedChannelId || 0 },
    {
      enabled: isAuthenticated && Boolean(selectedChannelId),
      refetchInterval: advanceFastPoll ? 1500 : 5000,
    },
  );
  const qqAdvance = (advanceStatusQuery.data?.channelId === selectedChannelId ? advanceStatusQuery.data : null) as any;
  const qqAdvancing = Boolean(qqAdvance?.running);
  useEffect(() => {
    setAdvanceFastPoll(qqAdvancing);
  }, [qqAdvancing]);

  const personas = (personasQuery.data ?? []) as any[];
  const readyPersonas = useMemo(
    () => personas.filter(persona => persona.analysisStatus === "ready"),
    [personas],
  );
  const channels = (channelsQuery.data ?? []) as any[];
  const scenes = (scenesQuery.data ?? []) as any[];
  const channel = channelQuery.data?.channel as any | undefined;
  const messages = (channelQuery.data?.messages ?? []) as any[];
  const studioChannelReady = studioChannelId !== null && studioChannelQuery.data?.channel?.id === studioChannelId;
  const studioMessages = useMemo(() => {
    const data = studioChannelQuery.data;
    return studioChannelReady ? (data?.messages ?? []) as any[] : [];
  }, [studioChannelQuery.data, studioChannelReady]);

  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    }
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (channel?.members?.length > 0) {
      // 频道成员变更时，确保工作台当前角色属于该频道；越界则回退到第一位成员
      setWorkbenchPersonaId(prev => {
        if (prev && channel.members.some((m: any) => m.personaId === prev)) return prev;
        return channel.members[0].personaId;
      });
    }
  }, [channel?.members]);

  // 切换频道时关闭工作台弹窗，避免面板显示上一个频道的数据
  const handleSelectChannel = (channelId: number) => {
    if (channelId === selectedChannelId) return;
    if (activeWebTaskRef.current) cancelWebTask(activeWebTaskRef.current, false);
    setShowMoodModal(false);
    setShowStateModal(false);
    setShowDiagnosticsModal(false);
    setShowMemoryModal(false);
    setShowSourceLibraryModal(false);
    setShowEmotionModal(false);
    setShowTheaterDrawer(false);
    setShowSearchPanel(false);
    setSelectedChannelId(channelId);
  };

  useEffect(() => {
    if (studioMemberIds.length === 0 && readyPersonas.length >= 2) {
      setStudioMemberIds(readyPersonas.slice(0, 2).map(persona => persona.id));
    }
  }, [studioMemberIds.length, readyPersonas]);

  // Initial scroll when switching channels
  useEffect(() => {
    if (selectedChannelId) {
      setTimeout(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 100);
    }
  }, [selectedChannelId]);

  // Derived timeline dates & messages (including user + all personas) for TimelineQuickJump
  const { timelineDates, timelineMessages, speakerList } = useMemo(() => {
    const datesMap = new Map<string, { label: string; count: number }>();
    const msgList: Array<{
      id: number;
      index: number;
      role: string;
      speakerId?: number;
      speakerName: string;
      snippet: string;
      timeStr?: string;
    }> = [];
    const speakers = new Set<string>();

    // Pre-populate with all channel members so buttons are immediately available
    if (channel?.members) {
      channel.members.forEach((m: any) => {
        if (m.personaName) speakers.add(m.personaName);
      });
    }

    messages.forEach((msg: any, idx: number) => {
      const createdAt = msg.createdAt ? new Date(msg.createdAt) : new Date();
      const dayKey = beijingDateKey(createdAt);
      const label = formatBeijingDate(createdAt);

      if (!datesMap.has(dayKey)) {
        datesMap.set(dayKey, { label, count: 1 });
      } else {
        datesMap.get(dayKey)!.count += 1;
      }

      const speakerName = msg.role === "user" ? "用户旁白" : (msg.speakerName || "角色");
      speakers.add(speakerName);

      const rawContent = msg.content || "";
      const snippet = rawContent.length > 32 ? `${rawContent.slice(0, 32)}...` : rawContent || "(无文字内容)";

      msgList.push({
        id: msg.id,
        index: idx + 1,
        role: msg.role,
        speakerId: msg.speakerId,
        speakerName,
        snippet,
        timeStr: formatBeijingTime(createdAt),
      });
    });

    const dates = Array.from(datesMap.entries()).map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }));

    return {
      timelineDates: dates,
      timelineMessages: msgList,
      speakerList: Array.from(speakers),
    };
  }, [messages, channel?.members]);

  const refresh = async () => {
    await Promise.all([
      utils.roleplay.list.invalidate(),
      utils.roleplay.get.invalidate(),
      utils.persona.list.invalidate(),
      utils.scene.list.invalidate(),
    ]);
  };

  // QQ 正在推进时，跟着把消息刷出来（网页自己的推进是本地循环，会自己 refresh）。
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!qqAdvancing) return;
    const timer = setInterval(() => {
      void refreshRef.current();
    }, 2500);
    return () => clearInterval(timer);
  }, [qqAdvancing]);

  const createMutation = trpc.roleplay.create.useMutation({
    onSuccess: async (result) => {
      toast.success("角色生活频道已创建");
      setSelectedChannelId(result.id);
      setCurrentView("chat");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.roleplay.update.useMutation({
    onSuccess: async () => {
      toast.success("频道设定已更新");
      setCurrentView("chat");
      await refresh();
    },
    onError: (error) => toast.error("更新失败：" + error.message),
  });

  const deleteMutation = trpc.roleplay.delete.useMutation({
    onSuccess: async () => {
      if (activeWebTaskRef.current) cancelWebTask(activeWebTaskRef.current, false);
      toast.success("角色频道已删除");
      setDeleteTargetId(null);
      setSelectedChannelId(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const postMutation = trpc.roleplay.postUserMessage.useMutation({
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const tickMutation = trpc.roleplay.tick.useMutation();
  const startWebAdvanceMutation = trpc.roleplay.startWebAdvance.useMutation();
  const finishWebAdvanceMutation = trpc.roleplay.finishWebAdvance.useMutation();
  const stopAdvanceMutation = trpc.roleplay.stopAdvance.useMutation();

  // Context Management Mutations
  const setInclusionMutation = trpc.roleplay.setContextInclusion.useMutation({
    onSuccess: async (result) => {
      toast.success(`已更新 ${result.updated} 条消息的上下文状态`);
      setContextSelectedIds(new Set());
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMessagesMutation = trpc.roleplay.deleteMessages.useMutation({
    onSuccess: async (result) => {
      toast.success(`已删除 ${result.deletedMessages} 条消息`);
      setContextSelectedIds(new Set());
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMessageContentMutation = trpc.roleplay.updateMessage.useMutation({
    onSuccess: async () => {
      toast.success("消息内容已更新");
      setEditingMessageId(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const clearAllMessagesMutation = trpc.roleplay.clearAllMessages.useMutation({
    onSuccess: async () => {
      toast.success("已清空当前频道的全部历史消息");
      setContextSelectedIds(new Set());
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const isCurrentWebTask = (task: WebAdvanceTask) =>
    activeWebTaskRef.current === task && !task.cancelled;

  const cancelWebTask = (task: WebAdvanceTask, announce = true) => {
    if (!isCurrentWebTask(task)) return;
    task.cancelled = true;
    activeWebTaskRef.current = null;
    setActiveWebTask(null);
    setCurrentTurnProgress(0);
    if (announce) toast.info("已请求停止网页推进");
    void stopAdvanceMutation.mutateAsync({ channelId: task.channelId, taskId: task.taskId })
      .catch((error: Error) => {
        if (!activeWebTaskRef.current && selectedChannelIdRef.current === task.channelId
          && task.taskId === `${advanceClientIdRef.current}:${advanceSequenceRef.current}`) {
          toast.error("停止网页推进失败：" + error.message);
        }
      });
  };

  // 离开频道、离开聊天视图或卸载时始终停止原频道的任务。
  useEffect(() => {
    const task = activeWebTaskRef.current;
    if (task && (task.channelId !== selectedChannelId || currentView !== "chat")) {
      cancelWebTask(task, false);
    }
  }, [selectedChannelId, currentView]);

  const stopOnUnmountRef = useRef<(task: WebAdvanceTask) => void>(() => {});
  stopOnUnmountRef.current = task => {
    void stopAdvanceMutation.mutateAsync({ channelId: task.channelId, taskId: task.taskId })
      .catch(error => console.error("停止离开页面的网页推进失败", error));
  };
  useEffect(() => () => {
    const task = activeWebTaskRef.current;
    if (!task) return;
    task.cancelled = true;
    activeWebTaskRef.current = null;
    stopOnUnmountRef.current(task);
  }, []);

  const runWebAdvance = async (mode: WebAdvanceMode, totalTurns: number, personaId?: number) => {
    const channelId = selectedChannelId;
    if (!channelId || activeWebTaskRef.current) return;
    if (!advanceClientIdRef.current) advanceClientIdRef.current = crypto.randomUUID();
    const task: WebAdvanceTask = {
      channelId,
      taskId: `${advanceClientIdRef.current}:${++advanceSequenceRef.current}`,
      mode,
      cancelled: false,
    };
    activeWebTaskRef.current = task;
    setActiveWebTask(task);
    setCurrentTurnProgress(1);
    let completed = false;

    try {
      const started = await startWebAdvanceMutation.mutateAsync({ channelId, taskId: task.taskId });
      if (!isCurrentWebTask(task) || !started.started || started.cancelled) return;
      if (mode === "auto") toast.success("已启动持续推演模式（可随时点击停止）");

      for (let turn = 1; turn <= totalTurns; turn++) {
        if (!isCurrentWebTask(task)) return;
        setCurrentTurnProgress(turn);
        const result = await tickMutation.mutateAsync({
          channelId,
          taskId: task.taskId,
          personaId,
          allowSilence,
        });
        if (!isCurrentWebTask(task) || result.cancelled) return;
        await refresh();
        if (!isCurrentWebTask(task)) return;
        if (result.qqDeliveryError || result.qqDelivery?.some(batch => !isQqDeliveryComplete(batch))) {
          toast.warning(result.qqDeliveryError || "剧情已生成并保存，QQ 交付未完成；已暂停后续推进，请查看 QQ 交付卡。");
          await utils.roleplay.qqDeliveries.invalidate({ channelId });
          return;
        }
        if (turn < totalTurns) {
          await new Promise(resolve => setTimeout(resolve, mode === "auto" ? 1600 : 1200));
          if (!isCurrentWebTask(task)) return;
        }
      }
      completed = true;
    } catch (error: any) {
      if (isCurrentWebTask(task)) toast.error(error.message || "频道推进失败");
    } finally {
      try {
        await finishWebAdvanceMutation.mutateAsync({ channelId, taskId: task.taskId });
      } catch (error: any) {
        if (isCurrentWebTask(task)) toast.error("结束网页推进失败：" + (error.message || "未知错误"));
      }
      if (isCurrentWebTask(task)) {
        if (completed && mode === "multi") toast.success(`✨ 已完成 ${totalTurns} 轮对话推进`);
        activeWebTaskRef.current = null;
        setActiveWebTask(null);
        setCurrentTurnProgress(0);
      }
    }
  };

  const executeSingleTick = (personaId?: number) => {
    void runWebAdvance("single", 1, personaId);
  };

  const handleRunMultiTurns = (totalTurns: number) => {
    void runWebAdvance("multi", totalTurns);
  };

  const handleToggleAutoTick = () => {
    const task = activeWebTaskRef.current;
    if (task?.mode === "auto") {
      cancelWebTask(task);
    } else if (!task) {
      void runWebAdvance("auto", 50);
    }
  };

  const handleStopAllTicks = () => {
    const task = activeWebTaskRef.current;
    if (task) {
      cancelWebTask(task);
      return;
    }
    // 没有网页任务时，原有按钮继续停止当前频道的 QQ 推进。
    const channelId = selectedChannelId;
    if (!channelId) return;
    void stopAdvanceMutation.mutateAsync({ channelId })
      .then(async result => {
        if (selectedChannelIdRef.current !== channelId || activeWebTaskRef.current) return;
        toast[result.stopped ? "info" : "success"](result.stopped ? "已请求停止 QQ 端推进" : "当前没有在推进");
        await refresh();
      })
      .catch((error: Error) => {
        if (selectedChannelIdRef.current === channelId && !activeWebTaskRef.current) toast.error(error.message);
      });
  };

  const handleSetTurns = (n: number) => {
    const valid = Math.max(1, Math.min(30, n));
    setMultiTurnCount(valid);
    setCustomTurnsInput(String(valid));
    try {
      localStorage.setItem("ink-and-kin_roleplay_multi_turns", String(valid));
    } catch {}
    setShowTurnCountMenu(false);
    toast.success(`默认推进轮数已设为 ${valid} 轮`);
  };

  const handleOpenEditStudio = (targetChannel: any) => {
    if (activeWebTaskRef.current) cancelWebTask(activeWebTaskRef.current, false);
    setStudioChannelId(targetChannel.id);
    setStudioName(targetChannel.name || "");
    setStudioIcon(targetChannel.icon || "🛋️");
    setStudioDescription(targetChannel.description || "");
    const parsedPrompt = splitStudioScenePrompt(targetChannel.scenePrompt || "");
    setStudioScenePrompt(parsedPrompt.scenePrompt);
    setStudioSystemPromptOverlay(parsedPrompt.systemPromptOverlay);
    setStudioPersona1Role(parsedPrompt.persona1Role);
    setStudioPersona2Role(parsedPrompt.persona2Role);
    setStudioContextSeed(parsedPrompt.contextSeed);
    setStudioStarters(parsedPrompt.starters);
    setStudioVisualBaseline(parsedPrompt.visualBaseline);
    setStudioContinuationEnabled(true);
    setStudioMemberIds(targetChannel.members?.map((m: any) => m.personaId) || []);
    setContextSelectedIds(new Set());
    setEditingMessageId(null);
    setCurrentView("studio");
  };

  const handleOpenCreateStudio = () => {
    if (activeWebTaskRef.current) cancelWebTask(activeWebTaskRef.current, false);
    setStudioChannelId(null);
    setStudioName("");
    setStudioIcon("🎭");
    setStudioDescription("");
    setStudioScenePrompt("");
    setStudioSystemPromptOverlay("通过对话与具体动作推进情节，描写环境、服饰与关键道具。");
    setStudioPersona1Role("");
    setStudioPersona2Role("");
    setStudioContextSeed("");
    setStudioStarters("");
    setStudioVisualBaseline("");
    setStudioContinuationEnabled(true);
    if (readyPersonas.length >= 2) {
      setStudioMemberIds(readyPersonas.slice(0, 2).map(p => p.id));
    }
    setContextSelectedIds(new Set());
    setEditingMessageId(null);
    setCurrentView("studio");
  };

  const handleApplyTemplate = (tmpl: any) => {
    setStudioName(tmpl.title);
    setStudioIcon(tmpl.icon);
    setStudioDescription(tmpl.description);
    setStudioScenePrompt(tmpl.description);
    setStudioPersona1Role(tmpl.persona1Role);
    setStudioPersona2Role(tmpl.persona2Role);
    setStudioSystemPromptOverlay(tmpl.prompt);
    setStudioStarters(tmpl.starters);
    toast.success(`已套用「${tmpl.title}」灵感模板`);
  };

  const handleSaveStudio = async () => {
    if (!studioName.trim()) {
      toast.error("请输入频道名称");
      return;
    }
    if (studioMemberIds.length < 2) {
      toast.error("至少选择两位参与角色");
      return;
    }

    let combinedPrompt = studioScenePrompt.trim() || studioDescription.trim();
    if (studioSystemPromptOverlay.trim()) {
      combinedPrompt += `\n【行为偏好】${studioSystemPromptOverlay.trim()}`;
    }
    if (studioPersona1Role.trim()) {
      combinedPrompt += `\n【左位角色身份】${studioPersona1Role.trim()}`;
    }
    if (studioPersona2Role.trim()) {
      combinedPrompt += `\n【右位角色身份】${studioPersona2Role.trim()}`;
    }
    if (studioContextSeed.trim()) {
      combinedPrompt += `\n【前情提要/上下文】${studioContextSeed.trim()}`;
    }
    if (studioStarters.trim()) {
      combinedPrompt += `\n【破冰引导】${studioStarters.trim()}`;
    }
    if (studioVisualBaseline.trim()) {
      combinedPrompt += `\n【画面视觉基准】${studioVisualBaseline.trim()}`;
    }

    if (studioChannelId) {
      await updateMutation.mutateAsync({
        channelId: studioChannelId,
        name: studioName.trim() || "未命名频道",
        description: studioDescription.trim(),
        scenePrompt: combinedPrompt,
        memberPersonaIds: studioMemberIds,
      });
    } else {
      await createMutation.mutateAsync({
        name: studioName.trim() || "新生活频道",
        description: studioDescription.trim(),
        scenePrompt: combinedPrompt,
        memberPersonaIds: studioMemberIds,
      });
    }
  };

  const handleImportFromScene = (scene: any) => {
    const starters = Array.isArray(scene.starters)
      ? scene.starters.filter((item: unknown): item is string => typeof item === "string").join("\n")
      : typeof scene.starters === "string" ? scene.starters : "";
    setStudioName(scene.name || "");
    setStudioIcon(scene.icon || "🎭");
    setStudioDescription(scene.description || "");
    setStudioScenePrompt(scene.description || scene.systemPromptOverlay || "");
    setStudioSystemPromptOverlay(scene.systemPromptOverlay || "");
    setStudioPersona1Role(scene.personaIdentityOverride || "");
    setStudioPersona2Role(scene.userIdentityOverride || "");
    setStudioContextSeed(scene.contextSeed || "");
    setStudioStarters(starters);
    setStudioVisualBaseline(scene.sceneVisualBaseline || "");
    setStudioContinuationEnabled(scene.continuationEnabled !== false);
    setShowSceneImportDialog(false);
    toast.success(`已从情景模式导入「${scene.name}」的全部设定`);
  };

  const handleCloneFromChannel = (source: any) => {
    setStudioName(source.name + " (副本)");
    setStudioIcon(source.icon || "🛋️");
    setStudioDescription(source.description || "");
    setStudioScenePrompt(source.scenePrompt || "");
    setStudioMemberIds(source.members?.map((m: any) => m.personaId) || []);
    setShowChannelCloneDialog(false);
    toast.success(`已克隆「${source.name}」频道的配置`);
  };

  const toggleStudioMember = (personaId: number) => {
    setStudioMemberIds(current => current.includes(personaId)
      ? current.filter(id => id !== personaId)
      : [...current, personaId]);
  };

  const moveStudioMember = (personaId: number, direction: -1 | 1) => {
    setStudioMemberIds(current => {
      const index = current.indexOf(personaId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const toggleExpandThoughts = () => {
    setExpandThoughts(prev => {
      const next = !prev;
      try {
        localStorage.setItem("ink-and-kin_roleplay_expand_thoughts", String(next));
      } catch {}
      return next;
    });
  };

  const toggleAllowSilence = () => {
    setAllowSilence(prev => {
      const next = !prev;
      try {
        localStorage.setItem("ink-and-kin_roleplay_allow_silence", String(next));
      } catch {}
      toast.success(next ? "已开启允许沉默模式" : "已关闭沉默模式（每轮必定发言）");
      return next;
    });
  };

  const postNote = async (textToSend?: string) => {
    const text = (textToSend || note).trim();
    if (!selectedChannelId || !text) return;
    await postMutation.mutateAsync({
      channelId: selectedChannelId,
      content: text,
    });
  };

  const handleInsertQuickAction = (actionText: string) => {
    setNote(actionText);
    setShowQuickActionMatrix(false);
  };

  const toggleSelectMessage = (id: number) => {
    setContextSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllMessages = () => {
    if (!studioChannelReady) return;
    if (contextSelectedIds.size === studioMessages.length) {
      setContextSelectedIds(new Set());
    } else {
      setContextSelectedIds(new Set(studioMessages.map(m => m.id)));
    }
  };

  const handleBatchInclusion = (status: "included" | "excluded") => {
    if (!studioChannelReady || !studioChannelId || contextSelectedIds.size === 0) return;
    setInclusionMutation.mutate({
      channelId: studioChannelId,
      messageIds: Array.from(contextSelectedIds),
      status,
    });
  };

  const handleBatchDeleteMessages = () => {
    if (!studioChannelReady || !studioChannelId || contextSelectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${contextSelectedIds.size} 条消息吗？`)) return;
    deleteMessagesMutation.mutate({
      channelId: studioChannelId,
      messageIds: Array.from(contextSelectedIds),
    });
  };

  const handleSaveEditedMessage = (messageId: number) => {
    if (!studioChannelReady || !studioChannelId || !editingMessageContent.trim()) return;
    updateMessageContentMutation.mutate({
      channelId: studioChannelId,
      messageId,
      content: editingMessageContent.trim(),
    });
  };

  const filteredScenes = useMemo(() => {
    if (!sceneSearchQuery.trim()) return scenes;
    const q = sceneSearchQuery.toLowerCase();
    return scenes.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q)
    );
  }, [scenes, sceneSearchQuery]);

  const filteredStudioMessages = useMemo(() => {
    if (!contextSearchQuery.trim()) return studioMessages;
    const q = contextSearchQuery.toLowerCase();
    return studioMessages.filter(m =>
      m.content?.toLowerCase().includes(q) ||
      m.speakerName?.toLowerCase().includes(q) ||
      m.innerThought?.toLowerCase().includes(q)
    );
  }, [studioMessages, contextSearchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center animate-pulse">
          <Users className="w-5 h-5" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const firstMemberId = channel?.members?.[0]?.personaId;
  const firstMember = channel?.members?.[0];
  const secondMember = channel?.members?.[1];

  // ══════════════════════════════════════════════════════════════════════
  // VIEW 1: STUDIO (1:1 对齐情景模式工作室页面)
  // ══════════════════════════════════════════════════════════════════════
  if (currentView === "studio") {
    return (
      <div className="min-h-screen bg-background flex flex-col relative selection:bg-primary/20 pb-20">
        <div className="gradient-mesh-bg" />

        {/* Studio Top Header (1:1 with Scenes) */}
        <header className="sticky top-0 z-30 app-header border-b border-border/50 bg-background/90 backdrop-blur-xl">
          <div className="container max-w-4xl h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <button
                onClick={() => setCurrentView("chat")}
                className="w-8.5 h-8.5 rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-all shadow-2xs active:scale-95 shrink-0 cursor-pointer"
                title="返回频道"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-lg shadow-inner ring-1 ring-primary/20 shrink-0">
                <Film className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-foreground truncate">
                  {studioChannelId ? "编辑生活频道工坊" : "设计新生活频道情境"}
                </h1>
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate hidden sm:block">
                  设定时代背景、双角色身份、互动偏好与 /p 配图基准
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("chat")}
                className="text-xs rounded-xl cursor-pointer h-8"
              >
                返回频道
              </Button>

              <Button
                size="sm"
                onClick={handleSaveStudio}
                disabled={updateMutation.isPending || createMutation.isPending || studioMemberIds.length < 2}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-8 px-4 shadow-xs flex items-center gap-1.5 cursor-pointer font-semibold"
              >
                {updateMutation.isPending || createMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>保存设定</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Studio Content Form (Tabbed Multi-Step / Section View) */}
        <main className="container max-w-4xl py-6 space-y-5 sm:space-y-6 animate-scale-in">
          {/* Top Modern Tab Switcher */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-muted/40 border border-border/70 shadow-2xs overflow-x-auto scrollbar-hide">
            {[
              { id: "overview", label: "基础与场景", icon: BookOpen, desc: "剧本名 / 氛围 / 场景" },
              { id: "cast", label: "角色与身份", icon: Users, desc: "左右站位 / 时代身份", badge: `${studioMemberIds.length}位` },
              { id: "prompt", label: "心智与偏好", icon: Wand2, desc: "行为与旁白写法" },
              { id: "history", label: "上下文与记忆", icon: Database, desc: "种子记忆 / 历史对话", badge: studioChannelId ? `${studioMessages.length}条` : undefined },
            ].map(tab => {
              const isActive = studioTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStudioTab(tab.id as StudioTab)}
                  className={`flex-1 min-w-[140px] py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer select-none ${
                    isActive
                      ? "bg-card text-primary shadow-xs border border-border/80 ring-1 ring-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="text-left leading-tight min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="truncate">{tab.label}</span>
                      {tab.badge && (
                        <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-mono font-normal ${
                          isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        }`}>
                          {tab.badge}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* TAB 1: 基础概况与场景 (Overview) */}
          {studioTab === "overview" && (
            <div className="space-y-4 sm:space-y-5 animate-fade-in">
              {/* Quick Import & Clone Toolbar */}
              <div className="rounded-2xl sm:rounded-3xl border border-primary/20 bg-primary/[0.03] p-3.5 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-primary" />
                    <span>剧本导入与频道克隆</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    从情景模式剧本库一键导入，或从已有角色生活频道克隆
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSceneImportDialog(true)}
                    className="flex-1 sm:flex-initial h-8 px-3 rounded-xl border-primary/30 text-primary hover:bg-primary/10 gap-1.5 text-xs font-medium cursor-pointer shadow-2xs"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>从情景模式导入剧本</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowChannelCloneDialog(true)}
                    className="flex-1 sm:flex-initial h-8 px-3 rounded-xl border-border hover:bg-muted text-muted-foreground hover:text-foreground gap-1.5 text-xs font-medium cursor-pointer shadow-2xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>从已有频道克隆</span>
                  </Button>
                </div>
              </div>

              {/* Inspiration Templates (New Only) */}
              {!studioChannelId && (
                <div className="rounded-2xl sm:rounded-3xl border border-primary/20 bg-primary/[0.03] p-3.5 sm:p-5 shadow-xs">
                  <div className="flex items-center gap-2 mb-2.5 sm:mb-3">
                    <Lightbulb className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      灵感模板库（点击一键套用）
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    {INSPIRATION_TEMPLATES.map(tmpl => (
                      <button
                        key={tmpl.title}
                        type="button"
                        onClick={() => handleApplyTemplate(tmpl)}
                        className="p-3 rounded-2xl border border-border/70 bg-card hover:border-primary hover:shadow-sm text-left transition-all group cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-base">{tmpl.icon}</span>
                          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate">
                            {tmpl.title}
                          </span>
                        </div>
                        <p className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {tmpl.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 1. Basic Info Card */}
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold text-foreground border-b border-border/50 pb-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <span>频道剧本基础概况</span>
                </div>

                <div className="space-y-3.5">
                  <div className="grid grid-cols-[80px_1fr] sm:grid-cols-[96px_1fr] gap-3 items-start">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground block h-4 leading-4">氛围图标</label>
                      <Input
                        value={studioIcon}
                        onChange={e => setStudioIcon(e.target.value)}
                        placeholder="🛋️"
                        className="w-full text-center text-xl font-emoji h-10 rounded-xl bg-muted/20 border-border/60 p-0"
                        maxLength={4}
                      />
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <label className="text-xs font-semibold text-foreground block h-4 leading-4">
                        频道名称 <span className="text-destructive">*</span>
                      </label>
                      <Input
                        value={studioName}
                        onChange={e => setStudioName(e.target.value)}
                        placeholder="例如：深夜教室独处、雨夜避雨书房…"
                        className="w-full h-10 rounded-xl font-medium text-xs sm:text-sm"
                        maxLength={100}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] text-muted-foreground">推荐氛围图标（点击快速选用）：</span>
                    <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-2xl bg-muted/25 border border-border/50">
                      {EMOJI_PRESETS.map(e => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setStudioIcon(e)}
                          className={`w-7.5 h-7.5 rounded-xl text-base flex items-center justify-center transition-all cursor-pointer ${
                            studioIcon === e
                              ? "bg-primary/20 text-primary border border-primary/40 shadow-2xs scale-110"
                              : "hover:bg-card/90 hover:scale-110 text-foreground/85"
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">一句话剧本简介</label>
                    <Input
                      value={studioDescription}
                      onChange={e => setStudioDescription(e.target.value)}
                      placeholder="在频道列表中展示，如：下晚自习后的空教室里，两个人第一次把话说开。"
                      className="h-10 text-xs sm:text-sm rounded-xl"
                      maxLength={200}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">生活场景细节描写 / 当前情景</label>
                    <Textarea
                      value={studioScenePrompt}
                      onChange={e => setStudioScenePrompt(e.target.value)}
                      placeholder="描写当下的环境、时间、氛围与两人的动作触觉细节..."
                      rows={4}
                      className="text-xs rounded-xl bg-muted/20 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              </div>

              {/* Starters & Visual Baseline */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-5 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <MessageSquareQuote className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">破冰开场台词</span>
                  </div>
                  <Textarea
                    value={studioStarters}
                    onChange={e => setStudioStarters(e.target.value)}
                    placeholder="例：刚沏好的茶，尝尝合不合口味。\n坐过来一点，外面风大。"
                    rows={3}
                    className="text-xs rounded-xl bg-muted/20 leading-relaxed font-mono"
                  />
                </div>

                <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-5 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <Palette className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">画面视觉基准（/p 专属）</span>
                  </div>
                  <Textarea
                    value={studioVisualBaseline}
                    onChange={e => setStudioVisualBaseline(e.target.value)}
                    placeholder="例：温暖柔和的室内暖光，棉麻家居服，柔和微笑..."
                    rows={3}
                    className="text-xs rounded-xl bg-muted/20 leading-relaxed"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 角色配置与时代身份 (Cast & Standings) */}
          {studioTab === "cast" && (
            <div className="space-y-4 sm:space-y-5 animate-fade-in">
              {/* Character Members Card */}
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <Users className="w-4 h-4 text-primary" />
                    <span>参与角色配置与左右站位</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">已选 {studioMemberIds.length} 位角色（至少2位）</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {readyPersonas.map(persona => {
                    const isSelected = studioMemberIds.includes(persona.id);
                    const rank = isSelected ? studioMemberIds.indexOf(persona.id) + 1 : 0;
                    return (
                      <div
                        key={persona.id}
                        className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition-all text-xs ${
                          isSelected
                            ? "border-primary/40 bg-primary/8 shadow-2xs"
                            : "border-border/50 hover:bg-muted/30"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleStudioMember(persona.id)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div
                            className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs ${
                              isSelected
                                ? rank === 1 ? "bg-primary text-primary-foreground" : "bg-chart-3 text-white"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {isSelected ? (rank === 1 ? "左" : "右") : initials(persona.name)}
                          </div>
                          <span className="font-semibold text-foreground truncate">{persona.name}</span>
                        </button>
                        {isSelected && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveStudioMember(persona.id, -1)}
                              disabled={studioMemberIds.indexOf(persona.id) === 0}
                              className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer shadow-2xs"
                              title="移到左侧主位"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStudioMember(persona.id, 1)}
                              disabled={studioMemberIds.indexOf(persona.id) === studioMemberIds.length - 1}
                              className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer shadow-2xs"
                              title="移到右侧对位"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dual Character Identity Card */}
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <Users className="w-4 h-4 text-primary" />
                    <span>双角色身份与时代设定（可选）</span>
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-muted-foreground hidden xs:inline">留空沿用日常身份</span>
                </div>

                <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-[10px] sm:text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <b>守则提示：</b>
                    只改变该场景下的职业角色、年龄数字与时代背景。原人物性格、身材骨架、外貌、嗓音、健康状态及深层情感纽带保持不变；退出场景后自动失效。
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3.5 rounded-2xl border border-primary/30 bg-primary/5 space-y-1.5">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary" />
                      左位角色在本场景的身份微调
                    </label>
                    <Textarea
                      value={studioPersona1Role}
                      onChange={e => setStudioPersona1Role(e.target.value)}
                      placeholder="例如：角色在档案馆与调查搭档核对地图，通过提问与线索推进情节。"
                      rows={3}
                      className="text-xs leading-relaxed resize-none rounded-xl bg-card"
                    />
                  </div>

                  <div className="p-3.5 rounded-2xl border border-chart-3/30 bg-chart-3/5 space-y-1.5">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-chart-3" />
                      右位角色在本场景的身份微调
                    </label>
                    <Textarea
                      value={studioPersona2Role}
                      onChange={e => setStudioPersona2Role(e.target.value)}
                      placeholder="例如：角色在档案馆与调查搭档核对地图，通过提问与线索推进情节。"
                      rows={3}
                      className="text-xs leading-relaxed resize-none rounded-xl bg-card"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 心智与提示词偏好 (Prompt & Behavior) */}
          {studioTab === "prompt" && (
            <div className="space-y-4 sm:space-y-5 animate-fade-in">
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <Wand2 className="w-4 h-4 text-primary" />
                    <span>专属行为与旁白写法偏好</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] sm:text-[11px] text-muted-foreground mr-1">快捷偏好：</span>
                  {PROMPT_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setStudioSystemPromptOverlay(prev => prev ? `${prev}，${tag}` : tag)}
                      className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] bg-muted/60 hover:bg-primary/15 hover:text-primary border border-border/60 transition-colors cursor-pointer"
                    >
                      +{tag}
                    </button>
                  ))}
                </div>

                <Textarea
                  value={studioSystemPromptOverlay}
                  onChange={e => setStudioSystemPromptOverlay(e.target.value)}
                  placeholder="例：在这个场景里，你更主动、更黏人，多照顾对方的情绪、少讲道理；动作和语气都更近一些……&#10;也可以在这里写「旁白怎么写」的偏好，例：多写触感/温度/声音等感官细节、把过程一步步写全、直白一些、每轮多写几段——场景模式下会高优先生效。"
                  rows={6}
                  className="text-xs leading-relaxed rounded-xl font-mono"
                />
              </div>
            </div>
          )}

          {/* TAB 4: 记忆与上下文管理 (History & Memory) */}
          {studioTab === "history" && (
            <div className="space-y-4 sm:space-y-5 animate-fade-in">
              {/* Context Seed Card & Continuation Toggle */}
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <Database className="w-4 h-4 text-primary" />
                    <span>前情提要与上下文种子 (Context Seed)</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">定义当下的剧情记忆切入点</span>
                </div>

                <div className="space-y-1.5">
                  <Textarea
                    value={studioContextSeed}
                    onChange={e => setStudioContextSeed(e.target.value)}
                    placeholder="例如：角色在档案馆与调查搭档核对地图，通过提问与线索推进情节。"
                    rows={3}
                    className="text-xs rounded-xl bg-muted/20 leading-relaxed"
                  />
                </div>

                <label className="flex items-center justify-between p-3.5 rounded-2xl border border-border/60 bg-muted/20 cursor-pointer hover:border-primary/40 transition-colors">
                  <div className="space-y-0.5 pr-2">
                    <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      持续推演时自动承接前情记忆
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      开启后，双角色在连续对话推演中会自动承接最新的剧情事实与情感动态。
                    </div>
                  </div>
                  <Switch
                    checked={studioContinuationEnabled}
                    onCheckedChange={setStudioContinuationEnabled}
                  />
                </label>
              </div>

              {/* History & Context Manager Card */}
              {studioChannelId && (
                <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-chart-3" />
                      <span className="text-xs font-bold text-foreground">历史对话与上下文精细管理</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        共 {studioMessages.length} 条
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={toggleSelectAllMessages}
                        disabled={!studioChannelReady}
                        className="h-7 text-[11px] px-2.5 rounded-xl border-border cursor-pointer"
                      >
                        {contextSelectedIds.size === studioMessages.length && studioMessages.length > 0 ? (
                          <CheckSquare className="w-3 h-3 mr-1 text-primary" />
                        ) : (
                          <Square className="w-3 h-3 mr-1" />
                        )}
                        {contextSelectedIds.size === studioMessages.length && studioMessages.length > 0 ? "取消全选" : "全选"}
                      </Button>

                      {contextSelectedIds.size > 0 && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleBatchInclusion("included")}
                            className="h-7 text-[11px] px-2.5 rounded-xl border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            批量包含 ({contextSelectedIds.size})
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleBatchInclusion("excluded")}
                            className="h-7 text-[11px] px-2.5 rounded-xl border-border text-muted-foreground hover:bg-muted cursor-pointer"
                          >
                            <EyeOff className="w-3 h-3 mr-1" />
                            批量排除 ({contextSelectedIds.size})
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleBatchDeleteMessages}
                            className="h-7 text-[11px] px-2.5 rounded-xl border-rose-500/30 text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            批量删除 ({contextSelectedIds.size})
                          </Button>
                        </>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!studioChannelReady) return;
                          if (confirm("确定要清空该频道的全部聊天记录吗？")) {
                            clearAllMessagesMutation.mutate({ channelId: studioChannelId });
                          }
                        }}
                        disabled={!studioChannelReady || clearAllMessagesMutation.isPending}
                        className="h-7 text-[11px] px-2 rounded-xl text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                      >
                        清空记录
                      </Button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={contextSearchQuery}
                      onChange={e => setContextSearchQuery(e.target.value)}
                      placeholder="搜索历史消息内容、说话人或内心思考..."
                      className="pl-8 h-8 text-xs rounded-xl bg-muted/20"
                    />
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {studioChannelQuery.isLoading || (studioChannelQuery.isFetching && !studioChannelReady) ? (
                      <div className="text-center py-8 text-xs text-muted-foreground">正在读取该频道历史对话…</div>
                    ) : studioChannelQuery.isError ? (
                      <div className="text-center py-8 text-xs text-destructive">读取该频道历史对话失败</div>
                    ) : filteredStudioMessages.length === 0 ? (
                      <div className="text-center py-8 text-xs text-muted-foreground">
                        {studioMessages.length === 0 ? "暂无历史对话记录" : "未搜索到匹配的消息"}
                      </div>
                    ) : (
                      filteredStudioMessages.map((m, idx) => {
                        const isExcluded = m.contextOverride === "excluded";
                        const isSelected = contextSelectedIds.has(m.id);
                        const isEditing = editingMessageId === m.id;

                        return (
                          <div
                            key={m.id}
                            className={`p-3 rounded-2xl border transition-all text-xs space-y-2 ${
                              isExcluded
                                ? "bg-muted/15 border-border/40 opacity-70"
                                : isSelected
                                  ? "bg-primary/5 border-primary/40 shadow-xs"
                                  : "bg-card border-border/70 hover:border-border"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleSelectMessage(m.id)}
                                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <span className="font-bold text-foreground truncate">
                                  #{idx + 1} {m.speakerName || (m.role === "user" ? "场景旁白" : "角色")}
                                </span>
                                <span
                                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-medium border ${
                                    isExcluded
                                      ? "bg-muted text-muted-foreground border-border"
                                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                                  }`}
                                >
                                  {isExcluded ? "已排除" : "上下文中"}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setInclusionMutation.mutate({
                                      channelId: studioChannelId,
                                      messageIds: [m.id],
                                      status: isExcluded ? "included" : "excluded",
                                    })
                                  }
                                  className="h-6.5 text-[11px] px-2 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  {isExcluded ? (
                                    <>
                                      <Eye className="w-3 h-3 mr-1 text-emerald-600" />
                                      <span>纳入</span>
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="w-3 h-3 mr-1 text-slate-500" />
                                      <span>排除</span>
                                    </>
                                  )}
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (isEditing) {
                                      setEditingMessageId(null);
                                    } else {
                                      setEditingMessageId(m.id);
                                      setEditingMessageContent(m.content || "");
                                    }
                                  }}
                                  className="h-6.5 text-[11px] px-2 rounded-lg text-muted-foreground hover:text-primary cursor-pointer"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm("确定删除这条消息吗？")) {
                                      deleteMessagesMutation.mutate({
                                        channelId: studioChannelId,
                                        messageIds: [m.id],
                                      });
                                    }
                                  }}
                                  className="h-6.5 text-[11px] px-2 rounded-lg text-muted-foreground hover:text-rose-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="space-y-2 pt-1">
                                <Textarea
                                  value={editingMessageContent}
                                  onChange={e => setEditingMessageContent(e.target.value)}
                                  rows={3}
                                  className="text-xs rounded-xl bg-muted/20 leading-relaxed"
                                />
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingMessageId(null)}
                                    className="h-6.5 text-xs rounded-lg cursor-pointer"
                                  >
                                    取消
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveEditedMessage(m.id)}
                                    className="h-6.5 text-xs px-3 rounded-lg bg-primary text-primary-foreground font-semibold cursor-pointer"
                                  >
                                    保存修改
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-foreground leading-relaxed whitespace-pre-wrap pl-2 border-l-2 border-primary/20">
                                {m.content}
                              </p>
                            )}

                            {m.innerThought && !isEditing && (
                              <div className="text-[11px] text-muted-foreground/80 italic pl-2">
                                💭 思考：{m.innerThought}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottom Action Footer */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/60">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("chat")}
                className="rounded-xl text-xs h-9 px-4 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                返回剧场
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {studioTab !== "overview" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const tabs: StudioTab[] = ["overview", "cast", "prompt", "history"];
                    const currIdx = tabs.indexOf(studioTab);
                    if (currIdx > 0) setStudioTab(tabs[currIdx - 1]);
                  }}
                  className="rounded-xl text-xs h-9 px-3 cursor-pointer"
                >
                  上一页
                </Button>
              )}
              {studioTab !== "history" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const tabs: StudioTab[] = ["overview", "cast", "prompt", "history"];
                    const currIdx = tabs.indexOf(studioTab);
                    if (currIdx < tabs.length - 1) setStudioTab(tabs[currIdx + 1]);
                  }}
                  className="rounded-xl text-xs h-9 px-3 cursor-pointer text-primary border-primary/30 hover:bg-primary/10"
                >
                  下一页
                </Button>
              ) : null}

              <Button
                onClick={handleSaveStudio}
                disabled={updateMutation.isPending || createMutation.isPending || studioMemberIds.length < 2}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-9 px-6 shadow-xs flex items-center gap-2 cursor-pointer font-semibold"
              >
                {updateMutation.isPending || createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>保存设定并进入频道</span>
              </Button>
            </div>
          </div>
        </main>

        {/* Modal: Import from Scenes */}
        <Dialog open={showSceneImportDialog} onOpenChange={setShowSceneImportDialog}>
          <DialogContent className="bg-card border-border rounded-2xl max-w-xl max-h-[80vh] flex flex-col p-0 overflow-hidden shadow-xl">
            <DialogHeader className="px-5 py-4 border-b border-border/50 bg-muted/20">
              <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Film className="w-4 h-4 text-primary" />
                从情景模式剧本库导入
              </DialogTitle>
            </DialogHeader>

            <div className="p-4 border-b border-border/40">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={sceneSearchQuery}
                  onChange={e => setSceneSearchQuery(e.target.value)}
                  placeholder="搜索情景剧本名称或描述..."
                  className="pl-8 h-8 text-xs rounded-xl bg-muted/20"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-96">
              {filteredScenes.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">没有找到匹配的情景剧本</div>
              ) : (
                filteredScenes.map(sc => (
                  <div
                    key={sc.id}
                    className="p-3 rounded-2xl border border-border/70 bg-card hover:border-primary/50 hover:bg-primary/[0.02] transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                        <span className="text-base">{sc.icon || "🎬"}</span>
                        <span>{sc.name}</span>
                        {sc.isBuiltin && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-normal">预置</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {sc.description || "无场景描述"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleImportFromScene(sc)}
                      className="h-7 text-xs px-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 cursor-pointer font-semibold shadow-2xs"
                    >
                      一键导入
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal: Clone from Channel */}
        <Dialog open={showChannelCloneDialog} onOpenChange={setShowChannelCloneDialog}>
          <DialogContent className="bg-card border-border rounded-2xl max-w-md max-h-[75vh] flex flex-col p-0 overflow-hidden shadow-xl">
            <DialogHeader className="px-5 py-4 border-b border-border/50 bg-muted/20">
              <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Copy className="w-4 h-4 text-primary" />
                从已有生活频道克隆
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {channels.filter(c => c.id !== studioChannelId).length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">暂无可克隆的其他频道</div>
              ) : (
                channels
                  .filter(c => c.id !== studioChannelId)
                  .map(ch => (
                    <div
                      key={ch.id}
                      className="p-3 rounded-2xl border border-border/70 bg-card hover:border-primary/50 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <span className="font-semibold text-xs text-foreground truncate block">{ch.name}</span>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">
                          {ch.scenePrompt ? ch.scenePrompt.split("\n")[0] : (ch.description || "无场景描写")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCloneFromChannel(ch)}
                        className="h-7 text-xs px-3 rounded-xl border-border hover:bg-muted shrink-0 cursor-pointer"
                      >
                        克隆配置
                      </Button>
                    </div>
                  ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // VIEW 2: CHANNEL CHAT STAGE (主对话聊天界面 - 1:1 左侧工作台 + 1:1 右侧定位器)
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-background flex flex-col relative selection:bg-primary/20">
      <div className="gradient-mesh-bg" />

      {/* Top Header (Clean & Uncluttered - All companion tools in left sidebar) */}
      <header className="sticky top-0 z-30 app-header border-b border-border/50 bg-background/85 backdrop-blur-xl">
        <div className="container max-w-6xl h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                if (activeWebTaskRef.current) cancelWebTask(activeWebTaskRef.current, false);
                navigate("/");
              }}
              className="w-8.5 h-8.5 rounded-xl bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-all shadow-2xs active:scale-95 shrink-0 cursor-pointer"
              title="返回大厅"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-8.5 h-8.5 rounded-xl bg-primary/10 text-primary flex items-center justify-center shadow-2xs shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-foreground truncate">
                  {channel ? channel.name : "角色生活频道"}
                </h1>
                {channel && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                    {channel.members?.length || 0} 位角色
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate hidden sm:block">
                {channel?.scenePrompt ? channel.scenePrompt.split("\n")[0] : "多角色同场景深度互动演练"}
              </p>
            </div>
          </div>

          {/* Clean Header Action Buttons */}
          {channel && (
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Expand Thoughts Toggle */}
              <button
                onClick={toggleExpandThoughts}
                className={`h-8 px-2.5 rounded-xl border flex items-center gap-1.5 transition-all text-xs cursor-pointer ${
                  expandThoughts
                    ? "bg-primary/10 border-primary/30 text-primary font-medium"
                    : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground"
                }`}
                title={expandThoughts ? "内心思考：当前默认展开" : "内心思考：当前默认折叠"}
              >
                {expandThoughts ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{expandThoughts ? "思考展开" : "思考折叠"}</span>
              </button>

              {/* Allow Silence Toggle */}
              <button
                onClick={toggleAllowSilence}
                className={`h-8 px-2.5 rounded-xl border flex items-center gap-1.5 transition-all text-xs cursor-pointer ${
                  allowSilence
                    ? "bg-chart-3/15 border-chart-3/30 text-foreground font-medium"
                    : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground"
                }`}
                title={allowSilence ? "允许沉默：角色可静默思考" : "必定发言：每轮强制说话"}
              >
                {allowSilence ? <VolumeX className="w-3.5 h-3.5 text-chart-3" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{allowSilence ? "允许沉默" : "必定发言"}</span>
              </button>

              {/* Main Channel Edit Button */}
              <button
                onClick={() => handleOpenEditStudio(channel)}
                className="h-8 px-3 rounded-xl bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 flex items-center gap-1.5 transition-all cursor-pointer text-xs font-semibold shadow-2xs"
                title="进入频道设计与编辑工坊"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>频道编辑</span>
              </button>

              {/* Delete Channel Button */}
              <button
                onClick={() => setDeleteTargetId(channel.id)}
                className="w-8 h-8 rounded-xl bg-muted/50 border border-border/60 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 hover:border-rose-500/20 flex items-center justify-center transition-all cursor-pointer"
                title="删除当前频道"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="container max-w-6xl py-4 flex-1 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Left Sidebar (包含 1:1 左侧陪伴工作台与频道列表) */}
        <aside className="space-y-3 flex flex-col">
          {/* 1. Left Companion Workbench (左侧陪伴工作台) */}
          {channel && (
            <div className="p-3.5 rounded-2xl bg-card border border-border/70 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                  陪伴工作台
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">频道多维档案</span>
              </div>

              {/* Workbench 6 Grid Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowTheaterDrawer(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-chart-3/10 hover:border-chart-3/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Film className="w-3.5 h-3.5 text-chart-3 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-chart-3">频道剧场</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">场景前情与设定</p>
                </button>

                <button
                  type="button"
                  onClick={() => setShowMoodModal(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-primary/10 hover:border-primary/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-primary">情感状态</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">全员情感与心智</p>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDiagnosticsModal(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-sky-500/10 hover:border-sky-500/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Activity className="w-3.5 h-3.5 text-sky-500 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-sky-500">运行诊断</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">心智透视与规划</p>
                </button>

                <button
                  type="button"
                  onClick={() => setShowMemoryModal(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-chart-4/10 hover:border-chart-4/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5 text-chart-4 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-chart-4">记忆时间线</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">共同回忆档案</p>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSourceLibraryModal(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-chart-2/10 hover:border-chart-2/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Database className="w-3.5 h-3.5 text-chart-2 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-chart-2">资料库</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">原著知识检索</p>
                </button>

                <button
                  type="button"
                  onClick={() => setShowEmotionModal(true)}
                  className="p-2.5 rounded-xl bg-muted/30 hover:bg-chart-5/10 hover:border-chart-5/30 border border-border/50 text-left transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-chart-5 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-foreground group-hover:text-chart-5">情绪报告</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">情绪日志与走势</p>
                </button>
              </div>
            </div>
          )}

          {/* 2. Channels List Header */}
          <div className="flex items-center justify-between p-1.5 rounded-2xl bg-muted/50 border border-border/60 shadow-2xs">
            <div className="flex items-center gap-1.5 px-2 text-xs font-bold text-foreground">
              <MessageCircle className="w-3.5 h-3.5 text-primary" />
              <span>频道列表 ({channels.length})</span>
            </div>
            <Button
              size="sm"
              onClick={handleOpenCreateStudio}
              className="rounded-xl text-xs h-7 px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground gap-1 cursor-pointer font-semibold shadow-xs"
            >
              <Plus className="w-3 h-3" />
              新建频道
            </Button>
          </div>

          {/* 3. Channels List */}
          <section className="warm-card p-3 space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-360px)]">
            {channels.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <p className="text-xs text-muted-foreground">暂无角色生活频道</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenCreateStudio}
                  className="rounded-xl text-xs h-7 border-primary/30 text-primary cursor-pointer"
                >
                  <Plus className="w-3 h-3 mr-1" /> 立即创建
                </Button>
              </div>
            ) : (
              channels.map(item => {
                const isSelected = selectedChannelId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectChannel(item.id)}
                    className={`w-full rounded-xl p-3 text-left transition-all border group relative cursor-pointer ${
                      isSelected
                        ? "bg-primary/8 border-primary/30 shadow-xs"
                        : "bg-card/60 hover:bg-card border-border/60 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full ${isSelected ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                        <span className="text-xs font-semibold text-foreground truncate">{item.name}</span>
                        {item.channelKind === "duet" && (
                          <span
                            className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium shrink-0"
                            title="QQ「对戏」专用频道：不在「进入频道N」编号内，与角色生活频道相互隔离"
                          >
                            对戏
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditStudio(item);
                          }}
                          className="w-5 h-5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors cursor-pointer"
                          title="频道编辑"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-muted text-muted-foreground font-medium shrink-0">
                          {item.members?.length || 0}人
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mb-2">
                      {item.scenePrompt ? item.scenePrompt.split("\n")[0] : (item.description || "无场景设定")}
                    </p>
                    <div className="flex items-center gap-1">
                      {item.members?.map((m: any, idx: number) => (
                        <span
                          key={m.personaId}
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium truncate max-w-[80px] ${
                            idx === 0 ? "bg-primary/10 text-primary" : "bg-chart-3/15 text-chart-3"
                          }`}
                        >
                          {m.personaName}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </aside>

        {/* Right Main Stage: Dialogue Chat Room */}
        <section className="warm-card flex flex-col h-[calc(100vh-140px)] min-h-[560px] overflow-hidden relative shadow-sm">
          {channel ? (
            <>
              {/* Channel Header Info */}
              <div className="px-4 py-2 border-b border-border/50 bg-muted/20 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center -space-x-1.5 shrink-0">
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold border border-background shadow-xs">
                      {initials(firstMember?.personaName || "左")}
                    </div>
                    <div className="w-6 h-6 rounded-full bg-chart-3 text-white flex items-center justify-center text-[10px] font-bold border border-background shadow-xs">
                      {initials(secondMember?.personaName || "右")}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-foreground truncate">{channel.name}</span>
                  <span className="text-[10px] text-muted-foreground hidden sm:inline truncate max-w-xs">
                    · {channel.scenePrompt ? channel.scenePrompt.split("\n")[0] : "自由生活场景"}
                  </span>
                </div>

                {/* Real-time Ticking Indicator：网页自己的推进 + QQ 端的 /R 推进都显示在这里 */}
                {(isSingleTicking || isMultiTicking || isAutoTicking || qqAdvancing) && (
                  <div className="flex items-center gap-2 animate-pulse">
                    <span className="text-[11px] text-primary font-medium">
                      {isSingleTicking
                        ? "单轮推进中"
                        : isAutoTicking
                        ? `持续推演中 (第 ${currentTurnProgress} 轮)`
                        : isMultiTicking
                          ? `多轮推进中 (${currentTurnProgress}/${multiTurnCount})`
                          : qqAdvance?.continuous
                            ? `QQ 持续推进中 (第 ${qqAdvance?.current ?? 0} 轮)`
                            : `QQ 推进中 (${qqAdvance?.current ?? 0}/${qqAdvance?.total ?? 0})`}
                    </span>
                    {qqAdvancing && !activeWebTask && qqAdvance?.lastSpeaker && (
                      <span className="text-[10px] text-muted-foreground">最近：{qqAdvance.lastSpeaker}</span>
                    )}
                    <Button
                      size="sm"
                      onClick={handleStopAllTicks}
                      className="h-6.5 text-[11px] px-2.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>停止</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Messages Stream Container */}
              {channel.id === selectedChannelId && (
                <QqDeliveryPanel key={selectedChannelId} channelId={channel.id} busy={Boolean(activeWebTask) || qqAdvancing} />
              )}
              <div className="flex-1 relative overflow-hidden flex flex-col">
                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-3 py-16">
                      <div className="w-14 h-14 rounded-3xl bg-primary/10 text-primary flex items-center justify-center shadow-xs animate-bounce">
                        <Sparkles className="w-7 h-7" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">静谧的生活场景已就绪</h3>
                        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                          点击下方的【推进 {multiTurnCount} 轮对话】，或输入旁白/生活动作，开启双角色对话。
                        </p>
                      </div>
                      <Button
                        onClick={() => handleRunMultiTurns(multiTurnCount)}
                        disabled={Boolean(activeWebTask)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-8.5 px-4 cursor-pointer shadow-xs font-semibold"
                      >
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" /> 开始推进 {multiTurnCount} 轮
                      </Button>
                    </div>
                  ) : (
                    messages.map((message, index) => {
                      const isUser = message.role === "user";
                      const isSpeaker1 = !isUser && (
                        message.speakerId === firstMemberId ||
                        message.speakerName === firstMember?.personaName ||
                        (firstMemberId === undefined)
                      );

                      const prev = index > 0 ? messages[index - 1] : null;
                      const showDateDivider = Boolean(message.createdAt) && (
                        !prev?.createdAt ||
                        new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
                      );
                      const dayKey = message.createdAt ? beijingDateKey(new Date(message.createdAt)) : undefined;

                      return (
                        <Fragment key={message.id}>
                          {showDateDivider && message.createdAt && (
                            <div id={dayKey ? `date-divider-${dayKey}` : undefined} className="flex justify-center my-3">
                              <span className="px-3 py-1 rounded-full bg-muted/60 text-[10.5px] font-mono text-muted-foreground border border-border/50 shadow-2xs">
                                📅 {formatBeijingDate(message.createdAt)}
                              </span>
                            </div>
                          )}

                          {/* User Message / Scene Moderator Ribbon (CENTER) */}
                          {isUser ? (
                            <div id={`roleplay-msg-${message.id}`} className="flex justify-center my-4 animate-fade-in scroll-mt-20 px-2 sm:px-6">
                              <div className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-primary/10 dark:bg-primary/15 border border-primary/25 text-xs sm:text-[13.5px] text-foreground/90 shadow-2xs max-w-[85%] text-center leading-relaxed">
                                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                <span className="font-bold text-primary shrink-0">{message.speakerName || "场景引导"}：</span>
                                <span className="font-medium text-foreground/90">{message.content}</span>
                                <span className="text-[10.5px] text-muted-foreground/70 ml-2 font-mono shrink-0">{formatBeijingTime(message.createdAt)}</span>
                              </div>
                            </div>
                          ) : (() => {
                            const sections = parseRoleplayMessage(message.content);
                            const lastDialogueIdx = sections.reduce((last, sec, idx) => sec.type === "dialogue" ? idx : last, -1);
                            const personaObj = readyPersonas.find(p => p.name === message.speakerName || p.name?.includes(message.speakerName) || message.speakerName?.includes(p.name)) || channel?.members?.find((m: any) => m.personaName === message.speakerName || m.personaName?.includes(message.speakerName));
                            const avatarUrl = personaObj?.avatarUrl;

                            return (
                              <div id={`roleplay-msg-${message.id}`} className="space-y-4 w-full scroll-mt-20 animate-fade-in-up">
                                {sections.map((sec, sIdx) => {
                                  if (sec.type === "narration") {
                                    return (
                                      <div key={sIdx} className="my-6 w-full flex justify-center animate-fade-in px-2 sm:px-6">
                                        <div className="w-full max-w-2xl rounded-2xl bg-amber-500/5 dark:bg-amber-950/20 border border-amber-500/30 dark:border-amber-500/25 p-4.5 sm:p-5 shadow-xs space-y-2 transition-all">
                                          <div className="flex items-center justify-center gap-2 mb-1">
                                            <span className="h-px w-10 bg-gradient-to-r from-transparent to-amber-500/60" />
                                            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-500/20 dark:bg-amber-500/25 text-amber-900 dark:text-amber-200 text-[11px] font-bold tracking-wider">
                                              <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                              <span>场景旁白 · 环境描写</span>
                                            </div>
                                            <span className="h-px w-10 bg-gradient-to-l from-transparent to-amber-500/60" />
                                          </div>
                                          <p className="text-[13.5px] sm:text-[14px] leading-relaxed text-foreground dark:text-zinc-100 font-normal tracking-wide text-justify px-1">
                                            {sec.text}
                                          </p>

                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={sIdx}
                                      className={`flex items-start gap-3.5 w-full ${
                                        isSpeaker1 ? "justify-start" : "flex-row-reverse justify-start"
                                      }`}
                                    >
                                      {/* Avatar */}
                                      {avatarUrl ? (
                                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl overflow-hidden ring-1 ring-border/50 shadow-xs shrink-0">
                                          <img src={avatarUrl} alt={message.speakerName} className="w-full h-full object-cover" />
                                        </div>
                                      ) : (
                                        <div
                                          className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center font-bold text-xs shadow-xs shrink-0 border ${
                                            isSpeaker1
                                              ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border-primary/30 text-primary"
                                              : "bg-gradient-to-br from-chart-3/25 via-chart-3/15 to-transparent border-chart-3/35 text-foreground"
                                          }`}
                                        >
                                          {initials(message.speakerName)}
                                        </div>
                                      )}

                                      {/* Message Content Container */}
                                      <div className={`max-w-[82%] sm:max-w-[75%] space-y-1.5 ${isSpeaker1 ? "text-left" : "text-right"}`}>
                                        {/* Name & Mood Header */}
                                        <div className={`flex items-center gap-2 px-1 ${isSpeaker1 ? "justify-start" : "flex-row-reverse justify-start"}`}>
                                          <span className="text-xs sm:text-[13px] font-bold text-foreground">{message.speakerName}</span>
                                          {getMoodBadge(message.moodState).label && (
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shadow-2xs ${getMoodBadge(message.moodState).color}`}>
                                              {getMoodBadge(message.moodState).emoji} {getMoodBadge(message.moodState).label}
                                            </span>
                                          )}
                                          <span className="text-[10.5px] text-muted-foreground/60 font-mono">
                                            {formatBeijingTime(message.createdAt)}
                                          </span>
                                        </div>

                                        {/* Dialogue Bubble (With seamlessly integrated inner thought) */}
                                        <div
                                          className={`p-3.5 sm:p-4 rounded-3xl text-[13.5px] sm:text-[14px] leading-relaxed whitespace-pre-line shadow-xs transition-all ${
                                            isSpeaker1
                                              ? "bg-card border border-border/80 text-foreground rounded-tl-sm"
                                              : "bg-primary/10 dark:bg-primary/15 border border-primary/25 text-foreground rounded-tr-sm text-left"
                                          }`}
                                        >
                                          <div>{sec.text}</div>

                                          {/* Nested Inner Thought (Attached to the last dialogue bubble, click 💭 to toggle collapse) */}
                                          {message.innerThought && sIdx === lastDialogueIdx && (() => {
                                            const isCollapsed = collapsedThoughtIds.has(message.id);
                                            return (
                                              <div className="mt-2 pt-1.5 border-t border-border/20 text-left">
                                                <div className="flex items-start gap-1.5">
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      toggleThoughtCollapse(message.id);
                                                    }}
                                                    className="cursor-pointer select-none shrink-0 mt-[2px] p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all not-italic text-[11px] leading-none opacity-70 hover:opacity-100"
                                                    title={isCollapsed ? "点击展开心声" : "点击折叠心声"}
                                                  >
                                                    💭
                                                  </button>
                                                  {!isCollapsed && (
                                                    <p className="flex-1 min-w-0 text-[11.5px] sm:text-xs leading-relaxed text-muted-foreground/80 dark:text-muted-foreground/70 font-serif italic tracking-normal whitespace-normal text-justify">
                                                      {message.innerThought}
                                                    </p>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}

                              </div>
                            );
                          })()}
                        </Fragment>
                      );
                    })
                  )}
                  <div ref={messageEndRef} />
                </div>
              </div>

              {/* ════ CLEAN & POWERFUL BOTTOM COMPOSER ════ */}
              <div ref={composerRef} className="p-3 border-t border-border/50 bg-background/85 backdrop-blur-xl space-y-2 shrink-0 relative">
                {/* Floating Quick Action Matrix */}
                {showQuickActionMatrix && (
                  <div className="absolute bottom-full left-3 right-3 mb-2 p-3.5 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl space-y-3 animate-scale-in shadow-xl z-20">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                      <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        情景生活动作库 (点击即填入)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowQuickActionMatrix(false)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-lg cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {QUICK_ACTION_CATEGORIES.map(cat => (
                        <div key={cat.category} className="space-y-1.5">
                          <div className="text-[11px] font-semibold text-foreground/80 flex items-center gap-1">
                            <span>{cat.icon}</span>
                            <span>{cat.category}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {cat.actions.map(act => (
                              <button
                                key={act}
                                type="button"
                                onClick={() => handleInsertQuickAction(act)}
                                className="text-[11px] px-2 py-0.5 rounded-lg bg-muted/40 hover:bg-primary/10 hover:text-primary border border-border/40 text-muted-foreground transition-all cursor-pointer text-left"
                              >
                                {act}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Floating Turn Count & Continuous Settings Menu */}
                {showTurnCountMenu && (
                  <div className="absolute bottom-full right-3 mb-2 p-3 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl space-y-3 animate-scale-in shadow-xl z-20 min-w-[240px]">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                      <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-primary" />
                        推进轮数与模式设定
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTurnCountMenu(false)}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded-lg"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] text-muted-foreground block font-medium">快速设定单次推进轮数：</span>
                      <div className="grid grid-cols-4 gap-1">
                        {[2, 3, 5, 10].map(cnt => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => handleSetTurns(cnt)}
                            className={`py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                              multiTurnCount === cnt
                                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                : "bg-muted/40 hover:bg-primary/10 text-foreground border-border/50"
                            }`}
                          >
                            {cnt} 轮
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-xs text-foreground shrink-0 font-medium">自定义轮数:</span>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={customTurnsInput}
                        onChange={e => setCustomTurnsInput(e.target.value)}
                        className="h-7 text-xs rounded-lg w-16 text-center"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSetTurns(Number(customTurnsInput))}
                        className="h-7 text-xs px-2.5 rounded-lg bg-primary text-primary-foreground font-semibold"
                      >
                        确定
                      </Button>
                    </div>

                    <div className="pt-2 border-t border-border/40">
                      <button
                        type="button"
                        onClick={() => {
                          setShowTurnCountMenu(false);
                          handleToggleAutoTick();
                        }}
                        disabled={Boolean(activeWebTask && !isAutoTicking)}
                        className={`w-full py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs ${
                          isAutoTicking
                            ? "bg-rose-500 hover:bg-rose-600 text-white border-rose-600"
                            : "bg-chart-3/15 hover:bg-chart-3/25 text-foreground border-chart-3/30"
                        }`}
                      >
                        {isAutoTicking ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>停止持续推演</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current text-chart-3" />
                            <span>开启持续推演（自动连播）</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Floating Speaker Menu */}
                {showSpeakerMenu && (
                  <div className="absolute bottom-full right-32 mb-2 p-1.5 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl space-y-1 animate-scale-in shadow-xl z-20 min-w-[160px]">
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground border-b border-border/40">
                      指定单一角色发言：
                    </div>
                    {channel.members?.map((member: any) => (
                      <button
                        key={member.personaId}
                        type="button"
                        onClick={() => {
                          setShowSpeakerMenu(false);
                          executeSingleTick(member.personaId);
                        }}
                        disabled={Boolean(activeWebTask) || member.analysisStatus !== "ready"}
                        className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-primary/10 hover:text-primary text-xs text-foreground flex items-center gap-2 transition-all cursor-pointer font-medium"
                      >
                        <Brain className="w-3.5 h-3.5 text-primary" />
                        <span>让 {member.personaName} 发言</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Unified Sleek Composer Input Row */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuickActionMatrix(!showQuickActionMatrix)}
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-2xs ${
                      showQuickActionMatrix
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400"
                        : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                    title="快捷动作库"
                  >
                    <Zap className="w-4 h-4" />
                  </button>

                  <Textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="输入场景动作或用户插话（例如：给对方递了杯热茶），按 Ctrl+Enter 发送..."
                    className="min-h-[40px] max-h-24 text-xs rounded-xl bg-card leading-relaxed resize-none py-2.5"
                    onKeyDown={e => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        postNote();
                      }
                    }}
                  />

                  {note.trim() && (
                    <Button
                      onClick={() => postNote()}
                      disabled={postMutation.isPending}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-9 w-9 p-0 shrink-0 shadow-xs active:scale-95 transition-all cursor-pointer"
                      title="发送旁白/动作 (Ctrl+Enter)"
                    >
                      {postMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  )}

                  <div className="flex items-center shrink-0 -space-x-px">
                    {activeWebTask ? (
                      <Button
                        onClick={handleStopAllTicks}
                        className="bg-rose-500 hover:bg-rose-600 text-white rounded-l-xl rounded-r-none shadow-xs text-xs h-9 px-3.5 active:scale-95 transition-all flex items-center gap-1.5 font-bold cursor-pointer animate-pulse border-r border-white/20"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>停止推进 ({currentTurnProgress})</span>
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleRunMultiTurns(multiTurnCount)}
                        disabled={Boolean(activeWebTask)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-l-xl rounded-r-none shadow-xs text-xs h-9 px-3.5 active:scale-95 transition-all flex items-center gap-1.5 font-bold cursor-pointer border-r border-primary-foreground/20"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                        <span>推进 {multiTurnCount} 轮</span>
                      </Button>
                    )}

                    <Button
                      onClick={() => setShowTurnCountMenu(!showTurnCountMenu)}
                      disabled={Boolean(activeWebTask)}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-r-xl rounded-l-none shadow-xs text-xs h-9 px-2 active:scale-95 transition-all cursor-pointer"
                      title="调整推进轮数 / 持续推演模式"
                    >
                      <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
              <div className="w-14 h-14 rounded-3xl bg-primary/10 text-primary flex items-center justify-center">
                <Users className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">选择或创建一个角色生活频道</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  在左侧列表中点击已有频道进入，或点击【新建频道】定制全新的生活场景与互动角色。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenCreateStudio}
                className="rounded-xl text-xs h-8 border-primary/30 text-primary cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> 新建生活频道
              </Button>
            </div>
          )}
        </section>
      </main>

      {/* 1:1 消息定位器 (置于页面最外层，固定在屏幕最右侧) */}
      {channel && (
        <TimelineQuickJump
          dates={timelineDates}
          messages={timelineMessages}
          speakers={speakerList}
          onJumpToDate={jumpToDate}
          onJumpToMessage={jumpToMessage}
          onJumpToTop={scrollToTop}
          onJumpToBottom={scrollToBottom}
          onOpenSearch={() => setShowSearchPanel(true)}
        />
      )}

      {/* ════════════════ WORKBENCH MODALS ════════════════ */}

      {/* 1. 频道剧场 (Channel Theater Drawer) */}
      {showTheaterDrawer && channel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={() => setShowTheaterDrawer(false)} />
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-chart-3/15 text-chart-3 flex items-center justify-center">
                  <Film className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-foreground">频道剧场 · 场景设定与前情</h3>
                  <p className="text-[11px] text-muted-foreground">当前生活频道剧本与角色关系背景</p>
                </div>
              </div>
              <button onClick={() => setShowTheaterDrawer(false)} className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-chart-3/10 via-chart-3/5 to-background border border-chart-3/20 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{channel.icon || "🛋️"}</span>
                  <span className="font-bold text-sm text-foreground">{channel.name}</span>
                </div>
                {channel.description && (
                  <p className="text-xs text-foreground/85 leading-relaxed">{channel.description}</p>
                )}
              </div>

              {channel.scenePrompt && (
                <div className="p-4 rounded-2xl bg-card border border-border/70 space-y-2">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    场景细节描写与前情
                  </span>
                  <p className="text-xs text-foreground/85 leading-relaxed bg-muted/20 p-3 rounded-xl border border-border/40 whitespace-pre-wrap">
                    {channel.scenePrompt}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {channel.members?.map((m: any, idx: number) => (
                  <div key={m.personaId} className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">
                        {idx === 0 ? "左位主控角色" : "右位互动角色"}：{m.personaName}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${idx === 0 ? "bg-primary/10 text-primary" : "bg-chart-3/15 text-chart-3"}`}>
                        {m.emotionalState ? getMoodBadge(m.emotionalState).label : "就绪"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 频道情感状态 (ChannelMoodPanel · 全员心智总览) */}
      {showMoodModal && channel && (
        <ChannelMoodPanel
          channel={channel}
          messages={messages}
          personas={personas}
          onClose={() => setShowMoodModal(false)}
          onOpenPersonaDiagnostics={(personaId: number) => {
            setWorkbenchPersonaId(personaId);
            setShowMoodModal(false);
            setShowStateModal(true);
          }}
        />
      )}

      {/* 3. 角色深度运行诊断 (PersonaStatePanel · 从面板内打开) */}
      {showStateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={() => setShowStateModal(false)} />
          <div
            className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
            onClick={e => e.stopPropagation()}
          >
            {channel?.members?.length > 1 && (
              <div className="px-6 py-2.5 border-b border-border/40 bg-muted/30 flex items-center justify-between gap-3 shrink-0">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  切换查看频道角色：
                </span>
                <div className="flex items-center gap-2">
                  {channel.members.map((m: any) => (
                    <button
                      key={m.personaId}
                      type="button"
                      onClick={() => setWorkbenchPersonaId(m.personaId)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        workbenchPersonaId === m.personaId
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "bg-muted/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m.personaName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <PersonaStatePanel
                personaId={workbenchPersonaId || firstMemberId || 0}
                onClose={() => setShowStateModal(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. 频道运行诊断 (ChannelDiagnosticsPanel) */}
      {showDiagnosticsModal && channel && (
        <ChannelDiagnosticsPanel
          channel={channel}
          messages={messages}
          personas={personas}
          personaId={workbenchPersonaId || firstMemberId || 0}
          onSwitchPersona={(id) => setWorkbenchPersonaId(id)}
          onClose={() => setShowDiagnosticsModal(false)}
          onRefresh={() => channelQuery.refetch()}
          isRefreshing={channelQuery.isFetching}
          onOpenPersonaState={(personaId: number) => {
            setWorkbenchPersonaId(personaId);
            setShowDiagnosticsModal(false);
            setShowStateModal(true);
          }}
        />
      )}

      {/* 5. 记忆时间线 (MemoryModal) */}
      {showMemoryModal && (
        <RoleplayMemoryModal
          personaId={workbenchPersonaId || firstMemberId || 0}
          channelMembers={channel?.members || []}
          onSwitchPersona={(id) => setWorkbenchPersonaId(id)}
          onClose={() => setShowMemoryModal(false)}
        />
      )}

      {/* 6. 资料库 (SourceLibraryModal) */}
      {showSourceLibraryModal && (
        <RoleplaySourceLibraryModal
          personaId={workbenchPersonaId || firstMemberId || 0}
          channelMembers={channel?.members || []}
          onSwitchPersona={(id) => setWorkbenchPersonaId(id)}
          onClose={() => setShowSourceLibraryModal(false)}
        />
      )}

      {/* 7. 情绪报告 (EmotionReportModal · 频道情感回退) */}
      {showEmotionModal && (
        <RoleplayEmotionModal
          personaId={workbenchPersonaId || firstMemberId || 0}
          channelMembers={channel?.members || []}
          channelMessages={messages}
          onSwitchPersona={(id) => setWorkbenchPersonaId(id)}
          onClose={() => setShowEmotionModal(false)}
        />
      )}

      {/* 6. 消息搜索抽屉 (SearchPanel) */}
      {showSearchPanel && (
        <RoleplaySearchPanel
          messages={messages}
          onJumpToMessage={jumpToMessage}
          onClose={() => setShowSearchPanel(false)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTargetId} onOpenChange={() => setDeleteTargetId(null)}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">确认删除频道</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-xs py-2 leading-relaxed">
            确定要删除该角色生活频道吗？该频道内的所有对话记录将被清除，且无法恢复。
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTargetId(null)}
              className="rounded-xl text-xs cursor-pointer"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-xl text-xs cursor-pointer"
              onClick={() => deleteTargetId && deleteMutation.mutate({ channelId: deleteTargetId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 1:1 TIMELINE QUICK JUMP (消息定位器 - 独立角色分列导轨与精准跳转)
// ══════════════════════════════════════════════════════════════════════

function TimelineQuickJump({
  dates,
  messages,
  speakers,
  members = [],
  readyPersonas = [],
  onJumpToDate,
  onJumpToMessage,
  onJumpToTop,
  onJumpToBottom,
  onOpenSearch,
}: {
  dates: Array<{ key: string; label: string; count: number }>;
  messages: Array<{ id: number; index: number; role: string; speakerName: string; snippet: string; timeStr?: string }>;
  speakers: string[];
  members?: any[];
  readyPersonas?: any[];
  onJumpToDate: (dayKey: string) => void;
  onJumpToMessage: (messageId: number) => void;
  onJumpToTop: () => void;
  onJumpToBottom: () => void;
  onOpenSearch: () => void;
}) {
  // activeTarget: null | "date" | "user" | speakerName
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  // Group messages by target
  const userMessages = useMemo(() => {
    return messages.filter(m => m.role === "user" || m.speakerName === "用户旁白");
  }, [messages]);

  const personaSpeakers = useMemo(() => {
    return speakers.filter(sp => sp !== "用户旁白");
  }, [speakers]);

  // Current active list to display in the floating drawer
  const activeList = useMemo(() => {
    if (!activeTarget) return [];
    if (activeTarget === "user") return userMessages;
    if (activeTarget === "date") return [];
    return messages.filter(m => m.speakerName === activeTarget);
  }, [activeTarget, userMessages, messages]);

  const activeTitle = useMemo(() => {
    if (!activeTarget) return "";
    if (activeTarget === "user") return `场景引导 / 用户旁白 (${userMessages.length}条)`;
    if (activeTarget === "date") return `按日期定位 (${dates.length}天)`;
    return `${activeTarget} 的发言记录 (${activeList.length}条)`;
  }, [activeTarget, userMessages.length, dates.length, activeList.length]);

  return (
    <>
      {/* Click-away backdrop overlay when popover is open */}
      {activeTarget && (
        <div
          className="fixed inset-0 z-30 bg-black/15 backdrop-blur-2xs transition-opacity pointer-events-auto"
          onClick={() => setActiveTarget(null)}
        />
      )}

      <aside className="fixed right-2 sm:right-3 xl:right-5 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 pointer-events-auto">
        {/* Expanded Floating Popover Panel */}
        {activeTarget && (
          <div
            className="backdrop-blur-2xl bg-card/95 dark:bg-card/90 border border-border/80 rounded-3xl shadow-2xl p-3.5 w-72 sm:w-80 max-h-[75vh] flex flex-col gap-2.5 animate-scale-in mr-1 ring-1 ring-black/5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border/60 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs overflow-hidden ${
                    activeTarget === "user"
                      ? "bg-primary/15 text-primary"
                      : activeTarget === "date"
                      ? "bg-chart-3/15 text-chart-3"
                      : "bg-gradient-to-br from-chart-3/20 to-primary/20 text-foreground"
                  }`}
                >
                  {activeTarget === "user" ? (
                    <User className="w-3.5 h-3.5" />
                  ) : activeTarget === "date" ? (
                    <Calendar className="w-3.5 h-3.5" />
                  ) : (
                    initials(activeTarget)
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-foreground truncate">{activeTitle}</h4>
                  <p className="text-[10px] text-muted-foreground">点击条目立即定位到对应对话</p>
                </div>
              </div>
              <button
                onClick={() => setActiveTarget(null)}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[50vh]">
              {activeTarget === "date" ? (
                dates.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-8">暂无日期记录</p>
                ) : (
                  dates.map(d => (
                    <button
                      key={d.key}
                      onClick={() => {
                        onJumpToDate(d.key);
                        setActiveTarget(null);
                      }}
                      className="w-full text-left p-2.5 rounded-xl bg-muted/35 hover:bg-chart-3/10 hover:border-chart-3/30 border border-border/40 transition-all flex items-center justify-between group/d cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-foreground group-hover/d:text-chart-3 transition-colors">
                        {d.label}
                      </span>
                      <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground group-hover/d:bg-chart-3/15 group-hover/d:text-chart-3 font-medium transition-colors font-mono">
                        {d.count} 条记录
                      </span>
                    </button>
                  ))
                )
              ) : activeList.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">暂无发言记录</p>
              ) : (
                activeList.map(item => {
                  const isUser = item.role === "user" || item.speakerName === "用户旁白";
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onJumpToMessage(item.id);
                        setActiveTarget(null);
                      }}
                      className="w-full text-left p-2 rounded-xl bg-muted/35 hover:bg-primary/10 hover:border-primary/30 border border-border/40 transition-all flex items-start gap-2 group/u cursor-pointer"
                    >
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md shrink-0 mt-0.5 ${
                          isUser
                            ? "bg-primary/15 text-primary group-hover/u:bg-primary group-hover/u:text-primary-foreground"
                            : "bg-chart-3/15 text-chart-3 group-hover/u:bg-chart-3 group-hover/u:text-white"
                        }`}
                      >
                        #{item.index}
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10.5px] font-bold text-foreground truncate group-hover/u:text-primary transition-colors">
                            {item.speakerName}
                          </span>
                          {item.timeStr && (
                            <span className="text-[9.5px] text-muted-foreground font-mono shrink-0">{item.timeStr}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed group-hover/u:text-foreground">
                          {item.snippet}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Main Trigger Rail with Separate Buttons */}
        <div className="backdrop-blur-2xl bg-card/90 dark:bg-card/85 border border-border/80 rounded-2xl sm:rounded-3xl shadow-xl p-2 flex flex-col items-center gap-2 transition-all overflow-visible">
          {/* 1. Scroll to Top */}
          <button
            onClick={onJumpToTop}
            title="回滚到最顶部"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/top cursor-pointer"
          >
            <ChevronUp className="w-5 h-5 group-hover/top:-translate-y-0.5 transition-transform" />
          </button>

          {/* 2. Global Search Drawer */}
          <button
            onClick={onOpenSearch}
            title="搜索全部历史消息"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/search cursor-pointer"
          >
            <Search className="w-4 h-4 group-hover/search:scale-110 transition-transform" />
          </button>

          <div className="w-5 border-t border-border/60 my-0.5" />

          {/* 3. Separate Button: User / Narration (用户旁白) */}
          <div className="relative shrink-0">
            <button
              onClick={() => setActiveTarget(activeTarget === "user" ? null : "user")}
              title={`用户旁白与引导 (${userMessages.length}条) - 点击展开定位`}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${
                activeTarget === "user"
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80 border border-border/40"
              }`}
            >
              <User className="w-4 h-4" />
            </button>
            {userMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[18px] h-4.5 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-card shadow-md z-30 font-mono select-none pointer-events-none leading-none">
                {userMessages.length > 99 ? "99+" : userMessages.length}
              </span>
            )}
          </div>

          {/* 各角色的独立头像入口 */}
          {personaSpeakers.map((sp, idx) => {
            const spMessages = messages.filter(m => m.speakerName === sp);
            const isActive = activeTarget === sp;
            const personaObj = readyPersonas.find(p => p.name === sp || p.name?.includes(sp) || sp?.includes(p.name)) || members.find((m: any) => m.personaName === sp || m.personaName?.includes(sp));
            const avatarUrl = personaObj?.avatarUrl;

            return (
              <div key={sp} className="relative shrink-0">
                <button
                  onClick={() => setActiveTarget(isActive ? null : sp)}
                  title={`【${sp}】的发言 (${spMessages.length}条) - 点击展开定位`}
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all active:scale-95 cursor-pointer group ${
                    isActive
                      ? "ring-2 ring-primary shadow-md scale-105"
                      : "hover:scale-105 hover:bg-muted/80"
                  }`}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={sp}
                      className="w-full h-full rounded-xl sm:rounded-2xl object-cover ring-1 ring-border/50 shadow-2xs group-hover:brightness-105 transition-all"
                    />
                  ) : (
                    <div
                      className={`w-full h-full rounded-xl sm:rounded-2xl flex items-center justify-center font-bold text-xs shadow-xs border ${
                        idx === 0
                          ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border-primary/30 text-primary"
                          : "bg-gradient-to-br from-chart-3/25 via-chart-3/15 to-transparent border-chart-3/35 text-foreground"
                      }`}
                    >
                      {initials(sp)}
                    </div>
                  )}
                </button>
                {spMessages.length > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 min-w-[18px] h-4.5 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-card shadow-md z-30 font-mono select-none pointer-events-none leading-none">
                    {spMessages.length > 99 ? "99+" : spMessages.length}
                  </span>
                )}
              </div>
            );
          })}

          {/* 5. Separate Button: Dates (日期目录) */}
          <div className="relative shrink-0">
            <button
              onClick={() => setActiveTarget(activeTarget === "date" ? null : "date")}
              title={`按日期目录 (${dates.length}天) - 点击展开快速跳转`}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${
                activeTarget === "date"
                  ? "bg-chart-3 text-white shadow-md ring-2 ring-chart-3/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80 border border-border/40"
              }`}
            >
              <Calendar className="w-4 h-4" />
            </button>
            {dates.length > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[18px] h-4.5 rounded-full bg-chart-3 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-card shadow-sm z-30 font-mono select-none pointer-events-none leading-none">
                {dates.length}
              </span>
            )}
          </div>

        <div className="w-5 border-t border-border/60 my-0.5" />

        {/* 6. Scroll to Bottom */}
        <button
          onClick={onJumpToBottom}
          title="回到底部最新消息"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/bot cursor-pointer"
        >
          <ChevronDown className="w-5 h-5 group-hover/bot:translate-y-0.5 transition-transform" />
        </button>
      </div>
    </aside>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 1:1 SEARCH PANEL (右侧抽屉式消息搜索)
// ══════════════════════════════════════════════════════════════════════

function RoleplaySearchPanel({
  messages,
  onJumpToMessage,
  onClose,
}: {
  messages: any[];
  onJumpToMessage: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return messages.filter(m =>
      m.content?.toLowerCase().includes(q) ||
      m.speakerName?.toLowerCase().includes(q) ||
      m.innerThought?.toLowerCase().includes(q)
    );
  }, [messages, query]);

  const highlight = (text: string, q: string) => {
    if (!q || !text) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-primary/25 text-primary font-semibold rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in" onClick={onClose}>
      <div className="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity" />
      <aside
        className="relative z-10 w-full sm:w-[420px] h-full bg-card/95 dark:bg-card/90 backdrop-blur-2xl border-l border-border/80 shadow-2xl flex flex-col animate-slide-in-right"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8.5 h-8.5 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/15 shadow-2xs">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">搜索历史消息</h3>
              <p className="text-[11px] text-muted-foreground">
                {query ? `找到 ${results.length} 条相关消息` : "检索频道内的过往对话"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-border/50 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              placeholder="输入关键词搜索聊天记录..."
              className="w-full h-11 pl-10 pr-9 bg-background/90 border border-border/80 focus:border-primary/50 focus:ring-2 focus:ring-primary/15 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all shadow-2xs"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {!query ? (
            <div className="text-center py-20 text-muted-foreground/70 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground/50 border border-border/40">
                <Search className="w-5 h-5" />
              </div>
              <p className="text-xs">在上方输入关键词检索对话</p>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <X className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-xs">未找到包含 “{query}” 的消息</p>
            </div>
          ) : (
            results.map((m: any) => (
              <div
                key={m.id}
                onClick={() => {
                  onJumpToMessage(m.id);
                  onClose();
                }}
                className="group/item p-3.5 rounded-2xl bg-muted/30 hover:bg-primary/8 border border-border/50 hover:border-primary/30 transition-all cursor-pointer space-y-2 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      m.role === "user"
                        ? "bg-primary/15 text-primary border border-primary/20"
                        : "bg-chart-3/15 text-chart-3 border border-chart-3/20"
                    }`}
                  >
                    {m.speakerName || (m.role === "user" ? "场景旁白" : "角色")}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground font-mono">
                    {formatBeijingTime(m.createdAt)}
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-foreground/90 line-clamp-3 leading-relaxed">
                  {highlight(m.content, query)}
                </p>
                <div className="flex items-center justify-end text-[11px] text-primary opacity-0 group-hover/item:opacity-100 transition-opacity font-medium">
                  <span>跳转至该消息 →</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ROLEPLAY WORKBENCH SUB-MODALS (支持多角色快速切换的记忆/资料库/情绪报告)
// ══════════════════════════════════════════════════════════════════════

function RoleplayMemoryModal({
  personaId,
  channelMembers,
  onSwitchPersona,
  onClose,
}: {
  personaId: number;
  channelMembers: any[];
  onSwitchPersona: (id: number) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "active" | "archived">("active");
  const [search, setSearch] = useState("");
  const { data: memories, isLoading, isError, refetch } = trpc.memory.list.useQuery({ personaId });
  const extractMutation = trpc.memory.autoExtract.useMutation({
    onSuccess: (res) => {
      toast.success(`AI 已提取 ${res.extracted?.length || 0} 条记忆`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    let list = memories || [];
    if (activeTab === "active") list = list.filter((m: any) => m.status === "active" || !m.status);
    if (activeTab === "archived") list = list.filter((m: any) => m.status === "archived");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m: any) => m.title?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q));
    }
    return list;
  }, [memories, activeTab, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-chart-4/15 text-chart-4 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground">记忆时间轴 & 档案</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                  {memories?.length || 0} 条记忆
                </span>
              </div>
              <p className="text-xs text-muted-foreground">记录共同回忆、偏好习惯、承诺约定与重大节点</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => extractMutation.mutate({ personaId })}
              disabled={extractMutation.isPending}
              className="h-8 text-xs px-3 rounded-xl bg-gradient-to-r from-primary/20 to-chart-3/20 text-primary border border-primary/30 hover:bg-primary/20 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 mr-1 ${extractMutation.isPending ? "animate-spin" : ""}`} />
              AI 提取记忆
            </Button>
            <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {channelMembers.length > 1 && (
          <div className="px-6 py-2.5 border-b border-border/40 bg-muted/30 flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs font-bold text-foreground">当前角色：</span>
            <div className="flex items-center gap-2">
              {channelMembers.map((m: any) => (
                <button
                  key={m.personaId}
                  type="button"
                  onClick={() => onSwitchPersona(m.personaId)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    personaId === m.personaId
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.personaName}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-3 border-b border-border/40 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/50 text-xs">
            <button
              onClick={() => setActiveTab("active")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${activeTab === "active" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              有效记忆
            </button>
            <button
              onClick={() => setActiveTab("all")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${activeTab === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              全部
            </button>
          </div>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索记忆标题或细节..."
              className="h-8 pl-8 text-xs rounded-xl bg-muted/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="text-center py-16 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin text-primary/60 mx-auto" />
              <p className="text-xs text-muted-foreground">正在读取记忆档案...</p>
            </div>
          ) : isError ? (
            <div className="text-center py-16 space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-sm font-medium text-foreground">记忆档案加载失败</p>
              <p className="text-xs text-muted-foreground">网络异常或数据暂不可用，请点击右上角刷新重试。</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-xl text-xs cursor-pointer">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> 重试
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <Clock className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs text-muted-foreground">
                {memories?.length ? "没有匹配的记忆档案，换个关键词试试" : "TA 还没有沉淀记忆，对话推进后会自动记录共同回忆"}
              </p>
            </div>
          ) : (
            filtered.map((m: any) => (
              <div key={m.id} className="p-4 rounded-2xl border border-border/70 bg-card hover:border-primary/40 transition-all space-y-2 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-foreground">{m.title}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-medium">
                      {m.category || "日常记忆"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatBeijingDateTime(m.createdAt)}
                  </span>
                </div>
                {m.description && (
                  <p className="text-xs text-foreground/80 leading-relaxed bg-muted/20 p-2.5 rounded-xl border border-border/40">
                    {m.description}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RoleplaySourceLibraryModal({
  personaId,
  channelMembers,
  onSwitchPersona,
  onClose,
}: {
  personaId: number;
  channelMembers: any[];
  onSwitchPersona: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isLoading, isError } = trpc.sourceLibrary.overview.useQuery({ personaId, query });
  const sources = data?.sources || [];
  const results = data?.search?.results || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-chart-2/15 text-chart-2 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">资料库 & 原著知识沉淀</h3>
              <p className="text-xs text-muted-foreground">原著设定、背景档案与检索召回中枢（RAG 证据源）</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {channelMembers.length > 1 && (
          <div className="px-6 py-2.5 border-b border-border/40 bg-muted/30 flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs font-bold text-foreground">当前角色：</span>
            <div className="flex items-center gap-2">
              {channelMembers.map((m: any) => (
                <button
                  key={m.personaId}
                  type="button"
                  onClick={() => onSwitchPersona(m.personaId)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    personaId === m.personaId
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.personaName}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-6 border-b border-border/40">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="检索原著设定、人物性格或剧情证据切片..."
              className="pl-9 h-9 text-xs rounded-xl bg-muted/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="text-center py-16 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin text-primary/60 mx-auto" />
              <p className="text-xs text-muted-foreground">正在检索资料库...</p>
            </div>
          ) : isError ? (
            <div className="text-center py-16 space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-sm font-medium text-foreground">资料库加载失败</p>
              <p className="text-xs text-muted-foreground">网络异常或数据暂不可用，请稍后重试。</p>
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <span className="text-xs font-bold text-foreground">检索命中切片：</span>
              {results.map((r: any) => (
                <div key={r.id} className="p-4 rounded-2xl border border-border/70 bg-card space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-foreground">{r.sourceTitle} · {r.chapterTitle}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">分数: {r.score}</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed bg-muted/20 p-3 rounded-xl border border-border/40">
                    {r.content}
                  </p>
                </div>
              ))}
            </div>
          ) : sources.length > 0 ? (
            <div className="space-y-3">
              <span className="text-xs font-bold text-foreground">全部资料来源 ({sources.length})：</span>
              {sources.map((s: any) => (
                <div key={s.id} className="p-4 rounded-2xl border border-border/70 bg-card space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-foreground">{s.title}</span>
                    <span className="text-[10px] text-muted-foreground">{s.chunkCount} 个切片片段</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.sourceType} · {s.tokenEstimate} Tokens</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 space-y-2">
              <BookOpen className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs text-muted-foreground">当前角色还没有可检索的资料库，上传原著或在 1:1 聊天中沉淀后即可使用</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleplayEmotionModal({
  personaId,
  channelMembers,
  channelMessages,
  onSwitchPersona,
  onClose,
}: {
  personaId: number;
  channelMembers: any[];
  channelMessages?: any[];
  onSwitchPersona: (id: number) => void;
  onClose: () => void;
}) {
  const { data: report, isLoading, isError, refetch } = trpc.emotion.getReport.useQuery({ personaId, days: 30 });
  const member = channelMembers.find((m: any) => m.personaId === personaId);

  // 频道模式回退：1:1 情绪快照不覆盖频道消息时，直接用频道消息的 moodState 生成报告
  const channelMoodMessages = useMemo(
    () => (channelMessages || []).filter((m: any) => m.role !== "user" && m.moodState?.emotionalState),
    [channelMessages],
  );
  const channelReport = useMemo(() => {
    if (channelMoodMessages.length === 0) return null;
    const days = new Set<string>();
    const distMap = new Map<string, number>();
    let total = 0;
    channelMoodMessages.forEach((m: any) => {
      if (m.createdAt) days.add(typeof m.createdAt === "string" ? m.createdAt.slice(0, 10) : "");
      const state = String(m.moodState?.emotionalState || "");
      distMap.set(state, (distMap.get(state) || 0) + 1);
      total += 1;
    });
    const distribution = Array.from(distMap.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
    const snapshots = channelMoodMessages.slice(-30).map((m: any) => ({
      date: m.createdAt ? (typeof m.createdAt === "string" ? m.createdAt.slice(0, 10) : "") : "",
      emotionalState: String(m.moodState?.emotionalState || ""),
      messageCount: 1,
    }));
    return { totalDays: days.size, totalMessages: total, distribution, snapshots };
  }, [channelMoodMessages]);

  const isChannelMode = !report || (report.totalDays === 0 && report.totalMessages === 0);
  const effectiveReport = isChannelMode ? channelReport : report;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-chart-5/15 text-chart-5 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">情绪报告 & 趋势分析</h3>
              <p className="text-xs text-muted-foreground">
                {isChannelMode ? "频道对话情感统计 · 近 30 条角色发言" : "近 30 天心境演化、互动温度与情绪分布"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-muted/60 hover:bg-muted text-foreground border border-border/70 rounded-xl transition-all shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {channelMembers.length > 1 && (
          <div className="px-6 py-2.5 border-b border-border/40 bg-muted/30 flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs font-bold text-foreground">当前角色：</span>
            <div className="flex items-center gap-2">
              {channelMembers.map((m: any) => (
                <button
                  key={m.personaId}
                  type="button"
                  onClick={() => onSwitchPersona(m.personaId)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    personaId === m.personaId
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.personaName}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {isLoading ? (
            <div className="text-center py-16 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin text-primary/60 mx-auto" />
              <p className="text-xs text-muted-foreground">正在生成情绪报告...</p>
            </div>
          ) : isError && !channelReport ? (
            <div className="text-center py-16 space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-sm font-medium text-foreground">情绪报告加载失败</p>
              <p className="text-xs text-muted-foreground">网络异常或数据暂不可用，请点击右上角刷新重试。</p>
            </div>
          ) : !effectiveReport || (effectiveReport.totalMessages === 0 && effectiveReport.snapshots.length === 0) ? (
            <div className="text-center py-16 space-y-3">
              <Heart className="w-9 h-9 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium text-foreground">还没有可统计的情绪数据</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                频道对话开演后，这里会根据每一轮角色的情感标签生成情绪走势；1:1 的日常聊天记录也会汇总到当前角色的报告中。
                {member ? `「${member.personaName}」当前情感：${getMoodBadge(member.emotionalState).emoji} ${getMoodBadge(member.emotionalState).label}` : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/50 text-center">
                  <span className="text-[10px] text-muted-foreground font-bold">总互动天数</span>
                  <p className="text-lg font-bold text-foreground mt-0.5">{effectiveReport.totalDays || 0} 天</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/50 text-center">
                  <span className="text-[10px] text-muted-foreground font-bold">主流情绪</span>
                  <p className="text-lg font-bold text-primary mt-0.5">
                    {effectiveReport.distribution?.[0]?.state
                      ? `${getMoodBadge(effectiveReport.distribution[0].state).emoji} ${getMoodBadge(effectiveReport.distribution[0].state).label}`
                      : "温柔"}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/50 text-center">
                  <span className="text-[10px] text-muted-foreground font-bold">总发言条数</span>
                  <p className="text-lg font-bold text-foreground mt-0.5">{effectiveReport.totalMessages || 0} 条</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/50 text-center">
                  <span className="text-[10px] text-muted-foreground font-bold">情绪波动度</span>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">平稳温馨</p>
                </div>
              </div>

              {/* 情绪分布 */}
              {(effectiveReport.distribution || []).length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-foreground">情绪分布：</span>
                  <div className="space-y-1.5">
                    {effectiveReport.distribution.map((d: any) => {
                      const mood = getMoodBadge(d.state);
                      const pct = Math.round((d.count / Math.max(effectiveReport.totalMessages, 1)) * 100);
                      return (
                        <div key={d.state} className="flex items-center gap-2 text-xs">
                          <span className={`w-24 shrink-0 px-2 py-0.5 rounded-md border font-medium text-center ${mood.color}`}>
                            {mood.emoji} {mood.label}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-chart-5/70 to-chart-5" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-16 text-right font-mono text-muted-foreground">{pct}% · {d.count}条</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <span className="text-xs font-bold text-foreground">
                  {isChannelMode ? "频道情感流水（最近角色发言）：" : "近 30 天情绪快照流水："}
                </span>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {(effectiveReport.snapshots || []).map((s: any, idx: number) => {
                    const mood = getMoodBadge(s.emotionalState);
                    const src = isChannelMode ? channelMoodMessages[Math.max(0, channelMoodMessages.length - (effectiveReport.snapshots.length - idx))] : null;
                    return (
                      <div key={idx} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-border/60 bg-card text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {src && (
                            <span className="text-[11px] font-semibold text-foreground shrink-0">{src.speakerName}</span>
                          )}
                          {!src && <span className="font-mono text-muted-foreground shrink-0">{s.date}</span>}
                          <span className={`px-2 py-0.5 rounded-md border font-medium shrink-0 ${mood.color}`}>
                            {mood.emoji} {mood.label}
                          </span>
                          {src && (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                              {String(src.content || "").replace(/【[\s\S]*?】/g, "").trim().slice(0, 32) || "（本条仅旁白）"}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {src && src.createdAt ? formatBeijingTime(new Date(src.createdAt)) : `${s.messageCount} 条对话`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 频道工作台 · 情感状态面板（全员情感总览 & 心智快照）
// 数据：channel.members（基线情感）+ roleplay 消息（每轮 moodState/innerThought）
// ══════════════════════════════════════════════════════════════════════

function ChannelMoodPanel({
  channel,
  messages,
  personas,
  onClose,
  onOpenPersonaDiagnostics,
}: {
  channel: any;
  messages: any[];
  personas: any[];
  onClose: () => void;
  onOpenPersonaDiagnostics: (personaId: number) => void;
}) {
  const members = (channel.members || []) as any[];
  const memberStats = useMemo(
    () =>
      members.map(member => {
        const personaMessages = messages.filter(
          (m: any) => m.role !== "user" && (m.speakerId === member.personaId || m.speakerName === member.personaName),
        );
        const last = personaMessages[personaMessages.length - 1] || null;
        const persona = personas.find((p: any) => p.id === member.personaId);
        const mood = last?.moodState?.emotionalState || member.emotionalState || persona?.emotionalState || null;
        return { member, persona, count: personaMessages.length, last, mood };
      }),
    [members, messages, personas],
  );

  const moodTimeline = useMemo(
    () => messages.filter((m: any) => m.role !== "user" && m.moodState?.emotionalState).slice(-20),
    [messages],
  );
  const hasActivity = messages.some((m: any) => m.role !== "user");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/12 text-primary flex items-center justify-center">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">频道情感状态</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
                  {members.length} 位成员
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">频道全员实时情感与心智快照</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 panel-scrollbar space-y-5">
          {members.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <Users className="w-9 h-9 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium text-foreground">频道还没有成员</p>
              <p className="text-xs text-muted-foreground">进入【频道编辑】为频道添加角色后，这里会展示每位成员的情感状态。</p>
            </div>
          ) : (
            <>
              {/* 全员情感总览 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-rose-500" />
                    成员情感与最近互动
                  </span>
                  {!hasActivity && (
                    <span className="text-[10px] text-muted-foreground">频道刚开始 · 展示角色基线情感</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {memberStats.map(({ member, persona, count, last, mood }) => {
                    const moodCfg = getMoodBadge(mood);
                    return (
                      <div key={member.personaId} className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-2 relative">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-chart-3/20 text-foreground flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(member.personaName || "?")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-foreground truncate">{member.personaName}</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-md border font-medium shrink-0 ${moodCfg.color}`}>
                                {moodCfg.emoji} {moodCfg.label}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {count > 0 ? `${count} 次发言` : "尚未发言"}
                              {last?.createdAt ? ` · 最近 ${formatBeijingTime(new Date(last.createdAt))}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenPersonaDiagnostics(member.personaId)}
                            className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-muted/50 hover:bg-sky-500/10 hover:text-sky-500 text-muted-foreground border border-border/60 transition-colors cursor-pointer"
                            title="查看该角色的心智与运行诊断"
                          >
                            <Activity className="w-3 h-3" />
                            心智
                          </button>
                        </div>
                        {last?.innerThought ? (
                          <p className="text-[11px] text-muted-foreground/85 leading-relaxed bg-background/50 border border-border/40 rounded-xl p-2.5 italic">
                            💭 {last.innerThought}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                            暂无最近内心活动——发起对话后这里会记录 TA 的实时心境。
                            {persona?.analysisStatus === "ready" ? "（形象分析已就绪）" : ""}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 情感走向 */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-chart-5" />
                  情感走向（最近 {Math.min(moodTimeline.length, 20)} 轮角色发言）
                </span>
                {moodTimeline.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center">
                    <p className="text-xs text-muted-foreground">
                      还没有可统计的情感轨迹。点击【推进 N 轮对话】或输入一条旁白后，这里会实时记录每位角色的情感变化。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {moodTimeline.map((m: any, idx: number) => {
                      const cfg = getMoodBadge(m.moodState?.emotionalState);
                      return (
                        <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl border border-border/50 bg-card text-[11px]">
                          <span className="font-semibold text-foreground shrink-0 w-16 truncate">{m.speakerName}</span>
                          <span className={`px-1.5 py-0.2 rounded-md border font-medium shrink-0 ${cfg.color}`}>
                            {cfg.emoji} {cfg.label}
                          </span>
                          <span className="text-muted-foreground truncate min-w-0 flex-1">
                            {String(m.content || "").replace(/【[\s\S]*?】/g, "").trim().slice(0, 40) || "（本条仅旁白）"}
                          </span>
                          <span className="text-muted-foreground/60 shrink-0 font-mono">
                            {m.createdAt ? formatBeijingTime(new Date(m.createdAt)) : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 频道工作台 · 运行诊断面板（频道运行透视 & 逐角色节奏统计）
// 数据：roleplay 消息（innerThought/moodState）+ 频道成员信息
// ══════════════════════════════════════════════════════════════════════

function ChannelDiagnosticsPanel({
  channel,
  messages,
  personas,
  personaId,
  onSwitchPersona,
  onClose,
  onRefresh,
  isRefreshing,
  onOpenPersonaState,
}: {
  channel: any;
  messages: any[];
  personas: any[];
  personaId: number;
  onSwitchPersona: (id: number) => void;
  onClose: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenPersonaState: (personaId: number) => void;
}) {
  const members = (channel.members || []) as any[];
  const personaMessages = useMemo(() => messages.filter((m: any) => m.role !== "user"), [messages]);

  // 频道运行诊断快照（每轮发言后由后端写入）：最近一轮时间 / 节奏导演反思 / 策略 / 风险提示
  const diagnostics = (channel.runtimeDiagnostics as any) || null;
  const diagReflection = (diagnostics?.reflection as any) || null;
  const diagLastTurnAt = diagnostics?.lastTurnAt || null;
  const diagBeats = Array.isArray(diagnostics?.beats) ? diagnostics.beats : [];

  const memberStats = useMemo(
    () =>
      members.map(member => {
        const list = messages.filter(
          (m: any) => m.role !== "user" && (m.speakerId === member.personaId || m.speakerName === member.personaName),
        );
        const last = list[list.length - 1] || null;
        const avgChars = list.length
          ? Math.round(list.reduce((sum, m: any) => sum + String(m.content || "").replace(/【[\s\S]*?】/g, "").trim().length, 0) / list.length)
          : 0;
        const mood = last?.moodState?.emotionalState || member.emotionalState || null;
        return { member, count: list.length, last, avgChars, mood };
      }),
    [members, messages],
  );

  const moodDistribution = useMemo(() => {
    const map = new Map<string, number>();
    personaMessages.slice(-30).forEach((m: any) => {
      const state = String(m.moodState?.emotionalState || "");
      if (state) map.set(state, (map.get(state) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
  }, [personaMessages]);

  const recentEvents = useMemo(() => [...personaMessages].slice(-6).reverse(), [personaMessages]);
  const lastActivityAt = diagnostics?.lastTurnAt || personaMessages[personaMessages.length - 1]?.createdAt || null;
  const totalChars = personaMessages.reduce((sum, m: any) => sum + String(m.content || "").length, 0);

  // 诊断导航 Tab: "director" (节奏导演反思) | "cast" (双角色心智) | "memory_llm" (记忆与LLM统计) | "history" (频道节拍流)
  const [diagTab, setDiagTab] = useState<"director" | "cast" | "memory_llm" | "history">("director");
  const lastGlobalSpeaker = personaMessages[personaMessages.length - 1]?.speakerName || null;

  // 频道专属统计与 LLM 消耗查询
  const statsQuery = trpc.roleplay.stats.useQuery(
    { channelId: channel.id },
    { refetchOnWindowFocus: false },
  );
  const statsData = statsQuery.data;

  // 节奏风险：最近连续同一位角色发言的轮数
  const consecutiveStreak = useMemo(() => {
    if (personaMessages.length === 0) return 0;
    const lastSpeaker = personaMessages[personaMessages.length - 1]?.speakerName;
    let streak = 1;
    for (let i = personaMessages.length - 2; i >= 0; i--) {
      if (personaMessages[i]?.speakerName === lastSpeaker) streak++;
      else break;
    }
    return streak;
  }, [personaMessages]);

  const hintLabel = (hint: any): string => {
    if (hint === "same") return "上一位连说";
    if (hint === "other") return "换人回应";
    return "默认轮换";
  };
  const lengthLabel = (len: any): string => {
    if (len === "short") return "短篇幅";
    if (len === "long") return "长篇幅";
    if (len === "medium") return "中等篇幅";
    return "自然篇幅";
  };

  const handleRefreshAll = () => {
    statsQuery.refetch();
    onRefresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/12 text-sky-500 flex items-center justify-center shadow-2xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">频道运行透视与节奏诊断</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                  {personaMessages.length > 0 ? "推演进行中" : "待开演"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{channel.name} · 双角色推演事实与导演反思</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshing || statsQuery.isFetching}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-muted/60 hover:bg-muted text-foreground border border-border/70 rounded-xl transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || statsQuery.isFetching ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1 cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-border/50 bg-muted/10 shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-2xl border border-border/40 flex-wrap">
            <button
              type="button"
              onClick={() => setDiagTab("director")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                diagTab === "director"
                  ? "bg-card text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Brain className="w-3.5 h-3.5 text-amber-500" />
              <span>🎬 节奏导演反思</span>
            </button>
            <button
              type="button"
              onClick={() => setDiagTab("cast")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                diagTab === "cast"
                  ? "bg-card text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="w-3.5 h-3.5 text-primary" />
              <span>👥 双角色态势</span>
            </button>
            <button
              type="button"
              onClick={() => setDiagTab("memory_llm")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                diagTab === "memory_llm"
                  ? "bg-card text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span>🧠 记忆与 LLM 消耗</span>
            </button>
            <button
              type="button"
              onClick={() => setDiagTab("history")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                diagTab === "history"
                  ? "bg-card text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-500" />
              <span>📜 频道节拍流 ({personaMessages.length})</span>
            </button>
          </div>

          <div className="text-[11px] text-muted-foreground/80 font-mono">
            最近更新 {diagLastTurnAt ? formatBeijingTime(new Date(diagLastTurnAt)) : lastActivityAt ? formatBeijingTime(new Date(lastActivityAt)) : "暂无"}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 panel-scrollbar space-y-5">
          {personaMessages.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Gauge className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium text-foreground">频道暂无运行记录</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                点击主页面的【推进 N 轮对话】开启双角色对戏后，这里将实时呈现节奏导演反思、角色内心心智、记忆状态与频道 LLM 统计。
              </p>
            </div>
          ) : (
            <>
              {/* Top 4 Metric Cards */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/25 p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground text-[11px] font-semibold">
                    <span>频道角色</span>
                    <Users className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="text-base font-bold text-foreground">{members.length} 位在场</div>
                  <div className="text-[10px] text-muted-foreground">{members.map(m => m.personaName).join(" & ")}</div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/25 p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground text-[11px] font-semibold">
                    <span>角色发言</span>
                    <MessageSquareText className="w-3.5 h-3.5 text-chart-3" />
                  </div>
                  <div className="text-base font-bold text-foreground">{personaMessages.length} 轮对话</div>
                  <div className="text-[10px] text-muted-foreground">累计 {totalChars} 字符数</div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/25 p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground text-[11px] font-semibold">
                    <span>轮换健康度</span>
                    <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <div className="text-base font-bold text-foreground">
                    {consecutiveStreak >= 3 ? `同人连说 ${consecutiveStreak} 轮` : "轮换自然"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {consecutiveStreak >= 3 ? "可能需要换人接话" : "节奏平稳无卡顿"}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/25 p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground text-[11px] font-semibold">
                    <span>最近发言人</span>
                    <Clock className="w-3.5 h-3.5 text-sky-500" />
                  </div>
                  <div className="text-base font-bold text-foreground truncate">{lastGlobalSpeaker || "—"}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {lastActivityAt ? formatBeijingTime(new Date(lastActivityAt)) : "—"}
                  </div>
                </div>
              </div>

              {/* TAB 1: 节奏导演反思 */}
              {diagTab === "director" && (
                <div className="space-y-4 animate-fade-in">
                  {diagBeats.length > 0 && (
                    <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3">
                      <h4 className="text-xs font-bold">本轮实际发言 · {diagBeats.length} 拍</h4>
                      <p className="text-[11px] text-muted-foreground">按保存顺序记录；最后一拍用于本轮诊断概览。</p>
                      {diagBeats.map((beat: any, index: number) => (
                        <div key={beat.messageId ?? index} className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-1 text-xs">
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            <span>第 {index + 1} 拍 · {beat.speakerName}</span>
                            <span className="text-muted-foreground">{getMoodBadge(beat.emotionalState).label}</span>
                            {beat.messageId != null && <span className="text-muted-foreground">消息 {beat.messageId}</span>}
                            {index === diagBeats.length - 1 && <span className="text-primary">最后保存拍</span>}
                          </div>
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{beat.replyText}</p>
                          {beat.innerThought && <p className="text-muted-foreground whitespace-pre-wrap break-words">心声：{beat.innerThought}</p>}
                        </div>
                      ))}
                      {diagnostics?.postPersistWarning && <p className="text-[11px] text-amber-700">{diagnostics.postPersistWarning}</p>}
                    </div>
                  )}
                  {/* 下一拍剧情推进重点卡片 */}
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 p-4.5 space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                          <Sparkles className="w-3.5 h-3.5" />
                        </span>
                        <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 tracking-wide uppercase">
                          下一拍剧情推进目标 (Next Beat)
                        </h4>
                      </div>
                      {diagReflection?.stuckOnStatic && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/30 animate-pulse">
                          ⚠️ 静止状态已打破
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-[13px] text-foreground dark:text-zinc-100 font-medium leading-relaxed">
                      {diagReflection?.nextBeat || "下一拍自然推演中：保持生活动作连贯，推进新的剧情与对话互动。"}
                    </p>
                  </div>

                  {/* 回复策略与叙事侧重 */}
                  <div className="rounded-2xl border border-border/80 bg-card p-4.5 space-y-3 shadow-xs">
                    <div className="flex items-center gap-2">
                      <MessageSquareText className="w-4 h-4 text-primary" />
                      <h4 className="text-xs font-bold text-foreground">叙事与生成策略 (Strategy)</h4>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-xs text-foreground/90 leading-relaxed font-normal">
                      {diagReflection?.replyStrategy || "注重肢体动作步骤与环境触感描写，篇幅充分展开，避免干瘪敷衍。"}
                    </div>

                    {/* 导演决策指标矩阵 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      <div className="p-2.5 rounded-xl bg-muted/30 border border-border/40 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground font-medium">轮换决策</span>
                        <p className="text-xs font-bold text-foreground">{hintLabel(diagReflection?.nextSpeakerHint)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-muted/30 border border-border/40 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground font-medium">篇幅倾向</span>
                        <p className="text-xs font-bold text-foreground">{lengthLabel(diagReflection?.replyLength)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-muted/30 border border-border/40 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground font-medium">基调预判</span>
                        <p className="text-xs font-bold text-foreground flex items-center gap-1">
                          {getMoodBadge(diagReflection?.mood).emoji} {getMoodBadge(diagReflection?.mood).label}
                        </p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-muted/30 border border-border/40 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground font-medium">首发倾向</span>
                        <p className="text-xs font-bold text-foreground truncate">{diagReflection?.preferredSpeaker || "自然轮流"}</p>
                      </div>
                    </div>
                  </div>

                  {/* 角色内心预演 */}
                  {(diagReflection?.innerThought || diagnostics?.innerThought) && (
                    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-fuchsia-500/5 to-transparent p-4.5 space-y-2 shadow-xs">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-violet-500" />
                        <h4 className="text-xs font-bold text-foreground">导演预判角色内心活动 (Inner Thought Preview)</h4>
                      </div>
                      <p className="text-xs text-foreground/85 leading-relaxed italic bg-background/60 p-3 rounded-xl border border-violet-500/15">
                        💭 {diagReflection?.innerThought || diagnostics?.innerThought}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: 双角色态势与心智 */}
              {diagTab === "cast" && (
                <div className="space-y-4 animate-fade-in">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {memberStats.map(stat => {
                      const cfg = getMoodBadge(stat.mood);
                      return (
                        <div key={stat.member.personaId} className="rounded-2xl border border-border/80 bg-card p-4.5 space-y-3 shadow-xs flex flex-col justify-between">
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 via-chart-3/15 to-transparent border border-primary/25 flex items-center justify-center text-xs font-bold text-foreground shrink-0 shadow-2xs">
                                  {initials(stat.member.personaName || "?")}
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold text-foreground">{stat.member.personaName}</h4>
                                  <span className="text-[10px] text-muted-foreground font-medium">
                                    {stat.count} 轮发言 · 均 {stat.avgChars} 字
                                  </span>
                                </div>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shadow-2xs shrink-0 ${cfg.color}`}>
                                {cfg.emoji} {cfg.label}
                              </span>
                            </div>

                            {/* 最新内心活动 */}
                            <div className="space-y-1">
                              <span className="text-[10.5px] font-bold text-muted-foreground flex items-center gap-1">
                                <span>💭 最新心声</span>
                              </span>
                              <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-[11.5px] text-muted-foreground/90 italic leading-relaxed line-clamp-3">
                                {stat.last?.innerThought || "（本轮暂无单独心声记录）"}
                              </div>
                            </div>

                            {/* 最新台词摘要 */}
                            <div className="space-y-1">
                              <span className="text-[10.5px] font-bold text-muted-foreground flex items-center gap-1">
                                <MessageSquareText className="w-3 h-3 text-primary/70" />
                                <span>最新台词</span>
                              </span>
                              <div className="p-2.5 rounded-xl bg-muted/20 border border-border/30 text-[11.5px] text-foreground/80 leading-relaxed line-clamp-2">
                                {String(stat.last?.content || "").replace(/【[\s\S]*?】/g, "").trim() || "（本轮为场景动作）"}
                              </div>
                            </div>
                          </div>

                          <div className="text-[10px] text-muted-foreground/60 font-mono text-right pt-2 border-t border-border/30">
                            最近发言 {stat.last?.createdAt ? formatBeijingTime(new Date(stat.last.createdAt)) : "未发言"}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 情绪基调分布 */}
                  {moodDistribution.length > 0 && (
                    <div className="rounded-2xl border border-border/80 bg-card p-4.5 space-y-3 shadow-xs">
                      <div className="flex items-center gap-2">
                        <Heart className="w-4 h-4 text-rose-500" />
                        <h4 className="text-xs font-bold text-foreground">最近 30 轮情感基调分布</h4>
                      </div>
                      <div className="space-y-2">
                        {moodDistribution.map(d => {
                          const cfg = getMoodBadge(d.state);
                          const pct = Math.round((d.count / Math.max(personaMessages.length, 1)) * 100);
                          return (
                            <div key={d.state} className="flex items-center gap-2.5 text-xs">
                              <span className={`w-20 shrink-0 px-2 py-0.5 rounded-lg border font-medium text-center text-[10.5px] ${cfg.color}`}>
                                {cfg.emoji} {cfg.label}
                              </span>
                              <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
                                <div className="h-full rounded-full bg-gradient-to-r from-sky-500/70 to-sky-500 transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="w-16 text-right font-mono text-[11px] text-muted-foreground">{d.count} 次 ({pct}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: 记忆状态与 LLM 消耗 (仅频道相关) */}
              {diagTab === "memory_llm" && (
                <div className="space-y-4 animate-fade-in">
                  {/* 1. 频道记忆与上下文状态 */}
                  <div className="rounded-2xl border border-border/80 bg-card p-4.5 space-y-3.5 shadow-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                          <Database className="w-4 h-4" />
                        </div>
                        <h4 className="text-xs font-bold text-foreground">频道记忆与上下文状态 (Context & Memory)</h4>
                      </div>
                      <span className="text-[10.5px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/20">
                        🛡️ 纯情景世界锚 · 原著人物隔离
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">前情种子字符</span>
                        <p className="text-sm font-bold text-foreground">{statsData?.memory?.scenePromptChars ?? channel.scenePrompt?.length ?? 0} 字</p>
                        <span className="text-[9.5px] text-muted-foreground">场景与触觉基准</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">纳入上下文</span>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{statsData?.memory?.includedCount ?? messages.length} 条</p>
                        <span className="text-[9.5px] text-muted-foreground">参与后续推演生成</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">修剪/排除条数</span>
                        <p className="text-sm font-bold text-muted-foreground">{statsData?.memory?.excludedCount ?? 0} 条</p>
                        <span className="text-[9.5px] text-muted-foreground">不占上下文窗口</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">当前预估 Token</span>
                        <p className="text-sm font-bold text-foreground">~{statsData?.memory?.currentEstimatedTokens ?? Math.round(totalChars / 1.5)}</p>
                        <span className="text-[9.5px] text-muted-foreground">窗口上限 6,500 字符</span>
                      </div>
                    </div>

                    {/* 前情提要预览 */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>前情提要 / 记忆种子预览</span>
                      </span>
                      <div className="p-3 rounded-xl bg-muted/20 border border-border/40 text-[11.5px] text-foreground/80 leading-relaxed font-mono whitespace-pre-wrap line-clamp-3">
                        {channel.scenePrompt || "自由生活场景，未指定特别的前情提要种子。"}
                      </div>
                    </div>
                  </div>

                  {/* 2. 频道专属 LLM 消耗与模型调用 */}
                  <div className="rounded-2xl border border-border/80 bg-card p-4.5 space-y-3.5 shadow-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-sky-500/12 text-sky-500 flex items-center justify-center">
                          <Gauge className="w-4 h-4" />
                        </div>
                        <h4 className="text-xs font-bold text-foreground">频道专属 LLM 消耗与调用统计 (Channel Only)</h4>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] px-2.5 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium border border-sky-500/20 font-mono">
                          今日均耗 {(statsData?.llm?.avgDurationMs ? (statsData.llm.avgDurationMs / 1000).toFixed(1) : "—")}s
                        </span>
                        <span className="text-[10.5px] px-2.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium border border-border/50">
                          经济档位 {diagnostics?.economyLevel || "normal"}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">今日频道调用</span>
                        <p className="text-base font-bold text-foreground">{statsData?.llm?.todayCalls ?? 0} 次</p>
                        <span className="text-[9.5px] text-muted-foreground">回合推演 + 反思 + 润色</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">今日 Token 消耗</span>
                        <p className="text-base font-bold text-sky-600 dark:text-sky-400">{(statsData?.llm?.todayTokens ?? 0).toLocaleString()}</p>
                        <span className="text-[9.5px] text-muted-foreground">入 {(statsData?.llm?.todayInputTokens ?? 0).toLocaleString()} / 出 {(statsData?.llm?.todayOutputTokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">累计频道调用</span>
                        <p className="text-base font-bold text-foreground">{statsData?.llm?.totalCalls ?? personaMessages.length} 次</p>
                        <span className="text-[9.5px] text-muted-foreground">历史推演总轮次</span>
                      </div>
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium">累计 Token 消耗</span>
                        <p className="text-base font-bold text-foreground">{(statsData?.llm?.totalTokens ?? 0).toLocaleString()}</p>
                        <span className="text-[9.5px] text-muted-foreground">仅限生活频道</span>
                      </div>
                    </div>

                    {/* 细分子链路调用与路由统计 */}
                    {statsData?.llm?.routes && statsData.llm.routes.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <span className="text-[11px] font-bold text-muted-foreground">子链路调用分布</span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {statsData.llm.routes.map(r => {
                            const label = r.route.includes("reflection")
                              ? "🎬 节奏导演反思"
                              : r.route.includes("narration")
                              ? "✨ 旁白动作润色"
                              : "🎭 角色对话推演";
                            return (
                              <div key={r.route} className="p-2.5 rounded-xl bg-muted/20 border border-border/30 text-xs space-y-1">
                                <div className="flex items-center justify-between font-medium">
                                  <span className="text-foreground">{label}</span>
                                  <span className="text-primary font-mono">{r.calls} 次</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground/70 font-mono">
                                  Token: {r.totalTokens.toLocaleString()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: 频道节拍流 */}
              {diagTab === "history" && (
                <div className="space-y-3 animate-fade-in">
                  <div className="space-y-2">
                    {recentEvents.map((m: any, idx: number) => {
                      const cfg = getMoodBadge(m.moodState?.emotionalState);
                      const sections = parseRoleplayMessage(m.content);
                      const narration = sections.find(s => s.type === "narration")?.text;
                      const dialogue = sections.find(s => s.type === "dialogue")?.text;

                      return (
                        <div key={idx} className="p-3.5 rounded-2xl border border-border/70 bg-card space-y-2 shadow-2xs hover:border-border transition-colors">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground">{m.speakerName}</span>
                              <span className={`px-2 py-0.2 rounded-md border text-[10px] font-medium ${cfg.color}`}>
                                {cfg.emoji} {cfg.label}
                              </span>
                            </div>
                            <span className="text-[10.5px] text-muted-foreground/70 font-mono">
                              {m.createdAt ? formatBeijingDateTime(new Date(m.createdAt)) : ""}
                            </span>
                          </div>

                          {m.innerThought && (
                            <p className="text-[11.5px] text-muted-foreground/85 italic leading-relaxed bg-muted/30 p-2 rounded-lg border border-border/30">
                              💭 {m.innerThought}
                            </p>
                          )}

                          {dialogue && (
                            <p className="text-xs text-foreground font-medium leading-relaxed">
                              {dialogue}
                            </p>
                          )}

                          {narration && (
                            <p className="text-[11px] text-amber-800 dark:text-amber-200/90 bg-amber-500/5 p-2 rounded-lg border border-amber-500/15 leading-relaxed">
                              ✨ {narration}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
