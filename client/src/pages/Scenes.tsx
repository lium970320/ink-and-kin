import { useState, useEffect, useMemo, ChangeEvent } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatBeijingTime } from "@/lib/beijing-time";
import SceneChatHistoryManager from "@/components/SceneChatHistoryManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  Plus,
  Play,
  Pencil,
  Database,
  Sparkles,
  BookOpen,
  CheckCircle2,
  LogOut,
  Compass,
  Film,
  Users,
  Wand2,
  MessageSquareQuote,
  Lightbulb,
  Info,
  Clock,
  Trash2,
  Save,
  RotateCcw,
  Activity,
  Flame,
  AlertTriangle,
  Copy,
  Image as ImageIcon,
  Palette,
  Eye,
  X,
  ChevronRight,
  ListChecks,
  ArrowUpDown,
} from "lucide-react";

type PageView = "gallery" | "studio" | "memory";
type FilterTab = "all" | "active" | "custom" | "builtin";
type SortOption = "recent" | "created_desc" | "created_asc" | "name" | "turns";

interface SceneFormData {
  id?: number;
  name: string;
  icon: string;
  description: string;
  contextSeed?: string;
  systemPromptOverlay: string;
  personaIdentityOverride: string;
  userIdentityOverride: string;
  starters: string;
  continuationEnabled?: boolean;
  scenePersonaRefKey?: string | null;
  sceneUserRefKey?: string | null;
  sceneEnvRefKey?: string | null;
  sceneVisualBaseline?: string | null;
}

const EMOJI_PRESETS = [
  "🎭", "👨‍⚕️", "🩺", "🌙", "🌧️", "☕", "🏢", "🏫", "🏖️", "🚗", "🏡", "🍂", "🕯️", "📖", "🌲", "🌸", "✈️", "🍸"
];

const INSPIRATION_TEMPLATES = [
  {
    "title": "古城档案馆",
    "icon": "📚",
    "description": "两位调查员在旧城档案馆核对一份地图，寻找失落展品的线索。",
    "personaRole": "熟悉城市历史的档案管理员，认真细致，擅长检索资料。",
    "userRole": "受博物馆委托的调查员，负责整理线索和提出问题。",
    "prompt": "围绕地图、记录与证词展开推理。用对话推进调查，保留线索的不确定性，每轮提供一个可追踪的新发现。",
    "starters": "这张地图的标记与馆藏目录不一致。\n我们先核对哪一份记录？"
  },
  {
    "title": "星港检修站",
    "icon": "🚀",
    "description": "工程师与领航员在出航前协作排查飞船的导航故障。",
    "personaRole": "负责飞船维护的工程师，行动谨慎，习惯先核对数据。",
    "userRole": "熟悉航线的领航员，带来最新的航行日志。",
    "prompt": "描写仪表、工具与操作流程。故障线索应前后连贯，通过协作逐步缩小问题范围。",
    "starters": "导航信号出现了三次相同的偏移。\n请把上一段航行日志调出来。"
  },
  {
    "title": "山间驿站",
    "icon": "🌲",
    "description": "旅行者与向导在山间驿站整理物资，规划下一段行程。",
    "personaRole": "熟悉山路与天气的向导，表达简洁，尊重同行者的选择。",
    "userRole": "记录沿途地理风物的旅行者，携带地图和笔记。",
    "prompt": "用天气、地形和有限物资形成具体选择。描写普通旅行服饰、环境和道具，让人物通过讨论制定计划。",
    "starters": "前方山口可能有雨，我们有两条路线。\n先清点一下剩余物资。"
  },
  {
    "title": "海岸观测站",
    "icon": "🌊",
    "description": "两位观测员在海岸站整理潮汐记录，为下一次沿岸调查制定计划。",
    "personaRole": "熟悉海岸地形的观测员，认真记录现象，遇到变化会先核对仪器与笔记。",
    "userRole": "协作整理资料的调查搭档，负责比较不同日期的观测记录。",
    "prompt": "通过海风、潮声与观测工具呈现环境。区分已记录现象和待验证推测，用具体问题推进调查。",
    "starters": "今天的潮位和上周的记录有些不同。\n我们先核对时间，再看看哪一项仪器需要检查。"
  }
];

const PROMPT_TAGS = ["突出环境细节", "对话推进情节", "保留线索悬念", "动作清晰连贯", "保持角色一致性", "展现不同观点"];

function readImageFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result.split(",")[1] : "";
      if (!value) {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

export default function ScenesPage() {
  const params = useParams<{ id?: string }>();
  const personaId = Number(params.id) || 1;
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  // URL query params
  const searchParams = new URLSearchParams(window.location.search);
  const initialView = (searchParams.get("view") as PageView) || "gallery";
  const initialSceneId = searchParams.get("sceneId") ? Number(searchParams.get("sceneId")) : null;

  const [currentView, setCurrentView] = useState<PageView>(initialView);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(initialSceneId);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [assetUploading, setAssetUploading] = useState<"persona" | "user" | "env" | null>(null);
  const [showSceneChatManager, setShowSceneChatManager] = useState(false);
  const [historyScene, setHistoryScene] = useState<any | null>(null);

  // Studio form state
  const [studioForm, setStudioForm] = useState<SceneFormData>({
    name: "",
    icon: "🎭",
    description: "",
    contextSeed: "",
    systemPromptOverlay: "",
    personaIdentityOverride: "",
    userIdentityOverride: "",
    starters: "",
    continuationEnabled: true,
    scenePersonaRefKey: null,
    sceneUserRefKey: null,
    sceneEnvRefKey: null,
    sceneVisualBaseline: "",
  });

  // Memory drafts
  const [summaryDraft, setSummaryDraft] = useState("");
  const [factDraft, setFactDraft] = useState("");

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, loading, navigate]);

  // Queries
  const personaQuery = trpc.persona.get.useQuery({ id: personaId }, { enabled: isAuthenticated });
  const persona = personaQuery.data;
  const personaName = persona?.name || "TA";

  const scenesQuery = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });
  const scenes = useMemo(() => (scenesQuery.data ?? []) as any[], [scenesQuery.data]);

  const activeScene = useMemo(() => {
    return scenes.find(s => s.id === persona?.activeSceneId);
  }, [scenes, persona?.activeSceneId]);

  // Detail query for Memory view or active scene
  const detailQuery = trpc.scene.detail.useQuery(
    { id: selectedSceneId || 0, personaId },
    { enabled: isAuthenticated && Boolean(selectedSceneId && currentView === "memory") }
  );
  const currentDetailScene = detailQuery.data?.scene as any;
  const currentMemory = detailQuery.data?.memory as { storyState?: any; cache?: any } | undefined;

  useEffect(() => {
    if (currentMemory?.cache?.summary) {
      setSummaryDraft(currentMemory.cache.summary);
    } else {
      setSummaryDraft("");
    }
  }, [currentMemory?.cache?.summary]);

  // Mutations
  const activateSceneMutation = trpc.scene.activate.useMutation({
    onSuccess: () => {
      toast.success("已进入剧本情境");
      void scenesQuery.refetch();
      void personaQuery.refetch();
    },
    onError: (err: any) => toast.error("进入场景失败：" + (err?.message || "未知错误")),
  });

  const deactivateSceneMutation = trpc.scene.deactivate.useMutation({
    onSuccess: () => {
      toast.success("已退出剧场，恢复日常对话");
      void scenesQuery.refetch();
      void personaQuery.refetch();
    },
    onError: (err: any) => toast.error("退出场景失败：" + (err?.message || "未知错误")),
  });

  const createSceneMutation = trpc.scene.create.useMutation({
    onSuccess: (data: any) => {
      toast.success("新剧本场景已创建");
      void scenesQuery.refetch();
      if (data?.id) {
        setSelectedSceneId(data.id);
      }
      setCurrentView("gallery");
    },
    onError: (err: any) => toast.error("创建失败：" + (err?.message || "未知错误")),
  });

  const updateSceneMutation = trpc.scene.update.useMutation({
    onSuccess: () => {
      toast.success("剧本设置已保存");
      void scenesQuery.refetch();
      if (selectedSceneId) void detailQuery.refetch();
    },
    onError: (err: any) => toast.error("保存失败：" + (err?.message || "未知错误")),
  });

  const deleteSceneMutation = trpc.scene.delete.useMutation({
    onSuccess: () => {
      toast.success("剧本场景已删除");
      void scenesQuery.refetch();
      setCurrentView("gallery");
    },
    onError: (err: any) => toast.error("删除失败：" + (err?.message || "未知错误")),
  });

  const generateDraftMutation = trpc.scene.generateOverlayDraft.useMutation({
    onSuccess: data => {
      if (data?.draft) {
        setStudioForm(f => ({ ...f, systemPromptOverlay: data.draft }));
        toast.success("已智能提炼专属行为提示词");
      }
    },
    onError: (err: any) => toast.error("提炼初稿失败：" + (err?.message || "未知错误")),
  });

  const uploadSceneAsset = trpc.scene.uploadImageAsset.useMutation();

  const updateMemoryMutation = trpc.scene.updateMemory.useMutation({
    onSuccess: () => {
      toast.success("剧本记忆已更新");
      void detailQuery.refetch();
    },
    onError: (err: any) => toast.error("保存失败：" + (err?.message || "未知错误")),
  });

  const summarizeMemoryMutation = trpc.scene.summarizeMemory.useMutation({
    onSuccess: () => {
      toast.success("前情摘要已提炼生成，事实已同步更新");
      void detailQuery.refetch();
    },
    onError: (err: any) => toast.error("提炼摘要失败：" + (err?.message || "未知错误")),
  });

  const extractFactsMutation = trpc.scene.extractFacts.useMutation({
    onSuccess: (data) => {
      if (data?.facts && data.facts.length > 0) {
        toast.success(`已智能提炼并记住 ${data.facts.length} 条剧本关键事实`);
      } else {
        toast.info("暂未从近期对话中发现新的关键事实");
      }
      void detailQuery.refetch();
    },
    onError: (err: any) => toast.error("提炼事实失败：" + (err?.message || "未知错误")),
  });

  const clearMemoryMutation = trpc.scene.clearMemory.useMutation({
    onSuccess: () => {
      toast.success("剧本记忆已清空，下次将重新开场");
      void detailQuery.refetch();
    },
    onError: (err: any) => toast.error("清空失败：" + (err?.message || "未知错误")),
  });

  const copySceneMutation = trpc.scene.copy.useMutation({
    onSuccess: () => {
      toast.success("已另存为我的剧本");
      void scenesQuery.refetch();
      setCurrentView("gallery");
    },
    onError: (err: any) => toast.error("另存失败：" + (err?.message || "未知错误")),
  });

  // Filtered scenes list
  const filteredScenes = useMemo(() => {
    let result = scenes;
    if (activeTab === "active") {
      result = result.filter(s => s.id === persona?.activeSceneId);
    } else if (activeTab === "custom") {
      result = result.filter(s => !s.isBuiltin);
    } else if (activeTab === "builtin") {
      result = result.filter(s => Boolean(s.isBuiltin));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        s =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q) ||
          (s.personaIdentityOverride || "").toLowerCase().includes(q) ||
          (s.userIdentityOverride || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [scenes, activeTab, searchQuery, persona?.activeSceneId]);

  // 场景大厅卡片上展示的关键进展：回合数、最近剧情更新时间、事实/线索计数。
  const memorySceneIds = filteredScenes.map(s => s.id);
  const memoryStatsQuery = trpc.scene.getMemoryStats.useQuery(
    { personaId, sceneIds: memorySceneIds },
    { enabled: isAuthenticated && memorySceneIds.length > 0 },
  );
  const memoryStats = useMemo(() => {
    const list = memoryStatsQuery.data ?? [];
    const map = new Map<number, { turn: number; updatedAt: string | null; factCount: number; openThreadCount: number }>();
    for (const item of list) map.set(item.sceneId, item);
    return map;
  }, [memoryStatsQuery.data]);

  // Final sorted scenes list for display
  const displayScenes = useMemo(() => {
    const list = [...filteredScenes];
    list.sort((a, b) => {
      if (sortBy === "recent") {
        if (a.id === persona?.activeSceneId) return -1;
        if (b.id === persona?.activeSceneId) return 1;
        const statA = memoryStats.get(a.id);
        const statB = memoryStats.get(b.id);
        const timeA = statA?.updatedAt ? new Date(statA.updatedAt).getTime() : 0;
        const timeB = statB?.updatedAt ? new Date(statB.updatedAt).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.id || 0) - (a.id || 0);
      }
      if (sortBy === "created_desc") {
        return (b.id || 0) - (a.id || 0);
      }
      if (sortBy === "created_asc") {
        return (a.id || 0) - (b.id || 0);
      }
      if (sortBy === "name") {
        return (a.name || "").localeCompare(b.name || "", "zh-CN");
      }
      if (sortBy === "turns") {
        const turnA = memoryStats.get(a.id)?.turn || 0;
        const turnB = memoryStats.get(b.id)?.turn || 0;
        if (turnA !== turnB) return turnB - turnA;
        return (b.id || 0) - (a.id || 0);
      }
      return 0;
    });
    return list;
  }, [filteredScenes, sortBy, memoryStats, persona?.activeSceneId]);

  // View handlers
  const handleOpenCreate = () => {
    setStudioForm({
      name: "",
      icon: "🎭",
      description: "",
      contextSeed: "",
      systemPromptOverlay: "",
      personaIdentityOverride: "",
      userIdentityOverride: "",
      starters: "",
      continuationEnabled: true,
      scenePersonaRefKey: null,
      sceneUserRefKey: null,
      sceneEnvRefKey: null,
      sceneVisualBaseline: "",
    });
    setSelectedSceneId(null);
    setCurrentView("studio");
  };

  const handleOpenEdit = (scene: any) => {
    setStudioForm({
      id: scene.id,
      name: scene.name || "",
      icon: scene.icon || "🎭",
      description: scene.description || "",
      contextSeed: scene.contextSeed || "",
      systemPromptOverlay: scene.systemPromptOverlay || "",
      personaIdentityOverride: scene.personaIdentityOverride || "",
      userIdentityOverride: scene.userIdentityOverride || "",
      starters: (scene.starters || []).join("\n"),
      continuationEnabled: scene.continuationEnabled !== false,
      scenePersonaRefKey: scene.scenePersonaRefKey || null,
      sceneUserRefKey: scene.sceneUserRefKey || null,
      sceneEnvRefKey: scene.sceneEnvRefKey || null,
      sceneVisualBaseline: scene.sceneVisualBaseline || "",
    });
    setSelectedSceneId(scene.id);
    setCurrentView("studio");
  };

  const handleOpenMemory = (sceneId: number) => {
    setSelectedSceneId(sceneId);
    setCurrentView("memory");
  };

  const handleOpenSceneHistory = (scene: any) => {
    setHistoryScene(scene);
    setShowSceneChatManager(true);
  };

  const handleApplyTemplate = (tmpl: typeof INSPIRATION_TEMPLATES[0]) => {
    setStudioForm(f => ({
      ...f,
      name: tmpl.title,
      icon: tmpl.icon,
      description: tmpl.description,
      personaIdentityOverride: tmpl.personaRole,
      userIdentityOverride: tmpl.userRole,
      systemPromptOverlay: tmpl.prompt,
      starters: tmpl.starters,
    }));
    toast.success(`已载入「${tmpl.title}」剧本模板`);
  };

  const handleAddPromptTag = (tag: string) => {
    setStudioForm(f => {
      const current = f.systemPromptOverlay.trim();
      const addition = `【偏好】${tag}。`;
      if (current.includes(tag)) return f;
      return {
        ...f,
        systemPromptOverlay: current ? `${current}\n${addition}` : addition,
      };
    });
  };

  // Asset Upload
  const assetTypeLabel = (assetType: "persona" | "user" | "env") =>
    assetType === "persona" ? "人物定妆图" : assetType === "user" ? "用户定妆图" : "场景环境图";
  const handleUploadSceneAsset = async (assetType: "persona" | "user" | "env", file: File) => {
    if (!studioForm.id) {
      toast.error("请先创建或保存剧本，再上传专属配图资产");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("配图仅支持 PNG、JPEG 或 WebP 格式");
      return;
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      toast.error("配图大小须小于 10 MB");
      return;
    }
    setAssetUploading(assetType);
    try {
      const fileContent = await readImageFileAsBase64(file);
      const res = await uploadSceneAsset.mutateAsync({
        sceneId: studioForm.id,
        assetType,
        fileContent,
        mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
      });
      toast.success(`${assetTypeLabel(assetType)}已上传`);
      if (assetType === "persona") {
        setStudioForm(f => ({ ...f, scenePersonaRefKey: res.key }));
      } else if (assetType === "user") {
        setStudioForm(f => ({ ...f, sceneUserRefKey: res.key }));
      } else {
        setStudioForm(f => ({ ...f, sceneEnvRefKey: res.key }));
      }
      void scenesQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "上传配图资产失败");
    } finally {
      setAssetUploading(null);
    }
  };

  const handleClearAsset = (assetType: "persona" | "user" | "env") => {
    if (!studioForm.id) return;
    updateSceneMutation.mutate(
      assetType === "persona"
        ? { id: studioForm.id, scenePersonaRefKey: null }
        : assetType === "user"
          ? { id: studioForm.id, sceneUserRefKey: null }
          : { id: studioForm.id, sceneEnvRefKey: null },
      {
        onSuccess: () => {
          if (assetType === "persona") {
            setStudioForm(f => ({ ...f, scenePersonaRefKey: null }));
          } else if (assetType === "user") {
            setStudioForm(f => ({ ...f, sceneUserRefKey: null }));
          } else {
            setStudioForm(f => ({ ...f, sceneEnvRefKey: null }));
          }
          toast.success(`${assetTypeLabel(assetType)}已移除`);
        },
      }
    );
  };

  const handleSaveStudio = () => {
    const name = studioForm.name.trim();
    if (!name) {
      toast.error("请填写剧本场景名称");
      return;
    }
    const payload = {
      name,
      icon: studioForm.icon.trim() || "🎭",
      description: studioForm.description.trim(),
      systemPromptOverlay: studioForm.systemPromptOverlay.trim(),
      personaIdentityOverride: studioForm.personaIdentityOverride.trim(),
      userIdentityOverride: studioForm.userIdentityOverride.trim(),
      starters: studioForm.starters
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean),
      contextSeed: studioForm.contextSeed?.trim() || "",
      continuationEnabled: studioForm.continuationEnabled !== false,
      sceneVisualBaseline: studioForm.sceneVisualBaseline?.trim() || null,
    };

    if (studioForm.id) {
      updateSceneMutation.mutate(
        { id: studioForm.id, ...payload },
        {
          onSuccess: () => {
            setCurrentView("gallery");
          },
        }
      );
    } else {
      createSceneMutation.mutate(payload);
    }
  };

  const memoryFacts = useMemo(() => {
    return (currentMemory?.cache?.pinnedFacts ?? []) as Array<{
      id: string;
      fact: string;
      source: string;
    }>;
  }, [currentMemory?.cache?.pinnedFacts]);

  const memoryThreads = useMemo(() => {
    return (currentMemory?.cache?.openThreads ?? []) as Array<{
      id: string;
      summary: string;
      status: string;
    }>;
  }, [currentMemory?.cache?.openThreads]);

  const handleSaveSummary = () => {
    if (!selectedSceneId) return;
    updateMemoryMutation.mutate({
      sceneId: selectedSceneId,
      personaId,
      summary: summaryDraft,
      pinnedFacts: memoryFacts.map(f => ({
        id: f.id,
        fact: f.fact,
        source: f.source as "user" | "llm",
      })),
    });
  };

  const handleAddFact = () => {
    const fact = factDraft.trim();
    if (!fact || !selectedSceneId) return;
    updateMemoryMutation.mutate({
      sceneId: selectedSceneId,
      personaId,
      pinnedFacts: [
        ...memoryFacts.map(item => ({
          id: item.id,
          fact: item.fact,
          source: item.source as "user" | "llm",
        })),
        { id: `fact-${Date.now()}`, fact, source: "user" as const },
      ],
    });
    setFactDraft("");
  };

  const handleRemoveFact = (id: string) => {
    if (!selectedSceneId) return;
    updateMemoryMutation.mutate({
      sceneId: selectedSceneId,
      personaId,
      pinnedFacts: memoryFacts
        .filter(f => f.id !== id)
        .map(f => ({
          id: f.id,
          fact: f.fact,
          source: f.source as "user" | "llm",
        })),
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased pb-safe">
      {/* ── Top Navigation Bar (Mobile Responsive) ───────────────────── */}
      <header className="sticky top-0 z-40 bg-card/90 backdrop-blur-md border-b border-border/80 px-3 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-2.5 sm:gap-4 shrink-0 transition-all">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/chat/${personaId}`)}
            className="h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/70 gap-1 shrink-0"
            title="返回对话"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold hidden md:inline">返回对话</span>
          </Button>

          <div className="h-4 w-[1px] bg-border/80 hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm sm:text-base shadow-inner ring-1 ring-primary/20 shrink-0">
              🎭
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs sm:text-sm md:text-base font-bold text-foreground truncate">
                  剧场情境
                </h1>
                <span className="text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium truncate hidden sm:inline">
                  {personaName} 专属
                </span>
              </div>
            </div>
          </div>

          {/* If Active Scene: Integrated Header Status Pill */}
          {activeScene && (
            <div className="flex items-center gap-1.5 bg-chart-3/12 px-2 sm:px-2.5 py-1 rounded-xl border border-chart-3/25 text-xs font-semibold text-chart-3 min-w-0 shadow-2xs">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold truncate flex items-center gap-1">
                <span>{activeScene.icon || "🎭"}</span>
                <span className="max-w-[80px] xs:max-w-[130px] sm:max-w-[180px] truncate">{activeScene.name}</span>
              </span>
              {activeScene.personaIdentityOverride && (
                <span className="text-[10.5px] text-muted-foreground font-normal hidden xl:inline max-w-[200px] truncate">
                  ({activeScene.personaIdentityOverride})
                </span>
              )}
            </div>
          )}
        </div>

        {/* View Switcher Tabs & Active Scene Quick Actions in Header */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {activeScene && (
            <div className="flex items-center gap-1 bg-chart-3/10 p-0.5 sm:p-1 rounded-2xl border border-chart-3/25 shadow-2xs">
              <Button
                size="sm"
                onClick={() => navigate(`/chat/${personaId}`)}
                className="h-7.5 sm:h-8 rounded-xl bg-chart-3 text-white hover:bg-chart-3/90 text-xs font-bold shadow-xs flex items-center gap-1 px-2.5 sm:px-3 shrink-0"
                title={`一键进入当前正在运行的场景：${activeScene.name}`}
              >
                <Play className="w-3 h-3 fill-current" />
                <span>一键进入</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7.5 sm:h-8 text-xs text-chart-3 hover:bg-chart-3/15 px-2 rounded-xl font-medium hidden sm:flex items-center gap-1"
                onClick={() => handleOpenMemory(activeScene.id)}
                title="记忆中枢"
              >
                <Database className="w-3 h-3" />
                <span className="hidden md:inline">记忆中枢</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7.5 sm:h-8 text-xs text-destructive hover:bg-destructive/10 px-2 rounded-xl font-medium hidden sm:flex items-center gap-1"
                onClick={() => deactivateSceneMutation.mutate({ personaId })}
                disabled={deactivateSceneMutation.isPending}
                title="退出当前剧场"
              >
                <LogOut className="w-3 h-3" />
                <span className="hidden md:inline">退出</span>
              </Button>
            </div>
          )}

          <div className="flex items-center gap-0.5 sm:gap-1 bg-muted/40 p-0.5 sm:p-1 rounded-2xl border border-border/60 shadow-xs">
            <button
              onClick={() => setCurrentView("gallery")}
              className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-semibold transition-all ${
                currentView === "gallery"
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Film className="w-3.5 h-3.5 text-primary" />
              <span className="hidden xs:inline">剧场</span>大厅
            </button>
            <button
              onClick={handleOpenCreate}
              className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-semibold transition-all ${
                currentView === "studio" && !studioForm.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">新建</span>工坊
            </button>
            {selectedSceneId && (
              <button
                onClick={() => setCurrentView("memory")}
                className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  currentView === "memory"
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Database className="w-3.5 h-3.5 text-chart-3" />
                <span className="hidden xs:inline">剧本</span>记忆
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main View Content ────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 md:p-8">
        {/* ════ VIEW 1: GALLERY ════════════════════════════════════════ */}
        {currentView === "gallery" && (
          <div className="space-y-4 sm:space-y-6 animate-scale-in">
            {/* Filter, Sort & Search Bar (Mobile Horizontal Scroll) */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 bg-card p-2 sm:p-3 rounded-2xl border border-border/70 shadow-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Tabs */}
                <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40 overflow-x-auto no-scrollbar shrink-0">
                  <button
                    onClick={() => setActiveTab("all")}
                    className={`px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer ${
                      activeTab === "all"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    全部 ({scenes.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("custom")}
                    className={`px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer ${
                      activeTab === "custom"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    自建 ({scenes.filter(s => !s.isBuiltin).length})
                  </button>
                  <button
                    onClick={() => setActiveTab("builtin")}
                    className={`px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer ${
                      activeTab === "builtin"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    预置 ({scenes.filter(s => Boolean(s.isBuiltin)).length})
                  </button>
                  {activeScene && (
                    <button
                      onClick={() => setActiveTab("active")}
                      className={`px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer ${
                        activeTab === "active"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-primary hover:bg-primary/10"
                      }`}
                    >
                      进行中
                    </button>
                  )}
                </div>

                {/* Sort Selector */}
                <div className="flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-xl border border-border/40 text-xs shrink-0 shadow-2xs">
                  <ArrowUpDown className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-muted-foreground hidden sm:inline font-medium">排序:</span>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="bg-transparent text-xs font-semibold text-foreground focus:outline-hidden cursor-pointer"
                  >
                    <option value="recent">最近使用 / 活跃</option>
                    <option value="created_desc">添加时间 (最新)</option>
                    <option value="created_asc">添加时间 (最早)</option>
                    <option value="name">剧本名称 (A-Z)</option>
                    <option value="turns">剧情进度 (回合最多)</option>
                  </select>
                </div>
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索场景、身份、时代设定…"
                  className="h-8.5 pl-8 text-xs bg-muted/30 rounded-xl"
                />
              </div>
            </div>

            {/* Scene Cards Grid */}
            {scenesQuery.isLoading ? (
              <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-xs">正在载入剧场场景…</p>
              </div>
            ) : displayScenes.length === 0 ? (
              <div className="py-12 sm:py-16 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-3xl border border-dashed border-border/80 bg-card/50">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-3xl bg-muted/50 flex items-center justify-center text-2xl sm:text-3xl mb-3 shadow-inner">
                  🎬
                </div>
                <h3 className="text-sm sm:text-base font-bold text-foreground">没有找到匹配的剧本情境</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  {searchQuery
                    ? "尝试使用不同的关键词搜索，或新建一个你专属的情境剧本"
                    : "还没有创建过自定义场景，点击下方按钮开始创作吧"}
                </p>
                <Button size="sm" onClick={handleOpenCreate} className="mt-4 gap-1.5 rounded-xl text-xs font-semibold shadow-sm">
                  <Plus className="w-4 h-4" />
                  新建第一个剧本
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
                {displayScenes.map(scene => {
                  const isActive = scene.id === persona?.activeSceneId;
                  const hasCustomPersonaRole = Boolean(scene.personaIdentityOverride?.trim());
                  const hasCustomUserRole = Boolean(scene.userIdentityOverride?.trim());
                  const hasPersonaRef = Boolean(scene.scenePersonaRefKey);
                  const hasUserRef = Boolean(scene.sceneUserRefKey);
                  const hasEnvRef = Boolean(scene.sceneEnvRefKey);
                  const stat = memoryStats.get(scene.id);

                  return (
                    <div
                      key={scene.id}
                      className={`group relative rounded-2xl sm:rounded-3xl border transition-all duration-300 flex flex-col overflow-hidden bg-card hover:-translate-y-1 ${
                        isActive
                          ? "border-primary shadow-lg ring-1 ring-primary/30 bg-primary/[0.02]"
                          : "border-border/80 hover:border-primary/40 hover:shadow-md"
                      }`}
                    >
                      {/* Top highlight gradient bar */}
                      <div
                        className={`h-1.5 sm:h-2 w-full transition-opacity ${
                          isActive
                            ? "bg-primary opacity-100"
                            : "bg-gradient-to-r from-primary/40 via-chart-3/40 to-transparent opacity-0 group-hover:opacity-100"
                        }`}
                      />

                      <div className="p-4 sm:p-5 flex-1 flex flex-col">
                        {/* Card Header: Icon, Name, Badges */}
                        <div className="flex items-start justify-between gap-2 mb-2.5 sm:mb-3">
                          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-primary/20 via-chart-3/15 to-primary/5 border border-primary/25 flex items-center justify-center text-2xl sm:text-3xl shrink-0 group-hover:scale-105 transition-all shadow-sm ring-1 ring-primary/10 select-none">
                              <span className="drop-shadow-xs">{scene.icon || "🎭"}</span>
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-xs sm:text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                {scene.name}
                              </h3>
                              <div className="flex items-center gap-1 sm:gap-1.5 mt-0.5 flex-wrap">
                                {scene.isBuiltin ? (
                                  <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
                                    预置
                                  </span>
                                ) : (
                                  <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-md bg-primary/10 text-primary font-semibold">
                                    自建
                                  </span>
                                )}
                                {isActive && (
                                  <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    进行中
                                  </span>
                                )}
                                {(hasPersonaRef || hasUserRef || hasEnvRef) && (
                                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-md bg-chart-3/10 text-chart-3 font-semibold flex items-center gap-0.5">
                                    <ImageIcon className="w-2.5 h-2.5" /> 专属配图
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Edit button */}
                          {!scene.isBuiltin && (
                            <button
                              onClick={() => handleOpenEdit(scene)}
                              className="p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-primary transition-colors opacity-80 group-hover:opacity-100"
                              title="编辑剧本"
                            >
                              <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </button>
                          )}
                        </div>

                        {/* Description */}
                        <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-3 flex-1">
                          {scene.description || "暂无剧本简述"}
                        </p>

                        {/* Dual Role Badges */}
                        {(hasCustomPersonaRole || hasCustomUserRole) ? (
                          <div className="mb-3.5 p-2 sm:p-2.5 rounded-2xl bg-muted/30 border border-border/50 space-y-1">
                            {hasCustomPersonaRole && (
                              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px]">
                                <span className="font-semibold text-foreground/80 shrink-0">
                                  {personaName}：
                                </span>
                                <span className="text-muted-foreground truncate">
                                  {scene.personaIdentityOverride}
                                </span>
                              </div>
                            )}
                            {hasCustomUserRole && (
                              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px]">
                                <span className="font-semibold text-foreground/80 shrink-0">你：</span>
                                <span className="text-muted-foreground truncate">
                                  {scene.userIdentityOverride}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mb-3.5 text-[10px] sm:text-[11px] text-muted-foreground/60 italic flex items-center gap-1">
                            <Compass className="w-3 h-3" />
                            双方沿用日常身份设定
                          </div>
                        )}

                        {/* Key progress stats (turns & last update) */}
                        {stat && (stat.turn > 0 || stat.updatedAt) && (
                          <div className="mb-3.5 grid grid-cols-2 gap-1.5 text-[10px] sm:text-[11px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenSceneHistory(scene);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/5 hover:bg-primary/15 border border-primary/20 hover:border-primary/40 text-primary transition-all group/turn cursor-pointer text-left shadow-2xs hover:shadow-xs"
                              title="点击直接查看该剧本全部历史聊天记录与回合"
                            >
                              <Flame className="w-3.5 h-3.5 text-primary shrink-0 group-hover/turn:scale-110 transition-transform" />
                              <span className="text-foreground/80 font-medium group-hover/turn:text-primary">回合</span>
                              <span className="font-bold text-primary ml-auto flex items-center gap-0.5">
                                {stat.turn}
                                <ChevronRight className="w-3 h-3 opacity-60 group-hover/turn:opacity-100 group-hover/turn:translate-x-0.5 transition-all" />
                              </span>
                            </button>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-muted/30 border border-border/50 min-w-0">
                              <Clock className="w-3.5 h-3.5 text-chart-3 shrink-0" />
                              <span className="text-muted-foreground shrink-0">更新</span>
                              <span className="font-semibold text-foreground truncate ml-auto">
                                {stat.updatedAt ? formatBeijingTime(new Date(stat.updatedAt)) : "—"}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Card Footer Actions */}
                        <div className="pt-2.5 sm:pt-3 border-t border-border/60 flex items-center justify-between gap-2 mt-auto">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenMemory(scene.id)}
                            className="h-8 text-xs text-muted-foreground hover:text-foreground px-2 sm:px-2.5 rounded-xl gap-1 font-semibold"
                          >
                            <Database className="w-3.5 h-3.5 text-chart-3" />
                            <span>记忆线索</span>
                          </Button>

                          {isActive ? (
                            <Button
                              size="sm"
                              onClick={() => navigate(`/chat/${personaId}`)}
                              className="h-8 text-xs font-bold px-3 sm:px-3.5 rounded-xl bg-chart-3 text-white hover:bg-chart-3/90 shadow-xs flex items-center gap-1.5"
                              title="点击一键进入当前运行的剧场对话"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>一键进入</span>
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => activateSceneMutation.mutate({ personaId, sceneId: scene.id })}
                              disabled={activateSceneMutation.isPending}
                              className="h-8 text-xs font-bold px-3.5 sm:px-4 rounded-xl shadow-xs hover:shadow transition-all gap-1"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>进入剧场</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════ VIEW 2: STUDIO (Create / Edit) ═════════════════════════ */}
        {currentView === "studio" && (
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-scale-in">
            <div className="flex items-center justify-between border-b border-border/70 pb-3 sm:pb-4">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-lg sm:text-xl shadow-inner ring-1 ring-primary/20 shrink-0">
                  <Film className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base md:text-lg font-bold text-foreground truncate">
                    {studioForm.id ? "编辑剧本场景工坊" : "设计新剧本情境"}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                    设定时代背景、双角色身份、互动偏好与 /p 配图基准
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("gallery")}
                className="text-xs rounded-xl shrink-0"
              >
                返回大厅
              </Button>
            </div>

            {/* Inspiration Templates (New Only) */}
            {!studioForm.id && (
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
                      className="p-3 rounded-2xl border border-border/70 bg-card hover:border-primary hover:shadow-sm text-left transition-all group"
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
                <span>剧本基础概况</span>
              </div>

              <div className="space-y-3.5">
                {/* Row 1: Atmosphere Icon & Scene Name */}
                <div className="grid grid-cols-[80px_1fr] sm:grid-cols-[96px_1fr] gap-3 items-start">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground block h-4 leading-4">氛围图标</label>
                    <Input
                      value={studioForm.icon}
                      onChange={e => setStudioForm(f => ({ ...f, icon: e.target.value }))}
                      placeholder="🎭"
                      className="w-full text-center text-xl font-emoji h-10 rounded-xl bg-muted/20 border-border/60 p-0"
                      maxLength={4}
                    />
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <label className="text-xs font-semibold text-foreground block h-4 leading-4">
                      场景名称 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={studioForm.name}
                      onChange={e => setStudioForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="例如：古城档案馆、星港检修站…"
                      className="w-full h-10 rounded-xl font-medium text-xs sm:text-sm"
                      maxLength={100}
                    />
                  </div>
                </div>

                {/* Row 2: Clean Full-width Emoji Preset Quick Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">推荐氛围图标（点击快速选用）：</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-2xl bg-muted/25 border border-border/50">
                    {EMOJI_PRESETS.map(e => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setStudioForm(f => ({ ...f, icon: e }))}
                        className={`w-7.5 h-7.5 rounded-xl text-base flex items-center justify-center transition-all ${
                          studioForm.icon === e
                            ? "bg-primary/20 text-primary border border-primary/40 shadow-2xs scale-110"
                            : "hover:bg-card/90 hover:scale-110 text-foreground/85"
                        }`}
                        title={`选用 ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Row 3: One-sentence Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">一句话剧本简介</label>
                  <Input
                    value={studioForm.description}
                    onChange={e => setStudioForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="在场景卡片中展示，如：两位调查员在古城档案馆核对一份地图。"
                    className="h-10 text-xs sm:text-sm rounded-xl"
                    maxLength={200}
                  />
                </div>
              </div>
            </div>

            {/* 2. Dual Character Identity Card */}
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
                {/* Persona Role */}
                <div className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-1.5">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    {personaName} 在本场景的身份
                  </label>
                  <Textarea
                    value={studioForm.personaIdentityOverride}
                    onChange={e =>
                      setStudioForm(f => ({ ...f, personaIdentityOverride: e.target.value }))
                    }
                    placeholder={`例：${personaName} 是古城档案馆的资料员，负责整理地图与目录，保留原本性格。`}
                    rows={3}
                    className="text-xs leading-relaxed resize-none rounded-xl"
                    maxLength={4000}
                  />
                </div>

                {/* User Role */}
                <div className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-1.5">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-chart-3" />
                    你（用户）在本场景的身份
                  </label>
                  <Textarea
                    value={studioForm.userIdentityOverride}
                    onChange={e =>
                      setStudioForm(f => ({ ...f, userIdentityOverride: e.target.value }))
                    }
                    placeholder="例：用户是来访的调查员，与资料员共同核对地图线索，其余设定不变。"
                    rows={3}
                    className="text-xs leading-relaxed resize-none rounded-xl"
                    maxLength={4000}
                  />
                </div>
              </div>
            </div>

            {/* 3. System Prompt & Narration Card */}
            <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                  <Wand2 className="w-4 h-4 text-primary" />
                  <span>专属行为与旁白写法偏好</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    generateDraftMutation.mutate({
                      personaId,
                      sceneName: studioForm.name || "新场景",
                      hint: studioForm.description || studioForm.personaIdentityOverride,
                    })
                  }
                  disabled={generateDraftMutation.isPending}
                  className="h-7 text-xs text-primary gap-1 rounded-xl hover:bg-primary/10 border-primary/30"
                >
                  <Sparkles className="w-3 h-3" />
                  {generateDraftMutation.isPending ? "提炼中…" : "AI 智能提炼"}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] sm:text-[11px] text-muted-foreground mr-1">快捷偏好：</span>
                {PROMPT_TAGS.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAddPromptTag(tag)}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] bg-muted/60 hover:bg-primary/15 hover:text-primary border border-border/60 transition-colors"
                  >
                    +{tag}
                  </button>
                ))}
              </div>

              <Textarea
                value={studioForm.systemPromptOverlay}
                onChange={e =>
                  setStudioForm(f => ({ ...f, systemPromptOverlay: e.target.value }))
                }
                placeholder="例如：角色在档案馆与调查搭档核对地图，通过提问与线索推进情节。"
                rows={5}
                className="text-xs leading-relaxed rounded-xl font-mono"
              />
            </div>

            {/* 4. Scene Visual Assets & Baseline Card (Mobile Responsive) */}
            <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
              <div className="border-b border-border/50 pb-2">
                <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                  <Palette className="w-4 h-4 text-primary" />
                  <span>场景专属配图资产与视觉基线（/p 专属）</span>
                </div>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                  为该场景上传专属人物定妆图、用户定妆图与环境基准图，发送 <b>/p 画面</b> 时将优先采纳。
                </p>
              </div>

              {studioForm.id ? (
                <div className="space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Persona Reference Card */}
                    <div className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-2.5">
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <label className="text-xs font-bold text-foreground block">人物定妆图</label>
                          <span className="text-[10px] text-muted-foreground">该场景服装姿态</span>
                        </div>
                        <label className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-xl border border-border bg-card text-[11px] font-semibold cursor-pointer hover:bg-muted transition-colors text-primary shadow-xs">
                          <Plus className="w-3 h-3" />
                          {assetUploading === "persona" ? "上传中…" : studioForm.scenePersonaRefKey ? "替换" : "上传"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="sr-only"
                            disabled={assetUploading !== null}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleUploadSceneAsset("persona", f);
                            }}
                          />
                        </label>
                      </div>

                      {studioForm.scenePersonaRefKey ? (
                        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-card border border-border/60">
                          <img
                            src={`/uploads/${studioForm.scenePersonaRefKey}`}
                            alt="人物定妆图"
                            className="w-12 h-12 rounded-lg object-cover border border-border/50 shrink-0"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-foreground truncate">已绑人物定妆</p>
                            <p className="text-[9px] text-muted-foreground truncate">
                              {studioForm.scenePersonaRefKey.split("/").pop()}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6.5 text-[10px] text-destructive hover:bg-destructive/10 px-1.5 rounded-lg"
                            onClick={() => handleClearAsset("persona")}
                          >
                            清除
                          </Button>
                        </div>
                      ) : (
                        <div className="h-14 flex items-center justify-center rounded-xl border border-dashed border-border/70 text-[10px] text-muted-foreground">
                          未上传（沿用默认主图）
                        </div>
                      )}
                    </div>

                    {/* User Reference Card */}
                    <div className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-2.5">
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <label className="text-xs font-bold text-foreground block">用户定妆图</label>
                          <span className="text-[10px] text-muted-foreground">该场景用户服装姿态</span>
                        </div>
                        <label className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-xl border border-border bg-card text-[11px] font-semibold cursor-pointer hover:bg-muted transition-colors text-primary shadow-xs">
                          <Plus className="w-3 h-3" />
                          {assetUploading === "user" ? "上传中…" : studioForm.sceneUserRefKey ? "替换" : "上传"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="sr-only"
                            disabled={assetUploading !== null}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleUploadSceneAsset("user", f);
                            }}
                          />
                        </label>
                      </div>

                      {studioForm.sceneUserRefKey ? (
                        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-card border border-border/60">
                          <img
                            src={`/uploads/${studioForm.sceneUserRefKey}`}
                            alt="用户定妆图"
                            className="w-12 h-12 rounded-lg object-cover border border-border/50 shrink-0"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-foreground truncate">已绑用户定妆</p>
                            <p className="text-[9px] text-muted-foreground truncate">
                              {studioForm.sceneUserRefKey.split("/").pop()}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6.5 text-[10px] text-destructive hover:bg-destructive/10 px-1.5 rounded-lg"
                            onClick={() => handleClearAsset("user")}
                          >
                            清除
                          </Button>
                        </div>
                      ) : (
                        <div className="h-14 flex items-center justify-center rounded-xl border border-dashed border-border/70 text-[10px] text-muted-foreground">
                          未上传（沿用用户参考）
                        </div>
                      )}
                    </div>

                    {/* Env Reference Card */}
                    <div className="p-3.5 rounded-2xl border border-border/60 bg-muted/15 space-y-2.5 sm:col-span-2 lg:col-span-1">
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <label className="text-xs font-bold text-foreground block">场景环境图</label>
                          <span className="text-[10px] text-muted-foreground">地点道具光线</span>
                        </div>
                        <label className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-xl border border-border bg-card text-[11px] font-semibold cursor-pointer hover:bg-muted transition-colors text-primary shadow-xs">
                          <Plus className="w-3 h-3" />
                          {assetUploading === "env" ? "上传中…" : studioForm.sceneEnvRefKey ? "替换" : "上传"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="sr-only"
                            disabled={assetUploading !== null}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleUploadSceneAsset("env", f);
                            }}
                          />
                        </label>
                      </div>

                      {studioForm.sceneEnvRefKey ? (
                        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-card border border-border/60">
                          <img
                            src={`/uploads/${studioForm.sceneEnvRefKey}`}
                            alt="环境图"
                            className="w-12 h-12 rounded-lg object-cover border border-border/50 shrink-0"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-foreground truncate">已绑环境基准</p>
                            <p className="text-[9px] text-muted-foreground truncate">
                              {studioForm.sceneEnvRefKey.split("/").pop()}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6.5 text-[10px] text-destructive hover:bg-destructive/10 px-1.5 rounded-lg"
                            onClick={() => handleClearAsset("env")}
                          >
                            清除
                          </Button>
                        </div>
                      ) : (
                        <div className="h-14 flex items-center justify-center rounded-xl border border-dashed border-border/70 text-[10px] text-muted-foreground">
                          未上传环境基准图
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visual Baseline Text */}
                  <div className="space-y-1 pt-1">
                    <label className="text-xs font-semibold text-foreground">画面基线文字描述（可选）</label>
                    <Textarea
                      value={studioForm.sceneVisualBaseline || ""}
                      onChange={e =>
                        setStudioForm(f => ({ ...f, sceneVisualBaseline: e.target.value }))
                      }
                      placeholder="例：暖黄色低饱和度光线，安静的古城档案馆，桌上铺着地图，窗外有树叶的阴影。"
                      rows={2}
                      className="text-xs leading-relaxed rounded-xl"
                    />
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                      作为生图提示词中服装、地点与画质的基础底稿；若留空，首次出图成功后会自动回填。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 text-[11px] sm:text-xs text-muted-foreground leading-relaxed flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary shrink-0" />
                  <span>
                    新建剧本保存成功后，即可在此直接上传该剧本的人物定妆图、环境基准图与画面基线。
                  </span>
                </div>
              )}
            </div>

            {/* 5. Context Seed & Continuation Card */}
            <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground border-b border-border/50 pb-2">
                <Compass className="w-4 h-4 text-primary" />
                <span>前情切入点与开场白</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  前情提要 / 当前上下文（Context Seed）
                </label>
                <Textarea
                  value={studioForm.contextSeed}
                  onChange={e => setStudioForm(f => ({ ...f, contextSeed: e.target.value }))}
                  placeholder="例如：角色在档案馆与调查搭档核对地图，通过提问与线索推进情节。"
                  rows={3}
                  className="text-xs leading-relaxed rounded-xl"
                  maxLength={4000}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <MessageSquareQuote className="w-3.5 h-3.5 text-muted-foreground" />
                  剧本开场白（可选，一行一句）
                </label>
                <Textarea
                  value={studioForm.starters}
                  onChange={e => setStudioForm(f => ({ ...f, starters: e.target.value }))}
                  placeholder="例：&#10;这份地图上的标记还需要核对。&#10;我们先查目录，再决定下一步。"
                  rows={2}
                  className="text-xs leading-relaxed rounded-xl"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl border border-border/60 bg-muted/20 cursor-pointer hover:border-primary/40 transition-colors">
                  <div className="space-y-0.5 pr-2">
                    <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      再次进入时自动续写剧情记忆
                    </div>
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground">
                      开启后，重进该场景会自动延续上次的前情提要与剧情事实；关闭则每次从头开场。
                    </div>
                  </div>
                  <Switch
                    checked={studioForm.continuationEnabled}
                    onCheckedChange={checked =>
                      setStudioForm(f => ({ ...f, continuationEnabled: checked }))
                    }
                  />
                </label>
              </div>
            </div>

            {/* Studio Action Buttons (Mobile Responsive) */}
            <div className="flex items-center justify-between pt-3 sm:pt-4 border-t border-border/70 pb-4 sm:pb-0">
              <div>
                {studioForm.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (studioForm.id && window.confirm("确定删除这个剧本场景？此操作不可撤销。")) {
                        deleteSceneMutation.mutate({ id: studioForm.id });
                      }
                    }}
                    disabled={deleteSceneMutation.isPending}
                    className="text-xs text-destructive hover:bg-destructive/10 gap-1 rounded-xl px-2.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">删除剧本</span>
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentView("gallery")}
                  className="text-xs rounded-xl px-3"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveStudio}
                  disabled={createSceneMutation.isPending || updateSceneMutation.isPending}
                  className="text-xs font-bold px-4 sm:px-6 rounded-xl gap-1.5 shadow-sm hover:shadow"
                >
                  <Save className="w-3.5 h-3.5" />
                  {createSceneMutation.isPending || updateSceneMutation.isPending
                    ? "保存中…"
                    : studioForm.id
                    ? "保存剧本"
                    : "创建剧本"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ════ VIEW 3: MEMORY & PROGRESS ═════════════════════════════ */}
        {currentView === "memory" && (
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-scale-in">
            {detailQuery.isLoading ? (
              <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-xs">正在读取剧本记忆中枢…</p>
              </div>
            ) : !currentDetailScene ? (
              <div className="py-12 sm:py-16 text-center text-muted-foreground">
                <p className="text-xs sm:text-sm">未选择或无法读取该剧本场景。</p>
                <Button size="sm" onClick={() => setCurrentView("gallery")} className="mt-3 rounded-xl">
                  返回大厅
                </Button>
              </div>
            ) : (
              <>
                {/* Memory Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/70 pb-3 sm:pb-4">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-chart-3/10 text-chart-3 flex items-center justify-center text-xl sm:text-2xl shadow-inner ring-1 ring-chart-3/20 shrink-0">
                      {currentDetailScene.icon || "🎭"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm sm:text-base md:text-lg font-bold text-foreground truncate">
                          {currentDetailScene.name} · 记忆中枢
                        </h2>
                        {currentDetailScene.isBuiltin ? (
                          <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                            预置
                          </span>
                        ) : (
                          <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                            自建
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                        {currentDetailScene.description || "管理本剧本内的前情摘要、已确认事实与剧情线索"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenEdit(currentDetailScene)}
                      className="text-xs rounded-xl gap-1 h-7.5 px-2.5"
                    >
                      <Pencil className="w-3 h-3" />
                      <span className="hidden xs:inline">编辑设定与配图</span>
                      <span className="xs:hidden">编辑</span>
                    </Button>
                    {currentDetailScene.isBuiltin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copySceneMutation.mutate({ sceneId: currentDetailScene.id })}
                        disabled={copySceneMutation.isPending}
                        className="text-xs rounded-xl gap-1 h-7.5 px-2.5"
                      >
                        <Copy className="w-3 h-3" />
                        <span className="hidden xs:inline">另存为我的剧本</span>
                        <span className="xs:hidden">另存</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentView("gallery")}
                      className="text-xs rounded-xl h-7.5 px-2.5"
                    >
                      大厅
                    </Button>
                  </div>
                </div>

                {/* Dashboard Tiles (2 columns on mobile, 4 on desktop) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
                  <button
                    onClick={() => setShowSceneChatManager(true)}
                    className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-xs text-left w-full hover:bg-muted/30 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
                      <Flame className="w-3.5 h-3.5 text-primary" />
                      对话回合
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-bold text-foreground">
                      {currentMemory?.storyState?.turn ?? 0} <span className="text-[10px] sm:text-xs font-normal text-muted-foreground">回合</span>
                    </p>
                  </button>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
                      <Clock className="w-3.5 h-3.5 text-chart-3" />
                      剧情更新
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs font-bold text-foreground truncate">
                      {currentMemory?.storyState?.updatedAt ?? "暂无活动"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
                      <Activity className="w-3.5 h-3.5 text-emerald-500" />
                      已确认事实
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-bold text-foreground">
                      {memoryFacts.length} <span className="text-[10px] sm:text-xs font-normal text-muted-foreground">条</span>
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
                      未完成线索
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-bold text-foreground">
                      {memoryThreads.length} <span className="text-[10px] sm:text-xs font-normal text-muted-foreground">条</span>
                    </p>
                  </div>
                </div>

                {/* Summary Card */}
                <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3.5 sm:space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-xs sm:text-sm text-foreground">滚动前情摘要</h3>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                        再次进入该场景时先读取这段摘要，快速接续剧情线索。
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        summarizeMemoryMutation.mutate({
                          sceneId: currentDetailScene.id,
                          personaId,
                        })
                      }
                      disabled={summarizeMemoryMutation.isPending}
                      className="text-xs rounded-xl gap-1 text-primary border-primary/30 hover:bg-primary/10 h-7 px-2.5"
                    >
                      <Sparkles className="w-3 h-3" />
                      {summarizeMemoryMutation.isPending ? "提炼中…" : "提炼最新摘要"}
                    </Button>
                  </div>

                  <Textarea
                    value={summaryDraft}
                    onChange={e => setSummaryDraft(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    className="rounded-2xl text-xs leading-relaxed font-mono"
                    placeholder="还没有生成摘要。在场景里聊几轮后点击上方「提炼最新摘要」，或在此处手动写一段前情。"
                  />

                  <div className="flex justify-end pt-0.5">
                    <Button
                      size="sm"
                      onClick={handleSaveSummary}
                      disabled={updateMemoryMutation.isPending}
                      className="text-xs font-bold px-3.5 sm:px-4 rounded-xl gap-1 h-7.5"
                    >
                      <Save className="w-3 h-3" />
                      保存摘要
                    </Button>
                  </div>
                </div>

                {/* Facts Card */}
                <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3 sm:space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-xs sm:text-sm text-foreground">剧本内已确认事实</h3>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                        下次进入场景时，这些事实会随记忆一同注入，AI 会自动记住重要时刻与习惯默契。
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        extractFactsMutation.mutate({
                          sceneId: currentDetailScene.id,
                          personaId,
                        })
                      }
                      disabled={extractFactsMutation.isPending}
                      className="text-xs rounded-xl gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 h-7 px-2.5"
                    >
                      <Sparkles className="w-3 h-3" />
                      {extractFactsMutation.isPending ? "提炼事实中…" : "✨ 智能提炼事实"}
                    </Button>
                  </div>

                  {memoryFacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-2xl p-3.5">
                      暂无剧本专属事实。在对话中达成重要约定或产生默契后，系统会自动提炼，您也可以在此手动输入。
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {memoryFacts.map(fact => (
                        <span
                          key={fact.id}
                          className={`inline-flex items-center gap-1 sm:gap-1.5 rounded-full border px-2.5 sm:px-3.5 py-1 text-xs text-foreground transition-all ${
                            fact.source === "llm"
                              ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-950 dark:text-emerald-100"
                              : "border-border/80 bg-muted/40 hover:bg-muted/70"
                          }`}
                        >
                          {fact.source === "llm" && (
                            <span title="AI自动提炼" className="inline-flex items-center shrink-0">
                              <Sparkles className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                            </span>
                          )}
                          <span>{fact.fact}</span>
                          <button
                            onClick={() => handleRemoveFact(fact.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 p-0.5"
                            title="删除这条事实"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Input
                      value={factDraft}
                      onChange={e => setFactDraft(e.target.value)}
                      placeholder="输入一条剧本事实，按回车添加…"
                      className="text-xs rounded-xl h-8.5"
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handleAddFact();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddFact}
                      disabled={!factDraft.trim() || updateMemoryMutation.isPending}
                      className="text-xs rounded-xl shrink-0 gap-1 font-semibold h-8.5 px-3"
                    >
                      <Plus className="w-3 h-3" />
                      添加
                    </Button>
                  </div>
                </div>

                {/* Open Threads Card (if any) */}
                {memoryThreads.length > 0 && (
                  <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-4 sm:p-6 space-y-3 sm:space-y-4 shadow-sm">
                    <div className="border-b border-border/50 pb-2">
                      <h3 className="font-bold text-xs sm:text-sm text-foreground">未完成的剧情线索</h3>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                        在接下来的对话中提醒人物自然推进这些事件。
                      </p>
                    </div>

                    <div className="space-y-2">
                      {memoryThreads.map(thread => (
                        <div
                          key={thread.id}
                          className="flex items-start gap-2 rounded-2xl border border-border/60 bg-muted/15 p-3 text-xs"
                        >
                          {thread.status === "open" ? (
                            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                          )}
                          <span
                            className={
                              thread.status === "open"
                                ? "text-foreground leading-relaxed font-medium"
                                : "text-muted-foreground line-through leading-relaxed"
                            }
                          >
                            {thread.summary}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reset Action */}
                <div className="rounded-2xl sm:rounded-3xl border border-destructive/20 bg-destructive/[0.02] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-destructive">清空剧情记忆重开</h4>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                      仅清空该场景内的剧情记忆缓存与前情摘要，不会删除角色原有的聊天消息。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm("确定清空这个场景的剧情记忆并重新开始？聊天记录不会被删除。")) {
                        clearMemoryMutation.mutate({
                          sceneId: currentDetailScene.id,
                          personaId,
                        });
                      }
                    }}
                    disabled={clearMemoryMutation.isPending}
                    className="text-xs rounded-xl gap-1.5 h-8 shrink-0 self-end sm:self-auto"
                  >
                    <RotateCcw className="w-3 h-3" />
                    清空记忆重开
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {showSceneChatManager && (historyScene || currentDetailScene) && (
        <SceneChatHistoryManager
          sceneId={(historyScene || currentDetailScene).id}
          personaId={personaId}
          sceneName={(historyScene || currentDetailScene).name || "场景"}
          personaName={personaName}
          onClose={() => {
            setShowSceneChatManager(false);
            setHistoryScene(null);
          }}
          onHistoryChanged={() => {
            void detailQuery.refetch();
            void memoryStatsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
