import { motion, useReducedMotion } from "framer-motion";
import { CollapseSection, SPRING_SNAPPY } from "@/components/ui/motion";
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LivingWorldProbePanel from "@/components/LivingWorldProbePanel";
import type { ProactiveSettings } from "../../../server/proactive/types";
import {
  ArrowLeft, Save, Eye, X, Plus, Sparkles, Bell, Clock, Upload
} from "lucide-react";
import { toast } from "sonner";

const ATTACHMENT_STYLES = ["安全型", "焦虑型", "回避型", "混乱型"];
const LOVE_LANGUAGES = ["精心时刻", "肯定的言辞", "服务的行动", "身体接触", "接收礼物"];
const DEFAULT_PROACTIVE_TIME = "09:00";
const PROFILE_SCHEMA_VERSION = 1;

function proactiveSettingsDraft(policy: ProactiveSettings & { revision: number }): ProactiveSettings {
  return {
    enabled: policy.enabled, times: [...policy.times], stylePrompt: policy.stylePrompt,
    timeZone: policy.revision === 0 && policy.timeZone === "UTC"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : policy.timeZone,
    quietHours: policy.quietHours, maxPerLocalDay: policy.maxPerLocalDay,
    minIntervalMinutes: policy.minIntervalMinutes, delivery: policy.delivery, ambientEnabled: policy.ambientEnabled,
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function textValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function arrayValue(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map(item => typeof item === "string" ? item.trim() : "")
      .filter(Boolean);
    if (items.length > 0) return Array.from(new Set(items));
  }
  return [];
}

function multilineToList(value: string): string[] {
  return value
    .split(/\r?\n|；|;/)
    .map(item => item.trim())
    .filter(Boolean);
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(""); }
  };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/12 rounded-full font-medium transition-all">
            {t}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))}
              className="hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="输入后回车添加" className="h-10 bg-muted/30 border-border rounded-xl text-sm flex-1 focus-visible:ring-1 focus-visible:ring-primary/45 transition-all" />
        <Button size="sm" variant="ghost" onClick={add} className="h-10 px-3 rounded-xl border border-border bg-muted/10 hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-all">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function PersonaEdit() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const { data: persona, refetch } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: promptData } = trpc.persona.getSystemPrompt.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const providers = trpc.llmConfig.listProviders.useQuery();
  const utils = trpc.useUtils();
  const proactiveQuery = trpc.proactive.getSettings.useQuery(
    { personaId }, { enabled: isAuthenticated && personaId > 0 && persona?.analysisStatus === "ready" },
  );
  const saveProactiveMutation = trpc.proactive.saveSettings.useMutation({ retry: false });

  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => { toast.success("基本信息已保存"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateDataMutation = trpc.persona.updatePersonaData.useMutation({
    onSuccess: () => { toast.success("人设数据已保存"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherFrom, setTogetherFrom] = useState("");
  const [togetherTo, setTogetherTo] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [coreIdentity, setCoreIdentity] = useState("");
  const [hardFactsText, setHardFactsText] = useState("");
  const [healthState, setHealthState] = useState("");
  const [workAndLocation, setWorkAndLocation] = useState("");
  const [userContext, setUserContext] = useState("");
  const [relationshipStage, setRelationshipStage] = useState("");
  const [personality, setPersonality] = useState("");
  const [personalityValues, setPersonalityValues] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [catchphrases, setCatchphrases] = useState<string[]>([]);
  const [nickname, setNickname] = useState("");
  const [memories, setMemories] = useState("");
  const [longBackground, setLongBackground] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState("");
  const [attachmentStyle, setAttachmentStyle] = useState("");
  const [loveLanguage, setLoveLanguage] = useState("");
  const [conflictStyle, setConflictStyle] = useState("");
  const [touchingMoments, setTouchingMoments] = useState("");
  const [feelingsForUser, setFeelingsForUser] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [replyRules, setReplyRules] = useState("");
  const [dailyScenes, setDailyScenes] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [starterQuestions, setStarterQuestions] = useState<string[]>([]);
  const [proactiveDraft, setProactiveDraft] = useState<{ personaId: number; revision: number; settings: ProactiveSettings } | null>(null);
  const [proactiveTimeInput, setProactiveTimeInput] = useState(DEFAULT_PROACTIVE_TIME);
  const [qqConsentRevision, setQqConsentRevision] = useState<number | null>(null);
  const [proactiveFeedback, setProactiveFeedback] = useState("");
  const [proactiveConflict, setProactiveConflict] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [activeEditTab, setActiveEditTab] = useState("core");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!persona) return;
    setName(persona.name || "");
    setRelationshipDesc(persona.relationshipDesc || "");
    setTogetherFrom(persona.togetherFrom || "");
    setTogetherTo(persona.togetherTo || "");
    setLlmProvider((persona as any).llmProvider || "");
    const p = (persona.personaData as any) || {};
    const profile = asRecord(p.profileSections);
    const core = asRecord(profile.core);
    const profilePersonality = asRecord(profile.personality);
    const relationship = asRecord(profile.relationship);
    const speaking = asRecord(profile.speaking);
    const source = asRecord(profile.source);
    const behavior = asRecord(profile.behavior);

    const hardFacts = arrayValue(core.hardFacts, p.hardFacts, p.facts, p.keyFacts);
    setCoreIdentity(textValue(core.identity, p.coreIdentity, p.summary));
    setHardFactsText(hardFacts.join("\n"));
    setHealthState(textValue(core.healthState, p.healthState, p.bodyState));
    setWorkAndLocation(textValue(core.workAndLocation, p.workAndLocation, p.workBackground, p.locationContext));
    setUserContext(textValue(core.userContext, p.userContext, p.userBackground));
    setRelationshipStage(textValue(core.relationshipStage, p.relationshipStage));

    setPersonality(textValue(profilePersonality.traits, p.personality));
    setPersonalityValues(textValue(profilePersonality.values, p.values, p.personalityValues));
    setAttachmentStyle(textValue(profilePersonality.attachmentStyle, p.attachmentStyle));
    setLoveLanguage(textValue(profilePersonality.loveLanguage, p.loveLanguage));
    setConflictStyle(textValue(profilePersonality.conflictStyle, p.conflictStyle));

    setNickname(textValue(relationship.nickname, p.nickname));
    setMemories(textValue(relationship.memories, p.memories));
    setTouchingMoments(textValue(relationship.touchingMoments, p.touchingMoments));
    setFeelingsForUser(textValue(relationship.feelingsForUser, p.feelingsForUser));
    setBoundaries(textValue(relationship.boundaries, p.boundaries, p.relationshipBoundaries));

    setSpeakingStyle(textValue(speaking.style, p.speakingStyle));
    setCatchphrases(arrayValue(speaking.catchphrases, p.catchphrases));
    setReplyRules(textValue(speaking.replyRules, p.replyRules, p.chatStyleRules));

    setLongBackground(textValue(source.longBackground, p.longBackground));
    setSourcePolicy(textValue(source.sourcePolicy, p.sourcePolicy));

    setDailyScenes(textValue(behavior.dailyScenes, p.dailyScenes, p.dailyLifeScenes));
    setCustomInstructions(textValue(behavior.customInstructions, p.customInstructions));
    setStarterQuestions(arrayValue(behavior.starterQuestions, p.starterQuestions));
  }, [persona]);

  useEffect(() => {
    setProactiveDraft(null);
    setProactiveTimeInput(DEFAULT_PROACTIVE_TIME);
    setQqConsentRevision(null);
    setProactiveFeedback("");
    setProactiveConflict(false);
  }, [personaId]);

  const saveBasic = () => updateMutation.mutate({
    id: personaId, name, relationshipDesc,
    togetherFrom: togetherFrom || undefined, togetherTo: togetherTo || undefined,
    llmProvider: llmProvider || null,
  });

  const policy = proactiveQuery.data;
  const activeProactiveDraft = proactiveDraft?.personaId === personaId ? proactiveDraft : null;
  const proactive = activeProactiveDraft?.settings ?? (policy ? proactiveSettingsDraft(policy) : undefined);
  const qqProactiveConsent = !!policy && qqConsentRevision === policy.revision;
  const proactiveOutOfDate = proactiveConflict || (!!activeProactiveDraft && !!policy && activeProactiveDraft.revision !== policy.revision);
  const proactiveDisabled = !policy || proactiveQuery.isError || saveProactiveMutation.isPending || proactiveOutOfDate;

  const editProactive = (fields: Partial<ProactiveSettings>) => {
    if (proactiveDisabled || !policy || !proactive) return;
    setProactiveDraft({ personaId, revision: activeProactiveDraft?.revision ?? policy.revision, settings: { ...proactive, ...fields } });
    setProactiveFeedback("");
    if (fields.delivery !== undefined) setQqConsentRevision(null);
  };

  const addProactiveTime = () => {
    if (!proactive || proactive.times.length >= 8 || !/^\d{2}:\d{2}$/.test(proactiveTimeInput) || proactive.times.includes(proactiveTimeInput)) return;
    editProactive({ times: [...proactive.times, proactiveTimeInput].sort() });
  };

  async function saveProactive() {
    if (proactiveDisabled || !proactive || !policy || (proactive.delivery === "qq" && !qqProactiveConsent)) return;
    if (!Number.isInteger(proactive.maxPerLocalDay) || proactive.maxPerLocalDay < 1 || proactive.maxPerLocalDay > 10 ||
      !Number.isInteger(proactive.minIntervalMinutes) || proactive.minIntervalMinutes < 5 || proactive.minIntervalMinutes > 1440) {
      setProactiveFeedback("每日上限须为 1–10 次，最短间隔须为 5–1440 分钟。");
      return;
    }
    setProactiveFeedback("");
    try {
      const saved = await saveProactiveMutation.mutateAsync({
        personaId, expectedRevision: activeProactiveDraft?.revision ?? policy.revision, settings: proactive,
      });
      utils.proactive.getSettings.setData({ personaId }, saved);
      setProactiveDraft(null);
      setQqConsentRevision(null);
      setProactiveFeedback("主动消息设置已保存。");
    } catch (error) {
      if ((error as { data?: { code?: string } })?.data?.code === "CONFLICT") {
        setProactiveConflict(true);
        setQqConsentRevision(null);
        setProactiveFeedback("设置版本已变化，当前草稿已保留。请载入当前设置后重新编辑。");
        void proactiveQuery.refetch();
      } else {
        setProactiveFeedback(error instanceof Error ? error.message : "未能保存主动消息设置。");
      }
    }
  }

  const savePersonaData = () => {
    const {
      proactiveMessages: _legacyProactive, proactiveStyle: _legacyStyle, personaRuntime: _legacyRuntime,
      runtimeLifeState: _runtimeLifeState, runtimeDiagnostics: _runtimeDiagnostics, ...current
    } = asRecord(persona?.personaData);
    const currentProfile = asRecord(current.profileSections);
    const { runtimeLifeState, runtimeDiagnostics, proactiveMessages, ...currentRuntimeProfile } = asRecord(currentProfile.runtime);
    const hardFacts = multilineToList(hardFactsText);
    const profileSections = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      ...(currentProfile.life === undefined ? {} : { life: currentProfile.life }),
      core: {
        identity: coreIdentity,
        hardFacts,
        healthState,
        workAndLocation,
        userContext,
        relationshipStage,
      },
      personality: {
        traits: personality,
        values: personalityValues,
        attachmentStyle,
        loveLanguage,
        conflictStyle,
      },
      relationship: {
        nickname,
        memories,
        touchingMoments,
        feelingsForUser,
        boundaries,
      },
      speaking: {
        style: speakingStyle,
        catchphrases,
        replyRules,
      },
      source: {
        longBackground,
        sourcePolicy,
      },
      behavior: {
        dailyScenes,
        customInstructions,
        starterQuestions,
      },
      runtime: {
        ...currentRuntimeProfile,
      },
    };

    updateDataMutation.mutate({
      id: personaId,
      personaData: {
        ...current,
        coreIdentity,
        hardFacts,
        healthState,
        workAndLocation,
        userContext,
        relationshipStage,
        personality,
        personalityValues,
        speakingStyle,
        catchphrases,
        nickname,
        memories,
        longBackground,
        sourcePolicy,
        attachmentStyle,
        loveLanguage,
        conflictStyle,
        touchingMoments,
        feelingsForUser,
        boundaries,
        replyRules,
        dailyScenes,
        customInstructions,
        starterQuestions,
        profileSections,
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      },
    });
  };

  if (!persona) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="app-nav-title">{persona.name}</p>
              <p className="app-nav-subtitle">编辑分身</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 sm:py-8 max-w-2xl mx-auto space-y-6 animate-fade-in-up">
        {/* Basic Info */}
        <section className="warm-card warm-card-static p-5 sm:p-6 space-y-5 border-border/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              <span className="section-chip h-8 w-8 rounded-xl" aria-hidden="true">✦</span> 基本信息
            </h2>
            <Button size="sm" variant="outline" className="rounded-xl border-border hover:bg-muted/40 text-xs px-3 h-8 shadow-xs"
              onClick={() => navigate(`/upload/${personaId}`)}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />资料文件
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground/85">名字</Label>
              <Input value={name} onChange={e => setName(e.target.value)}
                className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground/85">关系描述</Label>
              <Input value={relationshipDesc} onChange={e => setRelationshipDesc(e.target.value)}
                className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground/85">在一起日期</Label>
              <Input type="date" value={togetherFrom} onChange={e => setTogetherFrom(e.target.value)}
                className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground/85">分开日期（可选）</Label>
              <Input type="date" value={togetherTo} onChange={e => setTogetherTo(e.target.value)}
                className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-xs" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground/85">指定 LLM 提供商（留空使用全局默认）</Label>
            <select value={llmProvider} onChange={e => setLlmProvider(e.target.value)}
              className="w-full h-10 bg-muted/30 border border-border rounded-xl text-sm px-3 text-foreground outline-none focus:ring-1 focus:ring-primary/45 transition-all cursor-pointer">
              <option value="" className="bg-card">使用全局默认</option>
              {providers.data?.map(p => <option key={p.name} value={p.name} className="bg-card">{p.name}</option>)}
            </select>
          </div>

          <Button size="sm" onClick={saveBasic} disabled={updateMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 px-4 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
            <Save className="w-3.5 h-3.5 mr-1.5" />{updateMutation.isPending ? "保存中..." : "保存基本信息"}
          </Button>
        </section>

        {/* Persona Data Editor */}
        {persona.analysisStatus === "ready" && (
          <section className="warm-card warm-card-static p-5 sm:p-6 space-y-5 border-border/70">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <span className="section-chip h-8 w-8 rounded-xl"><Sparkles className="w-4 h-4" /></span>人设资料库
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setShowPrompt(!showPrompt)}
                className="text-xs text-muted-foreground rounded-xl hover:bg-muted/40 px-3 h-8">
                <Eye className="w-3.5 h-3.5 mr-1.5" />{showPrompt ? "隐藏" : "预览"} System Prompt
              </Button>
            </div>

            {promptData && (
              <CollapseSection open={showPrompt}>
                <pre className="panel-scrollbar text-xs text-muted-foreground/90 bg-muted/30 p-4 rounded-2xl overflow-auto max-h-64 whitespace-pre-wrap border border-border/70 font-mono leading-relaxed">
                  {promptData.prompt}
                </pre>
              </CollapseSection>
            )}

            <Tabs value={activeEditTab} onValueChange={setActiveEditTab} className="space-y-5">
              <TabsList aria-label="人设编辑分区" className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/55 p-1 border border-border/60 rounded-2xl sm:grid-cols-6">
                {[
                  ["core", "核心"], ["personality", "性格"], ["relationship", "关系"],
                  ["source", "原著"], ["speaking", "说话"], ["behavior", "行为"],
                ].map(([key, label]) => (
                  <TabsTrigger key={key} value={key} className="relative rounded-xl py-2 text-xs font-medium data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                    {activeEditTab === key && <motion.span aria-hidden="true" layoutId={reduceMotion ? undefined : "persona-edit-tab-pill"}
                      transition={SPRING_SNAPPY} className="pointer-events-none absolute inset-0 rounded-xl border border-border/70 bg-card shadow-xs" />}
                    <span className="relative z-10">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="core" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">身份定位</Label>
                  <Textarea value={coreIdentity} onChange={e => setCoreIdentity(e.target.value)}
                    rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">硬性事实（一行一条）</Label>
                  <Textarea value={hardFactsText} onChange={e => setHardFactsText(e.target.value)}
                    rows={4} placeholder="例如：旅人负责记录路线；队伍将在傍晚抵达驿站。"
                    className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">身体与健康状态</Label>
                    <Textarea value={healthState} onChange={e => setHealthState(e.target.value)}
                      rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">工作与所在地背景</Label>
                    <Textarea value={workAndLocation} onChange={e => setWorkAndLocation(e.target.value)}
                      rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">用户侧背景与知悉事实</Label>
                    <Textarea value={userContext} onChange={e => setUserContext(e.target.value)}
                      rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">当前关系阶段进展</Label>
                    <Textarea value={relationshipStage} onChange={e => setRelationshipStage(e.target.value)}
                      rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="personality" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">性格特质</Label>
                  <Textarea value={personality} onChange={e => setPersonality(e.target.value)}
                    rows={4} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">价值观 / 底层精神动机</Label>
                  <Textarea value={personalityValues} onChange={e => setPersonalityValues(e.target.value)}
                    rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">依恋类型</Label>
                    <select value={attachmentStyle} onChange={e => setAttachmentStyle(e.target.value)}
                      className="w-full h-10 bg-muted/30 border border-border rounded-xl text-sm px-3 text-foreground outline-none focus:ring-1 focus:ring-primary/45 transition-all cursor-pointer">
                      <option value="" className="bg-card">未设置</option>
                      {ATTACHMENT_STYLES.map(s => <option key={s} value={s} className="bg-card">{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">爱的语言</Label>
                    <select value={loveLanguage} onChange={e => setLoveLanguage(e.target.value)}
                      className="w-full h-10 bg-muted/30 border border-border rounded-xl text-sm px-3 text-foreground outline-none focus:ring-1 focus:ring-primary/45 transition-all cursor-pointer">
                      <option value="" className="bg-card">未设置</option>
                      {LOVE_LANGUAGES.map(l => <option key={l} value={l} className="bg-card">{l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">冲突处理风格</Label>
                    <Input value={conflictStyle} onChange={e => setConflictStyle(e.target.value)}
                      className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-sm" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="relationship" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">专属亲昵称呼</Label>
                    <Input value={nickname} onChange={e => setNickname(e.target.value)}
                      placeholder="例如：领航员" className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-sm" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">对用户的情感态度</Label>
                    <Input value={feelingsForUser} onChange={e => setFeelingsForUser(e.target.value)}
                      className="h-10 bg-muted/30 border-border rounded-xl focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-sm" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">重要共同记忆</Label>
                  <Textarea value={memories} onChange={e => setMemories(e.target.value)}
                    rows={4} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">最触动心弦的瞬间</Label>
                  <Textarea value={touchingMoments} onChange={e => setTouchingMoments(e.target.value)}
                    rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">关系边界 / 情感底线</Label>
                  <Textarea value={boundaries} onChange={e => setBoundaries(e.target.value)}
                    rows={3} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
              </TabsContent>

              <TabsContent value="source" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">原著/长篇人物设定资料（进入智能查重库）</Label>
                  <Textarea value={longBackground} onChange={e => setLongBackground(e.target.value)}
                    rows={12}
                    placeholder="在此贴入和该分身高度相关的原著小说背景、经历、核心设定、长篇故事背景。对话引擎会在此范围内开展精准记忆召回。"
                    className="bg-muted/30 border-border rounded-xl text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-primary/45 transition-all font-sans" />
                  <p className="text-[10px] text-muted-foreground/85 pl-1">
                    当前已载入 {longBackground.length.toLocaleString("zh-CN")} 字。建议总长度控制在 32,000 字以内以保证召回时效。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">原著素材使用与遵循准则</Label>
                  <Textarea value={sourcePolicy} onChange={e => setSourcePolicy(e.target.value)}
                    rows={3}
                    placeholder="例如：对小说原著情节的提问要优先调用该记忆库；不确定的情节承认不确定，不要编造原著后续。"
                    className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
              </TabsContent>

              <TabsContent value="speaking" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">话语风格 / 语气特质</Label>
                  <Textarea value={speakingStyle} onChange={e => setSpeakingStyle(e.target.value)}
                    rows={4} className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">高频口头禅</Label>
                  <TagInput tags={catchphrases} onChange={setCatchphrases} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">对话与应答规则（最高细节指令）</Label>
                  <Textarea value={replyRules} onChange={e => setReplyRules(e.target.value)}
                    rows={3}
                    placeholder="例如：绝对不以括号描述内心活动或环境动作；单句短消息切忌冗长说教回复；异地语境一以贯之。"
                    className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
              </TabsContent>

              <TabsContent value="behavior" className="space-y-4 focus-visible:outline-none focus:outline-none">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">日常作息与生活轨迹场景</Label>
                  <Textarea value={dailyScenes} onChange={e => setDailyScenes(e.target.value)}
                    rows={3}
                    placeholder="例如：清晨核对地图，白天记录沿途见闻，傍晚在驿站整理旅行笔记。"
                    className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">专属对话开场白 / 破冰话题</Label>
                  <TagInput tags={starterQuestions} onChange={setStarterQuestions} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground/85">绝对特制指令（追加至系统核心 Prompt 尾部）</Label>
                  <Textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                    rows={3} placeholder="例如：以虚构旅人的视角围绕当前场景推进故事，使用已确认的线索，不替用户作决定。"
                    className="bg-muted/30 border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                </div>

                <div className="border border-border/80 rounded-xl p-4.5 space-y-4 bg-muted/15">
                  <div className="flex items-center gap-3">
                    <Bell className="w-4 h-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">主动问候与心路分享</h3>
                      <p className="text-[11px] text-muted-foreground leading-normal">默认关闭，启用后按这里保存的时区与频率安排问候。默认在网页查看。</p>
                    </div>
                    <Switch aria-label="启用主动问候" checked={proactive?.enabled ?? false} disabled={proactiveDisabled}
                      onCheckedChange={enabled => editProactive({ enabled })} className="data-[state=checked]:bg-primary" />
                  </div>

                  {proactiveQuery.isError ? (
                    <p role="alert" className="text-xs text-destructive">主动设置读取失败。<button type="button" className="ml-2 underline" onClick={() => void proactiveQuery.refetch()}>刷新</button></p>
                  ) : !proactive ? <p className="text-xs text-muted-foreground">正在读取主动设置…</p> : <>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {proactive.times.map(time => (
                      <span key={time} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/12 rounded-full font-medium transition-all">
                        <Clock className="w-3.5 h-3.5" />{time}
                        <button type="button" aria-label={`移除时间 ${time}`} disabled={proactiveDisabled}
                          onClick={() => editProactive({ times: proactive.times.filter(t => t !== time) })}
                          className="hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                    {proactive.times.length === 0 && (
                      <span className="text-xs text-muted-foreground italic pl-1">暂无排定问候时间点</span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input aria-label="待添加的问候时间" type="time" value={proactiveTimeInput} disabled={proactiveDisabled} onChange={e => setProactiveTimeInput(e.target.value)}
                      className="h-10 bg-card border-border rounded-xl max-w-[140px] focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-xs" />
                    <Button size="sm" variant="outline" disabled={proactiveDisabled || proactive.times.length >= 8} onClick={addProactiveTime}
                      className="rounded-xl h-10 px-3 border-border hover:bg-muted/40 transition-all text-xs font-semibold">
                      <Plus className="w-4 h-4 mr-1" />添加时间
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="proactive-style" className="text-xs font-semibold text-foreground/85">主动问候心路风格补充</Label>
                    <Textarea id="proactive-style" value={proactive.stylePrompt} disabled={proactiveDisabled} maxLength={2000}
                      onChange={e => editProactive({ stylePrompt: e.target.value })}
                      rows={2}
                      placeholder="例如：清晨问候注重关怀提醒；深夜则更倾向于平实地倾诉心里的挂念与过去的小说细节回忆。"
                      className="bg-card border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>问候时区</span>
                      <Input value={proactive.timeZone} disabled={proactiveDisabled} maxLength={100}
                        onChange={e => editProactive({ timeZone: e.target.value })} className="bg-card rounded-xl" />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>免打扰（HH:mm-HH:mm）</span>
                      <Input value={proactive.quietHours} disabled={proactiveDisabled} maxLength={11} placeholder="23:00-08:00"
                        onChange={e => editProactive({ quietHours: e.target.value })} className="bg-card rounded-xl" />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>每日发送上限</span>
                      <Input type="number" min={1} max={10} value={Number.isNaN(proactive.maxPerLocalDay) ? "" : proactive.maxPerLocalDay} disabled={proactiveDisabled}
                        onChange={e => editProactive({ maxPerLocalDay: e.target.valueAsNumber })} className="bg-card rounded-xl" />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>最短间隔（分钟）</span>
                      <Input type="number" min={5} max={1440} value={Number.isNaN(proactive.minIntervalMinutes) ? "" : proactive.minIntervalMinutes} disabled={proactiveDisabled}
                        onChange={e => editProactive({ minIntervalMinutes: e.target.valueAsNumber })} className="bg-card rounded-xl" />
                    </label>
                  </div>
                  {policy?.revision === 0 && <p className="text-[11px] text-muted-foreground">初填时区来自浏览器，保存主动设置后才生效。</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>交付方式</span>
                      <select value={proactive.delivery} disabled={proactiveDisabled}
                        onChange={e => editProactive({ delivery: e.target.value === "qq" ? "qq" : "web" })}
                        className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground">
                        <option value="web">网页</option><option value="qq">QQ 私聊</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Switch checked={proactive.ambientEnabled} disabled={proactiveDisabled} onCheckedChange={ambientEnabled => editProactive({ ambientEnabled })} />
                      允许大厅存在感触发排程
                    </label>
                  </div>
                  {proactive.delivery === "qq" && (
                    <label className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={qqProactiveConsent} disabled={proactiveDisabled}
                        onChange={e => setQqConsentRevision(e.target.checked ? policy?.revision ?? null : null)} />
                      我同意把该角色的主动消息发送到同账号已验证的 QQ 私聊绑定；处于频道模式时暂停。
                    </label>
                  )}
                  </>}
                  {proactiveFeedback && <p role="status" className="text-xs text-muted-foreground">{proactiveFeedback}</p>}
                  {proactiveOutOfDate && (
                    <Button size="sm" variant="outline" disabled={proactiveQuery.isFetching || proactiveQuery.isError}
                      onClick={() => { setProactiveDraft(null); setProactiveConflict(false); setQqConsentRevision(null); setProactiveFeedback(""); }}>
                      载入当前设置（放弃草稿）
                    </Button>
                  )}
                  <Button size="sm" className="rounded-xl" disabled={proactiveDisabled || !proactive || (proactive.delivery === "qq" && !qqProactiveConsent)}
                    onClick={() => void saveProactive()}>
                    <Save className="w-3.5 h-3.5 mr-1.5" />{saveProactiveMutation.isPending ? "保存中…" : "保存主动消息设置"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <Button size="sm" onClick={savePersonaData} disabled={updateDataMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 px-5 shadow-sm hover:shadow-md transition-all active:scale-[0.98]">
              <Save className="w-3.5 h-3.5 mr-1.5" />{updateDataMutation.isPending ? "保存中..." : "保存人设资料"}
            </Button>
          </section>
        )}

        {persona.analysisStatus === "ready" && (
          <LivingWorldProbePanel personaId={personaId} />
        )}

        {persona.analysisStatus !== "ready" && (
          <div className="warm-card p-6 text-center text-muted-foreground text-sm animate-pulse-soft">
            🧬 人设资料库正在解析蒸馏中。分析完成后即可自由编辑细化。
            <Button size="sm" variant="link" className="text-primary hover:text-primary/80 font-semibold p-0 ml-1.5 transition-colors"
              onClick={() => navigate(`/upload/${personaId}`)}>前往上传素材</Button>
          </div>
        )}
      </main>
    </div>
  );
}
