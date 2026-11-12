import { useState, useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatBeijingTime } from "@/lib/beijing-time";
import SceneChatHistoryManager from "@/components/SceneChatHistoryManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MotionModal, SPRING_SNAPPY } from "@/components/ui/motion";
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
  const [confirmDeleteSceneOpen, setConfirmDeleteSceneOpen] = useState(false);
  const [confirmClearMemoryOpen, setConfirmClearMemoryOpen] = useState(false);

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
      setConfirmDeleteSceneOpen(false);
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
      setConfirmClearMemoryOpen(false);
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
      {/* ── Top Navigation Bar (Editorial Quiet Luxury & Mobile Responsive) ── */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border/65 shrink-0 transition-all">
        <div className="px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/chat/${personaId}`)}
              className="h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-1 shrink-0 cursor-pointer"
              title="返回对话"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-xs font-medium hidden md:inline">返回对话</span>
            </Button>

            <div className="h-4 w-px bg-border/70 hidden sm:block shrink-0" />

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-primary/10 border border-primary/18 text-primary flex items-center justify-center text-sm sm:text-base shrink-0">
                🎭
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-xs sm:text-sm md:text-base font-semibold text-foreground truncate tracking-tight">
                    剧场情境
                  </h1>
                  <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-muted/70 border border-border/60 text-muted-foreground font-medium truncate hidden sm:inline">
                    {personaName} 专属
                  </span>
                </div>
              </div>
            </div>

            {/* Desktop Active Scene Pill */}
            {activeScene && (
              <div className="hidden lg:flex items-center gap-1.5 bg-emerald-500/8 px-2.5 py-1 rounded-full border border-emerald-500/22 text-xs font-medium text-emerald-700 dark:text-emerald-300 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-70" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="truncate flex items-center gap-1 max-w-[180px]">
                  <span>{activeScene.icon || "🎭"}</span>
                  <span className="truncate font-semibold">{activeScene.name}</span>
                </span>
              </div>
            )}
          </div>

          {/* Right: Desktop Active Quick Bar + Shared layoutId View Segmented Switcher */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {activeScene && (
              <div className="hidden sm:flex items-center gap-1 bg-muted/45 p-1 rounded-2xl border border-border/65">
                <Button
                  size="sm"
                  onClick={() => navigate(`/chat/${personaId}`)}
                  className="h-7.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-2xs flex items-center gap-1 px-2.5 shrink-0 cursor-pointer"
                  title={`一键进入当前正在运行的场景：${activeScene.name}`}
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>一键进入</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7.5 text-xs text-muted-foreground hover:text-foreground hover:bg-card/80 px-2 rounded-xl font-medium flex items-center gap-1 cursor-pointer"
                  onClick={() => handleOpenMemory(activeScene.id)}
                  title="记忆中枢"
                >
                  <Database className="w-3 h-3 text-chart-3" />
                  <span className="hidden md:inline">记忆中枢</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7.5 text-xs text-destructive hover:bg-destructive/10 px-2 rounded-xl font-medium flex items-center gap-1 cursor-pointer"
                  onClick={() => deactivateSceneMutation.mutate({ personaId })}
                  disabled={deactivateSceneMutation.isPending}
                  title="退出当前剧场"
                >
                  <LogOut className="w-3 h-3" />
                  <span className="hidden md:inline">退出</span>
                </Button>
              </div>
            )}

            <div
              role="tablist"
              aria-label="剧场情境视图切换"
              className="inline-flex items-center gap-0.5 bg-muted/55 p-1 rounded-2xl border border-border/65 backdrop-blur-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={currentView === "gallery"}
                onClick={() => setCurrentView("gallery")}
                className={`relative flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs transition-colors outline-none select-none cursor-pointer ${
                  currentView === "gallery"
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground font-medium"
                }`}
              >
                {currentView === "gallery" && (
                  <motion.span
                    layoutId="scenes-view-pill"
                    transition={SPRING_SNAPPY}
                    className="pointer-events-none absolute inset-0 rounded-xl border border-border/70 bg-card shadow-xs dark:border-border/55 dark:bg-card/95"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  <Film className={`w-3.5 h-3.5 ${currentView === "gallery" ? "text-primary" : "text-muted-foreground"}`} />
                  <span>
                    <span className="hidden xs:inline">剧场</span>大厅
                  </span>
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={currentView === "studio"}
                onClick={() => {
                  if (currentView === "studio" && studioForm.id) return;
                  handleOpenCreate();
                }}
                className={`relative flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs transition-colors outline-none select-none cursor-pointer ${
                  currentView === "studio"
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground font-medium"
                }`}
              >
                {currentView === "studio" && (
                  <motion.span
                    layoutId="scenes-view-pill"
                    transition={SPRING_SNAPPY}
                    className="pointer-events-none absolute inset-0 rounded-xl border border-border/70 bg-card shadow-xs dark:border-border/55 dark:bg-card/95"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  {currentView === "studio" && studioForm.id ? (
                    <Pencil className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Plus className={`w-3.5 h-3.5 ${currentView === "studio" ? "text-primary" : "text-muted-foreground"}`} />
                  )}
                  <span>
                    {currentView === "studio" && studioForm.id ? (
                      <>
                        <span className="hidden xs:inline">编辑</span>工坊
                      </>
                    ) : (
                      <>
                        <span className="hidden xs:inline">新建</span>工坊
                      </>
                    )}
                  </span>
                </span>
              </button>

              {(selectedSceneId || activeScene) && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={currentView === "memory"}
                  onClick={() => {
                    if (!selectedSceneId && activeScene) {
                      setSelectedSceneId(activeScene.id);
                    }
                    setCurrentView("memory");
                  }}
                  className={`relative flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs transition-colors outline-none select-none cursor-pointer ${
                    currentView === "memory"
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground font-medium"
                  }`}
                >
                  {currentView === "memory" && (
                    <motion.span
                      layoutId="scenes-view-pill"
                      transition={SPRING_SNAPPY}
                      className="pointer-events-none absolute inset-0 rounded-xl border border-border/70 bg-card shadow-xs dark:border-border/55 dark:bg-card/95"
                    />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1">
                    <Database className={`w-3.5 h-3.5 ${currentView === "memory" ? "text-chart-3" : "text-muted-foreground"}`} />
                    <span>
                      <span className="hidden xs:inline">剧本</span>记忆
                    </span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Compact Active Scene Strip (< sm) */}
        {activeScene && (
          <div className="sm:hidden border-t border-border/50 bg-muted/25 px-3 py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="shrink-0">{activeScene.icon || "🎭"}</span>
              <span className="font-semibold text-foreground truncate">{activeScene.name}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => navigate(`/chat/${personaId}`)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold cursor-pointer"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                进入
              </button>
              <button
                type="button"
                onClick={() => handleOpenMemory(activeScene.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border/65 bg-card text-muted-foreground hover:text-foreground text-[11px] font-medium cursor-pointer"
              >
                记忆
              </button>
              <button
                type="button"
                onClick={() => deactivateSceneMutation.mutate({ personaId })}
                disabled={deactivateSceneMutation.isPending}
                className="inline-flex items-center px-2 py-1 rounded-lg text-destructive hover:bg-destructive/10 text-[11px] font-medium cursor-pointer"
              >
                退出
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Main View Content ────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 md:p-8">
        {/* ════ VIEW 1: GALLERY ════════════════════════════════════════ */}
        {currentView === "gallery" && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Filter, Sort & Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 warm-card warm-card-static p-2.5 sm:p-3 border-border/70">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter Segmented Control with Shared layoutId Pill */}
                <div
                  role="tablist"
                  aria-label="场景分类筛选"
                  className="inline-flex items-center gap-0.5 bg-muted/55 p-1 rounded-xl border border-border/60 overflow-x-auto no-scrollbar shrink-0"
                >
                  {(
                    [
                      { key: "all" as FilterTab, label: "全部", count: scenes.length },
                      { key: "custom" as FilterTab, label: "自建", count: scenes.filter(s => !s.isBuiltin).length },
                      { key: "builtin" as FilterTab, label: "预置", count: scenes.filter(s => Boolean(s.isBuiltin)).length },
                      ...(activeScene ? [{ key: "active" as FilterTab, label: "进行中", count: 1 }] : []),
                    ] as const
                  ).map(tab => {
                    const isSelected = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        onClick={() => setActiveTab(tab.key)}
                        className={`relative px-2.5 sm:px-3 py-1.5 text-xs rounded-lg transition-colors shrink-0 outline-none select-none cursor-pointer ${
                          isSelected
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground font-medium"
                        }`}
                      >
                        {isSelected && (
                          <motion.span
                            layoutId="scenes-filter-pill"
                            transition={SPRING_SNAPPY}
                            className="pointer-events-none absolute inset-0 rounded-lg border border-border/70 bg-card shadow-2xs dark:border-border/55 dark:bg-card/95"
                          />
                        )}
                        <span className="relative z-10 inline-flex items-center gap-1">
                          {tab.key === "active" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                          <span>{tab.label}</span>
                          {tab.key !== "active" && (
                            <span className="text-[10.5px] font-mono tabular-nums text-muted-foreground/85">
                              {tab.count}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Sort Selector */}
                <div className="flex items-center gap-1.5 bg-muted/35 px-2.5 py-1.5 rounded-xl border border-border/60 text-xs shrink-0">
                  <ArrowUpDown className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                  <span className="text-muted-foreground hidden sm:inline font-medium">排序</span>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="bg-transparent text-xs font-medium text-foreground focus:outline-hidden cursor-pointer pr-5"
                  >
                    <option value="recent">最近使用 / 活跃</option>
                    <option value="created_desc">添加时间 (最新)</option>
                    <option value="created_asc">添加时间 (最早)</option>
                    <option value="name">剧本名称 (A-Z)</option>
                    <option value="turns">剧情进度 (回合最多)</option>
                  </select>
                </div>
              </div>

              <div className="relative flex-1 md:max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索场景、身份、时代设定…"
                  className="h-9 pl-8.5 pr-8 text-xs bg-muted/25 border-border/65 rounded-xl"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="清空搜索"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Scene Cards Grid */}
            {scenesQuery.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="warm-card warm-card-static border-border/70 overflow-hidden p-0 h-72 flex flex-col"
                  >
                    <div className="h-24 bg-muted/50 animate-pulse" />
                    <div className="p-4 sm:p-5 flex-1 space-y-3">
                      <div className="h-4 w-2/5 rounded bg-muted/65 animate-pulse" />
                      <div className="h-3 w-full rounded bg-muted/40 animate-pulse" />
                      <div className="h-3 w-4/5 rounded bg-muted/40 animate-pulse" />
                      <div className="mt-auto pt-4 flex justify-between">
                        <div className="h-8 w-20 rounded-xl bg-muted/50 animate-pulse" />
                        <div className="h-8 w-24 rounded-xl bg-muted/65 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : displayScenes.length === 0 ? (
              <div className="py-14 sm:py-18 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-3xl border border-dashed border-border/70 bg-card/55">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-muted/55 border border-border/60 flex items-center justify-center text-2xl mb-3.5">
                  🎬
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-foreground">没有找到匹配的剧本情境</h3>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
                  {searchQuery
                    ? "尝试使用不同的关键词搜索，或新建一个你专属的情境剧本"
                    : "还没有创建过自定义场景，点击下方按钮开始创作吧"}
                </p>
                <Button
                  size="sm"
                  onClick={handleOpenCreate}
                  className="mt-4 gap-1.5 rounded-xl text-xs font-semibold shadow-2xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  新建第一个剧本
                </Button>
              </div>
            ) : (
              <motion.div
                key={`${activeTab}-${sortBy}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
              >
                {displayScenes.map(scene => {
                  const isActive = scene.id === persona?.activeSceneId;
                  const hasCustomPersonaRole = Boolean(scene.personaIdentityOverride?.trim());
                  const hasCustomUserRole = Boolean(scene.userIdentityOverride?.trim());
                  const hasPersonaRef = Boolean(scene.scenePersonaRefKey);
                  const hasUserRef = Boolean(scene.sceneUserRefKey);
                  const hasEnvRef = Boolean(scene.sceneEnvRefKey);
                  const coverKey = scene.sceneEnvRefKey || scene.scenePersonaRefKey || null;
                  const stat = memoryStats.get(scene.id);

                  return (
                    <article
                      key={scene.id}
                      className={`group relative rounded-3xl border transition-all duration-300 flex flex-col overflow-hidden bg-card hover:-translate-y-0.5 ${
                        isActive
                          ? "border-primary/65 shadow-md ring-1 ring-primary/20"
                          : "border-border/70 hover:border-border hover:shadow-md"
                      }`}
                    >
                      {/* Editorial Film-Still Cover Banner with Soft Vignette */}
                      <div className="relative h-24 sm:h-28 w-full overflow-hidden border-b border-border/50 bg-muted/35">
                        {coverKey ? (
                          <>
                            <img
                              src={`/uploads/${coverKey}`}
                              alt={scene.name}
                              loading="lazy"
                              className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-card/45 to-black/20" />
                          </>
                        ) : (
                          <>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--color-primary)_0%,transparent_68%)] opacity-[0.09] transition-transform duration-700 ease-out group-hover:scale-105" />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-muted/20 via-transparent to-card" />
                          </>
                        )}

                        {/* Top Floating Badges & Edit Trigger */}
                        <div className="absolute top-3 inset-x-3.5 flex items-center justify-between gap-2 z-10">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full backdrop-blur-md border font-medium ${
                                scene.isBuiltin
                                  ? "bg-card/85 border-border/70 text-muted-foreground"
                                  : "bg-card/90 border-primary/25 text-primary"
                              }`}
                            >
                              {scene.isBuiltin ? "预置剧目" : "自建剧本"}
                            </span>
                            {isActive && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full backdrop-blur-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                进行中
                              </span>
                            )}
                            {(hasPersonaRef || hasUserRef || hasEnvRef) && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full backdrop-blur-md bg-card/85 border border-border/70 text-foreground/80 font-medium inline-flex items-center gap-1">
                                <ImageIcon className="w-2.5 h-2.5 text-chart-3" />
                                剧照基线
                              </span>
                            )}
                          </div>

                          {!scene.isBuiltin && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(scene)}
                              className="h-7 w-7 rounded-xl backdrop-blur-md bg-card/85 border border-border/70 text-muted-foreground hover:text-foreground hover:border-border flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                              title="编辑剧本"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Floating Scene Emblem */}
                        <div className="absolute bottom-2.5 left-4 z-10 flex items-end gap-2.5 min-w-0 right-4">
                          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-card/95 backdrop-blur-md border border-border/75 flex items-center justify-center text-xl sm:text-2xl shrink-0 shadow-xs transition-transform duration-300 group-hover:scale-[1.03] select-none">
                            <span>{scene.icon || "🎭"}</span>
                          </div>
                          <div className="min-w-0 pb-0.5">
                            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                              {scene.name}
                            </h3>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 sm:p-5 pt-3.5 flex-1 flex flex-col">
                        {/* Description */}
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-3.5 flex-1">
                          {scene.description || "暂无剧本简述"}
                        </p>

                        {/* Dual Role Badges */}
                        {hasCustomPersonaRole || hasCustomUserRole ? (
                          <div className="mb-3.5 p-2.5 rounded-2xl bg-muted/25 border border-border/60 space-y-1.5">
                            {hasCustomPersonaRole && (
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <span className="font-semibold text-foreground/85 shrink-0">
                                  {personaName}：
                                </span>
                                <span className="text-muted-foreground truncate">
                                  {scene.personaIdentityOverride}
                                </span>
                              </div>
                            )}
                            {hasCustomUserRole && (
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <span className="font-semibold text-foreground/85 shrink-0">你：</span>
                                <span className="text-muted-foreground truncate">
                                  {scene.userIdentityOverride}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mb-3.5 text-[11px] text-muted-foreground/70 italic flex items-center gap-1.5">
                            <Compass className="w-3 h-3 shrink-0" />
                            <span>双方沿用日常身份设定</span>
                          </div>
                        )}

                        {/* Key progress stats (turns & last update) */}
                        {stat && (stat.turn > 0 || stat.updatedAt) && (
                          <div className="mb-3.5 grid grid-cols-2 gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleOpenSceneHistory(scene);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/6 hover:bg-primary/12 border border-primary/18 hover:border-primary/35 text-primary transition-all group/turn cursor-pointer text-left"
                              title="点击直接查看该剧本全部历史聊天记录与回合"
                            >
                              <Flame className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="text-foreground/80 font-medium">回合</span>
                              <span className="font-semibold font-mono tabular-nums text-primary ml-auto flex items-center gap-0.5">
                                {stat.turn}
                                <ChevronRight className="w-3 h-3 opacity-60 group-hover/turn:opacity-100 group-hover/turn:translate-x-0.5 transition-all" />
                              </span>
                            </button>
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-muted/25 border border-border/55 min-w-0">
                              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium font-mono tabular-nums text-foreground/85 truncate ml-auto text-[10.5px]">
                                {stat.updatedAt ? formatBeijingTime(new Date(stat.updatedAt)) : "—"}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Card Footer Actions */}
                        <div className="pt-3 border-t border-border/55 flex items-center justify-between gap-2 mt-auto">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenMemory(scene.id)}
                            className="h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 px-2.5 rounded-xl gap-1.5 font-medium cursor-pointer"
                          >
                            <Database className="w-3.5 h-3.5 text-chart-3" />
                            <span>记忆线索</span>
                          </Button>

                          {isActive ? (
                            <Button
                              size="sm"
                              onClick={() => navigate(`/chat/${personaId}`)}
                              className="h-8 text-xs font-semibold px-3.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                              title="点击一键进入当前运行的剧场对话"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>一键进入</span>
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => activateSceneMutation.mutate({ personaId, sceneId: scene.id })}
                              disabled={activateSceneMutation.isPending}
                              className="h-8 text-xs font-semibold px-3.5 rounded-xl border-border/75 hover:border-primary/40 hover:bg-primary/8 hover:text-primary transition-all gap-1.5 cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>进入剧场</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </motion.div>
            )}
          </div>
        )}

        {/* ════ VIEW 2: STUDIO (Create / Edit) ═════════════════════════ */}
        {currentView === "studio" && (
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in">
            <div className="flex items-center justify-between border-b border-border/70 pb-3 sm:pb-4 gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-primary/10 border border-primary/18 text-primary flex items-center justify-center text-lg sm:text-xl shrink-0">
                  <Film className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base md:text-lg font-semibold text-foreground truncate tracking-tight">
                    {studioForm.id ? "编辑剧本场景工坊" : "设计新剧本情境"}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                    设定时代背景、双角色身份、互动偏好与 /p 配图基准
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {studioForm.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenCreate}
                    className="text-xs rounded-xl border-border/70 gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">新建剧本</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentView("gallery")}
                  className="text-xs rounded-xl shrink-0 cursor-pointer"
                >
                  返回大厅
                </Button>
              </div>
            </div>

            {/* Inspiration Templates (New Only) */}
            {!studioForm.id && (
              <div className="warm-card warm-card-static border-border/70 p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2.5 sm:mb-3">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    灵感模板库（点击一键套用）
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                  {INSPIRATION_TEMPLATES.map(tmpl => (
                    <button
                      key={tmpl.title}
                      type="button"
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="p-3 rounded-2xl border border-border/70 bg-muted/15 hover:bg-card hover:border-primary/45 hover:shadow-2xs text-left transition-all group cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-base">{tmpl.icon}</span>
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
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
            <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-4">
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
            <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3.5 sm:space-y-4">
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
            <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3.5 sm:space-y-4">
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
                placeholder="例如：角色在档案馆核对地图，通过提问与线索推进情节。"
                rows={5}
                className="text-xs leading-relaxed rounded-xl font-mono"
              />
            </div>

            {/* 4. Scene Visual Assets & Baseline Card (Mobile Responsive) */}
            <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3.5 sm:space-y-4">
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
            <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3.5 sm:space-y-4">
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
                  placeholder="例如：角色在档案馆核对地图，通过提问与线索推进情节。"
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
                    onClick={() => setConfirmDeleteSceneOpen(true)}
                    disabled={deleteSceneMutation.isPending}
                    className="text-xs text-destructive hover:bg-destructive/10 gap-1 rounded-xl px-2.5 cursor-pointer"
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
                  className="text-xs rounded-xl px-3 cursor-pointer"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveStudio}
                  disabled={createSceneMutation.isPending || updateSceneMutation.isPending}
                  className="text-xs font-semibold px-4 sm:px-6 rounded-xl gap-1.5 shadow-2xs cursor-pointer"
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
          <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in">
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
                    <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-chart-3/10 border border-chart-3/20 text-chart-3 flex items-center justify-center text-xl sm:text-2xl shrink-0">
                      {currentDetailScene.icon || "🎭"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm sm:text-base md:text-lg font-semibold text-foreground truncate tracking-tight">
                          {currentDetailScene.name} · 记忆中枢
                        </h2>
                        {currentDetailScene.isBuiltin ? (
                          <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border/60 text-muted-foreground font-medium">
                            预置
                          </span>
                        ) : (
                          <span className="text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-medium">
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
                      className="text-xs rounded-xl border-border/70 gap-1 h-8 px-2.5 cursor-pointer"
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
                        className="text-xs rounded-xl border-border/70 gap-1 h-8 px-2.5 cursor-pointer"
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
                      className="text-xs rounded-xl h-8 px-2.5 cursor-pointer"
                    >
                      大厅
                    </Button>
                  </div>
                </div>

                {/* Dashboard Tiles (2 columns on mobile, 4 on desktop) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
                  <button
                    type="button"
                    onClick={() => setShowSceneChatManager(true)}
                    className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs text-left w-full hover:bg-muted/30 hover:border-primary/35 transition-all cursor-pointer"
                  >
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-medium">
                      <Flame className="w-3.5 h-3.5 text-primary" />
                      对话回合
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
                      {currentMemory?.storyState?.turn ?? 0}{" "}
                      <span className="text-[10px] sm:text-xs font-sans font-normal text-muted-foreground">回合</span>
                    </p>
                  </button>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-medium">
                      <Clock className="w-3.5 h-3.5 text-chart-3" />
                      剧情更新
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs font-semibold font-mono tabular-nums text-foreground truncate">
                      {currentMemory?.storyState?.updatedAt ?? "暂无活动"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-medium">
                      <Activity className="w-3.5 h-3.5 text-emerald-500" />
                      已确认事实
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
                      {memoryFacts.length}{" "}
                      <span className="text-[10px] sm:text-xs font-sans font-normal text-muted-foreground">条</span>
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs">
                    <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
                      未完成线索
                    </p>
                    <p className="mt-1 sm:mt-1.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
                      {memoryThreads.length}{" "}
                      <span className="text-[10px] sm:text-xs font-sans font-normal text-muted-foreground">条</span>
                    </p>
                  </div>
                </div>

                {/* Summary Card */}
                <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3.5 sm:space-y-4">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="font-semibold text-xs sm:text-sm text-foreground">滚动前情摘要</h3>
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
                      className="text-xs rounded-xl gap-1 text-primary border-primary/30 hover:bg-primary/10 h-7.5 px-2.5 cursor-pointer"
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
                    className="rounded-2xl text-xs leading-relaxed font-mono bg-muted/20 border-border/70"
                    placeholder="还没有生成摘要。在场景里聊几轮后点击上方「提炼最新摘要」，或在此处手动写一段前情。"
                  />

                  <div className="flex justify-end pt-0.5">
                    <Button
                      size="sm"
                      onClick={handleSaveSummary}
                      disabled={updateMemoryMutation.isPending}
                      className="text-xs font-semibold px-3.5 sm:px-4 rounded-xl gap-1 h-8 cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      保存摘要
                    </Button>
                  </div>
                </div>

                {/* Facts Card */}
                <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="font-semibold text-xs sm:text-sm text-foreground">剧本内已确认事实</h3>
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
                      className="text-xs rounded-xl gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 h-7.5 px-2.5 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      {extractFactsMutation.isPending ? "提炼事实中…" : "✨ 智能提炼事实"}
                    </Button>
                  </div>

                  {memoryFacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground bg-muted/25 border border-border/50 rounded-2xl p-3.5">
                      暂无剧本专属事实。在对话中达成重要约定或产生默契后，系统会自动提炼，您也可以在此手动输入。
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {memoryFacts.map(fact => (
                        <span
                          key={fact.id}
                          className={`inline-flex items-center gap-1 sm:gap-1.5 rounded-full border px-2.5 sm:px-3.5 py-1 text-xs text-foreground transition-all ${
                            fact.source === "llm"
                              ? "border-emerald-500/30 bg-emerald-500/6 hover:bg-emerald-500/15 text-emerald-950 dark:text-emerald-100"
                              : "border-border/70 bg-muted/35 hover:bg-muted/65"
                          }`}
                        >
                          {fact.source === "llm" && (
                            <span title="AI自动提炼" className="inline-flex items-center shrink-0">
                              <Sparkles className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                            </span>
                          )}
                          <span>{fact.fact}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFact(fact.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 p-0.5 cursor-pointer"
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
                      className="text-xs rounded-xl h-9 bg-muted/20 border-border/70"
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
                      className="text-xs rounded-xl border-border/70 shrink-0 gap-1 font-semibold h-9 px-3 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      添加
                    </Button>
                  </div>
                </div>

                {/* Open Threads Card (if any) */}
                {memoryThreads.length > 0 && (
                  <div className="warm-card warm-card-static border-border/70 p-4 sm:p-6 space-y-3 sm:space-y-4">
                    <div className="border-b border-border/50 pb-2">
                      <h3 className="font-semibold text-xs sm:text-sm text-foreground">未完成的剧情线索</h3>
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
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
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
                <div className="rounded-3xl border border-destructive/22 bg-destructive/[0.025] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-semibold text-destructive">清空剧情记忆重开</h4>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                      仅清空该场景内的剧情记忆缓存与前情摘要，不会删除角色原有的聊天消息。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setConfirmClearMemoryOpen(true)}
                    disabled={clearMemoryMutation.isPending}
                    className="text-xs rounded-xl gap-1.5 h-8 shrink-0 self-end sm:self-auto cursor-pointer"
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

      {/* Secondary Confirmation Modal: Delete Scene */}
      <MotionModal
        open={confirmDeleteSceneOpen}
        onClose={() => {
          if (!deleteSceneMutation.isPending) setConfirmDeleteSceneOpen(false);
        }}
        ariaLabel="删除剧本确认"
        className="max-w-md p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">确定删除这个剧本场景？</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                即将永久移除剧本「<span className="font-medium text-foreground">{studioForm.name || "未命名场景"}</span>」及其专属配图设定。此操作不可撤销。
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleteSceneMutation.isPending}
              onClick={() => setConfirmDeleteSceneOpen(false)}
              className="rounded-xl text-xs cursor-pointer"
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteSceneMutation.isPending || !studioForm.id}
              onClick={() => {
                if (studioForm.id) {
                  deleteSceneMutation.mutate({ id: studioForm.id });
                }
              }}
              className="rounded-xl text-xs font-semibold gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteSceneMutation.isPending ? "删除中…" : "确认删除"}
            </Button>
          </div>
        </div>
      </MotionModal>

      {/* Secondary Confirmation Modal: Clear Scene Memory */}
      <MotionModal
        open={confirmClearMemoryOpen}
        onClose={() => {
          if (!clearMemoryMutation.isPending) setConfirmClearMemoryOpen(false);
        }}
        ariaLabel="清空剧情记忆确认"
        className="max-w-md p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">清空剧情记忆并重新开始？</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                将清空「<span className="font-medium text-foreground">{currentDetailScene?.name || "当前场景"}</span>」内的滚动前情摘要、已确认事实与未完成线索，下次进入时从头开场。历史聊天记录不会被删除。
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={clearMemoryMutation.isPending}
              onClick={() => setConfirmClearMemoryOpen(false)}
              className="rounded-xl text-xs cursor-pointer"
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={clearMemoryMutation.isPending || !currentDetailScene?.id}
              onClick={() => {
                if (currentDetailScene?.id) {
                  clearMemoryMutation.mutate({
                    sceneId: currentDetailScene.id,
                    personaId,
                  });
                }
              }}
              className="rounded-xl text-xs font-semibold gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {clearMemoryMutation.isPending ? "清空中…" : "确认清空重开"}
            </Button>
          </div>
        </div>
      </MotionModal>

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
