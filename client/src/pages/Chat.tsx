import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { beijingDateKey, formatBeijingDate, formatBeijingTime } from "@/lib/beijing-time";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Send, Sparkles, ChevronDown, ChevronUp, Trash2, MoreVertical,
  Plus, Image, Mic, X, Play, Pause, Clock, BarChart3, Search, BookOpen, Theater,
  Volume2, Download, Activity, Archive, AlertTriangle, CheckCircle2, Filter, Pencil, RotateCcw, Save, Database,
  ListChecks, Layers, Info, MapPin, Sparkle, PanelLeft, PanelLeftClose, LayoutGrid, User, Calendar, ListFilter,
  Brain, Tag, Star, Loader2, Heart, ShieldAlert, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import GraduationModal from "@/components/GraduationModal";
import PersonaStatePanel from "@/components/PersonaStatePanel";
import ChatHistoryManager from "@/components/ChatHistoryManager";
import SceneChatHistoryManager from "@/components/SceneChatHistoryManager";
import SceneContextPanel from "@/components/SceneContextPanel";
import MemoryReviewCandidates from "@/components/MemoryReviewCandidates";

interface Message {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "voice" | "image";
  mediaUrl?: string | null;
  mediaDuration?: number | null;
  emotionalState?: string;
  channel?: string;
  createdAt?: Date;
  isStreaming?: boolean;
}

const STATES: Record<string, { label: string; emoji: string; desc: string }> = {
  warm:       { label: "温柔",  emoji: "🌸", desc: "温柔体贴，充满关怀" },
  playful:    { label: "俏皮",  emoji: "😄", desc: "轻松活泼，爱开玩笑" },
  nostalgic:  { label: "思念",  emoji: "🌙", desc: "有些想念，带着回忆" },
  melancholy: { label: "忧郁",  emoji: "🌧️", desc: "情绪低落，需要安慰" },
  happy:      { label: "开心",  emoji: "✨", desc: "心情很好，充满活力" },
  distant:    { label: "疏离",  emoji: "❄️", desc: "有些距离感，话不多" },
};

