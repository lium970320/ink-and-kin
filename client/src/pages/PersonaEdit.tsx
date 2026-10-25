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
import {
  ArrowLeft, Save, Eye, X, Plus, Sparkles, Bell, Clock, Upload
} from "lucide-react";
import { toast } from "sonner";

const ATTACHMENT_STYLES = ["安全型", "焦虑型", "回避型", "混乱型"];
const LOVE_LANGUAGES = ["精心时刻", "肯定的言辞", "服务的行动", "身体接触", "接收礼物"];
const DEFAULT_PROACTIVE_TIME = "09:00";
const PROFILE_SCHEMA_VERSION = 1;

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
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [proactiveTimes, setProactiveTimes] = useState<string[]>([]);
  const [proactiveTimeInput, setProactiveTimeInput] = useState(DEFAULT_PROACTIVE_TIME);
  const [proactiveStylePrompt, setProactiveStylePrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

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
    setProactiveEnabled(Boolean(p.proactiveMessages?.enabled));
    setProactiveTimes(Array.isArray(p.proactiveMessages?.times) ? p.proactiveMessages.times : []);
    setProactiveStylePrompt(textValue(behavior.proactiveStyle, p.proactiveStyle, p.proactiveMessages?.stylePrompt));
  }, [persona]);

  const saveBasic = () => updateMutation.mutate({
    id: personaId, name, relationshipDesc,
    togetherFrom: togetherFrom || undefined, togetherTo: togetherTo || undefined,
    llmProvider: llmProvider || null,
  });

  const addProactiveTime = () => {
    if (!/^\d{2}:\d{2}$/.test(proactiveTimeInput)) return;
    if (!proactiveTimes.includes(proactiveTimeInput)) {
      setProactiveTimes([...proactiveTimes, proactiveTimeInput].sort());
    }
  };

  const savePersonaData = () => {
    const current = ((persona?.personaData as any) || {});
    const currentProactive = current.proactiveMessages || {};
    const currentProfile = asRecord(current.profileSections);
    const { randomizedSchedule, lastSent, ambientPresence, ...currentProactiveConfig } = currentProactive;
    const { runtimeLifeState, runtimeDiagnostics, ...currentRuntimeProfile } = asRecord(currentProfile.runtime);
    const hardFacts = multilineToList(hardFactsText);
    const proactiveMessages = {
      ...currentProactiveConfig,
      enabled: proactiveEnabled,
      times: proactiveTimes,
      stylePrompt: proactiveStylePrompt,
    };
    const profileSections = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
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
        proactiveStyle: proactiveStylePrompt,
        customInstructions,
        starterQuestions,
      },
      runtime: {
        ...currentRuntimeProfile,
        proactiveMessages,
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
        proactiveStyle: proactiveStylePrompt,
        proactiveMessages,
        profileSections,
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      },
    });
  };

  if (!persona) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
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

      <main className="container py-8 max-w-2xl mx-auto space-y-6 animate-fade-in-up">
        {/* Basic Info */}
        <section className="warm-card p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              <span>🌸</span> 基本信息
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
          <section className="warm-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />人设资料库
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setShowPrompt(!showPrompt)}
                className="text-xs text-muted-foreground rounded-xl hover:bg-muted/40 px-3 h-8">
                <Eye className="w-3.5 h-3.5 mr-1.5" />{showPrompt ? "隐藏" : "预览"} System Prompt
              </Button>
            </div>

            {showPrompt && promptData && (
              <pre className="text-xs text-muted-foreground/90 bg-muted/30 p-4 rounded-xl overflow-auto max-h-64 whitespace-pre-wrap border border-border/80 font-mono leading-relaxed">
                {promptData.prompt}
              </pre>
            )}

            <Tabs defaultValue="core" className="space-y-5">
              <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/60 p-1 border border-border/50 rounded-xl shadow-inner mb-2 sm:grid-cols-6">
                <TabsTrigger value="core" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">核心</TabsTrigger>
                <TabsTrigger value="personality" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">性格</TabsTrigger>
                <TabsTrigger value="relationship" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">关系</TabsTrigger>
                <TabsTrigger value="source" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">原著</TabsTrigger>
                <TabsTrigger value="speaking" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">说话</TabsTrigger>
                <TabsTrigger value="behavior" className="text-xs py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all cursor-pointer font-medium">行为</TabsTrigger>
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
                      <p className="text-[11px] text-muted-foreground leading-normal">分身服务保持常驻且 QQ 通道畅通时，会在设定时间发起主动关怀问候。</p>
                    </div>
                    <Switch checked={proactiveEnabled} onCheckedChange={setProactiveEnabled} className="data-[state=checked]:bg-primary" />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {proactiveTimes.map(time => (
                      <span key={time} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/12 rounded-full font-medium transition-all">
                        <Clock className="w-3.5 h-3.5" />{time}
                        <button onClick={() => setProactiveTimes(proactiveTimes.filter(t => t !== time))}
                          className="hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                    {proactiveTimes.length === 0 && (
                      <span className="text-xs text-muted-foreground italic pl-1">暂无排定问候时间点</span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input type="time" value={proactiveTimeInput} onChange={e => setProactiveTimeInput(e.target.value)}
                      className="h-10 bg-card border-border rounded-xl max-w-[140px] focus-visible:ring-1 focus-visible:ring-primary/45 transition-all text-xs" />
                    <Button size="sm" variant="outline" onClick={addProactiveTime}
                      className="rounded-xl h-10 px-3 border-border hover:bg-muted/40 transition-all text-xs font-semibold">
                      <Plus className="w-4 h-4 mr-1" />添加时间
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-foreground/85">主动问候心路风格补充</Label>
                    <Textarea value={proactiveStylePrompt} onChange={e => setProactiveStylePrompt(e.target.value)}
                      rows={2}
                      placeholder="例如：清晨问候注重关怀提醒；深夜则更倾向于平实地倾诉心里的挂念与过去的小说细节回忆。"
                      className="bg-card border-border rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary/45 transition-all leading-relaxed" />
                  </div>
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