function generateAvatar(name: string): string {
  const colors = [
    ["#7CB69D", "#5A9E7F"], ["#D4A574", "#C08B5C"],
    ["#8BAEC4", "#6B96B0"], ["#C4A0C4", "#A882A8"],
  ];
  const idx = (name?.charCodeAt(0) || 0) % colors.length;
  const [c1, c2] = colors[idx];
  const char = (name || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <defs><linearGradient id="a" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient></defs>
    <rect width="40" height="40" rx="10" fill="url(#a)"/>
    <text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="600" fill="white" text-anchor="middle">${char}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// 有真实头像 URL 就显示真图，否则回退到算法色块。
function getAvatarUrl(name: string, avatarUrl?: string | null): string {
  return avatarUrl && avatarUrl.trim() ? avatarUrl : generateAvatar(name);
}

function VoicePlayer({ url, duration }: { url: string; duration?: number | null }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  return (
    <button onClick={toggle} className="flex items-center gap-2 min-w-[120px]">
      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      <div className="flex-1 flex items-center gap-0.5">
        {[...Array(12)].map((_, i) => (
          <div key={i} className={`w-1 rounded-full bg-current transition-all ${playing ? "animate-pulse" : ""}`}
            style={{ height: `${4 + Math.random() * 12}px`, animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>
      {duration != null && <span className="text-xs opacity-60">{duration}″</span>}
    </button>
  );
}

function TTSButton({ text }: { text: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsMutation = trpc.chat.tts.useMutation();

  const handlePlay = async () => {
    if (audioUrl && audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false); }
      else { audioRef.current.play(); setPlaying(true); }
      return;
    }
    setLoading(true);
    try {
      const result = await ttsMutation.mutateAsync({ text: text.slice(0, 500) });
      setAudioUrl(result.audioUrl);
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch { toast.error("语音生成失败"); }
    finally { setLoading(false); }
  };

  return (
    <button
      onClick={handlePlay}
      disabled={loading}
      title={playing ? "暂停朗读" : "朗读消息"}
      className={`p-1 rounded-lg transition-all flex items-center gap-1 ${
        playing
          ? "text-primary bg-primary/10 animate-pulse"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/70"
      } disabled:opacity-30`}
    >
      {loading ? (
        <Sparkles className="w-3 h-3 animate-pulse text-primary" />
      ) : (
        <Volume2 className={`w-3 h-3 ${playing ? "text-primary scale-110" : ""}`} />
      )}
    </button>
  );
}

function DateDivider({ date, id }: { date: string | Date; id?: string }) {
  const d = new Date(date);
  const now = new Date();
  const dayKey = beijingDateKey(d);
  const todayKey = beijingDateKey(now);
  const yesterdayKey = beijingDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const label = dayKey === todayKey ? "今天"
    : dayKey === yesterdayKey ? "昨天"
    : formatBeijingDate(d, dayKey.slice(0, 4) === todayKey.slice(0, 4)
        ? { month: "long", day: "numeric" }
        : { year: "numeric", month: "long", day: "numeric" });
  return (
    <div id={id || `date-divider-${dayKey}`} className="relative flex items-center justify-center my-7 select-none scroll-mt-24">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border/40" />
      </div>
      <span className="relative text-[11px] font-medium text-muted-foreground/75 bg-muted/60 backdrop-blur-md border border-border/50 px-3.5 py-0.5 rounded-full shadow-2xs">
        {label}
      </span>
    </div>
  );
}

function TimelineQuickJump({
  dates,
  userMessages,
  onJumpToDate,
  onJumpToMessage,
  onJumpToTop,
  onJumpToBottom,
  onOpenSearch,
}: {
  dates: { key: string; label: string; count: number }[];
  userMessages: { id: string | number; snippet: string; messageType?: string; timeStr: string; index: number }[];
  onJumpToDate: (key: string) => void;
  onJumpToMessage: (id: string | number) => void;
  onJumpToTop: () => void;
  onJumpToBottom: () => void;
  onOpenSearch: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"user" | "date" | null>(null);

  return (
    <aside className="fixed right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30 flex items-center gap-2 pointer-events-auto">
      {/* Expanded Floating Popover Panel */}
      {activeTab && (
        <div
          className="backdrop-blur-2xl bg-card/95 dark:bg-card/90 border border-border/80 rounded-3xl shadow-2xl p-3.5 w-64 sm:w-72 max-h-[70vh] flex flex-col gap-2.5 animate-scale-in mr-1 ring-1 ring-black/5"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {activeTab === "user" ? (
                <>
                  <div className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-bold text-xs text-foreground truncate">我的发言 ({userMessages.length})</span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 rounded-lg bg-chart-3/15 text-chart-3 flex items-center justify-center">
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-bold text-xs text-foreground truncate">按日期定位 ({dates.length})</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab(activeTab === "user" ? "date" : "user")}
                className="text-[10px] px-2 py-0.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground font-medium transition-colors"
                title="切换目录模式"
              >
                {activeTab === "user" ? "看日期" : "看发言"}
              </button>
              <button
                onClick={() => setActiveTab(null)}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto scrollbar-hide space-y-1.5 pr-0.5">
            {activeTab === "user" ? (
              userMessages.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">暂无发言记录</p>
              ) : (
                userMessages.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onJumpToMessage(item.id);
                    }}
                    className="w-full text-left p-2 rounded-xl bg-muted/35 hover:bg-primary/10 hover:border-primary/30 border border-border/40 transition-all flex items-start gap-2 group/u"
                  >
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5 group-hover/u:bg-primary group-hover/u:text-primary-foreground transition-colors">
                      #{item.index}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground font-medium truncate group-hover/u:text-primary transition-colors">
                        {item.snippet}
                      </p>
                      {item.timeStr && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.timeStr}</p>
                      )}
                    </div>
                  </button>
                ))
              )
            ) : (
              dates.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">暂无日期记录</p>
              ) : (
                dates.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => {
                      onJumpToDate(d.key);
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-muted/35 hover:bg-chart-3/10 hover:border-chart-3/30 border border-border/40 transition-all flex items-center justify-between group/d"
                  >
                    <span className="text-xs font-semibold text-foreground group-hover/d:text-chart-3 transition-colors">
                      {d.label}
                    </span>
                    <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground group-hover/d:bg-chart-3/15 group-hover/d:text-chart-3 font-medium transition-colors">
                      {d.count} 条记录
                    </span>
                  </button>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* Main Trigger Rail (Enlarged Target & Easy to Click) */}
      <div className="backdrop-blur-2xl bg-card/90 dark:bg-card/85 border border-border/80 rounded-2xl sm:rounded-3xl shadow-xl p-1.5 flex flex-col items-center gap-1.5 transition-all">
        {/* Top Button (Enlarged Target) */}
        <button
          onClick={onJumpToTop}
          title="回滚到最顶部"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/top"
        >
          <ChevronUp className="w-5 h-5 group-hover/top:-translate-y-0.5 transition-transform" />
        </button>

        {/* Search Message Button */}
        <button
          onClick={onOpenSearch}
          title="搜索消息记录"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/search"
        >
          <Search className="w-4 h-4 group-hover/search:scale-110 transition-transform" />
        </button>

        <div className="w-5 border-t border-border/60" />

        {/* Jump to User Messages Button */}
        <button
          onClick={() => setActiveTab(activeTab === "user" ? null : "user")}
          title={`我的发言 (${userMessages.length}条) - 点击展开快速跳转`}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 relative ${
            activeTab === "user"
              ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
          }`}
        >
          <User className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none mt-0.5 opacity-90">
            {userMessages.length > 99 ? "99+" : userMessages.length}
          </span>
        </button>

        {/* Jump to Dates Button */}
        <button
          onClick={() => setActiveTab(activeTab === "date" ? null : "date")}
          title={`日期目录 (${dates.length}天) - 点击展开快速跳转`}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${
            activeTab === "date"
              ? "bg-chart-3 text-white shadow-md ring-2 ring-chart-3/30"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none mt-0.5 opacity-90">
            {dates.length}
          </span>
        </button>

        <div className="w-5 border-t border-border/60" />

        {/* Bottom Button (Enlarged Target) */}
        <button
          onClick={onJumpToBottom}
          title="回到底部最新消息"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/bot"
        >
          <ChevronDown className="w-5 h-5 group-hover/bot:translate-y-0.5 transition-transform" />
        </button>
      </div>
    </aside>
  );
}

function ChatWorkbench({
  isExpanded,
  onToggleExpand,
  currentState,
  stateInfo,
  onChangeState,
  onOpenScenes,
  onOpenTimeline,
  onOpenSourceLibrary,
  onOpenEmotionReport,
  onOpenDiary,
  onOpenDiagnostics,
  activeScene,
}: {
  isExpanded: boolean;
  onToggleExpand: () => void;
  currentState: string;
  stateInfo: { label: string; emoji: string; desc: string };
  onChangeState: (state: string) => void;
  onOpenScenes: () => void;
  onOpenTimeline: () => void;
  onOpenSourceLibrary: () => void;
  onOpenEmotionReport: () => void;
  onOpenDiary: () => void;
  onOpenDiagnostics: () => void;
  activeScene?: any;
}) {
  const [showStateDropdown, setShowStateDropdown] = useState(false);

  return (
    <aside
      className={`hidden lg:flex flex-col fixed left-3 xl:left-5 top-20 bottom-24 z-30 backdrop-blur-2xl bg-card/90 dark:bg-card/85 border border-border/80 rounded-3xl shadow-xl shadow-black/5 hover:shadow-2xl transition-all duration-300 py-3.5 ${
        isExpanded ? "w-52 px-3" : "w-14 px-1.5"
      }`}
    >
      {/* Header & Toggle */}
      <div className={`flex items-center ${isExpanded ? "justify-between px-1 mb-3" : "justify-center mb-2.5"} pb-2 border-b border-border/60 shrink-0`}>
        {isExpanded ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-bold text-xs text-foreground tracking-wide truncate">陪伴工作台</span>
          </div>
        ) : null}
        <button
          onClick={onToggleExpand}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          title={isExpanded ? "收起工作台" : "展开工作台"}
        >
          {isExpanded ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4 text-primary" />}
        </button>
      </div>

      {/* Action Items List */}
      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3">
        {/* Group 0: 情感状态 (置于工作台最上方) */}
        <div className="space-y-1">
          {isExpanded ? (
            <div className="p-1 rounded-2xl bg-muted/30 border border-border/50">
              <div
                onClick={() => setShowStateDropdown(!showStateDropdown)}
                className={`w-full flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all state-bg-${currentState} state-${currentState}`}
                title="点击展开/收起情感状态切换"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">{stateInfo.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-tight truncate">{stateInfo.label}</p>
                    <p className="text-[9.5px] opacity-75 truncate">{stateInfo.desc}</p>
                  </div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform ${showStateDropdown ? "rotate-180" : ""}`} />
              </div>

              {showStateDropdown && (
                <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-border/40 animate-scale-in">
                  {Object.entries(STATES).map(([key, s]) => {
                    const isActive = currentState === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          onChangeState(key);
                          setShowStateDropdown(false);
                        }}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                          isActive
                            ? `state-bg-${key} state-${key} ring-1.5 ring-primary/40 shadow-2xs`
                            : "text-muted-foreground hover:text-foreground hover:bg-card/80 border border-border/30"
                        }`}
                        title={s.desc}
                      >
                        <span className="text-xs">{s.emoji}</span>
                        <span className="text-[10.5px] truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex justify-center my-0.5">
              <button
                onClick={() => {
                  const keys = Object.keys(STATES);
                  const nextIdx = (keys.indexOf(currentState) + 1) % keys.length;
                  onChangeState(keys[nextIdx]);
                }}
                className={`w-8.5 h-8.5 rounded-2xl flex items-center justify-center text-xs transition-all shadow-xs state-bg-${currentState} state-${currentState} hover:scale-105 active:scale-95`}
                title={`当前情感：${stateInfo.emoji} ${stateInfo.label} (点击切换)`}
              >
                <span>{stateInfo.emoji}</span>
              </button>
            </div>
          )}
        </div>

        {/* Group 1: 沉浸互动 */}
        <div className="space-y-1 pt-1 border-t border-border/50">
          {isExpanded && (
            <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 py-0.5">
              沉浸互动
            </p>
          )}
          <button
            onClick={onOpenScenes}
            className={`w-full flex items-center rounded-2xl transition-all group relative ${
              isExpanded
                ? activeScene
                  ? "p-2 bg-chart-3/15 border border-chart-3/30 gap-2.5 shadow-2xs"
                  : "px-2.5 py-2 hover:bg-muted/70 gap-2.5"
                : "p-1.5 justify-center"
            }`}
            title={activeScene ? `情境剧场（进行中）：${activeScene.name}` : "情境剧场"}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all relative ${
              activeScene
                ? "bg-chart-3 text-white shadow-xs"
                : "bg-chart-3/12 text-chart-3 group-hover:scale-105"
            }`}>
              <Theater className="w-4 h-4" />
              {activeScene && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-card"></span>
                </span>
              )}
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-foreground truncate">情境剧场</p>
                  {activeScene && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                      进行中
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/75 truncate">
                  {activeScene ? activeScene.name : "切换剧本与情境"}
                </p>
              </div>
            )}
          </button>
        </div>

        {/* Group 2: 记忆与感知 */}
        <div className="space-y-1 pt-1 border-t border-border/50">
          {isExpanded && (
            <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 py-0.5">
              记忆与感知
            </p>
          )}
          <button
            onClick={onOpenTimeline}
            className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
              isExpanded ? "px-2.5 py-2 hover:bg-muted/70" : "p-2 justify-center hover:bg-muted/70"
            }`}
            title="记忆时间线"
          >
            <div className="w-7 h-7 rounded-xl bg-chart-3/12 text-chart-3 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Clock className="w-3.5 h-3.5" />
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">记忆时间线</p>
                <p className="text-[10px] text-muted-foreground/75 truncate">回忆与关键节点</p>
              </div>
            )}
          </button>

          <button
            onClick={onOpenSourceLibrary}
            className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
              isExpanded ? "px-2.5 py-2 hover:bg-muted/70" : "p-2 justify-center hover:bg-muted/70"
            }`}
            title="资料库"
          >
            <div className="w-7 h-7 rounded-xl bg-chart-4/12 text-chart-4 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Database className="w-3.5 h-3.5" />
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">资料库</p>
                <p className="text-[10px] text-muted-foreground/75 truncate">背景与知识沉淀</p>
              </div>
            )}
          </button>

          <button
            onClick={onOpenEmotionReport}
            className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
              isExpanded ? "px-2.5 py-2 hover:bg-muted/70" : "p-2 justify-center hover:bg-muted/70"
            }`}
            title="情绪报告"
          >
            <div className="w-7 h-7 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <BarChart3 className="w-3.5 h-3.5" />
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">情绪报告</p>
                <p className="text-[10px] text-muted-foreground/75 truncate">心境波动曲线</p>
              </div>
            )}
          </button>

          <button
            onClick={onOpenDiary}
            className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
              isExpanded ? "px-2.5 py-2 hover:bg-muted/70" : "p-2 justify-center hover:bg-muted/70"
            }`}
            title="对话日记"
          >
            <div className="w-7 h-7 rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">对话日记</p>
                <p className="text-[10px] text-muted-foreground/75 truncate">每日情感日记</p>
              </div>
            )}
          </button>

          <button
            onClick={onOpenDiagnostics}
            className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
              isExpanded ? "px-2.5 py-2 hover:bg-muted/70" : "p-2 justify-center hover:bg-muted/70"
            }`}
            title="运行诊断"
          >
            <div className="w-7 h-7 rounded-xl bg-blue-500/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Activity className="w-3.5 h-3.5" />
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">运行诊断</p>
                <p className="text-[10px] text-muted-foreground/75 truncate">心智与状态透视</p>
              </div>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

function MessageBubble({
  msg,
  personaName,
  personaAvatarUrl,
  showState = true,
}: {
  msg: Message;
  personaName: string;
  personaAvatarUrl?: string | null;
  showState?: boolean;
}) {
  const isUser = msg.role === "user";
  const state = msg.emotionalState ? STATES[msg.emotionalState] : null;
  const [imgExpanded, setImgExpanded] = useState(false);

  const renderContent = () => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-2xl border border-border/60 shadow-sm max-w-[280px] sm:max-w-[340px] group/img">
            <img
              src={msg.mediaUrl}
              alt=""
              onClick={() => setImgExpanded(true)}
              className="w-full max-h-[320px] object-cover cursor-pointer group-hover/img:scale-102 transition-transform duration-300"
            />
          </div>
          {/* 场景配图等人物图片消息的 content 只是内部占位；有真实说明文字才显示，避免历史旧数据继续露出“（场景配图）” */}
          {msg.content && msg.content !== "[图片]" && msg.content !== "（场景配图）" && (
            <p className="text-[13.5px] sm:text-sm text-foreground/90 leading-relaxed px-1">{msg.content}</p>
          )}
          {imgExpanded && (
            <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setImgExpanded(false)}>
              <img src={msg.mediaUrl!} alt="" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl animate-scale-in" />
            </div>
          )}
        </div>
      );
    }
    if (msg.messageType === "voice" && msg.mediaUrl) {
      return (
        <div className="flex flex-col gap-1.5 py-0.5">
          <VoicePlayer url={msg.mediaUrl} duration={msg.mediaDuration} />
          {msg.content && msg.content !== "（语音消息）" && (
            <p className="text-xs opacity-75 mt-0.5 px-0.5">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.isStreaming) {
      return (
        <span className="leading-[1.75]">
          {msg.content}
          <span className="inline-block w-1.5 h-4 bg-primary/70 ml-1 rounded-sm animate-pulse align-middle" />
        </span>
      );
    }
    if (isUser) return <span className="whitespace-pre-wrap leading-[1.75]">{msg.content}</span>;
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none break-words [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 leading-[1.75] tracking-normal">
        <Streamdown>{msg.content}</Streamdown>
      </div>
    );
  };

  return (
    <div id={`msg-${msg.id}`} className={`bubble-enter flex gap-2.5 sm:gap-3.5 ${isUser ? "flex-row-reverse" : "flex-row"} mb-5 sm:mb-6 group/msg scroll-mt-24`}>
      {!isUser && (
        <img
          src={getAvatarUrl(personaName, personaAvatarUrl)}
          alt={personaName}
          className="w-9.5 h-9.5 sm:w-10.5 sm:h-10.5 rounded-2xl object-cover ring-2 ring-primary/10 group-hover/msg:ring-primary/30 shadow-xs flex-shrink-0 mt-0.5 transition-all"
          loading="lazy"
        />
      )}
      <div className={`max-w-[85%] sm:max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && state && showState && (
          <span className={`text-[11px] px-2.5 py-0.5 rounded-full border border-border/50 state-bg-${msg.emotionalState} state-${msg.emotionalState} font-medium shadow-2xs flex items-center gap-1 mb-0.5`}>
            <span>{state.emoji}</span>
            <span>{state.label}</span>
          </span>
        )}
        <div className={`px-4.5 py-3 sm:px-5 sm:py-3.5 text-[14px] sm:text-[14.5px] ${isUser ? "bubble-user" : "bubble-ai"}`}>
          {renderContent()}
        </div>
        {msg.createdAt && !msg.isStreaming && (
          <div className={`text-[10.5px] text-muted-foreground/60 px-1.5 flex items-center gap-2 mt-0.5 ${isUser ? "justify-end" : "justify-start"}`}>
            <span className="font-medium tracking-tight">{formatBeijingTime(msg.createdAt)}</span>
            {msg.channel === "wechat" && (
              <span className="text-[9.5px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-md font-semibold">微信</span>
            )}
            {msg.channel === "qq" && (
              <span className="text-[9.5px] px-1.5 py-0.2 bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 rounded-md font-semibold">QQ</span>
            )}
            {!isUser && msg.messageType === "text" && <TTSButton text={msg.content} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN CHAT ────────────────────────────────────────────────────────────────

export default function Chat() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [currentState, setCurrentState] = useState("warm");
  const [showStatePanel, setShowStatePanel] = useState(false);
  const [showSettingDetail, setShowSettingDetail] = useState(false);
  const [isWorkbenchExpanded, setIsWorkbenchExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("ink-and-kin_chat_workbench_expanded");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [showMobileWorkbench, setShowMobileWorkbench] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); toast.success("网络已恢复"); };
    const onOffline = () => { setIsOnline(false); toast.error("网络连接已断开"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const { data: persona, refetch: refetchPersona } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: intimacy } = trpc.persona.getIntimacy.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: history, refetch: refetchHistory } = trpc.chat.getHistory.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );
  const sceneImagePollTimersRef = useRef<Set<number>>(new Set());

  // /p 时，服务端先把人物文字回复还给页面，图片在后台完成后写进历史。
  // 这里短暂轮询历史，让成功图片自然出现在聊天流中；失败不会弹窗或发送文字。
  const pollForSceneImage = useCallback((requestedAtMs: number) => {
    const expiresAtMs = requestedAtMs + 6 * 60_000;
    const schedule = (delayMs: number) => {
      const timer = window.setTimeout(async () => {
        sceneImagePollTimersRef.current.delete(timer);
        try {
          const response = await refetchHistory();
          const imageArrived = (response.data ?? []).some((message: any) => (
            message.messageType === "image"
            && new Date(message.createdAt).getTime() >= requestedAtMs - 2_000
          ));
          if (!imageArrived && Date.now() < expiresAtMs) schedule(3_000);
        } catch {
          if (Date.now() < expiresAtMs) schedule(5_000);
        }
      }, delayMs);
      sceneImagePollTimersRef.current.add(timer);
    };
    schedule(1_000);
  }, [refetchHistory]);

  useEffect(() => () => {
    sceneImagePollTimersRef.current.forEach(timer => window.clearTimeout(timer));
    sceneImagePollTimersRef.current.clear();
  }, []);

  const sendMutation = trpc.chat.send.useMutation({
    onError: (e: any) => {
      toast.error("发送失败：" + e.message);
      setIsSending(false);
    },
  });

  const clearMutation = trpc.chat.clear.useMutation({
    onSuccess: () => { setMessages([]); toast.success("对话已清空"); setShowMenu(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const startNewContextMutation = trpc.chat.startNewContext.useMutation({
    onSuccess: () => { toast.success("已重新开本段对话，旧记录仍保留"); setShowMenu(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const startNewContext = () => {
    if (!window.confirm("旧聊天记录会保留，但不会再作为后续回复的上下文。当前场景和已确认的长期记忆不受影响。现在重新开本段对话？")) {
      return;
    }
    startNewContextMutation.mutate({ personaId });
  };

  const [showMenu, setShowMenu] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSourceLibrary, setShowSourceLibrary] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEmotionReport, setShowEmotionReport] = useState(false);
  const [showDiary, setShowDiary] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showHistoryManager, setShowHistoryManager] = useState(false);
  const [scenePanelTab, setScenePanelTab] = useState<"note" | "context" | null>(null);
  const [showSceneHistoryManager, setShowSceneHistoryManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showGraduation, setShowGraduation] = useState(false);

  const { data: scenesList, refetch: refetchScenes } = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });
  const deactivateSceneMutation = trpc.scene.deactivate.useMutation({
    onSuccess: () => {
      toast.success("已退出剧场，恢复日常对话");
      setScenePanelTab(null);
      void refetchPersona();
      void refetchScenes();
    },
  });

  const activeScene = scenesList?.find((s: any) => s.id === persona?.activeSceneId);

  const changeStateMutation = trpc.persona.update.useMutation({
    onSuccess: () => toast.success("情感状态已切换"),
  });

  const sendImageMutation = trpc.chat.sendImage.useMutation({
    onError: (e: any) => { toast.error("图片发送失败：" + e.message); setIsSending(false); },
  });

  const sendVoiceMutation = trpc.chat.sendVoice.useMutation({
    onError: (e: any) => { toast.error("语音发送失败：" + e.message); setIsSending(false); },
  });

  const exportMutation = trpc.chat.export.useMutation();

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({ personaId });
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e: any) { toast.error("导出失败：" + e.message); }
  };

  useEffect(() => {
    if (history) {
      setMessages(history.map((m: any) => ({
        id: m.id, role: m.role as "user" | "assistant",
        content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl, mediaDuration: m.mediaDuration,
        emotionalState: m.emotionalState, channel: m.channel, createdAt: m.createdAt,
      })));
    }
  }, [history]);

  const toggleWorkbenchExpand = useCallback(() => {
    setIsWorkbenchExpanded(prev => {
      const next = !prev;
      try { localStorage.setItem("ink-and-kin_chat_workbench_expanded", String(next)); } catch {}
      return next;
    });
  }, []);

  const timelineDates = useMemo(() => {
    const list: { key: string; label: string; count: number }[] = [];
    const seen = new Map<string, { key: string; label: string; count: number }>();
    const now = new Date();
    const todayKey = beijingDateKey(now);
    const yesterdayKey = beijingDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    for (const msg of messages) {
      if (!msg.createdAt) continue;
      const d = new Date(msg.createdAt);
      const dayKey = beijingDateKey(d);
      const label = dayKey === todayKey ? "今天"
        : dayKey === yesterdayKey ? "昨天"
        : formatBeijingDate(d, dayKey.slice(0, 4) === todayKey.slice(0, 4)
            ? { month: "numeric", day: "numeric" }
            : { month: "numeric", day: "numeric" });

      const existing = seen.get(dayKey);
      if (existing) {
        existing.count += 1;
      } else {
        const item = { key: dayKey, label, count: 1 };
        seen.set(dayKey, item);
        list.push(item);
      }
    }
    return list;
  }, [messages]);

  const userMessages = useMemo(() => {
    const list: { id: string | number; snippet: string; messageType?: string; timeStr: string; index: number }[] = [];
    let count = 0;
    for (const m of messages) {
      if (m.role === "user") {
        count++;
        let snippet = m.content || "";
        if (m.messageType === "image") snippet = "[图片]";
        else if (m.messageType === "voice") snippet = "[语音]";
        else if (snippet.length > 24) snippet = snippet.slice(0, 22) + "...";

        list.push({
          id: m.id,
          snippet: snippet || "...",
          messageType: m.messageType,
          timeStr: m.createdAt ? formatBeijingTime(m.createdAt) : "",
          index: count,
        });
      }
    }
    return list;
  }, [messages]);

  const handleJumpToMessage = useCallback((id: string | number) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-3xl", "transition-all", "duration-500");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "rounded-3xl");
      }, 1800);
    }
  }, []);

  const handleJumpToDate = useCallback((key: string) => {
    const el = document.getElementById(`date-divider-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

    const handleJumpToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
    document.body.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleJumpToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (persona?.emotionalState) setCurrentState(persona.emotionalState);
  }, [persona?.emotionalState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    setIsSending(true);

    const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);

    const streamId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

    const requestedAtMs = Date.now();
    try {
      const result = await sendMutation.mutateAsync({ personaId, message: text });
      setMessages(prev => prev.map(m => m.id === streamId
        ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
        : m
      ));
      setCurrentState(result.emotionalState);
      // /p 场景配图不再等待图片接口：文字先出现，生成成功的图片随后从聊天历史自然补入。
      if ((result as { sceneImagePending?: boolean } | undefined)?.sceneImagePending) {
        pollForSceneImage(requestedAtMs);
      }
      if (result.graduationSuggested) setShowGraduation(true);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== streamId));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isSending) return;
    setShowAttach(false);
    setIsSending(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = URL.createObjectURL(file);
      const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "[图片]", messageType: "image", mediaUrl: localUrl, createdAt: new Date() };
      setMessages(prev => [...prev, userMsg]);
      const streamId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

      try {
        const result = await sendImageMutation.mutateAsync({ personaId, imageContent: base64, fileName: file.name, mimeType: file.type });
        setMessages(prev => prev.map(m => m.id === streamId
          ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
          : m
        ));
        setCurrentState(result.emotionalState);
      } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
      finally { setIsSending(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [isSending, personaId, currentState]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const duration = recordingTime;
          setIsRecording(false);
          setRecordingTime(0);
          setIsSending(true);

          const localUrl = URL.createObjectURL(blob);
          const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "（语音消息）", messageType: "voice", mediaUrl: localUrl, mediaDuration: duration, createdAt: new Date() };
          setMessages(prev => [...prev, userMsg]);
          const streamId = `stream-${Date.now()}`;
          setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

          try {
            const result = await sendVoiceMutation.mutateAsync({ personaId, audioContent: base64, duration, fileName: `voice-${Date.now()}.webm` });
            setMessages(prev => prev.map(m => {
              if (m.id === streamId) return { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false };
              if (m === userMsg) return { ...m, content: result.transcription || "（语音消息）" };
              return m;
            }));
            setCurrentState(result.emotionalState);
          } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
          finally { setIsSending(false); }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error("无法访问麦克风"); }
  }, [personaId, currentState, recordingTime]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stateInfo = STATES[currentState] || STATES.warm;

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      {/* Header (Refined & Airy Layout) */}
      <header className="sticky top-0 z-40 bg-card/90 backdrop-blur-md border-b border-border/70 flex-shrink-0 transition-all shadow-xs">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3 sm:gap-4">
          {/* Left: Back button & Persona Info */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <button
              onClick={() => navigate("/")}
              className="w-8.5 h-8.5 rounded-2xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all shrink-0 -ml-1"
              title="返回大厅"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="relative shrink-0">
              <img
                src={getAvatarUrl(persona?.name || "?", (persona as { avatarUrl?: string | null } | undefined)?.avatarUrl)}
                alt={persona?.name || ""}
                className="w-9.5 h-9.5 sm:w-10.5 sm:h-10.5 rounded-2xl object-cover ring-2 ring-primary/15 shadow-xs"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-card flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-white opacity-90 animate-pulse" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                <h1 className="text-foreground font-bold text-sm sm:text-base leading-tight truncate">
                  {persona?.name || "..."}
                </h1>
                {intimacy && (
                  <span
                    className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0 font-medium flex items-center gap-1 shadow-2xs"
                    title={`${intimacy.level} · ${intimacy.score}分`}
                  >
                    {intimacy.icon} {intimacy.level}
                  </span>
                )}
                {activeScene && (
                  <button
                    onClick={() => navigate(`/scenes/${personaId}`)}
                    className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-chart-3/15 text-chart-3 border border-chart-3/25 font-semibold shrink-0 flex items-center gap-1 hover:bg-chart-3/25 transition-colors shadow-2xs"
                    title={`当前在情境剧场：${activeScene.name}，点击切换`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-chart-3 animate-pulse" />
                    <span>{activeScene.icon || "🎭"}</span>
                    <span className="max-w-[100px] xs:max-w-[150px] truncate">{activeScene.name}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <button
                  onClick={() => setShowSettingDetail(true)}
                  className="text-muted-foreground/80 hover:text-foreground text-[10.5px] sm:text-[11px] leading-tight truncate text-left transition-colors flex items-center gap-1 max-w-full group/subtitle"
                  title="点击查看详细人物与关系设定"
                >
                  {activeScene ? (
                    <>
                      <Theater className="w-3 h-3 text-chart-3 shrink-0" />
                      <span className="truncate">{activeScene.personaIdentityOverride ? `身份：${activeScene.personaIdentityOverride}` : activeScene.description || "情境剧场进行中"}</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 shrink-0" />
                      <span className="truncate">{persona?.relationshipDesc ? (persona.relationshipDesc.length > 28 ? `${persona.relationshipDesc.slice(0, 26)}...` : persona.relationshipDesc) : "日常相伴"}</span>
                    </>
                  )}
                  <Info className="w-3 h-3 opacity-0 group-hover/subtitle:opacity-70 transition-opacity shrink-0 ml-0.5 text-primary" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* If in active scene: Scene Quick Action Group in Header */}
            {activeScene && (
              <div className="flex items-center gap-1 bg-chart-3/10 p-1 rounded-2xl border border-chart-3/25 shadow-2xs">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 text-xs px-2.5 rounded-xl font-semibold transition-all ${
                    scenePanelTab === "note" ? "bg-chart-3/25 text-chart-3 font-bold" : "text-chart-3 hover:bg-chart-3/15"
                  }`}
                  onClick={() => setScenePanelTab(scenePanelTab === "note" ? null : "note")}
                  title="展开/收起剧本设定便签"
                >
                  <BookOpen className="w-3.5 h-3.5 mr-1 text-chart-3" />
                  <span className="hidden xs:inline">{scenePanelTab === "note" ? "收起" : "便签"}</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 text-xs px-2 rounded-xl transition-all ${
                    scenePanelTab === "context" ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setScenePanelTab(scenePanelTab === "context" ? null : "context")}
                  title="查看与管理剧本上下文"
                >
                  <Layers className="w-3.5 h-3.5 mr-1" />
                  <span className="hidden sm:inline">上下文</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 rounded-xl text-muted-foreground hover:text-foreground hidden sm:flex items-center"
                  onClick={() => navigate(`/scenes/${personaId}`)}
                  title="切换剧本"
                >
                  <Theater className="w-3.5 h-3.5 mr-1" />
                  <span>换剧本</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 rounded-xl text-destructive hover:bg-destructive/10"
                  onClick={() => deactivateSceneMutation.mutate({ personaId })}
                  disabled={deactivateSceneMutation.isPending}
                  title="退出当前情境剧场"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  <span>退出</span>
                </Button>
              </div>
            )}

            {/* Mobile Workbench Trigger */}
            <button
              onClick={() => setShowMobileWorkbench(true)}
              title="打开陪伴工作台"
              className="w-8.5 h-8.5 rounded-2xl lg:hidden flex items-center justify-center text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            {/* More Menu */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                title="系统设置与管理"
                aria-label="更多"
                className="w-8.5 h-8.5 rounded-2xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-card/95 backdrop-blur-2xl border border-border/80 rounded-2xl shadow-2xl p-1.5 min-w-[180px] z-50 animate-scale-in ring-1 ring-black/5">
                  <button
                    onClick={() => { handleExport(); setShowMenu(false); }}
                    disabled={exportMutation.isPending}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary rounded-xl transition-all disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-500" />导出对话
                  </button>
                  <button
                    onClick={() => { startNewContext(); setShowMenu(false); }}
                    disabled={startNewContextMutation.isPending}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary rounded-xl transition-all disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-teal-500" />重新开对话
                  </button>
                  <button
                    onClick={() => { setShowHistoryManager(true); setShowMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary rounded-xl transition-all"
                  >
                    <ListChecks className="w-3.5 h-3.5 text-orange-500" />管理聊天记录
                  </button>
                  <div className="my-1 border-t border-border/60" />
                  <button
                    onClick={() => { clearMutation.mutate({ personaId }); setShowMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-xl transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />清空对话
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Right Floating Scene Panel (Morandi Glassmorphism Floating Card) */}
      {activeScene && scenePanelTab && (
        <aside
          className="fixed right-[76px] sm:right-[88px] xl:right-[92px] top-20 bottom-24 z-30 w-[360px] sm:w-[400px] md:w-[430px] max-w-[calc(100vw-100px)] backdrop-blur-2xl bg-card/95 dark:bg-card/90 border border-border/80 rounded-3xl shadow-2xl shadow-black/10 flex flex-col overflow-hidden animate-slide-in-right transition-all duration-300"
        >
          {/* Panel Top Header: Tabs & Actions */}
          <div className="p-3 sm:p-3.5 border-b border-border/60 bg-muted/20 shrink-0 flex items-center justify-between gap-2">
            {/* Tab Switcher: [ 📖 剧情设定 ] | [ 🗂️ 上下文管理 ] */}
            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-2xl border border-border/50 shadow-2xs">
              <button
                onClick={() => setScenePanelTab("note")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  scenePanelTab === "note"
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-chart-3" />
                <span>剧情设定</span>
              </button>
              <button
                onClick={() => setScenePanelTab("context")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  scenePanelTab === "context"
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span>上下文</span>
              </button>
            </div>

            {/* Right Close & Quick Jump */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => navigate(`/scenes/${personaId}?view=memory&sceneId=${activeScene.id}`)}
                className="p-1.5 rounded-xl text-muted-foreground hover:text-chart-3 hover:bg-chart-3/10 transition-colors cursor-pointer"
                title="跳转该剧本完整记忆中枢"
              >
                <Database className="w-4 h-4" />
              </button>
              <button
                onClick={() => setScenePanelTab(null)}
                className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title="关闭面板"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Panel Scrollable Content Body */}
          <div className={`flex-1 min-h-0 ${scenePanelTab === "note" ? "overflow-y-auto p-3.5 sm:p-4 space-y-3" : "flex flex-col p-3 sm:p-3.5"} scrollbar-thin`}>
            {scenePanelTab === "note" && (
              <div className="space-y-3 animate-fade-in">
                {/* Scene Info Summary Card */}
                <div className="p-3 rounded-2xl bg-gradient-to-br from-chart-3/[0.08] via-chart-3/[0.03] to-background border border-chart-3/20 space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{activeScene.icon || "🎭"}</span>
                    <span className="font-bold text-sm text-foreground truncate">{activeScene.name}</span>
                  </div>
                  {activeScene.description && (
                    <p className="text-xs text-foreground/85 leading-relaxed">
                      {activeScene.description}
                    </p>
                  )}
                </div>

                {/* Context Seed Card */}
                {activeScene.contextSeed && (
                  <div className="p-3 rounded-2xl bg-card border border-border/70 space-y-1.5 shadow-2xs">
                    <span className="text-xs font-bold text-chart-3 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      前情提要背景
                    </span>
                    <p className="text-xs text-foreground/85 leading-relaxed bg-muted/20 p-2.5 rounded-xl border border-border/40">
                      {activeScene.contextSeed}
                    </p>
                  </div>
                )}

                {/* Persona Setting Card */}
                {activeScene.personaIdentityOverride && (
                  <div className="p-3 rounded-2xl bg-card border border-border/70 space-y-1.5 shadow-2xs">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                        {persona?.name ? persona.name.charAt(0) : "TA"}
                      </span>
                      {persona?.name || "角色"} 剧本设定
                    </span>
                    <p className="text-xs text-foreground/80 leading-relaxed bg-muted/20 p-2.5 rounded-xl border border-border/40">
                      {activeScene.personaIdentityOverride}
                    </p>
                  </div>
                )}
                {activeScene.userIdentityOverride && (
                  <div className="p-3 rounded-2xl bg-card border border-primary/20 shadow-2xs space-y-1.5 flex flex-col">
                    <div className="flex items-center gap-1.5 pb-1 border-b border-primary/15">
                      <span className="w-5 h-5 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        我
                      </span>
                      <span className="text-xs font-bold text-primary truncate">你（用户）剧本设定</span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed flex-1">
                      {activeScene.userIdentityOverride}
                    </p>
                  </div>
                )}
              </div>
            )}

            {scenePanelTab === "context" && (
              <SceneContextPanel
                sceneId={activeScene.id}
                personaId={personaId}
                sceneName={activeScene.name}
                personaName={persona?.name || "人物"}
                onOpenFullManager={() => setShowSceneHistoryManager(true)}
                isFloating={true}
              />
            )}
          </div>
        </aside>
      )}

      {showSearch && <SearchPanel personaId={personaId} onClose={() => { setShowSearch(false); setSearchQuery(""); }} />}

      {/* Main Chat Workspace Layout */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {/* Left Floating/Docked Workbench (lg+ screens) */}
        <ChatWorkbench
          isExpanded={isWorkbenchExpanded}
          onToggleExpand={toggleWorkbenchExpand}
          currentState={currentState}
          stateInfo={stateInfo}
          onChangeState={(key) => {
            changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
            setCurrentState(key);
          }}
          onOpenScenes={() => navigate(`/scenes/${personaId}`)}
          onOpenTimeline={() => setShowTimeline(true)}
          onOpenSourceLibrary={() => setShowSourceLibrary(true)}
          onOpenEmotionReport={() => setShowEmotionReport(true)}
          onOpenDiary={() => setShowDiary(true)}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          activeScene={activeScene}
        />

        {/* Center Column: Message Stream + Fixed Centered Composer */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scroll-smooth min-h-0">
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-35 dark:opacity-20">
              <div className="absolute -top-32 left-1/4 w-96 h-96 rounded-full bg-primary/15 blur-3xl animate-float" />
              <div className="absolute top-1/2 right-10 w-80 h-80 rounded-full bg-chart-3/12 blur-3xl animate-float" style={{ animationDelay: "2.5s" }} />
            </div>
            <div className={`container py-6 max-w-3xl sm:max-w-4xl mx-auto px-3 sm:px-6 relative z-10 will-change-transform transition-transform duration-300 ease-out ${
              activeScene && scenePanelTab ? "lg:-translate-x-[150px] xl:-translate-x-[180px]" : ""
            }`}>
              {messages.length === 0 && (
                <div className="text-center py-16 animate-fade-in">
                  <div className="text-5xl mb-4 animate-float">{stateInfo.emoji}</div>
                  <p className="text-foreground font-medium mb-1">{persona?.name} 在等你</p>
                  <p className="text-muted-foreground text-sm">{stateInfo.desc}</p>
                  <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    {(((persona?.personaData as any)?.starterQuestions?.length > 0
                      ? (persona?.personaData as any).starterQuestions
                      : ["最近怎么样？", "你还记得我们第一次见面吗？", "我有点想你了", "你现在在做什么？"]) as string[]).map((q: string) => (
                      <button key={q} onClick={() => setInput(q)}
                        className="text-xs px-3 py-1.5 bg-muted border border-border rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, index) => {
                const prev = index > 0 ? messages[index - 1] : null;
                const showDateDivider = Boolean(msg.createdAt) && (
                  !prev?.createdAt ||
                  new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt!).toDateString()
                );
                let prevAssistantState: string | null = null;
                for (let i = index - 1; i >= 0; i -= 1) {
                  if (messages[i].role === "assistant") {
                    prevAssistantState = messages[i].emotionalState ?? null;
                    break;
                  }
                }
                const showState = msg.role === "assistant" && Boolean(msg.emotionalState) && msg.emotionalState !== prevAssistantState;
                const dayKey = msg.createdAt ? beijingDateKey(new Date(msg.createdAt)) : undefined;
                return (
                  <Fragment key={msg.id}>
                    {showDateDivider && msg.createdAt && (
                      <DateDivider id={dayKey ? `date-divider-${dayKey}` : undefined} date={msg.createdAt} />
                    )}
                    <MessageBubble
                      msg={msg}
                      personaName={persona?.name || "?"}
                      personaAvatarUrl={(persona as { avatarUrl?: string | null } | undefined)?.avatarUrl}
                      showState={showState}
                    />
                  </Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Fixed Centered Input (100% aligned with message column) */}
          <div className="shrink-0 w-full bg-background/95 backdrop-blur-md border-t border-border/40 px-3 sm:px-6 pb-3 pt-2 z-20">
            <div className={`chat-composer max-w-3xl sm:max-w-4xl mx-auto py-2.5 sm:py-3 px-3 sm:px-4 shadow-md sm:shadow-lg will-change-transform transition-transform duration-300 ease-out ${
              activeScene && scenePanelTab ? "lg:-translate-x-[150px] xl:-translate-x-[180px]" : ""
            }`}>
          {isRecording ? (
            <div className="flex items-center gap-3 h-11">
              <button onClick={cancelRecording} className="text-destructive hover:bg-destructive/10 rounded-xl w-10 h-10 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
              <div className="flex-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-foreground">录音中 {recordingTime}″</span>
                <div className="flex-1 flex items-center gap-0.5 px-2">
                  {[...Array(20)].map((_, i) => (
                    <div key={i} className="w-1 rounded-full bg-primary/40 animate-pulse"
                      style={{ height: `${4 + Math.random() * 16}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <Button onClick={stopRecording} className="h-11 w-11 p-0 bg-primary hover:bg-primary/90 text-primary-foreground border-0 rounded-xl flex-shrink-0">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2.5 items-end">
              <div className="relative">
                <button onClick={() => setShowAttach(!showAttach)}
                  className="h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors">
                  <Plus className={`w-5 h-5 transition-transform ${showAttach ? "rotate-45" : ""}`} />
                </button>
                {showAttach && (
                  <div className="absolute bottom-full left-0 mb-2 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px] z-50 animate-fade-in">
                    <label className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors cursor-pointer">
                      <Image className="w-4 h-4" />发送图片
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                    </label>
                    <button onClick={() => { setShowAttach(false); startRecording(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                      <Mic className="w-4 h-4" />语音消息
                    </button>
                  </div>
                )}
              </div>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`对 ${persona?.name || "TA"} 说点什么...`}
                rows={1}
                className="flex-1 resize-none bg-muted/40 hover:bg-muted/60 focus:bg-background border-border/70 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-2xl min-h-[44px] max-h-32 text-sm transition-all"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isSending || !isOnline}
                className={`h-11 w-11 p-0 rounded-2xl flex-shrink-0 transition-all ${
                  input.trim()
                    ? "bg-gradient-to-tr from-primary to-primary/85 text-primary-foreground shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                    : "bg-muted text-muted-foreground/50 border-0"
                }`}
              >
                {isSending ? <Sparkles className="w-5 h-5 animate-pulse" /> : <Send className="w-5 h-5" />}
              </Button>
            </div>
          )}
        </div>
          </div>
        </div>

        {/* Right Quick Jump Navigation */}
        <TimelineQuickJump
          dates={timelineDates}
          userMessages={userMessages}
          onJumpToDate={handleJumpToDate}
          onJumpToMessage={handleJumpToMessage}
          onJumpToTop={handleJumpToTop}
          onJumpToBottom={handleJumpToBottom}
          onOpenSearch={() => setShowSearch(true)}
        />
      </div>

      {showSettingDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowSettingDetail(false)}>
          <div className="bg-card border border-border/80 rounded-3xl p-6 max-w-md w-full shadow-2xl animate-scale-in relative space-y-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setShowSettingDetail(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3.5">
              <img
                src={getAvatarUrl(persona?.name || "?", (persona as { avatarUrl?: string | null } | undefined)?.avatarUrl)}
                alt={persona?.name || ""}
                className="w-12 h-12 rounded-2xl object-cover ring-2 ring-primary/20 shadow-xs"
              />
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  {persona?.name}
                  {intimacy && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                      {intimacy.icon} {intimacy.level}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {persona?.togetherFrom && persona?.togetherTo ? `${persona.togetherFrom} ~ ${persona.togetherTo}` : "相伴时光"}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1 text-xs">
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 space-y-1.5">
                <span className="font-semibold text-foreground/90 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  关系与背景设定
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  {persona?.relationshipDesc || "暂无详细关系描述"}
                </p>
              </div>

              {activeScene && (
                <div className="p-3.5 rounded-2xl bg-chart-3/10 border border-chart-3/20 space-y-1.5">
                  <span className="font-semibold text-chart-3 flex items-center gap-1.5">
                    <Theater className="w-3.5 h-3.5" />
                    当前情境剧场：{activeScene.name}
                  </span>
                  {activeScene.personaIdentityOverride && (
                    <p className="text-muted-foreground leading-relaxed">
                      角色身份：<span className="text-foreground font-medium">{activeScene.personaIdentityOverride}</span>
                    </p>
                  )}
                  {activeScene.userIdentityOverride && (
                    <p className="text-muted-foreground leading-relaxed">
                      你的身份：<span className="text-foreground font-medium">{activeScene.userIdentityOverride}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettingDetail(false)}
                className="rounded-xl px-4 text-xs font-semibold"
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {showTimeline && <MemoryTimeline personaId={personaId} onClose={() => setShowTimeline(false)} />}
      {showSourceLibrary && <SourceLibraryPanel personaId={personaId} onClose={() => setShowSourceLibrary(false)} />}
      {showDiagnostics && <PersonaStatePanel personaId={personaId} onClose={() => setShowDiagnostics(false)} />}
      {showEmotionReport && <EmotionReport personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowEmotionReport(false)} />}
      {showDiary && <DiaryModal personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowDiary(false)} />}
      {showHistoryManager && (
        <ChatHistoryManager
          personaId={personaId}
          personaName={persona?.name || "人物"}
          onClose={() => setShowHistoryManager(false)}
          onHistoryChanged={() => { void refetchHistory(); }}
        />
      )}
      {showSceneHistoryManager && activeScene && (
        <SceneChatHistoryManager
          sceneId={activeScene.id}
          personaId={personaId}
          sceneName={activeScene.name || "场景"}
          personaName={persona?.name || "人物"}
          onClose={() => setShowSceneHistoryManager(false)}
          onHistoryChanged={() => { void refetchHistory(); }}
        />
      )}
      {/* Mobile Workbench Bottom Sheet / Drawer */}
      {showMobileWorkbench && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center animate-fade-in" onClick={() => setShowMobileWorkbench(false)}>
          <div className="bg-card border border-border/80 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full shadow-2xl animate-scale-in relative space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                <h3 className="font-bold text-sm text-foreground">陪伴工作台</h3>
              </div>
              <button
                onClick={() => setShowMobileWorkbench(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Emotional State Selector */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">当前情感状态</p>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-muted/40 border border-border/50">
                  {Object.entries(STATES).map(([key, s]) => {
                    const isActive = currentState === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
                          setCurrentState(key);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                          isActive
                            ? `state-bg-${key} state-${key} ring-1.5 ring-primary/40 shadow-xs`
                            : "text-muted-foreground hover:text-foreground hover:bg-card/80 border border-border/30"
                        }`}
                        title={s.desc}
                      >
                        <span className="text-sm">{s.emoji}</span>
                        <span className="text-xs truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">沉浸与感知</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { navigate(`/scenes/${personaId}`); setShowMobileWorkbench(false); }}
                    className={`p-3 rounded-2xl border flex items-center gap-2.5 text-left transition-all ${
                      activeScene ? "bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400 font-semibold" : "bg-muted/40 hover:bg-muted border-border/60"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-chart-3/12 text-chart-3 flex items-center justify-center shrink-0">
                      <Theater className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">情境剧场</p>
                      <p className="text-[10px] text-muted-foreground truncate">{activeScene ? activeScene.name : "剧本与情境"}</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { setShowTimeline(true); setShowMobileWorkbench(false); }}
                    className="p-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border/60 flex items-center gap-2.5 text-left transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">记忆时间线</p>
                      <p className="text-[10px] text-muted-foreground truncate">关键回忆节点</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { setShowSourceLibrary(true); setShowMobileWorkbench(false); }}
                    className="p-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border/60 flex items-center gap-2.5 text-left transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                      <Database className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">资料库</p>
                      <p className="text-[10px] text-muted-foreground truncate">设定与背景</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { setShowEmotionReport(true); setShowMobileWorkbench(false); }}
                    className="p-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border/60 flex items-center gap-2.5 text-left transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">情绪报告</p>
                      <p className="text-[10px] text-muted-foreground truncate">心情波动曲线</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { navigate(`/diary/${personaId}`); setShowMobileWorkbench(false); }}
                    className="p-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border/60 flex items-center gap-2.5 text-left transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">对话日记</p>
                      <p className="text-[10px] text-muted-foreground truncate">每日情感日记</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { setShowDiagnostics(true); setShowMobileWorkbench(false); }}
                    className="p-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border/60 flex items-center gap-2.5 text-left transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">运行诊断</p>
                      <p className="text-[10px] text-muted-foreground truncate">内在状态与心智透视</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showGraduation} onClose={() => setShowGraduation(false)} />
    </div>
  );
}

// ─── SEARCH PANEL (RIGHT DRAWER) ──────────────────────────────────────────

function SearchPanel({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results, isLoading } = trpc.chat.search.useQuery(
    { personaId, query: debouncedQuery },
    { enabled: debouncedQuery.length > 0 }
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val.trim()), 250);
  };

  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-primary/25 text-primary font-semibold rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  const handleJump = (msgId: number | string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-3xl", "transition-all", "duration-500");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "rounded-3xl");
      }, 2500);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in" onClick={onClose}>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity" />

      {/* Right Drawer */}
      <aside
        className="relative z-10 w-full sm:w-[420px] h-full bg-card/95 dark:bg-card/90 backdrop-blur-2xl border-l border-border/80 shadow-2xl flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8.5 h-8.5 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/15 shadow-2xs">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">搜索历史消息</h3>
              <p className="text-[11px] text-muted-foreground">
                {debouncedQuery && results ? `找到 ${results.length} 条相关消息` : "检索与 TA 的过往对话"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Input Bar */}
        <div className="p-4 border-b border-border/50 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              autoFocus
              placeholder="输入关键词搜索聊天记录..."
              className="w-full h-11 pl-10 pr-9 bg-background/90 border border-border/80 focus:border-primary/50 focus:ring-2 focus:ring-primary/15 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all shadow-2xs"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setDebouncedQuery("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Results Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {!debouncedQuery ? (
            <div className="text-center py-20 text-muted-foreground/70 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground/50 border border-border/40">
                <Search className="w-5 h-5" />
              </div>
              <p className="text-xs">在上方输入关键词检索对话</p>
            </div>
          ) : isLoading ? (
            <div className="text-center py-20 text-muted-foreground space-y-2.5">
              <Loader2 className="w-7 h-7 mx-auto animate-spin text-primary/70" />
              <p className="text-xs">正在搜索相关消息...</p>
            </div>
          ) : results && results.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <X className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-xs">未找到包含 “{debouncedQuery}” 的消息</p>
            </div>
          ) : (
            results?.map((m: any) => (
              <div
                key={m.id}
                onClick={() => handleJump(m.id)}
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
                    {m.role === "user" ? "我" : "TA"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground font-mono">
                    {formatBeijingDate(m.createdAt)} {formatBeijingTime(m.createdAt)}
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-foreground/90 line-clamp-3 leading-relaxed">
                  {highlight(m.content, debouncedQuery)}
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

// ─── MEMORY GOVERNANCE ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string; badgeBg: string; textCol: string; borderCol: string; emoji: string }> = {
  milestone: { label: "里程碑", color: "bg-amber-500", badgeBg: "bg-amber-500/10", textCol: "text-amber-600 dark:text-amber-400", borderCol: "border-amber-500/20", emoji: "👑" },
  memory: { label: "记忆", color: "bg-primary", badgeBg: "bg-primary/10", textCol: "text-primary", borderCol: "border-primary/20", emoji: "🌸" },
  anniversary: { label: "纪念日", color: "bg-rose-500", badgeBg: "bg-rose-500/10", textCol: "text-rose-600 dark:text-rose-400", borderCol: "border-rose-500/20", emoji: "💖" },
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_fact: "用户事实",
  relationship_event: "关系事件",
  promise: "承诺约定",
  preference: "偏好习惯",
  emotional_moment: "情绪节点",
  conflict: "冲突修复",
  open_loop: "未完成话题",
  persona_background: "人物背景",
  source_fact: "原著资料",
  daily_summary: "每日总结",
};

const MEMORY_SOURCE_LABELS: Record<string, string> = {
  manual: "手动添加",
  chat: "日常对话",
  daily_summary: "每日整理",
  source_material: "资料沉淀",
  import: "外部导入",
  system: "系统生成",
};

const MEMORY_STATUS_LABELS: Record<string, { label: string; tone: string; dot: string }> = {
  active: { label: "有效", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
  archived: { label: "已归档", tone: "bg-muted text-muted-foreground border-border/50", dot: "bg-muted-foreground/60" },
  contradicted: { label: "已标错", tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20", dot: "bg-rose-500" },
};

const MEMORY_TYPES = Object.entries(MEMORY_TYPE_LABELS);
const MEMORY_SOURCES = Object.entries(MEMORY_SOURCE_LABELS);
const MEMORY_STATUSES = Object.entries(MEMORY_STATUS_LABELS);

type MemoryFormState = {
  title: string;
  description: string;
  category: "memory" | "anchor" | "milestone" | "anniversary";
  date: string;
  source: string;
  memoryType: string;
  importance: number;
  confidence: number;
  keywords: string;
  emotion: string;
  status: "active" | "archived" | "contradicted";
  revision?: number;
};

function keywordText(value: unknown): string {
  return Array.isArray(value)
    ? value
      .filter(item => typeof item === "string" || typeof item === "number")
      .map(String)
      .join("、")
    : "";
}

function emptyMemoryForm(): MemoryFormState {
  return {
    title: "",
    description: "",
    category: "memory",
    date: "",
    source: "manual",
    memoryType: "relationship_event",
    importance: 3,
    confidence: 3,
    keywords: "",
    emotion: "",
    status: "active",
  };
}

function memoryToForm(memory: any): MemoryFormState {
  return {
    title: memory.title || "",
    description: memory.description || "",
    category: memory.category || "memory",
    date: memory.date || "",
    source: memory.source || "manual",
    memoryType: memory.memoryType || "relationship_event",
    importance: memory.importance ?? 3,
    confidence: memory.confidence ?? 3,
    keywords: keywordText(memory.keywords),
    emotion: memory.emotion || "",
    status: memory.status || "active",
    revision: memory.revision,
  };
}

function splitKeywords(text: string): string[] | undefined {
  const values = Array.from(new Set(
    text
      .split(/[,\n，、]/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => Array.from(item).slice(0, 24).join("")),
  )).slice(0, 12);
  return values.length > 0 ? values : undefined;
}

function memoryPayload(form: MemoryFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    category: form.category,
    date: form.date || undefined,
    source: form.source as any,
    memoryType: form.memoryType as any,
    importance: Number(form.importance),
    confidence: Number(form.confidence),
    keywords: splitKeywords(form.keywords),
    emotion: form.emotion.trim() || undefined,
    status: form.status,
  };
}

function MemoryTimeline({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const extractOperation = useRef<{ personaId: number; id: string } | null>(null);
  const extractInFlight = useRef(false);
  const { data: memories, refetch, isFetching: memoriesFetching } = trpc.memory.list.useQuery({ personaId });
  const createMutation = trpc.memory.create.useMutation({
    onSuccess: () => {
      refetch();
      setShowAdd(false);
      setForm(emptyMemoryForm());
      toast.success("记忆已添加");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.memory.update.useMutation({
    onSuccess: () => {
      refetch();
      setEditingId(null);
      toast.success("记忆已更新");
    },
    onError: (e: any, input) => {
      if (e.data?.code === "CONFLICT") {
        void refetch();
        if (input.id === editingId) setFormConflict(true);
        toast.error("记忆已有新版本，当前编辑已保留，请重新审阅");
      } else {
        toast.error(e.message);
      }
    },
  });
  const deleteMutation = trpc.memory.delete.useMutation({ onSuccess: () => { refetch(); toast.success("记忆已删除"); } });
  const extractMutation = trpc.memory.autoExtract.useMutation({
    onSuccess: (data) => {
      extractOperation.current = null;
      void utils.memoryReview.list.invalidate({ personaId, status: "pending" });
      toast.success(`生成${data.extracted.length}条待审阅候选，尚未应用`);
    },
    onError: (e: any) => {
      if (e.data?.code === "CONFLICT") {
        void utils.memoryReview.list.invalidate({ personaId, status: "pending" });
        toast.error("提取请求发生冲突，请刷新候选后重新审阅");
      } else {
        toast.error(e.message);
      }
    },
    onSettled: () => { extractInFlight.current = false; },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MemoryFormState>(emptyMemoryForm());
  const [formConflict, setFormConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "all" | "high_importance" | "low_confidence" | "archived" | "contradicted">("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const stats = useMemo(() => {
    const list = memories ?? [];
    return {
      total: list.length,
      active: list.filter((memory: any) => (memory.status || "active") === "active").length,
      lowConfidence: list.filter((memory: any) => (memory.confidence ?? 3) <= 2).length,
      highImportance: list.filter((memory: any) => (memory.importance ?? 3) >= 4).length,
      archived: list.filter((memory: any) => memory.status === "archived").length,
      contradicted: list.filter((memory: any) => memory.status === "contradicted").length,
    };
  }, [memories]);

  const filteredMemories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (memories ?? []).filter((memory: any) => {
      const status = memory.status || "active";
      if (activeTab === "active" && status !== "active") return false;
      if (activeTab === "archived" && status !== "archived") return false;
      if (activeTab === "contradicted" && status !== "contradicted") return false;
      if (activeTab === "low_confidence" && (memory.confidence ?? 3) > 2) return false;
      if (activeTab === "high_importance" && (memory.importance ?? 3) < 4) return false;

      if (typeFilter !== "all" && (memory.memoryType || "relationship_event") !== typeFilter) return false;
      if (sourceFilter !== "all" && (memory.source || "manual") !== sourceFilter) return false;
      if (!q) return true;
      return [
        memory.title,
        memory.description,
        memory.date,
        memory.emotion,
        memory.memoryType,
        memory.source,
        keywordText(memory.keywords),
      ].filter(Boolean).join("\n").toLowerCase().includes(q);
    });
  }, [memories, query, activeTab, typeFilter, sourceFilter]);

  const startAdd = () => {
    setFormConflict(false);
    setEditingId(null);
    setForm(emptyMemoryForm());
    setShowAdd(true);
  };

  const startEdit = (memory: any) => {
    setFormConflict(false);
    setShowAdd(false);
    setEditingId(memory.id);
    setForm(memoryToForm(memory));
  };

  const cancelForm = () => {
    setFormConflict(false);
    setShowAdd(false);
    setEditingId(null);
    setForm(emptyMemoryForm());
  };

  const saveForm = () => {
    if (!form.title.trim() || formConflict) return;
    if (editingId) {
      if (!Number.isSafeInteger(form.revision)) {
        toast.error("缺少记忆版本，请刷新并重新打开编辑");
        void refetch();
        return;
      }
      updateMutation.mutate({ id: editingId, ...memoryPayload(form), expectedRevision: form.revision });
    } else {
      createMutation.mutate({ personaId, ...memoryPayload(form) });
    }
  };

  const updateStatus = (memory: any, status: "active" | "archived" | "contradicted") => {
    if (updateMutation.isPending) return;
    if (!Number.isSafeInteger(memory.revision)) {
      toast.error("缺少记忆版本，请刷新后重试");
      void refetch();
      return;
    }
    updateMutation.mutate({
      id: memory.id,
      expectedRevision: memory.revision,
      status,
      confidence: status === "contradicted" ? 1 : memory.confidence ?? 3,
    });
  };

  const selectedMemory = editingId ? (memories ?? []).find((memory: any) => memory.id === editingId) : null;
  const showingForm = showAdd || Boolean(editingId);
  const selectedEvidenceText = keywordText((selectedMemory as any)?.evidenceMessageIds);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border/60 bg-card shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-chart-3/12 text-chart-3 flex items-center justify-center shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">记忆时间轴 & 档案</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 shadow-2xs">
                  {stats.active} 条有效
                </span>
                {stats.lowConfidence > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                    {stats.lowConfidence} 条待核验
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                记录故事事实、角色偏好、事件约定与关键节点
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                if (extractInFlight.current) return;
                if (extractOperation.current?.personaId !== personaId) {
                  extractOperation.current = { personaId, id: crypto.randomUUID() };
                }
                extractInFlight.current = true;
                extractMutation.mutate({ personaId, operationId: extractOperation.current.id });
              }}
              disabled={extractMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-gradient-to-r from-primary/15 to-chart-3/15 text-primary hover:from-primary/25 hover:to-chart-3/25 border border-primary/25 rounded-xl transition-all shadow-2xs disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${extractMutation.isPending ? "animate-spin" : ""}`} />
              {extractMutation.isPending ? "AI 提取中..." : "AI 提取候选"}
            </button>
            <button
              onClick={startAdd}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl transition-all shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              添加记忆
            </button>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="px-6 py-3 border-b border-border/60 bg-card space-y-2.5 shrink-0 z-10">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-xs">
            <button
              onClick={() => setActiveTab("active")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "active"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              有效记忆 ({stats.active})
            </button>
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              全部 ({stats.total})
            </button>
            <button
              onClick={() => setActiveTab("high_importance")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "high_importance"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              ⭐ 高重要 ({stats.highImportance})
            </button>
            <button
              onClick={() => setActiveTab("low_confidence")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "low_confidence"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              ⚠️ 低可信 ({stats.lowConfidence})
            </button>
            <button
              onClick={() => setActiveTab("archived")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "archived"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              📦 已归档 ({stats.archived})
            </button>
            <button
              onClick={() => setActiveTab("contradicted")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all shrink-0 ${
                activeTab === "contradicted"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              ❌ 已标错 ({stats.contradicted})
            </button>
          </div>

          {/* Search & Secondary Filter Selects */}
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索记忆标题、事实细节、关键词、情绪..."
                className="w-full h-9.5 pl-9.5 pr-8 bg-muted/40 border border-border/70 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/15 transition-all shadow-2xs"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-9.5 px-3 bg-background/80 border border-border/70 rounded-xl text-xs text-foreground outline-none focus:border-primary/50 transition-all shadow-2xs"
              >
                <option value="all">全部类型</option>
                {MEMORY_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-9.5 px-3 bg-background/80 border border-border/70 rounded-xl text-xs text-foreground outline-none focus:border-primary/50 transition-all shadow-2xs"
              >
                <option value="all">全部来源</option>
                {MEMORY_SOURCES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Content Stream */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 panel-scrollbar">
          <MemoryReviewCandidates key={personaId} personaId={personaId} />
          {showingForm && (
            <div className="p-5 bg-card border-2 border-primary/25 rounded-3xl space-y-4 shadow-lg animate-scale-in">
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Pencil className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-bold text-foreground">
                    {editingId ? `编辑记忆 #${editingId}` : "添加新记忆"}
                  </span>
                </div>
                <button onClick={cancelForm} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-foreground/80 mb-1 block">标题 / 核心结论 *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="简练明确的记忆摘要，例如：喜欢吃日料且不吃香菜"
                    className="w-full h-10 px-3.5 bg-background border border-border/80 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground/80 mb-1 block">事实细节与对话上下文</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="详细描述该记忆的具体内容、触发场景或约定细则..."
                    rows={3}
                    className="w-full px-3.5 py-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 resize-none leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">分类类别</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as MemoryFormState["category"] }))}
                      className="w-full h-9 px-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground"
                    >
                      <option value="memory">🌸 记忆</option>
                      <option value="anchor">📌 事实锚点</option>
                      <option value="milestone">👑 里程碑</option>
                      <option value="anniversary">💖 纪念日</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">发生日期</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full h-9 px-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">记忆类型</label>
                    <select
                      value={form.memoryType}
                      onChange={(e) => setForm((f) => ({ ...f, memoryType: e.target.value }))}
                      className="w-full h-9 px-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground"
                    >
                      {MEMORY_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">记忆来源</label>
                    <select
                      value={form.source}
                      onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                      className="w-full h-9 px-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground"
                    >
                      {MEMORY_SOURCES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5 p-3 rounded-2xl bg-muted/20 border border-border/40">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground font-medium">重要度</span>
                      <span className="font-bold text-primary">{form.importance} / 5</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={form.importance}
                      onChange={(e) => setForm((f) => ({ ...f, importance: Number(e.target.value) }))}
                      className="w-full accent-primary"
                    />
                  </div>

                  <div className="space-y-1.5 p-3 rounded-2xl bg-muted/20 border border-border/40">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground font-medium">可信度</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{form.confidence} / 5</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={form.confidence}
                      onChange={(e) => setForm((f) => ({ ...f, confidence: Number(e.target.value) }))}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">关键词 (顿号或逗号分隔)</label>
                    <input
                      value={form.keywords}
                      onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
                      placeholder="例：日料、饮食偏好、周末"
                      className="w-full h-9 px-3 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">情绪色彩</label>
                    <input
                      value={form.emotion}
                      onChange={(e) => setForm((f) => ({ ...f, emotion: e.target.value }))}
                      placeholder="例：温馨、期待、认真"
                      className="w-full h-9 px-3 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50"
                    />
                  </div>
                </div>

                {selectedEvidenceText && (
                  <p className="text-[11px] text-muted-foreground font-mono bg-muted/30 p-2 rounded-lg">
                    关联证据消息：{selectedEvidenceText}
                  </p>
                )}
              </div>

              {formConflict && (
                <div role="alert" className="space-y-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <p>记忆版本已变化。当前编辑已保留，请重新核对最新版本后保存。</p>
                  <button disabled={memoriesFetching || !selectedMemory || (selectedMemory as any).revision === form.revision} className="underline disabled:opacity-50" onClick={() => selectedMemory && startEdit(selectedMemory)}>载入最新版本（放弃当前编辑）</button>
                </div>
              )}
              <div className="flex gap-2.5 justify-end pt-2 border-t border-border/40">
                <button
                  onClick={cancelForm}
                  className="text-xs px-4 py-2 text-muted-foreground hover:text-foreground font-medium rounded-xl hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={saveForm}
                  disabled={!form.title.trim() || formConflict || createMutation.isPending || updateMutation.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl disabled:opacity-50 transition-all shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存记忆
                </button>
              </div>
            </div>
          )}

          {(!memories || memories.length === 0) && !showingForm && (
            <div className="text-center py-20 text-muted-foreground space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <Clock className="w-7 h-7 opacity-40" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">暂无记忆档案</p>
                <p className="text-xs text-muted-foreground mt-1">开始与 TA 聊天，或点击上方 “AI 提取候选” 后逐条审阅</p>
              </div>
            </div>
          )}

          {filteredMemories.length === 0 && memories && memories.length > 0 && !showingForm && (
            <div className="text-center py-16 text-muted-foreground space-y-2">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <Filter className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-xs">当前筛选条件下暂无记忆</p>
            </div>
          )}

          <div className="space-y-3.5">
            {filteredMemories.map((m: any) => {
              const cat = m.category === "anchor"
                ? { ...CATEGORY_LABELS.memory, label: "事实锚点", emoji: "📌" }
                : CATEGORY_LABELS[m.category] || CATEGORY_LABELS.memory;
              const status = MEMORY_STATUS_LABELS[m.status || "active"] || MEMORY_STATUS_LABELS.active;
              const typeLabel = MEMORY_TYPE_LABELS[m.memoryType || "relationship_event"] || m.memoryType || "记忆";
              const sourceLabel = MEMORY_SOURCE_LABELS[m.source || "manual"] || m.source || "未知";
              const lowConfidence = (m.confidence ?? 3) <= 2;
              const keywordsList = Array.isArray(m.keywords) ? m.keywords : (m.keywords ? String(m.keywords).split(/[,，、]/) : []);

              return (
                <div
                  key={m.id}
                  className="group/card relative rounded-2xl border border-border/60 bg-card hover:bg-muted/20 p-4.5 transition-all shadow-2xs space-y-3"
                >
                  {/* Left Color Indicator */}
                  <div className={`absolute top-4 bottom-4 left-0 w-1 rounded-r-full ${cat.color}`} />

                  {/* Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Status */}
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${status.tone}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>

                      {/* Category */}
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cat.badgeBg} ${cat.textCol} ${cat.borderCol}`}>
                        <span>{cat.emoji}</span>
                        {cat.label}
                      </span>

                      {/* Type */}
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40">
                        {typeLabel}
                      </span>

                      {/* Source */}
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground/80">
                        {sourceLabel}
                      </span>

                      {/* Date */}
                      {m.date && (
                        <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1 ml-1">
                          <Calendar className="w-3 h-3 text-muted-foreground/60" />
                          {m.date}
                        </span>
                      )}
                    </div>

                    {/* Metric Stars */}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-0.5" title={`重要度: ${m.importance ?? 3}/5`}>
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                        <span className="font-semibold text-foreground">{m.importance ?? 3}</span>
                      </div>
                      <div className="flex items-center gap-1" title={`可信度: ${m.confidence ?? 3}/5`}>
                        <span className="text-[10px] text-muted-foreground">可信</span>
                        <span className={`font-bold ${lowConfidence ? "text-rose-500 font-extrabold" : "text-foreground"}`}>
                          {m.confidence ?? 3}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Title & Body */}
                  <div className="pl-2 space-y-1.5">
                    <h4 className="text-sm sm:text-[15px] font-bold text-foreground tracking-tight leading-snug">
                      {m.title}
                    </h4>
                    {m.description && (
                      <p className="text-xs sm:text-[13px] text-foreground/85 leading-relaxed bg-muted/20 rounded-xl p-3 border border-border/40">
                        {m.description}
                      </p>
                    )}
                  </div>

                  {/* Keywords & Tags */}
                  {(keywordsList.length > 0 || m.emotion) && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-2 pt-0.5">
                      {m.emotion && (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-chart-4/10 text-chart-4 font-medium border border-chart-4/20">
                          情绪: {m.emotion}
                        </span>
                      )}
                      {keywordsList.filter(Boolean).map((kw: string, i: number) => (
                        <span key={i} className="text-[10.5px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-medium">
                          #{kw.trim()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Action Toolbar */}
                  <div className="flex items-center justify-between gap-2 pl-2 pt-2 border-t border-border/40">
                    <span className="text-[10.5px] text-muted-foreground/60 font-mono">
                      ID: #{m.id}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => startEdit(m)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-muted/60 hover:bg-primary/10 hover:text-primary text-foreground font-medium transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                        编辑
                      </button>

                      {(m.status || "active") !== "active" ? (
                        <button
                          onClick={() => updateStatus(m, "active")}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium transition-all"
                        >
                          <RotateCcw className="w-3 h-3" />
                          恢复有效
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => updateStatus(m, "archived")}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground font-medium transition-all"
                          >
                            <Archive className="w-3 h-3" />
                            归档
                          </button>
                          <button
                            onClick={() => updateStatus(m, "contradicted")}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-medium transition-all"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            标错
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => deleteMutation.mutate({ id: m.id })}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-xl text-muted-foreground/70 hover:text-rose-600 hover:bg-rose-500/10 transition-all ml-1"
                        title="删除记忆"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SOURCE LIBRARY ──────────────────────────────────────────────────────────

function formatCount(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "0";
}

function excerptText(text: string, limit = 220): string {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return `${chars.slice(0, limit).join("")}...`;
}

function SourceLibraryPanel({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const [queryInput, setQueryInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const { data, isLoading, refetch } = trpc.sourceLibrary.overview.useQuery({ personaId, query: submittedQuery });
  const sources = data?.sources ?? [];
  const results = data?.search?.results ?? [];

  const runSearch = () => setSubmittedQuery(queryInput.trim());
  const clearSearch = () => {
    setQueryInput("");
    setSubmittedQuery("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border/60 bg-card shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-chart-4/12 text-chart-4 flex items-center justify-center shadow-xs">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">资料库 & 原著知识沉淀</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-chart-4/10 text-chart-4 font-semibold border border-chart-4/20">
                  {formatCount(data?.stats?.sourceCount)} 个来源 / {formatCount(data?.stats?.chunkCount)} 个片段
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                原著设定、背景档案与检索召回中枢（RAG 证据源）
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-muted/60 hover:bg-muted text-foreground border border-border/60 rounded-xl transition-all disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              刷新资料
            </button>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Overview Stats Bar & Search */}
        <div className="px-6 py-3.5 border-b border-border/60 bg-card space-y-3 shrink-0 z-10">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-2xl bg-card/80 border border-border/70 p-3 shadow-2xs">
              <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block">知识来源</span>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatCount(data?.stats?.sourceCount)}</p>
            </div>
            <div className="rounded-2xl bg-card/80 border border-border/70 p-3 shadow-2xs">
              <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block">切片片段</span>
              <p className="text-lg font-bold text-primary mt-0.5">{formatCount(data?.stats?.chunkCount)}</p>
            </div>
            <div className="rounded-2xl bg-card/80 border border-border/70 p-3 shadow-2xs">
              <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block">结构章节</span>
              <p className="text-lg font-bold text-chart-3 mt-0.5">{formatCount(data?.stats?.chapterCount)}</p>
            </div>
            <div className="rounded-2xl bg-card/80 border border-border/70 p-3 shadow-2xs">
              <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block">估算 Tokens</span>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatCount(data?.stats?.tokenEstimate)}</p>
            </div>
          </div>

          {/* Search Box */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                placeholder="检索原著设定、名台词或剧情片段..."
                className="w-full h-10 pl-10 pr-9 bg-muted/40 border border-border/70 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/15 transition-all shadow-2xs"
              />
              {queryInput && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={runSearch}
              disabled={!queryInput.trim()}
              className="h-10 px-5 bg-primary text-primary-foreground font-semibold rounded-xl text-xs disabled:opacity-50 transition-all shadow-2xs hover:bg-primary/90"
            >
              检索
            </button>
          </div>

          {/* Hot Keywords */}
          {Boolean(data?.topKeywords?.length) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10.5px] text-muted-foreground font-medium mr-1">推荐关键词:</span>
              {data!.topKeywords.slice(0, 10).map((keyword: string) => (
                <button
                  key={keyword}
                  onClick={() => {
                    setQueryInput(keyword);
                    setSubmittedQuery(keyword);
                  }}
                  className="text-[10.5px] font-medium px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all border border-border/40"
                >
                  #{keyword}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Stream */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 panel-scrollbar">
          {isLoading && (
            <div className="text-center py-16 text-muted-foreground space-y-3">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary/70" />
              <p className="text-xs">正在读取资料库...</p>
            </div>
          )}

          {!isLoading && sources.length === 0 && (
            <div className="text-center py-16 text-muted-foreground space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <BookOpen className="w-7 h-7 opacity-40" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">暂无资料库内容</p>
                <p className="text-xs text-muted-foreground mt-1">导入原著或设定文档后，会自动在此建立知识索引</p>
              </div>
            </div>
          )}

          {/* Search Results Preview */}
          {submittedQuery && !isLoading && (
            <section className="rounded-2xl border-2 border-primary/25 bg-card p-4.5 space-y-3 shadow-sm animate-scale-in">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <p className="text-sm font-bold text-foreground truncate">检索命中预览：“{submittedQuery}”</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-semibold">
                    {results.length > 0 ? `命中 ${results.length} 个知识切片` : "未匹配到证据"}
                  </span>
                  <button onClick={clearSearch} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">
                    清除
                  </button>
                </div>
              </div>

              {results.length === 0 ? (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  资料库中未找到匹配的原文片段。对话会提示角色说明证据不足；可换用作品中的关键词再次检索。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {results.map((chunk: any) => (
                    <div key={chunk.id} className="rounded-xl bg-muted/25 border border-border/60 p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                            {chunk.sourceTitle}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {chunk.chapterTitle || `片段 #${chunk.chunkIndex + 1}`}
                          </span>
                        </div>
                        <span className="text-[10.5px] font-mono text-muted-foreground">
                          词法匹配分数: {chunk.score}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/90 leading-relaxed bg-background/80 p-3 rounded-xl border border-border/40">
                        {excerptText(chunk.content)}
                      </p>
                      {Boolean(chunk.matchedTerms?.length) && (
                        <p className="text-[10.5px] text-muted-foreground">
                          匹配词：<span className="font-semibold text-foreground">{keywordText(chunk.matchedTerms)}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Sources List */}
          {sources.map((source: any) => (
            <section
              key={source.id}
              className="relative rounded-2xl border border-border/70 bg-card p-4.5 transition-all duration-200 shadow-2xs hover:shadow-xs space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-chart-4 shrink-0" />
                    <p className="text-sm font-bold text-foreground truncate">{source.title}</p>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/40">
                      ID: #{source.id}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate pl-6">
                    {source.sourceType} {source.originalName ? `· ${source.originalName}` : ""}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-muted/30 p-2.5 text-center">
                  <p className="text-sm font-bold text-foreground">{formatCount(source.chunkCount)}</p>
                  <p className="text-[10px] text-muted-foreground">切片片段</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-2.5 text-center">
                  <p className="text-sm font-bold text-foreground">{formatCount(source.chapterCount)}</p>
                  <p className="text-[10px] text-muted-foreground">包含章节</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-2.5 text-center">
                  <p className="text-sm font-bold text-foreground">{formatCount(source.tokenEstimate)}</p>
                  <p className="text-[10px] text-muted-foreground">估算令牌规模</p>
                </div>
              </div>

              {Boolean(source.topKeywords?.length) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {source.topKeywords.map((keyword: string) => (
                    <button
                      key={keyword}
                      onClick={() => {
                        setQueryInput(keyword);
                        setSubmittedQuery(keyword);
                      }}
                      className="text-[10.5px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted font-medium transition-colors"
                    >
                      #{keyword}
                    </button>
                  ))}
                </div>
              )}

              {Boolean(source.chapters?.length) && (
                <div className="overflow-hidden rounded-xl border border-border/60 divide-y divide-border/40 bg-muted/10">
                  {source.chapters.map((chapter: any) => (
                    <div key={`${source.id}-${chapter.title}`} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
                      <span className="text-foreground font-medium truncate">{chapter.title}</span>
                      <span className="text-muted-foreground font-mono text-[11px] shrink-0">{formatCount(chapter.chunkCount)} 段</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border/60 bg-muted/10 shrink-0">
          <p className="text-[11px] text-muted-foreground text-center">
            按关键词及相邻片段检索 · 普通角色对话可引用原文 · 上传页管理资料
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── EMOTION REPORT ──────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  warm: "var(--color-chart-1)",
  playful: "var(--color-chart-2)",
  nostalgic: "var(--color-chart-3)",
  melancholy: "var(--color-muted-foreground)",
  happy: "var(--color-chart-5)",
  distant: "var(--color-chart-4)",
};

function EmotionReport({ personaId, personaName, onClose }: { personaId: number; personaName: string; onClose: () => void }) {
  const [days, setDays] = useState(30);
  const { data: report, isLoading } = trpc.emotion.getReport.useQuery({ personaId, days });

  const chartData = (report?.snapshots || []).map((s: any) => ({
    date: s.date,
    value: Object.keys(STATES).indexOf(s.emotionalState) + 1,
    state: s.emotionalState,
    label: STATES[s.emotionalState]?.label || s.emotionalState,
    messages: s.messageCount,
  }));

  const pieData = (report?.distribution || []).map((d: any) => ({
    name: STATES[d.emotionalState]?.label || d.emotionalState,
    value: Number(d.count),
    fill: STATE_COLORS[d.emotionalState] || "#999",
  }));

  const mostCommon = pieData.length > 0 ? pieData.reduce((a: any, b: any) => a.value > b.value ? a : b) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border/60 bg-card shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-xs">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground tracking-tight">{personaName} 的心境波动与情绪档案</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                基于对话情感标注的每日心境走势与分布画像
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-muted/60 p-0.5 rounded-xl border border-border/60">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                    days === d
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d}天
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Content Stream */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 panel-scrollbar">
          {/* Key Metrics Dashboard */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-muted/30 border border-border/60 p-3.5 text-center shadow-2xs">
              <span className="text-[11px] font-bold text-muted-foreground block">连续记录天数</span>
              <p className="text-2xl font-extrabold text-foreground mt-1">{report?.totalDays || 0}</p>
            </div>
            <div className="rounded-2xl bg-muted/30 border border-border/60 p-3.5 text-center shadow-2xs">
              <span className="text-[11px] font-bold text-muted-foreground block">累计交互消息</span>
              <p className="text-2xl font-extrabold text-primary mt-1">{report?.totalMessages || 0}</p>
            </div>
            <div className="rounded-2xl bg-muted/30 border border-border/60 p-3.5 text-center shadow-2xs">
              <span className="text-[11px] font-bold text-muted-foreground block">主导核心心境</span>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <span className="text-xl">
                  {mostCommon ? STATES[Object.keys(STATE_COLORS).find((k) => STATE_COLORS[k] === mostCommon.fill) || ""]?.emoji || "🌸" : "🌸"}
                </span>
                <span className="text-sm font-bold text-foreground">{mostCommon?.name || "温柔"}</span>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-16 text-muted-foreground space-y-3">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary/70" />
              <p className="text-xs">正在分析心境走势...</p>
            </div>
          ) : chartData.length > 0 ? (
            <>
              {/* Trend Chart */}
              <div className="rounded-2xl border border-border/70 bg-card p-4.5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-foreground">情绪波动趋势曲线</p>
                  <span className="text-[11px] text-muted-foreground">柱体高低与色彩代表每日主心境</span>
                </div>

                <div className="h-44 flex items-end gap-1.5 pt-4 pb-1 px-1 bg-muted/15 rounded-xl border border-border/40">
                  {chartData.map((d: any, i: number) => (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center gap-1.5 group/bar relative h-full justify-end"
                      title={`${d.date}: ${d.label} (${d.messages} 条消息)`}
                    >
                      {/* Tooltip on hover */}
                      <div className="absolute bottom-full mb-1 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded-md shadow-md whitespace-nowrap z-20">
                        {d.date}: {d.label} ({d.messages} 条)
                      </div>
                      <div
                        className="w-full rounded-t-lg transition-all group-hover/bar:brightness-110 shadow-2xs"
                        style={{
                          height: `${Math.max(12, (d.value / 6) * 100)}%`,
                          backgroundColor: STATE_COLORS[d.state] || "var(--color-primary)",
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-between text-[10.5px] font-mono text-muted-foreground px-1">
                  <span>{chartData[0]?.date}</span>
                  <span>{chartData[chartData.length - 1]?.date}</span>
                </div>
              </div>

              {/* Distribution Breakdown */}
              <div className="rounded-2xl border border-border/70 bg-card p-4.5 space-y-3 shadow-2xs">
                <p className="text-sm font-bold text-foreground">心境分布占比</p>
                <div className="space-y-2.5">
                  {pieData.map((d: any) => {
                    const total = pieData.reduce((s: number, p: any) => s + p.value, 0);
                    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs font-semibold text-foreground w-12">{d.name}</span>
                        <div className="flex-1 h-2.5 bg-muted/60 rounded-full overflow-hidden border border-border/30">
                          <div
                            className="h-full rounded-full transition-all duration-500 shadow-2xs"
                            style={{ width: `${pct}%`, backgroundColor: d.fill }}
                          />
                        </div>
                        <span className="text-xs font-bold font-mono text-muted-foreground w-10 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-muted-foreground space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/40">
                <BarChart3 className="w-6 h-6 opacity-40" />
              </div>
              <p className="text-xs">暂无情绪记录，与 TA 产生更多对话后将自动生成情绪曲线</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DIARY MODAL (EMBEDDED FLOATING MODAL) ──────────────────────────────────

function DiaryModal({ personaId, personaName, onClose }: { personaId: number; personaName: string; onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: diaryDates, refetch: refetchDates } = trpc.diary.getDates.useQuery(
    { personaId },
    { enabled: !!personaId }
  );
  const { data: missingDates, refetch: refetchMissingDates } = trpc.diary.getMissingDates.useQuery(
    { personaId },
    { enabled: !!personaId }
  );
  const { data: entries, refetch: refetchEntries } = trpc.diary.list.useQuery(
    { personaId },
    { enabled: !!personaId }
  );
  const { data: dayEntry } = trpc.diary.getByDate.useQuery(
    { personaId, date: selectedDate || "" },
    { enabled: !!personaId && !!selectedDate }
  );

  const generateMutation = trpc.diary.generate.useMutation({
    onSuccess: () => {
      toast.success("今日日记生成成功");
      void refetchDates();
      void refetchEntries();
      void refetchMissingDates();
    },
    onError: (e: any) => toast.error("生成失败：" + e.message),
  });

  const generateAllMissingMutation = trpc.diary.generateAllMissing.useMutation({
    onSuccess: (res) => {
      toast.success(`成功补全 ${res.count} 篇未填写的历史日记`);
      void refetchDates();
      void refetchEntries();
      void refetchMissingDates();
    },
    onError: (e: any) => toast.error("批量生成失败：" + e.message),
  });

  const deleteMutation = trpc.diary.delete.useMutation({
    onSuccess: () => {
      toast.success("日记已删除");
      setSelectedDate(null);
      void refetchDates();
      void refetchEntries();
      void refetchMissingDates();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const datesSet = new Set((diaryDates || []).map((d: any) => d.date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const activeEntry = selectedDate ? dayEntry : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl flex flex-col animate-modal-pop z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border/60 bg-card shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-xs">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground tracking-tight">{personaName} 的对话日记 & 心路日志</h3>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 shadow-2xs">
                  {entries?.length || 0} 篇日记
                </span>
                {missingDates && missingDates.length > 0 && (
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30 shadow-2xs">
                    {missingDates.length} 篇待补全
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                记录角色视角下的每日总结、情绪轨迹与故事片段
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {missingDates && missingDates.length > 0 && (
              <button
                onClick={() => generateAllMissingMutation.mutate({ personaId })}
                disabled={generateAllMissingMutation.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 rounded-xl transition-all shadow-xs disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${generateAllMissingMutation.isPending ? "animate-spin" : ""}`} />
                {generateAllMissingMutation.isPending ? "正在补全..." : `一键补全 ${missingDates.length} 篇日记`}
              </button>
            )}
            <button
              onClick={() => generateMutation.mutate({ personaId })}
              disabled={generateMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl transition-all shadow-xs disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              {generateMutation.isPending ? "生成中..." : "生成今日日记"}
            </button>
            <button
              onClick={onClose}
              className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ml-1"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Content Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 panel-scrollbar">
          {/* Calendar Box */}
          <div className="rounded-2xl border border-border/70 bg-card p-4.5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                {year}年{month + 1}月
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={prevMonth}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={nextMonth}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
              {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="h-9" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const hasDiary = datesSet.has(dateStr);
                const isSelected = selectedDate === dateStr;
                const isToday = now.toISOString().split("T")[0] === dateStr;

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    className={`h-9 rounded-xl flex flex-col items-center justify-center relative font-medium transition-all ${
                      isSelected
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : hasDiary
                        ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
                        : isToday
                        ? "border border-primary/40 text-primary font-bold"
                        : "text-foreground hover:bg-muted/60"
                    }`}
                  >
                    <span>{day}</span>
                    {hasDiary && !isSelected && (
                      <span className="w-1 h-1 rounded-full bg-primary absolute bottom-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Date Diary Detail */}
          {selectedDate && (
            <div className="rounded-2xl border-2 border-primary/25 bg-card p-5 space-y-4 shadow-md animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-foreground">📅 {selectedDate} 对话日记</span>
                  {activeEntry && (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
                      {activeEntry.messageCount} 条互动
                    </span>
                  )}
                </div>
                {activeEntry && (
                  <button
                    onClick={() => deleteMutation.mutate({ id: activeEntry.id })}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-600 px-2.5 py-1 rounded-lg hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                )}
              </div>

              {activeEntry ? (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="bg-muted/20 p-4 rounded-xl border border-border/40 text-sm text-foreground leading-relaxed">
                    <p className="font-semibold text-primary text-xs mb-1.5 uppercase tracking-wider">今日摘要</p>
                    {activeEntry.summary}
                  </div>

                  {/* Highlights */}
                  {Array.isArray(activeEntry.highlights) && activeEntry.highlights.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground/80 mb-2">✨ 亮点时刻</p>
                      <ul className="space-y-1.5">
                        {activeEntry.highlights.map((h: string, idx: number) => (
                          <li key={idx} className="text-xs sm:text-sm text-foreground/90 flex items-start gap-2 bg-muted/20 p-2.5 rounded-xl border border-border/30">
                            <span className="text-primary font-bold">•</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Quotes */}
                  {Array.isArray(activeEntry.quotes) && activeEntry.quotes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground/80 mb-2">💬 触动心语</p>
                      <div className="space-y-2">
                        {activeEntry.quotes.map((q: string, idx: number) => (
                          <p key={idx} className="text-xs sm:text-sm italic text-foreground/90 border-l-2 border-primary/40 pl-3 py-1 bg-primary/5 rounded-r-xl">
                            “{q}”
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reflection */}
                  {activeEntry.reflection && (
                    <div className="bg-muted/20 border border-border/40 p-3.5 rounded-xl text-xs sm:text-sm text-foreground/90 leading-relaxed">
                      <p className="font-semibold text-primary text-xs mb-1">🌙 TA 的心声反思</p>
                      {activeEntry.reflection}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs space-y-2">
                  <p>该日期尚未生成对话日记</p>
                  <button
                    onClick={() => generateMutation.mutate({ personaId, date: selectedDate })}
                    disabled={generateMutation.isPending}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    为该日期补写日记
                  </button>
                </div>
              )}
            </div>
          )}

          {/* All Entries List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground/80 uppercase tracking-wider">历史日记流</span>
              <span className="text-[11px] text-muted-foreground font-mono">共 {entries?.length || 0} 篇</span>
            </div>

            {(!entries || entries.length === 0) && (
              <div className="text-center py-12 text-muted-foreground text-xs space-y-2">
                <BookOpen className="w-8 h-8 mx-auto opacity-30" />
                <p>还没有日记记录，点击右上角 “生成今日日记” 开启记录吧</p>
              </div>
            )}

            {entries?.map((entry: any) => (
              <div
                key={entry.id}
                onClick={() => setSelectedDate(entry.date)}
                className={`p-4.5 rounded-2xl border transition-all cursor-pointer space-y-2.5 ${
                  selectedDate === entry.date
                    ? "border-primary/50 bg-primary/5 shadow-xs"
                    : "border-border/60 bg-card hover:bg-card/90 hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground font-mono">📅 {entry.date}</span>
                  <span className="text-[10.5px] text-muted-foreground font-mono">{entry.messageCount} 条消息</span>
                </div>
                <p className="text-xs sm:text-[13px] text-foreground/85 line-clamp-2 leading-relaxed">
                  {entry.summary}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
