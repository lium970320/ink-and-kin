import { Fragment, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { beijingDateKey, formatBeijingDate, formatBeijingTime } from "@/lib/beijing-time";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Send, Sparkles, ChevronDown, ChevronUp, Trash2, MoreVertical,
  Plus, Image, Mic, X, Play, Pause, Clock, BarChart3, Search, BookOpen, Theater,
  Volume2, Download, Activity, Archive, AlertTriangle, Filter, Pencil, RotateCcw, Save, Database,
  ListChecks, Layers, Info, PanelLeft, PanelLeftClose, LayoutGrid, User, Calendar,
  Star, Loader2, ChevronLeft, ChevronRight, Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import GraduationModal from "@/components/GraduationModal";
import PersonaStatePanel from "@/components/PersonaStatePanel";
import ChatHistoryManager from "@/components/ChatHistoryManager";
import SceneChatHistoryManager from "@/components/SceneChatHistoryManager";
import SceneContextPanel from "@/components/SceneContextPanel";
import MemoryReviewCandidates from "@/components/MemoryReviewCandidates";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CollapseSection,
  MotionDrawer,
  MotionModal,
  MotionPopover,
  SegmentedControl,
  SPRING_SILKY,
  SPRING_SNAPPY,
} from "@/components/ui/motion";

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
  animateIn?: boolean;
}

const STATES: Record<string, { label: string; emoji: string; desc: string }> = {
  warm:       { label: "温柔",  emoji: "🌸", desc: "温柔体贴，充满关怀" },
  playful:    { label: "俏皮",  emoji: "😄", desc: "轻松活泼，爱开玩笑" },
  nostalgic:  { label: "思念",  emoji: "🌙", desc: "有些想念，带着回忆" },
  melancholy: { label: "忧郁",  emoji: "🌧️", desc: "情绪低落，需要安慰" },
  happy:      { label: "开心",  emoji: "✨", desc: "心情很好，充满活力" },
  distant:    { label: "疏离",  emoji: "❄️", desc: "有些距离感，话不多" },
};

const VOICE_PLAYER_WAVE = [5, 9, 14, 8, 16, 12, 7, 15, 11, 14, 8, 6] as const;
const RECORDING_WAVE = [5, 10, 15, 8, 18, 12, 7, 16, 11, 19, 9, 14, 6, 17, 12, 8, 15, 10, 13, 6] as const;

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

function releaseChatAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.onplay = audio.onpause = audio.onended = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function VoicePlayer({ url, duration }: { url: string; duration?: number | null }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setPlaying(false);
    return () => {
      releaseChatAudio(audioRef.current);
      audioRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.onplay = () => setPlaying(true);
      audio.onpause = audio.onended = () => setPlaying(false);
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (!audio.paused) audio.pause();
    else void audio.play().catch((error: DOMException) => {
      if (error.name !== "AbortError" && audioRef.current === audio) toast.error("语音播放失败，请再试一次。");
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? "暂停语音" : "播放语音"}
      className="flex items-center gap-2.5 min-w-[136px] py-0.5 group/vp"
    >
      <span className="w-7 h-7 rounded-full bg-current/12 flex items-center justify-center shrink-0 transition-transform group-active/vp:scale-90">
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </span>
      <div className="flex-1 flex items-center gap-[3px] h-5" aria-hidden="true">
        {VOICE_PLAYER_WAVE.map((barHeight, i) => (
          <div
            key={i}
            className={`w-[3px] rounded-full bg-current/80 transition-opacity ${playing ? "animate-voice-wave" : "opacity-75"}`}
            style={{
              height: `${barHeight}px`,
              animationDelay: playing ? `${i * 0.07}s` : undefined,
            }}
          />
        ))}
      </div>
      {duration != null && (
        <span className="text-xs font-mono tabular-nums opacity-70">{Math.round(duration * 10) / 10}″</span>
      )}
    </button>
  );
}

function TTSButton({ text, enabled }: { text: string; enabled: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const operationRef = useRef<string | null>(null);
  const ttsMutation = trpc.chat.tts.useMutation({ retry: false });
  const { mutate: cancelOperation } = trpc.voiceConfig.cancelOperation.useMutation();

  useEffect(() => {
    setLoading(false);
    setPlaying(false);
    return () => {
      const operationId = operationRef.current;
      operationRef.current = null;
      if (operationId) cancelOperation({ operationId });
      releaseChatAudio(audioRef.current);
      audioRef.current = null;
    };
  }, [text, enabled, cancelOperation]);

  const play = (audio: HTMLAudioElement) => {
    void audio.play().catch((error: DOMException) => {
      if (error.name !== "AbortError" && audioRef.current === audio) toast.error("朗读音频播放失败，请再试一次。");
    });
  };

  const handlePlay = async () => {
    if (!enabled) return;
    if (operationRef.current) {
      const operationId = operationRef.current;
      operationRef.current = null;
      setLoading(false);
      cancelOperation({ operationId }, { onError: () => toast.error("取消请求未送达。") });
      return;
    }
    if (audioRef.current) {
      if (!audioRef.current.paused) audioRef.current.pause();
      else play(audioRef.current);
      return;
    }
    const operationId = crypto.randomUUID();
    operationRef.current = operationId;
    setLoading(true);
    try {
      const result = await ttsMutation.mutateAsync({ text: text.slice(0, 500), operationId });
      if (operationRef.current !== operationId) return;
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.onplay = () => setPlaying(true);
      audio.onpause = audio.onended = () => setPlaying(false);
      play(audio);
    } catch (error) {
      if (operationRef.current === operationId) {
        toast.error(error instanceof Error ? error.message : "语音生成失败。");
      }
    } finally {
      if (operationRef.current === operationId) {
        operationRef.current = null;
        setLoading(false);
      }
    }
  };

  const label = !enabled ? "手动朗读已关闭" : loading ? "取消朗读生成" : playing ? "暂停朗读" : "朗读消息";
  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={!enabled}
      title={label}
      aria-label={label}
      className={`p-1 rounded-lg transition-all flex items-center gap-1 ${
        playing
          ? "text-primary bg-primary/10"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/70"
      } disabled:opacity-30`}
    >
      {loading ? (
        <span className="relative grid place-items-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary/50" /><X className="absolute h-2 w-2 text-primary" /></span>
      ) : (
        <Volume2 className={`w-3 h-3 transition-transform ${playing ? "text-primary scale-110" : ""}`} />
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
        <div className="w-full border-t border-border/45" />
      </div>
      <span className="relative text-[11px] font-medium text-muted-foreground/80 bg-card/85 backdrop-blur-md border border-border/60 px-3.5 py-0.5 rounded-full shadow-2xs">
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
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  return (
    <>
      {/* 移动端（<sm）轻量右下悬浮胶囊，不压右侧聊天气泡 */}
      <div className="sm:hidden fixed right-3 bottom-22 z-30 flex flex-col items-end gap-2">
        <AnimatePresence>
          {mobileRailOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 8 }}
              transition={SPRING_SNAPPY}
              className="backdrop-blur-2xl bg-card/95 border border-border/75 rounded-2xl shadow-xl p-1.5 flex flex-col items-center gap-1"
            >
              <button
                type="button"
                onClick={onJumpToTop}
                title="回滚到最顶部"
                className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { onOpenSearch(); setMobileRailOpen(false); }}
                title="搜索消息记录"
                className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === "user" ? null : "user")}
                title="我的发言"
                className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center transition-colors ${
                  activeTab === "user" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <User className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === "date" ? null : "date")}
                title="按日期定位"
                className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center transition-colors ${
                  activeTab === "date" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Calendar className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onJumpToBottom}
                title="回到底部最新消息"
                className="w-8.5 h-8.5 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => {
            if (mobileRailOpen) setActiveTab(null);
            setMobileRailOpen(v => !v);
          }}
          title="对话导览与跳转"
          className="w-9 h-9 rounded-full backdrop-blur-xl bg-card/90 border border-border/75 shadow-lg flex items-center justify-center text-muted-foreground hover:text-primary active:scale-95 transition-all"
        >
          {mobileRailOpen ? <X className="w-4 h-4" /> : <Compass className="w-4 h-4" />}
        </button>
      </div>

      {/* 桌面/平板端（sm+）右侧纤细悬浮导览轨 + 弹簧目录浮层 */}
      <aside className="fixed right-3 sm:right-4 top-1/2 -translate-y-1/2 z-30 flex items-center gap-2 pointer-events-none">
        <AnimatePresence>
          {activeTab && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: 10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.96, x: 8 }}
              transition={SPRING_SILKY}
              className="pointer-events-auto backdrop-blur-2xl bg-card/96 border border-border/75 rounded-3xl shadow-2xl p-3.5 w-64 sm:w-72 max-h-[68vh] flex flex-col gap-2.5 mr-1"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-border/55 shrink-0 gap-2">
                <SegmentedControl
                  size="xs"
                  layoutId="quick-jump-tab"
                  value={activeTab}
                  onChange={val => setActiveTab(val)}
                  options={[
                    { value: "user", label: "我的发言", badge: userMessages.length },
                    { value: "date", label: "日期目录", badge: dates.length },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setActiveTab(null)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  title="关闭"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto panel-scrollbar space-y-1.5 pr-0.5">
                {activeTab === "user" ? (
                  userMessages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-6">暂无发言记录</p>
                  ) : (
                    userMessages.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          onJumpToMessage(item.id);
                          if (window.innerWidth < 640) setActiveTab(null);
                        }}
                        className="w-full text-left p-2.5 rounded-xl bg-muted/35 hover:bg-primary/8 hover:border-primary/30 border border-border/45 transition-all flex items-start gap-2 group/u"
                      >
                        <span className="text-[10px] font-mono tabular-nums font-semibold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5 group-hover/u:bg-primary group-hover/u:text-primary-foreground transition-colors">
                          #{item.index}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground font-medium truncate group-hover/u:text-primary transition-colors">
                            {item.snippet}
                          </p>
                          {item.timeStr && (
                            <p className="text-[10px] font-mono tabular-nums text-muted-foreground mt-0.5">{item.timeStr}</p>
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
                        type="button"
                        key={d.key}
                        onClick={() => {
                          onJumpToDate(d.key);
                          if (window.innerWidth < 640) setActiveTab(null);
                        }}
                        className="w-full text-left p-2.5 rounded-xl bg-muted/35 hover:bg-primary/8 hover:border-primary/30 border border-border/45 transition-all flex items-center justify-between group/d"
                      >
                        <span className="text-xs font-semibold text-foreground group-hover/d:text-primary transition-colors">
                          {d.label}
                        </span>
                        <span className="text-[10.5px] font-mono tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground group-hover/d:bg-primary/12 group-hover/d:text-primary font-medium transition-colors">
                          {d.count} 条
                        </span>
                      </button>
                    ))
                  )
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hidden sm:flex pointer-events-auto backdrop-blur-2xl bg-card/88 border border-border/75 rounded-2xl shadow-lg p-1.5 flex-col items-center gap-1 transition-all">
          <button
            type="button"
            onClick={onJumpToTop}
            title="回滚到最顶部"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/top"
          >
            <ChevronUp className="w-4 h-4 group-hover/top:-translate-y-0.5 transition-transform" />
          </button>

          <button
            type="button"
            onClick={onOpenSearch}
            title="搜索消息记录"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/search"
          >
            <Search className="w-4 h-4 group-hover/search:scale-105 transition-transform" />
          </button>

          <div className="w-4 border-t border-border/60 my-0.5" />

          <button
            type="button"
            onClick={() => setActiveTab(activeTab === "user" ? null : "user")}
            title={`我的发言 (${userMessages.length}条) - 点击展开快速跳转`}
            className={`w-9 h-9 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 relative ${
              activeTab === "user"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/75"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span className="text-[9px] font-mono tabular-nums font-semibold leading-none mt-0.5 opacity-90">
              {userMessages.length > 99 ? "99+" : userMessages.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab(activeTab === "date" ? null : "date")}
            title={`日期目录 (${dates.length}天) - 点击展开快速跳转`}
            className={`w-9 h-9 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 ${
              activeTab === "date"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/75"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="text-[9px] font-mono tabular-nums font-semibold leading-none mt-0.5 opacity-90">
              {dates.length}
            </span>
          </button>

          <div className="w-4 border-t border-border/60 my-0.5" />

          <button
            type="button"
            onClick={onJumpToBottom}
            title="回到底部最新消息"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-95 group/bot"
          >
            <ChevronDown className="w-4 h-4 group-hover/bot:translate-y-0.5 transition-transform" />
          </button>
        </div>
      </aside>
    </>
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
    <motion.aside
      initial={false}
      animate={{ width: isExpanded ? 212 : 58 }}
      transition={SPRING_SILKY}
      className={`hidden lg:flex flex-col shrink-0 my-3 ml-3 xl:ml-4 z-20 backdrop-blur-2xl bg-card/88 border border-border/75 rounded-3xl shadow-lg py-3 overflow-hidden ${
        isExpanded ? "px-3" : "px-1.5"
      }`}
    >
      <div className={`flex items-center ${isExpanded ? "justify-between px-1 mb-2.5" : "justify-center mb-2"} pb-2 border-b border-border/55 shrink-0`}>
        {isExpanded ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span className="font-semibold text-xs text-foreground tracking-tight truncate">陪伴工作台</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/75 transition-colors shrink-0"
          title={isExpanded ? "收起工作台" : "展开工作台"}
        >
          {isExpanded ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4 text-primary" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2.5">
        <div className="space-y-1">
          {isExpanded ? (
            <div className="p-1 rounded-2xl bg-muted/35 border border-border/50">
              <button
                type="button"
                onClick={() => setShowStateDropdown(!showStateDropdown)}
                className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all state-bg-${currentState} state-${currentState}`}
                title="点击展开/收起情感状态切换"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">{stateInfo.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight truncate">{stateInfo.label}</p>
                    <p className="text-[10px] opacity-75 truncate">{stateInfo.desc}</p>
                  </div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${showStateDropdown ? "rotate-180" : ""}`} />
              </button>

              <CollapseSection open={showStateDropdown}>
                <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-border/40">
                  {Object.entries(STATES).map(([key, s]) => {
                    const isActive = currentState === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          onChangeState(key);
                          setShowStateDropdown(false);
                        }}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium transition-all ${
                          isActive
                            ? `state-bg-${key} state-${key} ring-1 ring-primary/35 shadow-2xs font-semibold`
                            : "text-muted-foreground hover:text-foreground hover:bg-card/80 border border-border/35"
                        }`}
                        title={s.desc}
                      >
                        <span className="text-xs">{s.emoji}</span>
                        <span className="text-[10.5px] truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </CollapseSection>
            </div>
          ) : (
            <div className="flex justify-center my-0.5">
              <button
                type="button"
                onClick={() => {
                  const keys = Object.keys(STATES);
                  const nextIdx = (keys.indexOf(currentState) + 1) % keys.length;
                  onChangeState(keys[nextIdx]);
                }}
                className={`w-9 h-9 rounded-2xl flex items-center justify-center text-xs transition-all shadow-2xs state-bg-${currentState} state-${currentState} hover:scale-105 active:scale-95`}
                title={`当前情感：${stateInfo.emoji} ${stateInfo.label} (点击切换)`}
              >
                <span>{stateInfo.emoji}</span>
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1 pt-1.5 border-t border-border/50">
          {isExpanded && (
            <p className="text-[10px] font-medium text-muted-foreground/75 tracking-wider px-2 py-0.5">
              沉浸互动
            </p>
          )}
          <button
            type="button"
            onClick={onOpenScenes}
            className={`w-full flex items-center rounded-2xl transition-all group relative ${
              isExpanded
                ? activeScene
                  ? "p-2 bg-primary/8 border border-primary/25 gap-2.5 shadow-2xs"
                  : "px-2.5 py-2 hover:bg-muted/65 gap-2.5"
                : "p-1.5 justify-center"
            }`}
            title={activeScene ? `情境剧场（进行中）：${activeScene.name}` : "情境剧场"}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all relative ${
              activeScene
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-primary/10 text-primary group-hover:bg-primary/15"
            }`}>
              <Theater className="w-4 h-4" />
              {activeScene && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-card" />
              )}
            </div>
            {isExpanded && (
              <div className="text-left min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-foreground truncate">情境剧场</p>
                  {activeScene && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-semibold shrink-0">
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

        <div className="space-y-1 pt-1.5 border-t border-border/50">
          {isExpanded && (
            <p className="text-[10px] font-medium text-muted-foreground/75 tracking-wider px-2 py-0.5">
              记忆与感知
            </p>
          )}
          {[
            { label: "记忆时间线", sub: "回忆与关键节点", icon: Clock, onClick: onOpenTimeline },
            { label: "资料库", sub: "背景与知识沉淀", icon: Database, onClick: onOpenSourceLibrary },
            { label: "情绪报告", sub: "心境波动曲线", icon: BarChart3, onClick: onOpenEmotionReport },
            { label: "对话日记", sub: "每日情感日记", icon: BookOpen, onClick: onOpenDiary },
            { label: "运行诊断", sub: "心智与状态透视", icon: Activity, onClick: onOpenDiagnostics },
          ].map(item => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.label}
                onClick={item.onClick}
                className={`w-full flex items-center gap-2.5 rounded-2xl transition-all group ${
                  isExpanded ? "px-2.5 py-2 hover:bg-muted/65" : "p-2 justify-center hover:bg-muted/65"
                }`}
                title={item.label}
              >
                <div className="w-7.5 h-7.5 rounded-xl bg-muted/75 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary flex items-center justify-center shrink-0 transition-colors">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                {isExpanded && (
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground/75 truncate">{item.sub}</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </motion.aside>
  );
}

function MessageBubble({
  msg,
  personaName,
  personaAvatarUrl,
  showState = true,
  ttsEnabled = true,
}: {
  msg: Message;
  personaName: string;
  personaAvatarUrl?: string | null;
  showState?: boolean;
  ttsEnabled?: boolean;
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
              className="w-full max-h-[320px] object-cover cursor-pointer group-hover/img:scale-[1.02] transition-transform duration-300"
            />
          </div>
          {/* 场景配图等人物图片消息的 content 只是内部占位；有真实说明文字才显示，避免历史旧数据继续露出“（场景配图）” */}
          {msg.content && msg.content !== "[图片]" && msg.content !== "（场景配图）" && msg.content !== "[场景配图]" && (
            <p className="text-[13.5px] sm:text-sm text-foreground/90 leading-relaxed px-1">{msg.content}</p>
          )}
          <MotionModal
            open={imgExpanded}
            onClose={() => setImgExpanded(false)}
            ariaLabel="图片大图预览"
            className="max-w-4xl bg-transparent border-0 shadow-none backdrop-blur-none p-0 flex items-center justify-center"
          >
            <div className="relative" onClick={() => setImgExpanded(false)}>
              <img
                src={msg.mediaUrl!}
                alt=""
                className="max-w-[92vw] max-h-[86vh] object-contain rounded-2xl shadow-2xl border border-white/10"
              />
              <button
                type="button"
                onClick={() => setImgExpanded(false)}
                className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/55 text-white/90 hover:bg-black/75 flex items-center justify-center backdrop-blur-md transition-colors"
                aria-label="关闭预览"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </MotionModal>
        </div>
      );
    }
    if (msg.messageType === "voice" && msg.mediaUrl) {
      return (
        <div className="flex flex-col gap-1.5 py-0.5">
          <VoicePlayer url={msg.mediaUrl} duration={msg.mediaDuration} />
          {msg.content && msg.content !== "（语音消息）" && (
            <p className="text-xs opacity-80 mt-0.5 px-0.5">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.isStreaming) {
      if (!msg.content) {
        return (
          <div className="flex items-center gap-2 py-1 px-0.5 text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
            <span className="text-xs text-muted-foreground/75">正在回应…</span>
          </div>
        );
      }
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
    <div
      id={`msg-${msg.id}`}
      className={`${msg.animateIn ? "bubble-enter " : ""}flex gap-2.5 sm:gap-3.5 ${isUser ? "flex-row-reverse" : "flex-row"} mb-5 sm:mb-6 group/msg scroll-mt-24`}
    >
      {!isUser && (
        <img
          src={getAvatarUrl(personaName, personaAvatarUrl)}
          alt={personaName}
          className="w-9.5 h-9.5 sm:w-10.5 sm:h-10.5 rounded-2xl object-cover ring-1 ring-border/75 group-hover/msg:ring-primary/35 shadow-2xs flex-shrink-0 mt-0.5 transition-all"
          loading="lazy"
        />
      )}
      <div className={`max-w-[86%] sm:max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
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
          <div className={`text-[10.5px] text-muted-foreground/65 px-1.5 flex items-center gap-2 mt-0.5 ${isUser ? "justify-end" : "justify-start"}`}>
            <span className="font-mono tabular-nums tracking-tight">{formatBeijingTime(msg.createdAt)}</span>
            {msg.channel === "wechat" && (
              <span className="text-[9.5px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 rounded-md font-semibold">微信</span>
            )}
            {msg.channel === "qq" && (
              <span className="text-[9.5px] px-1.5 py-0.2 bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 rounded-md font-semibold">QQ</span>
            )}
            {msg.channel === "mobile" && (
              <span title="手机直连消息" className="text-[9.5px] px-1.5 py-0.2 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 rounded-md font-semibold">手机</span>
            )}
            {!isUser && msg.messageType === "text" && <TTSButton text={msg.content} enabled={ttsEnabled} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN CHAT ────────────────────────────────────────────────────────────────

const RECORDING_MAX_SECONDS = 30;
const RECORDING_MAX_BYTES = 8 * 1024 * 1024;
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
type VoiceTarget = Readonly<{ expectedSceneId: number | null; expectedConfigRevision: number }>;
type VoiceRecording = { target: VoiceTarget; blob: Blob; duration: number };
type VoiceCapture = {
  target: VoiceTarget;
  recorder?: MediaRecorder;
  startedAt: number;
  stoppedAt?: number;
  timer?: number;
  deadline?: number;
  sendWhenStopped: boolean;
};
type VoiceUpload = {
  target: VoiceTarget;
  id: string;
  userBubble: Message;
  replyBubble: Message;
  reader: FileReader;
  submitted: boolean;
};

type SceneImageRequest = {
  operationId: string;
  sceneId: number | null;
  scopeVersion: number;
  jobId?: string;
  replySettled?: boolean;
  timer?: number;
  pollVersion?: number;
  cancelled: boolean;
  leftScope: boolean;
};
type SceneImageNotice = { text: string; pending: boolean; error?: boolean };

function isSceneImageCommand(text: string) {
  return /^[\/／][pｐＰP](?=$|\s|[^a-zA-Z0-9_])/.test(text.trim())
    || /(?:^|\s)[\/／][pｐＰP]\s*$/.test(text.trim());
}

function clearRecordingTimers(capture: VoiceCapture) {
  window.clearInterval(capture.timer);
  window.clearTimeout(capture.deadline);
}

function releaseRecording(capture: VoiceCapture) {
  clearRecordingTimers(capture);
  const recorder = capture.recorder;
  if (!recorder) return;
  recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
  try {
    if (recorder.state !== "inactive") recorder.stop();
  } catch {
    // The stream can end before the recorder's stop event arrives.
  } finally {
    recorder.stream.getTracks().forEach(track => track.stop());
  }
}

function releaseVoiceUpload(upload: VoiceUpload) {
  if (upload.reader.readyState === FileReader.LOADING) upload.reader.abort();
  URL.revokeObjectURL(upload.userBubble.mediaUrl!);
}

function recordingExtension(mimeType: string) {
  const type = mimeType.split(";", 1)[0].trim().toLowerCase();
  return type === "audio/webm" ? "webm" : type === "audio/ogg" ? "ogg" : type === "audio/mp4" ? "m4a" : undefined;
}

export default function Chat() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  return <PersonaChat key={personaId} personaId={personaId} />;
}

function PersonaChat({ personaId }: { personaId: number }) {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [currentState, setCurrentState] = useState("warm");
  const [showSettingDetail, setShowSettingDetail] = useState(false);
  const [showNewContextConfirm, setShowNewContextConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isXlViewport, setIsXlViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1280px)").matches : true
  );
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
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const attachContainerRef = useRef<HTMLDivElement>(null);
  const initialHistoryScrolledRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsXlViewport(e.matches);
    update(mq);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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
  const utils = trpc.useUtils();
  const [sceneImageNotices, setSceneImageNotices] = useState<Record<string, SceneImageNotice>>({});
  const sceneImageRequests = useRef(new Map<string, SceneImageRequest>());
  const resumeSceneImagePoll = useRef<(request: SceneImageRequest, delay?: number) => void>(() => {});
  const chatMounted = useRef(false);
  const textSending = useRef(false);
  const refreshAfterText = useRef(false);
  const displayedSceneId = useRef(persona?.activeSceneId ?? null);
  const sceneScopeVersion = useRef(0);
  const { mutateAsync: cancelSceneImageJob } = trpc.sceneImageConfig.cancelJob.useMutation({ retry: false });
  const { mutateAsync: cancelSceneImageOperation } = trpc.sceneImageConfig.cancelOperation.useMutation({ retry: false });
  const syncSceneHistory = useCallback(() => {
    if (!chatMounted.current) return;
    if (textSending.current) refreshAfterText.current = true;
    else void utils.chat.getHistory.cancel({ personaId }).then(() => {
      if (chatMounted.current) return refetchHistory();
    }).catch(() => {});
  }, [personaId, utils, refetchHistory]);
  const setSceneImageNotice = useCallback((id: string, notice?: SceneImageNotice) => {
    if (!chatMounted.current) return;
    setSceneImageNotices(previous => {
      const next = { ...previous };
      if (notice) next[id] = notice;
      else delete next[id];
      const terminal = Object.keys(next).filter(key => !next[key].pending);
      for (const key of terminal.slice(0, Math.max(0, terminal.length - 3))) delete next[key];
      return next;
    });
  }, []);
  const cancelSceneImage = useCallback((request: SceneImageRequest, leavingScope: boolean) => {
    if (leavingScope) request.leftScope = true;
    if (request.cancelled) return;
    request.cancelled = true;
    request.pollVersion = (request.pollVersion ?? 0) + 1;
    window.clearTimeout(request.timer);
    if (!leavingScope) setSceneImageNotice(request.operationId, { text: "正在请求停止配图…", pending: false });
    const cancellation = request.jobId
      ? cancelSceneImageJob({ id: request.jobId })
      : cancelSceneImageOperation({ operationId: request.operationId });
    void cancellation.then(
      job => {
        sceneImageRequests.current.delete(request.operationId);
        if (!request.leftScope && request.scopeVersion === sceneScopeVersion.current) {
          setSceneImageNotice(request.operationId, {
            text: job.status === "succeeded" ? "配图已生成；停止请求未撤回已保存的图片。"
              : job.status === "cancelled" ? "场景配图已停止。"
              : job.status === "failed" ? `场景配图已失败：${job.errorMessage || "未取得可用图片。"}`
              : job.status === "unknown" ? "配图结果暂不确定；不会自动重试。"
              : "已请求停止配图；请以实际结果为准。",
            pending: false, error: job.status === "failed" || job.status === "unknown",
          });
        }
        syncSceneHistory();
      },
      () => {
        if (request.leftScope || request.scopeVersion !== sceneScopeVersion.current || !chatMounted.current) {
          sceneImageRequests.current.delete(request.operationId);
          return;
        }
        request.cancelled = false;
        const canTrack = Boolean(request.jobId) || !request.replySettled;
        if (!canTrack) sceneImageRequests.current.delete(request.operationId);
        setSceneImageNotice(request.operationId, {
          text: canTrack ? "未确认停止，可再次取消；将继续查询本次配图。"
            : "未确认停止；文字响应未关联配图任务，请查看配图记录。",
          pending: canTrack, error: true,
        });
        if (request.jobId) resumeSceneImagePoll.current(request, 0);
      },
    );
  }, [cancelSceneImageJob, cancelSceneImageOperation, syncSceneHistory, setSceneImageNotice]);
  useLayoutEffect(() => {
    chatMounted.current = true;
    return () => {
      chatMounted.current = false;
      for (const request of Array.from(sceneImageRequests.current.values())) cancelSceneImage(request, true);
    };
  }, [cancelSceneImage]);

  const pollForSceneImage = (request: SceneImageRequest, initialDelay = 700) => {
    const id = request.jobId;
    if (!id || request.cancelled) return;
    window.clearTimeout(request.timer);
    const version = request.pollVersion = (request.pollVersion ?? 0) + 1;
    const expiresAt = Date.now() + 15 * 60_000;
    const current = () => chatMounted.current && !request.cancelled
      && request.pollVersion === version
      && sceneImageRequests.current.get(request.operationId) === request;
    const schedule = (delay: number) => {
      if (!current()) return;
      if (Date.now() >= expiresAt) {
        setSceneImageNotice(request.operationId, { text: "等待配图状态超时，可停止本次配图或稍后查看记录。", pending: true });
        return;
      }
      request.timer = window.setTimeout(async () => {
        if (!current()) return;
        try {
          const job = await utils.sceneImageConfig.job.fetch({ id }, { staleTime: 0 });
          if (!current()) return;
          if (job.status === "pending" || job.status === "running") {
            setSceneImageNotice(request.operationId, {
              text: job.status === "running" ? "正在生成场景配图…" : "场景配图正在等待处理…", pending: true,
            });
            schedule(2_000);
            return;
          }
          sceneImageRequests.current.delete(request.operationId);
          const success = job.status === "succeeded";
          setSceneImageNotice(request.operationId, {
            text: success ? "场景配图已生成。" : job.status === "cancelled" ? "场景配图已停止。"
              : job.status === "unknown" ? "配图结果暂不确定；不会自动重试。"
              : `场景配图失败：${job.errorMessage || "未取得可用图片。"}`,
            pending: false, error: job.status === "failed" || job.status === "unknown",
          });
          if (success) syncSceneHistory();
        } catch {
          if (!current()) return;
          setSceneImageNotice(request.operationId, { text: "暂时无法读取配图状态，正在重新查询…", pending: true });
          schedule(5_000);
        }
      }, delay);
    };
    schedule(initialDelay);
  };
  useLayoutEffect(() => {
    resumeSceneImagePoll.current = pollForSceneImage;
  });
  const sendMutation = trpc.chat.send.useMutation({ retry: false });

  const clearMutation = trpc.chat.clear.useMutation({
    onSuccess: () => { void refetchHistory(); toast.success("日常对话已清空，场景记录保留"); setShowMenu(false); setShowClearConfirm(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const startNewContextMutation = trpc.chat.startNewContext.useMutation({
    onSuccess: () => { toast.success("已重新开本段对话，旧记录仍保留"); setShowMenu(false); setShowNewContextConfirm(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const [showMenu, setShowMenu] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [voiceStage, setVoiceStage] = useState<"requesting" | "recording" | "finishing" | "ready" | "sending" | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const captureRef = useRef<VoiceCapture | null>(null);
  const readyRecordingRef = useRef<VoiceRecording | null>(null);
  const voiceUploadRef = useRef<VoiceUpload | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSourceLibrary, setShowSourceLibrary] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEmotionReport, setShowEmotionReport] = useState(false);
  const [showDiary, setShowDiary] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showHistoryManager, setShowHistoryManager] = useState(false);
  const [scenePanelTab, setScenePanelTab] = useState<"note" | "context" | null>(null);
  const [showSceneHistoryManager, setShowSceneHistoryManager] = useState(false);

  const [showGraduation, setShowGraduation] = useState(false);

  // 点击外部自动关闭下拉菜单与附件浮层
  useEffect(() => {
    if (!showMenu && !showAttach) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showMenu && menuContainerRef.current && !menuContainerRef.current.contains(target)) {
        setShowMenu(false);
      }
      if (showAttach && attachContainerRef.current && !attachContainerRef.current.contains(target)) {
        setShowAttach(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showMenu, showAttach]);

  const { data: scenesList, refetch: refetchScenes } = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });
  const deactivateSceneMutation = trpc.scene.deactivate.useMutation({
    onSuccess: () => {
      toast.success("已退出剧场，恢复日常对话");
      setScenePanelTab(null);
      void refetchPersona();
      void refetchScenes();
    },
  });

  const activeSceneId = persona?.activeSceneId ?? null;
  const activeScene = scenesList?.find((s: any) => s.id === activeSceneId);
  useLayoutEffect(() => {
    if (displayedSceneId.current === activeSceneId) return;
    displayedSceneId.current = activeSceneId;
    sceneScopeVersion.current++;
    for (const request of Array.from(sceneImageRequests.current.values())) {
      if (request.sceneId !== activeSceneId) cancelSceneImage(request, true);
    }
    setSceneImageNotices({});
  }, [activeSceneId, cancelSceneImage]);

  const changeStateMutation = trpc.persona.update.useMutation({
    onSuccess: () => toast.success("情感状态已切换"),
  });

  const sendImageMutation = trpc.chat.sendImage.useMutation({
    onError: (e: any) => { toast.error("图片发送失败：" + e.message); setIsSending(false); },
  });

  const voiceConfig = trpc.voiceConfig.get.useQuery(undefined, { enabled: isAuthenticated });
  const sendVoiceMutation = trpc.chat.sendVoice.useMutation({ retry: false });
  const { mutateAsync: cancelVoiceOperation } = trpc.voiceConfig.cancelOperation.useMutation({ retry: false });
  useLayoutEffect(() => () => {
    const capture = captureRef.current;
    captureRef.current = null;
    readyRecordingRef.current = null;
    if (capture) releaseRecording(capture);
    const upload = voiceUploadRef.current;
    voiceUploadRef.current = null;
    if (upload) {
      releaseVoiceUpload(upload);
      if (upload.submitted) {
        toast.info("已请求停止；已保存的用户语音可能保留。");
        void cancelVoiceOperation({ operationId: upload.id }).then(() => refetchHistory()).catch(() => {});
      }
    }
  }, [cancelVoiceOperation, refetchHistory]);

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
    if (textSending.current) return;
    if (history) {
      const stored = history.map((m: any) => ({
        id: m.id, role: m.role as "user" | "assistant",
        content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl, mediaDuration: m.mediaDuration,
        emotionalState: m.emotionalState, channel: m.channel, createdAt: m.createdAt, animateIn: false,
      }));
      const upload = voiceUploadRef.current;
      setMessages(upload ? [...stored, upload.userBubble, upload.replyBubble] : stored);
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
    if (messages.length === 0) return;
    if (!initialHistoryScrolledRef.current) {
      initialHistoryScrolledRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending || textSending.current || voiceStage) return;
    const wantsSceneImage = isSceneImageCommand(text);
    if (wantsSceneImage && !persona) {
      toast.error("还无法确认当前角色和场景，请稍后再试。");
      return;
    }
    const operationId = crypto.randomUUID();
    const request: SceneImageRequest | undefined = wantsSceneImage ? {
      operationId, sceneId: activeSceneId, scopeVersion: sceneScopeVersion.current, cancelled: false, leftScope: false,
    } : undefined;
    if (request) {
      sceneImageRequests.current.set(operationId, request);
      setSceneImageNotice(operationId, { text: "等待角色回复，随后开始场景配图…", pending: true });
    }
    textSending.current = true;
    setInput("");
    setIsSending(true);

    const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, createdAt: new Date(), animateIn: true };
    setMessages(prev => [...prev, userMsg]);

    const streamId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState, animateIn: true }]);

    try {
      const result = await sendMutation.mutateAsync({
        personaId, message: text, operationId, expectedSceneId: activeSceneId,
      });
      if (!chatMounted.current) return;
      if (request) {
        request.replySettled = true;
        request.jobId = result.sceneImageJobId;
      }
      if (request && (request.leftScope || request.scopeVersion !== sceneScopeVersion.current)) {
        setMessages(previous => previous.filter(message => message.id !== streamId && message.id !== userMsg.id));
        syncSceneHistory();
        return;
      }
      setMessages(prev => prev.map(m => m.id === streamId
        ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), animateIn: true, isStreaming: false }
        : m
      ));
      setCurrentState(result.emotionalState);
      if (request && !request.cancelled) {
        if (request.jobId) {
          setSceneImageNotice(operationId, {
            text: result.sceneImagePending ? "场景配图正在等待处理…" : "正在读取本次配图结果…", pending: true,
          });
          pollForSceneImage(request, result.sceneImagePending ? 700 : 0);
        } else {
          sceneImageRequests.current.delete(operationId);
          setSceneImageNotice(operationId, {
            text: `场景配图未启动：${result.sceneImageError || "未创建配图任务。"}`, pending: false, error: true,
          });
        }
      }
      if (result.graduationSuggested) setShowGraduation(true);
    } catch (error) {
      if (!chatMounted.current) return;
      const visible = !request || (!request.leftScope && request.scopeVersion === sceneScopeVersion.current);
      setMessages(prev => prev.filter(m => m.id !== streamId && (!request || m.id !== userMsg.id)));
      if (request) {
        request.replySettled = true;
        if (!request.cancelled) cancelSceneImage(request, true);
        syncSceneHistory();
        if (visible) setSceneImageNotice(operationId, {
          text: "文字发送未确认，已请求停止本次配图。", pending: false, error: true,
        });
      }
      if (visible) toast.error(`发送失败：${error instanceof Error ? error.message : "暂时无法发送消息。"}`);
    } finally {
      refreshAfterText.current = true;
      textSending.current = false;
      if (chatMounted.current) {
        if (refreshAfterText.current) {
          refreshAfterText.current = false;
          syncSceneHistory();
        }
        setIsSending(false);
        textareaRef.current?.focus();
      }
    }
  };

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isSending || voiceStage) return;
    setShowAttach(false);
    setIsSending(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = URL.createObjectURL(file);
      const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "[图片]", messageType: "image", mediaUrl: localUrl, createdAt: new Date(), animateIn: true };
      setMessages(prev => [...prev, userMsg]);
      const streamId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState, animateIn: true }]);

      try {
        const result = await sendImageMutation.mutateAsync({ personaId, imageContent: base64, fileName: file.name, mimeType: file.type });
        setMessages(prev => prev.map(m => m.id === streamId
          ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), animateIn: true, isStreaming: false }
          : m
        ));
        setCurrentState(result.emotionalState);
      } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
      finally { setIsSending(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [isSending, personaId, currentState, voiceStage]);

  const removeVoiceBubbles = useCallback((upload: VoiceUpload) => {
    setMessages(prev => prev.filter(message => message.id !== upload.userBubble.id && message.id !== upload.replyBubble.id));
  }, []);

  const sendRecording = async ({ blob, duration, target }: VoiceRecording) => {
    const extension = recordingExtension(blob.type);
    if (!extension || !blob.size || blob.size > RECORDING_MAX_BYTES || duration <= 0 || duration > RECORDING_MAX_SECONDS) {
      setVoiceStage(null);
      toast.error("录音为空、超过 8 MiB 或格式不受支持，请重新录制或改用文字。");
      return;
    }
    if (voiceUploadRef.current) return;
    const id = crypto.randomUUID();
    const reader = new FileReader();
    const userBubble: Message = {
      id: `voice-${id}`, role: "user", content: "（语音消息）", messageType: "voice",
      mediaUrl: URL.createObjectURL(blob), mediaDuration: duration, createdAt: new Date(), animateIn: true,
    };
    const replyBubble: Message = {
      id: `voice-reply-${id}`, role: "assistant", content: "",
      isStreaming: true, emotionalState: currentState, createdAt: new Date(), animateIn: true,
    };
    const upload: VoiceUpload = { id, target, reader, userBubble, replyBubble, submitted: false };
    voiceUploadRef.current = upload;
    setVoiceStage("sending");
    setMessages(prev => [...prev, userBubble, replyBubble]);

    try {
      const audioContent = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const data = typeof reader.result === "string" ? reader.result.split(",", 2)[1] : null;
          if (data) resolve(data);
          else reject(new Error("无法读取录音。"));
        };
        reader.onabort = reader.onerror = () => reject(new Error("无法读取录音。"));
        reader.readAsDataURL(blob);
      });
      if (voiceUploadRef.current !== upload) return;
      upload.submitted = true;
      const result = await sendVoiceMutation.mutateAsync({
        personaId, audioContent, mimeType: blob.type, duration, ...upload.target,
        fileName: `voice-${id}.${extension}`, operationId: id,
      });
      if (voiceUploadRef.current !== upload) return;
      setMessages(prev => prev.map(message => {
        if (message.id === userBubble.id) return {
          ...userBubble, content: result.transcription, mediaUrl: result.voiceUrl,
          mediaDuration: (result as { voiceDuration?: number }).voiceDuration ?? duration,
        };
        if (message.id === replyBubble.id) return {
          ...replyBubble, content: result.reply, emotionalState: result.emotionalState, isStreaming: false,
        };
        return message;
      }));
      setCurrentState(result.emotionalState);
      if (result.graduationSuggested) setShowGraduation(true);
      void refetchHistory();
    } catch (error) {
      if (voiceUploadRef.current === upload) {
        removeVoiceBubbles(upload);
        toast.error(`${error instanceof Error ? error.message : "语音发送失败。"} 可重新录制或改用文字。`);
        void refetchHistory();
      }
    } finally {
      if (voiceUploadRef.current === upload) {
        voiceUploadRef.current = null;
        releaseVoiceUpload(upload);
        setVoiceStage(null);
        setRecordingTime(0);
      }
    }
  };

  const finishRecording = (capture: VoiceCapture, sendWhenStopped: boolean) => {
    if (captureRef.current !== capture || capture.stoppedAt !== undefined || capture.recorder?.state !== "recording") return;
    capture.stoppedAt = performance.now();
    capture.sendWhenStopped = sendWhenStopped;
    clearRecordingTimers(capture);
    setVoiceStage("finishing");
    try {
      capture.recorder.stop();
    } catch {
      captureRef.current = null;
      releaseRecording(capture);
      setVoiceStage(null);
      setRecordingTime(0);
      toast.error("无法结束录音，请重新录制或改用文字。");
    }
  };

  const startRecording = async () => {
    if (captureRef.current || readyRecordingRef.current || voiceUploadRef.current || isSending) return;
    if (!persona) {
      toast.error("还无法确认当前角色和场景，请稍后再试。");
      return;
    }
    if (!voiceConfig.data?.asrEnabled) {
      toast.error(voiceConfig.isPending ? "正在读取语音设置，请稍后再试。" :
        voiceConfig.isError ? "无法读取语音设置，请稍后再试。" : "语音识别尚未开启，请先在设置中配置。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("当前浏览器无法录音，请改用文字。");
      return;
    }
    const capture: VoiceCapture = {
      startedAt: 0, sendWhenStopped: false,
      target: { expectedSceneId: activeSceneId, expectedConfigRevision: voiceConfig.data.revision },
    };
    captureRef.current = capture;
    setVoiceStage("requesting");
    setRecordingTime(0);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (captureRef.current !== capture) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const mimeType = RECORDING_TYPES.find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      capture.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      const fail = (message: string) => {
        if (captureRef.current !== capture) return;
        captureRef.current = null;
        releaseRecording(capture);
        setVoiceStage(null);
        setRecordingTime(0);
        toast.error(message);
      };
      recorder.ondataavailable = event => {
        if (captureRef.current !== capture || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > RECORDING_MAX_BYTES) fail("录音超过 8 MiB，请缩短录音或改用文字。");
        else chunks.push(event.data);
      };
      recorder.onerror = () => fail("录音失败，请重新录制或改用文字。");
      recorder.onstop = () => {
        if (captureRef.current !== capture) return;
        captureRef.current = null;
        releaseRecording(capture);
        const duration = ((capture.stoppedAt ?? performance.now()) - capture.startedAt) / 1000;
        const actualMime = chunks.find(chunk => recordingExtension(chunk.type))?.type || recorder.mimeType;
        const blob = new Blob(chunks, { type: actualMime });
        if (!recordingExtension(blob.type) || !blob.size || duration <= 0 || duration > RECORDING_MAX_SECONDS) {
          setVoiceStage(null);
          setRecordingTime(0);
          toast.error(duration > RECORDING_MAX_SECONDS ? "录音超过 30 秒，请缩短录音或改用文字。" : "没有录到可用的语音，请重新录制或改用文字。");
          return;
        }
        const recording: VoiceRecording = { blob, duration, target: capture.target };
        if (capture.sendWhenStopped) {
          void sendRecording(recording);
        } else {
          readyRecordingRef.current = recording;
          setRecordingTime(Math.round(duration * 10) / 10);
          setVoiceStage("ready");
        }
      };
      recorder.start(250);
      capture.startedAt = performance.now();
      setVoiceStage("recording");
      capture.timer = window.setInterval(() => {
        const elapsed = (performance.now() - capture.startedAt) / 1000;
        setRecordingTime(Math.min(RECORDING_MAX_SECONDS, Math.floor(elapsed)));
      }, 250);
      // Leave a small margin for the browser to dispatch the stop timer.
      capture.deadline = window.setTimeout(() => finishRecording(capture, false), RECORDING_MAX_SECONDS * 1000 - 150);
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      if (captureRef.current === capture) {
        captureRef.current = null;
        releaseRecording(capture);
        setVoiceStage(null);
        setRecordingTime(0);
        toast.error("无法开始录音，请检查麦克风权限或改用文字。");
      }
    }
  };

  const stopRecording = () => {
    const capture = captureRef.current;
    if (capture) finishRecording(capture, true);
    const ready = readyRecordingRef.current;
    if (ready) {
      readyRecordingRef.current = null;
      void sendRecording(ready);
    }
  };

  const cancelRecording = useCallback(() => {
    const capture = captureRef.current;
    captureRef.current = null;
    readyRecordingRef.current = null;
    if (capture) releaseRecording(capture);
    const upload = voiceUploadRef.current;
    voiceUploadRef.current = null;
    if (upload) {
      removeVoiceBubbles(upload);
      releaseVoiceUpload(upload);
      if (upload.submitted) {
        toast.info("已请求停止；已保存的用户语音可能保留。");
        void cancelVoiceOperation({ operationId: upload.id }).then(
          () => { void refetchHistory(); },
          () => {
            toast.error("取消请求未送达，请核对聊天记录。");
            void refetchHistory();
          },
        );
      }
    }
    setVoiceStage(null);
    setRecordingTime(0);
  }, [cancelVoiceOperation, refetchHistory, removeVoiceBubbles]);

  useLayoutEffect(() => {
    const target = captureRef.current?.target ?? readyRecordingRef.current?.target ?? voiceUploadRef.current?.target;
    if (target && target.expectedSceneId !== activeSceneId) cancelRecording();
  }, [activeSceneId, cancelRecording]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stateInfo = STATES[currentState] || STATES.warm;

  const renderScenePanelBody = () => {
    if (!activeScene || !scenePanelTab) return null;
    return (
      <>
        <div className="p-3 sm:p-3.5 border-b border-border/60 bg-muted/20 shrink-0 flex items-center justify-between gap-2">
          <SegmentedControl
            size="xs"
            layoutId="chat-scene-panel-tab"
            value={scenePanelTab}
            onChange={val => setScenePanelTab(val)}
            options={[
              { value: "note", label: "剧情设定", icon: <BookOpen className="w-3.5 h-3.5" /> },
              { value: "context", label: "上下文", icon: <Layers className="w-3.5 h-3.5" /> },
            ]}
          />

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => navigate(`/scenes/${personaId}?view=memory&sceneId=${activeScene.id}`)}
              className="p-1.5 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="跳转该剧本完整记忆中枢"
            >
              <Database className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setScenePanelTab(null)}
              className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title="关闭面板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 ${scenePanelTab === "note" ? "overflow-y-auto p-3.5 sm:p-4 space-y-3 panel-scrollbar" : "flex flex-col p-3 sm:p-3.5"}`}>
          {scenePanelTab === "note" && (
            <div className="space-y-3 animate-fade-in">
              <div className="p-3.5 rounded-2xl bg-primary/[0.05] border border-primary/20 space-y-2 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{activeScene.icon || "🎭"}</span>
                  <span className="font-semibold text-sm text-foreground truncate">{activeScene.name}</span>
                </div>
                {activeScene.description && (
                  <p className="text-xs text-foreground/85 leading-relaxed">
                    {activeScene.description}
                  </p>
                )}
              </div>

              {activeScene.contextSeed && (
                <div className="p-3.5 rounded-2xl bg-card border border-border/70 space-y-1.5 shadow-2xs">
                  <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    前情提要背景
                  </span>
                  <p className="text-xs text-foreground/85 leading-relaxed bg-muted/25 p-2.5 rounded-xl border border-border/45">
                    {activeScene.contextSeed}
                  </p>
                </div>
              )}

              {activeScene.personaIdentityOverride && (
                <div className="p-3.5 rounded-2xl bg-card border border-border/70 space-y-1.5 shadow-2xs">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                      {persona?.name ? persona.name.charAt(0) : "TA"}
                    </span>
                    {persona?.name || "角色"} 剧本设定
                  </span>
                  <p className="text-xs text-foreground/80 leading-relaxed bg-muted/25 p-2.5 rounded-xl border border-border/45">
                    {activeScene.personaIdentityOverride}
                  </p>
                </div>
              )}
              {activeScene.userIdentityOverride && (
                <div className="p-3.5 rounded-2xl bg-card border border-primary/20 shadow-2xs space-y-1.5 flex flex-col">
                  <div className="flex items-center gap-1.5 pb-1 border-b border-primary/15">
                    <span className="w-5 h-5 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                      我
                    </span>
                    <span className="text-xs font-semibold text-primary truncate">你（用户）剧本设定</span>
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
      </>
    );
  };

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      {/* Header */}
      <header className="app-header sticky top-0 z-40 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-2.5 sm:px-6 py-2.5 flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Left: Back button & Persona Info */}
          <div className="flex items-center gap-1.5 sm:gap-3.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="app-nav-icon shrink-0 -ml-1"
              title="返回大厅"
              aria-label="返回大厅"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="relative shrink-0">
              <img
                src={getAvatarUrl(persona?.name || "?", (persona as { avatarUrl?: string | null } | undefined)?.avatarUrl)}
                alt={persona?.name || ""}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl object-cover ring-1 ring-border/80 shadow-2xs"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-card breathing-dot" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 sm:flex-wrap">
                <h1 title={persona?.name} className="min-w-0 text-foreground font-semibold text-sm sm:text-[15px] tracking-tight leading-tight truncate">
                  {persona?.name || "..."}
                </h1>
                {intimacy && (
                  <span
                    className="hidden sm:flex text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0 font-medium items-center gap-1"
                    title={`${intimacy.level} · ${intimacy.score}分`}
                  >
                    <span>{intimacy.icon}</span>
                    <span>{intimacy.level}</span>
                  </span>
                )}
                {activeScene && (
                  <button
                    type="button"
                    onClick={() => navigate(`/scenes/${personaId}`)}
                    className="hidden sm:flex text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium shrink-0 items-center gap-1 hover:bg-primary/15 transition-colors"
                    title={`当前在情境剧场：${activeScene.name}，点击切换`}
                    aria-label={`当前场景：${activeScene.name}，切换剧本`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span>{activeScene.icon || "🎭"}</span>
                    <span className="max-w-[96px] sm:max-w-[150px] truncate">{activeScene.name}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowSettingDetail(true)}
                  className="min-h-5 sm:min-h-0 text-muted-foreground/80 hover:text-foreground text-[11px] leading-tight truncate text-left transition-colors flex items-center gap-1 max-w-full group/subtitle"
                  title="点击查看详细人物与关系设定"
                  aria-label="查看人物与关系设定"
                >
                  {activeScene ? (
                    <>
                      <Theater className="hidden sm:block w-3 h-3 text-primary shrink-0" />
                      <span className="hidden sm:block truncate">{activeScene.personaIdentityOverride ? `身份：${activeScene.personaIdentityOverride}` : activeScene.description || "情境剧场进行中"}</span>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:block truncate">{persona?.relationshipDesc ? (persona.relationshipDesc.length > 30 ? `${persona.relationshipDesc.slice(0, 28)}...` : persona.relationshipDesc) : "日常相伴"}</span>
                    </>
                  )}
                  <Info className="w-3 h-3 opacity-75 sm:opacity-0 group-hover/subtitle:opacity-75 transition-opacity shrink-0 sm:ml-0.5 text-primary" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
            {activeScene && (
              <div className="flex items-center gap-0.5 sm:gap-1 bg-muted/65 p-0.5 sm:p-1 rounded-xl border border-border/60">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={`h-8 w-8 p-0 sm:h-7 sm:w-auto sm:px-2.5 gap-1.5 text-xs rounded-lg font-medium transition-all ${
                    scenePanelTab === "note" ? "bg-card text-foreground shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setScenePanelTab(scenePanelTab === "note" ? null : "note")}
                  title="展开/收起剧本设定便签"
                  aria-label="剧本设定便签"
                  aria-pressed={scenePanelTab === "note"}
                >
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">{scenePanelTab === "note" ? "收起便签" : "便签"}</span>
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={`h-8 w-8 p-0 sm:h-7 sm:w-auto sm:px-2.5 gap-1.5 text-xs rounded-lg font-medium transition-all ${
                    scenePanelTab === "context" ? "bg-card text-foreground shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setScenePanelTab(scenePanelTab === "context" ? null : "context")}
                  title="查看与管理剧本上下文"
                  aria-label="剧本上下文"
                  aria-pressed={scenePanelTab === "context"}
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">上下文</span>
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="inline-flex sm:hidden md:inline-flex h-8 w-8 p-0 md:h-7 md:w-auto md:px-2 gap-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground items-center"
                  onClick={() => navigate(`/scenes/${personaId}`)}
                  title={`当前场景：${activeScene.name}，切换剧本`}
                  aria-label={`当前场景：${activeScene.name}，切换剧本`}
                >
                  <Theater className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">换剧本</span>
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 p-0 sm:h-7 sm:w-auto sm:px-2 gap-1.5 text-xs rounded-lg text-destructive hover:bg-destructive/10"
                  onClick={() => deactivateSceneMutation.mutate({ personaId })}
                  disabled={deactivateSceneMutation.isPending}
                  title="退出当前情境剧场"
                  aria-label="退出当前情境剧场"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">退出</span>
                </Button>
              </div>
            )}

            {/* Mobile Workbench Trigger */}
            <button
              type="button"
              onClick={() => setShowMobileWorkbench(true)}
              title="打开陪伴工作台"
              aria-label="打开陪伴工作台"
              className="app-nav-icon lg:hidden text-primary bg-primary/8 hover:bg-primary/15"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            {/* More Menu */}
            <div ref={menuContainerRef} className="relative">
              <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                title="系统设置与管理"
                aria-label="更多"
                className="app-nav-icon"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              <MotionPopover
                open={showMenu}
                direction="down"
                className="absolute right-0 top-full mt-1.5 bg-card/96 backdrop-blur-2xl border border-border/75 rounded-2xl shadow-xl p-1.5 min-w-[184px] z-50"
              >
                <button
                  type="button"
                  onClick={() => { void handleExport(); setShowMenu(false); }}
                  disabled={exportMutation.isPending}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/75 rounded-xl transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />导出对话
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMenu(false); setShowNewContextConfirm(true); }}
                  disabled={startNewContextMutation.isPending}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/75 rounded-xl transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-primary" />重新开对话
                </button>
                <button
                  type="button"
                  onClick={() => { setShowHistoryManager(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/75 rounded-xl transition-colors"
                >
                  <ListChecks className="w-3.5 h-3.5 text-muted-foreground" />管理聊天记录
                </button>
                <div className="my-1 border-t border-border/55" />
                <button
                  type="button"
                  onClick={() => { setShowMenu(false); setShowClearConfirm(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />清空对话
                </button>
              </MotionPopover>
            </div>
          </div>
        </div>
      </header>

      {/* 中窄屏（<xl）下的右侧剧场面板抽屉，绝不挤压碰撞主聊天列 */}
      {!isXlViewport && (
        <MotionDrawer
          open={Boolean(activeScene && scenePanelTab)}
          onClose={() => setScenePanelTab(null)}
          side="right"
          ariaLabel="剧本设定与上下文"
          className="w-full max-w-[400px]"
        >
          {renderScenePanelBody()}
        </MotionDrawer>
      )}

      <SearchPanel
        open={showSearch}
        personaId={personaId}
        onClose={() => setShowSearch(false)}
      />

      {/* Main Responsive Flex Workspace (Left Dock + Center Stream + Optional XL Right Dock) */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
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

        {/* Center Column: Message Stream + Aligned Composer (无硬编码负向位移，弹性自适应) */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative scroll-smooth min-h-0 sm:pr-14 xl:pr-6">
            <div className="max-w-3xl mx-auto py-6 px-3 sm:px-6 relative z-10">
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={SPRING_SILKY}
                  className="text-center py-16 max-w-md mx-auto"
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-3xl bg-card border border-border/75 shadow-sm flex items-center justify-center text-3xl">
                    {stateInfo.emoji}
                  </div>
                  <p className="text-foreground font-semibold text-base tracking-tight mb-1">{persona?.name} 在等你开口</p>
                  <p className="text-muted-foreground text-xs sm:text-sm">{stateInfo.desc}</p>
                  <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    {(((persona?.personaData as any)?.starterQuestions?.length > 0
                      ? (persona?.personaData as any).starterQuestions
                      : ["故事从哪里开始？", "能说说你所在的地方吗？", "今天发生了什么？", "接下来我们去哪里？"]) as string[]).map((q: string) => (
                      <button
                        type="button"
                        key={q}
                        onClick={() => setInput(q)}
                        className="text-xs px-3.5 py-1.5 bg-card/80 border border-border/75 rounded-full text-muted-foreground hover:text-primary hover:border-primary/35 hover:bg-primary/5 transition-all shadow-2xs active:scale-97"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </motion.div>
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
                      ttsEnabled={voiceConfig.data?.ttsEnabled ?? true}
                    />
                  </Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Bottom Composer */}
          <div className="shrink-0 w-full bg-background/88 backdrop-blur-xl border-t border-border/45 px-3 sm:px-6 sm:pr-14 xl:pr-6 pb-3 pt-2.5 z-20 pb-safe">
            <div className="chat-composer max-w-3xl mx-auto py-2 sm:py-2.5 px-2.5 sm:px-3.5">
              {Object.entries(sceneImageNotices).map(([id, notice]) => (
                <div key={id} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1 text-xs">
                  <span role="status" className={notice.error ? "text-destructive" : "text-muted-foreground"}>{notice.text}</span>
                  {notice.pending ? (
                    <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => {
                      const request = sceneImageRequests.current.get(id);
                      if (request) cancelSceneImage(request, false);
                    }}>取消配图</Button>
                  ) : (
                    <button type="button" aria-label="关闭配图提示" onClick={() => setSceneImageNotice(id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              {voiceStage ? (
                <div className="flex items-center gap-3 h-11">
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="text-destructive hover:bg-destructive/10 rounded-xl w-10 h-10 flex items-center justify-center transition-colors"
                    aria-label={voiceStage === "sending" ? "取消语音请求" : "取消录音"}
                    title={voiceStage === "sending" ? "取消语音请求" : "取消录音"}
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="flex-1 flex items-center gap-2.5 min-w-0">
                    {voiceStage === "recording" ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                        <span className="text-xs sm:text-sm font-mono tabular-nums text-foreground shrink-0">
                          录音中 {recordingTime}″
                        </span>
                        <div className="flex-1 flex items-center gap-1 px-2 h-6 overflow-hidden" aria-hidden="true">
                          {RECORDING_WAVE.map((barHeight, i) => (
                            <div
                              key={i}
                              className="w-1 rounded-full bg-primary/65 animate-voice-wave"
                              style={{ height: `${barHeight}px`, animationDelay: `${i * 0.06}s` }}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <span role="status" className="text-sm text-foreground">
                        {voiceStage === "requesting" ? "正在等待麦克风权限…"
                          : voiceStage === "finishing" ? "正在处理录音…"
                          : voiceStage === "sending" ? "正在转写并发送语音…"
                          : `录音已结束（${recordingTime}″），可以发送`}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={stopRecording}
                    disabled={(voiceStage !== "recording" && voiceStage !== "ready") || !isOnline}
                    aria-label="发送录音"
                    className="h-10 w-10 p-0 rounded-xl flex-shrink-0"
                    title="完成并发送语音"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2 items-end">
                  <div ref={attachContainerRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAttach(!showAttach)}
                      className="h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/75 rounded-xl transition-colors"
                      title="发送图片或语音"
                    >
                      <Plus className={`w-5 h-5 transition-transform duration-200 ${showAttach ? "rotate-45 text-primary" : ""}`} />
                    </button>
                    <MotionPopover
                      open={showAttach}
                      direction="up"
                      className="absolute bottom-full left-0 mb-2 bg-card/96 backdrop-blur-2xl border border-border/75 rounded-2xl shadow-xl p-1.5 min-w-[148px] z-50"
                    >
                      <label className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/75 rounded-xl transition-colors cursor-pointer">
                        <Image className="w-4 h-4 text-primary" />发送图片
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                      </label>
                      <button
                        type="button"
                        onClick={() => { setShowAttach(false); void startRecording(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/75 rounded-xl transition-colors"
                      >
                        <Mic className="w-4 h-4 text-primary" />语音消息
                      </button>
                    </MotionPopover>
                  </div>
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`对 ${persona?.name || "TA"} 说点什么...`}
                    rows={1}
                    className="flex-1 resize-none bg-transparent hover:bg-muted/35 focus-visible:bg-muted/25 border-transparent hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 rounded-xl min-h-[40px] max-h-32 text-sm shadow-none px-2.5 py-2"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || isSending || !isOnline}
                    className={`h-10 w-10 p-0 rounded-xl flex-shrink-0 transition-all ${
                      input.trim()
                        ? ""
                        : "bg-muted text-muted-foreground/50 shadow-none hover:shadow-none"
                    }`}
                    title="发送消息"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 宽屏（xl+）弹性右侧剧场停靠栏，与中心列自然并排无遮挡 */}
        {isXlViewport && (
          <AnimatePresence initial={false}>
            {activeScene && scenePanelTab && (
              <motion.aside
                key="xl-scene-dock"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 392, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={SPRING_SILKY}
                className="hidden xl:flex shrink-0 my-3 mr-16 z-20 overflow-hidden"
              >
                <div className="w-[392px] h-full backdrop-blur-2xl bg-card/92 border border-border/75 rounded-3xl shadow-xl flex flex-col overflow-hidden">
                  {renderScenePanelBody()}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        )}

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

      {/* 重新开对话二次确认（替代原生阻塞式 window.confirm） */}
      <AlertDialog open={showNewContextConfirm} onOpenChange={setShowNewContextConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新开启本段对话？</AlertDialogTitle>
            <AlertDialogDescription>
              历史记录保留，同时重开当前模式的对话上下文。若正在场景中，会重开该场景的上下文并重置其剧情状态，保留手工确认的事实；已确认的长期记忆保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => startNewContextMutation.mutate({ personaId })}
              disabled={startNewContextMutation.isPending}
            >
              {startNewContextMutation.isPending ? "处理中..." : "确认开启新段落"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清空对话二次确认 */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空日常对话记录？</AlertDialogTitle>
            <AlertDialogDescription>
              该操作将清空与 {persona?.name || "TA"} 的日常对话，不影响场景记录。页面不能直接撤销。若只想重置上下文并保留历史，请选择“重新开对话”。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => clearMutation.mutate({ personaId })}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? "清空中..." : "确认清空"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 人物与关系设定详情弹簧弹窗 */}
      <MotionModal
        open={showSettingDetail}
        onClose={() => setShowSettingDetail(false)}
        ariaLabel="人物与关系设定详情"
        className="max-w-md p-6 space-y-4"
      >
        <button
          type="button"
          onClick={() => setShowSettingDetail(false)}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground w-8 h-8 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3.5">
          <img
            src={getAvatarUrl(persona?.name || "?", (persona as { avatarUrl?: string | null } | undefined)?.avatarUrl)}
            alt={persona?.name || ""}
            className="w-12 h-12 rounded-2xl object-cover ring-1 ring-border/80 shadow-xs"
          />
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              {persona?.name}
              {intimacy && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  {intimacy.icon} {intimacy.level}
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono tabular-nums">
              {persona?.togetherFrom && persona?.togetherTo ? `${persona.togetherFrom} ~ ${persona.togetherTo}` : "相伴时光"}
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1 text-xs">
          <div className="p-3.5 rounded-2xl bg-muted/35 border border-border/60 space-y-1.5">
            <span className="font-semibold text-foreground/90 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              关系与背景设定
            </span>
            <p className="text-muted-foreground leading-relaxed">
              {persona?.relationshipDesc || "暂无详细关系描述"}
            </p>
          </div>

          {activeScene && (
            <div className="p-3.5 rounded-2xl bg-primary/8 border border-primary/20 space-y-1.5">
              <span className="font-semibold text-primary flex items-center gap-1.5">
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

        <div className="pt-1 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettingDetail(false)}
            className="px-4 text-xs"
          >
            关闭
          </Button>
        </div>
      </MotionModal>

      <MemoryTimeline open={showTimeline} personaId={personaId} activeSceneId={activeSceneId} onClose={() => setShowTimeline(false)} />
      <SourceLibraryPanel open={showSourceLibrary} personaId={personaId} onClose={() => setShowSourceLibrary(false)} />
      {showDiagnostics && <PersonaStatePanel personaId={personaId} onClose={() => setShowDiagnostics(false)} />}
      <EmotionReport open={showEmotionReport} personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowEmotionReport(false)} />
      <DiaryModal open={showDiary} personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowDiary(false)} />
      <AnimatePresence>
        {showHistoryManager && (
          <ChatHistoryManager
            personaId={personaId}
            personaName={persona?.name || "人物"}
            onClose={() => setShowHistoryManager(false)}
            onHistoryChanged={() => { void refetchHistory(); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
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
      </AnimatePresence>

      {/* 移动端陪伴工作台丝滑底部抽屉 */}
      <MotionDrawer
        open={showMobileWorkbench}
        onClose={() => setShowMobileWorkbench(false)}
        side="bottom"
        ariaLabel="陪伴工作台"
        className="p-5 space-y-4 overflow-y-auto pb-safe"
      >
        <div className="w-10 h-1 rounded-full bg-border mx-auto -mt-1.5 mb-1 shrink-0" />
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <h3 className="font-semibold text-sm text-foreground">陪伴工作台</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileWorkbench(false)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground tracking-wider">当前情感状态</p>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-muted/40 border border-border/50">
              {Object.entries(STATES).map(([key, s]) => {
                const isActive = currentState === key;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
                      setCurrentState(key);
                    }}
                    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-medium transition-all ${
                      isActive
                        ? `state-bg-${key} state-${key} ring-1 ring-primary/35 shadow-2xs font-semibold`
                        : "text-muted-foreground hover:text-foreground hover:bg-card/80 border border-border/35"
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
            <p className="text-[11px] font-medium text-muted-foreground tracking-wider">沉浸与感知</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { navigate(`/scenes/${personaId}`); setShowMobileWorkbench(false); }}
                className={`p-3 rounded-2xl border flex items-center gap-2.5 text-left transition-all ${
                  activeScene ? "bg-primary/10 border-primary/25 text-primary font-semibold" : "bg-muted/35 hover:bg-muted/65 border-border/60"
                }`}
              >
                <div className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0">
                  <Theater className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">情境剧场</p>
                  <p className="text-[10px] text-muted-foreground truncate">{activeScene ? activeScene.name : "剧本与情境"}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowTimeline(true); setShowMobileWorkbench(false); }}
                className="p-3 rounded-2xl bg-muted/35 hover:bg-muted/65 border border-border/60 flex items-center gap-2.5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-muted text-foreground/80 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">记忆时间线</p>
                  <p className="text-[10px] text-muted-foreground truncate">关键回忆节点</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowSourceLibrary(true); setShowMobileWorkbench(false); }}
                className="p-3 rounded-2xl bg-muted/35 hover:bg-muted/65 border border-border/60 flex items-center gap-2.5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-muted text-foreground/80 flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">资料库</p>
                  <p className="text-[10px] text-muted-foreground truncate">设定与背景</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowEmotionReport(true); setShowMobileWorkbench(false); }}
                className="p-3 rounded-2xl bg-muted/35 hover:bg-muted/65 border border-border/60 flex items-center gap-2.5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-muted text-foreground/80 flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">情绪报告</p>
                  <p className="text-[10px] text-muted-foreground truncate">心情波动曲线</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowDiary(true); setShowMobileWorkbench(false); }}
                className="p-3 rounded-2xl bg-muted/35 hover:bg-muted/65 border border-border/60 flex items-center gap-2.5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-muted text-foreground/80 flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">对话日记</p>
                  <p className="text-[10px] text-muted-foreground truncate">每日情感日记</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowDiagnostics(true); setShowMobileWorkbench(false); }}
                className="p-3 rounded-2xl bg-muted/35 hover:bg-muted/65 border border-border/60 flex items-center gap-2.5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-muted text-foreground/80 flex items-center justify-center shrink-0">
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
      </MotionDrawer>

      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showGraduation} onClose={() => setShowGraduation(false)} />
    </div>
  );
}

// ─── SEARCH PANEL (RIGHT DRAWER) ──────────────────────────────────────────

function SearchPanel({
  open,
  personaId,
  onClose,
}: {
  open: boolean;
  personaId: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const { data: results, isLoading } = trpc.chat.search.useQuery(
    { personaId, query: debouncedQuery },
    { enabled: open && debouncedQuery.length > 0 }
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
        <mark key={i} className="bg-primary/20 text-primary font-semibold rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  const handleJump = (msgId: number | string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/60", "rounded-3xl", "transition-all", "duration-500");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary/60", "rounded-3xl");
      }, 2400);
    }
    onClose();
  };

  return (
    <MotionDrawer
      open={open}
      onClose={onClose}
      side="right"
      ariaLabel="搜索历史消息"
      className="w-full sm:w-[420px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/15 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/15 shadow-2xs">
            <Search className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground tracking-tight">搜索历史消息</h3>
            <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
              {debouncedQuery && results ? `找到 ${results.length} 条相关消息` : "检索与 TA 的过往对话"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="p-4 border-b border-border/50 bg-muted/10 shrink-0">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="输入关键词搜索聊天记录..."
            className="w-full h-10.5 pl-10 pr-9 bg-background/90 border border-border/75 focus:border-primary/50 focus:ring-2 focus:ring-primary/15 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all shadow-2xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDebouncedQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Results Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 panel-scrollbar">
        {!debouncedQuery ? (
          <div className="text-center py-20 text-muted-foreground/75 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground/55 border border-border/45">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-xs">在上方输入关键词检索对话</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-20 text-muted-foreground space-y-2.5">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary/70" />
            <p className="text-xs">正在搜索相关消息...</p>
          </div>
        ) : results && results.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/45">
              <X className="w-5 h-5 opacity-45" />
            </div>
            <p className="text-xs">未找到包含 “{debouncedQuery}” 的消息</p>
          </div>
        ) : (
          results?.map((m: any) => (
            <button
              type="button"
              key={m.id}
              onClick={() => handleJump(m.id)}
              className="group/item w-full text-left p-3.5 rounded-2xl bg-muted/25 hover:bg-primary/6 border border-border/55 hover:border-primary/30 transition-all cursor-pointer space-y-2 shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                    m.role === "user"
                      ? "bg-primary/12 text-primary border border-primary/20"
                      : "bg-muted text-foreground/80 border border-border/60"
                  }`}
                >
                  {m.role === "user" ? "我" : "TA"}
                </span>
                <span className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
                  {formatBeijingDate(m.createdAt)} {formatBeijingTime(m.createdAt)}
                </span>
              </div>
              <p className="text-xs sm:text-[13px] text-foreground/90 line-clamp-3 leading-relaxed">
                {highlight(m.content, debouncedQuery)}
              </p>
              <div className="flex items-center justify-end text-[11px] text-primary opacity-0 translate-x-1 group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-200 font-medium">
                <span>跳转至该消息 →</span>
              </div>
            </button>
          ))
        )}
      </div>
    </MotionDrawer>
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

type MemoryScope = "daily" | "all" | `scene:${number}`;

function MemoryTimeline({ open, personaId, activeSceneId, onClose }: {
  open: boolean;
  personaId: number;
  activeSceneId: number | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const extractOperation = useRef<{ personaId: number; id: string } | null>(null);
  const extractInFlight = useRef(false);
  const enabled = open && personaId > 0;
  const { data: memories, refetch, isFetching: memoriesFetching } = trpc.memory.list.useQuery({ personaId }, { enabled });
  const scenes = trpc.scene.list.useQuery(undefined, { enabled });
  const reviewed = trpc.memoryReview.list.useQuery({ personaId, status: "accepted" }, { enabled });

  const activeScope: MemoryScope = activeSceneId === null ? "daily" : `scene:${activeSceneId}`;
  const [selectedScope, setSelectedScope] = useState<MemoryScope>(activeScope);
  useEffect(() => {
    if (open) setSelectedScope(activeScope);
  }, [open, personaId, activeScope]);

  const sceneNames = new Map(scenes.data?.map(scene => [scene.id, scene.name] as const));
  const storyEvents = (reviewed.data ?? []).flatMap(event =>
    event.kind === "story_event" && event.application === "reviewed_only" &&
    event.sceneId !== null && sceneNames.has(event.sceneId) ? [{ ...event, sceneId: event.sceneId }] : [],
  );
  const storySceneIds = new Set(storyEvents.map(event => event.sceneId));
  if (activeSceneId !== null) storySceneIds.add(activeSceneId);
  const sceneIds = Array.from(storySceneIds).sort((first, second) => {
    if (first === second) return 0;
    if (first === activeSceneId) return -1;
    if (second === activeSceneId) return 1;
    return (sceneNames.get(first) ?? "").localeCompare(sceneNames.get(second) ?? "", "zh-CN");
  });
  const scopes: { key: MemoryScope; label: string }[] = [
    { key: "daily", label: "日常记忆" },
    ...sceneIds.map(id => ({ key: `scene:${id}` as const, label: sceneNames.get(id) ?? "当前场景" })),
    { key: "all", label: "全部档案" },
  ];
  const selectedSceneId = selectedScope.startsWith("scene:") ? Number(selectedScope.slice(6)) : null;
  const scope = selectedSceneId === null || selectedSceneId === activeSceneId || sceneNames.has(selectedSceneId)
    ? selectedScope : activeScope;
  const sceneId = scope.startsWith("scene:") ? Number(scope.slice(6)) : null;
  const sceneDetail = trpc.scene.detail.useQuery({ id: sceneId ?? 0, personaId }, { enabled: enabled && sceneId !== null });
  const sceneEvents = trpc.memoryReview.reviewedFacts.useQuery({ personaId, kind: "story_event", sceneId: sceneId ?? undefined }, {
    enabled: enabled && sceneId !== null,
  });
  const showDaily = scope === "daily" || scope === "all";
  const showStories = scope !== "daily";
  const canExtract = scope === activeScope || scope === "all";
  const scopedStoryEvents = scope === "all" ? storyEvents : sceneEvents.data ?? [];
  const storyEventsLoading = scope === "all" ? scenes.isLoading || reviewed.isLoading : sceneEvents.isLoading;
  const storyEventsError = scope === "all" ? scenes.isError || reviewed.isError : sceneEvents.isError;
  const sceneCache = sceneId === null ? undefined : sceneDetail.data?.memory.cache;
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
  const deleteMutation = trpc.memory.delete.useMutation({ onSuccess: () => { setConfirmDeleteId(null); void refetch(); toast.success("记忆已删除"); } });
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
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
      const revision = form.revision;
      if (typeof revision !== "number" || !Number.isSafeInteger(revision)) {
        toast.error("缺少记忆版本，请刷新并重新打开编辑");
        void refetch();
        return;
      }
      updateMutation.mutate({ id: editingId, ...memoryPayload(form), expectedRevision: revision });
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

  const tabItems: Array<{
    key: typeof activeTab;
    label: string;
    count: number;
  }> = [
    { key: "active", label: "有效记忆", count: stats.active },
    { key: "all", label: "全部", count: stats.total },
    { key: "high_importance", label: "⭐ 高重要", count: stats.highImportance },
    { key: "low_confidence", label: "⚠️ 低可信", count: stats.lowConfidence },
    { key: "archived", label: "📦 已归档", count: stats.archived },
    { key: "contradicted", label: "❌ 已标错", count: stats.contradicted },
  ];

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="记忆时间轴与档案"
      className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col p-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4.5 border-b border-border/60 bg-muted/10 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center shadow-2xs shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base text-foreground tracking-tight">记忆时间轴 & 档案</h3>
              {showDaily && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/20 font-mono tabular-nums">
                {stats.active} 条有效
              </span>}
              {showDaily && stats.lowConfidence > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold border border-amber-500/20 font-mono tabular-nums">
                  {stats.lowConfidence} 条待核验
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              浏览日常记忆和已审阅的场景事件
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canExtract && <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (extractInFlight.current) return;
              if (extractOperation.current?.personaId !== personaId) {
                extractOperation.current = { personaId, id: crypto.randomUUID() };
              }
              extractInFlight.current = true;
              extractMutation.mutate({ personaId, operationId: extractOperation.current.id });
            }}
            disabled={extractMutation.isPending}
            title={activeSceneId === null ? "从当前日常对话提取候选" : "从当前剧场对话提取候选"}
            className="text-xs border-primary/25 bg-primary/8 text-primary hover:bg-primary/15"
          >
            <Sparkles className={`w-3.5 h-3.5 ${extractMutation.isPending ? "animate-spin" : ""}`} />
            {extractMutation.isPending ? "AI 提取中..." : "AI 提取候选"}
          </Button>}
          {showDaily && <Button
            type="button"
            size="sm"
            onClick={startAdd}
            className="text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            添加日常记忆
          </Button>}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭记忆档案"
            className="w-8.5 h-8.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-border/55 shrink-0">
        <div role="group" aria-label="记忆来源" className="flex min-w-0 max-w-full gap-2 overflow-x-auto">
          {scopes.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={scope === key ? "default" : "outline"}
              aria-pressed={scope === key}
              onClick={() => setSelectedScope(key)}
              className="max-w-full text-xs"
            >
              <span className="truncate">{label}</span>
            </Button>
          ))}
        </div>
        {Boolean(scenes.data?.length) && (
          <select
            aria-label="按场景查看记忆"
            className="h-8 max-w-full rounded-lg border border-border bg-background px-2 text-xs"
            value={sceneId ?? ""}
            onChange={event => {
              if (event.target.value) setSelectedScope(`scene:${Number(event.target.value)}`);
            }}
          >
            <option value="" disabled>按场景查看</option>
            {scenes.data?.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </select>
        )}
      </div>

      {showDaily && <div className="px-6 py-3 border-b border-border/55 bg-card/60 space-y-2.5 shrink-0 z-10">
        {/* Status Tabs with Spring Pill */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar text-xs">
          {tabItems.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative px-3 py-1.5 rounded-xl font-medium transition-colors shrink-0 ${
                  isActive
                    ? "text-primary-foreground font-semibold"
                    : "bg-muted/45 text-muted-foreground hover:text-foreground hover:bg-muted/80"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="memory-timeline-tab-pill"
                    transition={SPRING_SNAPPY}
                    className="pointer-events-none absolute inset-0 rounded-xl bg-primary shadow-xs"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  <span>{tab.label}</span>
                  <span className="font-mono tabular-nums opacity-85">({tab.count})</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Secondary Filter Selects */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索日常记忆标题、关键词、情绪…"
              className="w-full h-9.5 pl-9.5 pr-8 bg-muted/35 border border-border/70 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all shadow-2xs"
            />
            {query && (
              <button
                type="button"
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
              className="h-9.5 px-3 bg-background/85 border border-border/70 rounded-xl text-xs text-foreground outline-none focus:border-primary/50 transition-all shadow-2xs"
            >
              <option value="all">全部类型</option>
              {MEMORY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-9.5 px-3 bg-background/85 border border-border/70 rounded-xl text-xs text-foreground outline-none focus:border-primary/50 transition-all shadow-2xs"
            >
              <option value="all">全部来源</option>
              {MEMORY_SOURCES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>}

      {/* Content Stream */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 panel-scrollbar">
        {open && <MemoryReviewCandidates key={personaId} personaId={personaId} />}
        {sceneCache && (sceneCache.summary || sceneCache.pinnedFacts.length > 0) && (
          <section className="space-y-2 rounded-3xl border border-border/60 bg-card/90 p-4">
            <h4 className="text-sm font-semibold">场景前情</h4>
            {sceneCache.summary && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{sceneCache.summary}</p>}
            {sceneCache.pinnedFacts.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {sceneCache.pinnedFacts.map(fact => <li key={fact.id}>📌 {fact.fact}</li>)}
              </ul>
            )}
          </section>
        )}
        {showStories && (
          <section aria-label="已审阅的场景事件" className="space-y-3 rounded-3xl border border-border/60 bg-card/90 p-4">
            <h4 className="text-sm font-semibold">已审阅的场景事件</h4>
            {!canExtract && <p className="text-xs text-muted-foreground">进入此场景后，可从该场景的当前对话提取候选。</p>}
            {storyEventsError ? (
              <p role="alert" className="text-xs text-destructive">场景事件加载失败，请稍后重试。</p>
            ) : storyEventsLoading ? (
              <p className="text-xs text-muted-foreground">正在加载场景事件…</p>
            ) : scopedStoryEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">此分区暂无已审阅的场景事件。</p>
            ) : (
              <ul className="space-y-2">
                {scopedStoryEvents.map(event => (
                  <li key={event.id} className="space-y-1 rounded-xl border border-border/60 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h5 className="font-medium">{event.title}</h5>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {sceneNames.get(event.sceneId ?? 0) ?? "当前场景"}
                      </span>
                      {event.date && <span className="text-xs text-muted-foreground">{event.date}</span>}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{event.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <CollapseSection open={showDaily && showingForm} innerClassName={showDaily && showingForm ? "pb-2" : ""}>
          <div className="p-5 bg-card border border-primary/30 rounded-3xl space-y-4 shadow-md">
            <div className="flex items-center justify-between pb-2 border-b border-border/45">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Pencil className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {editingId ? `编辑记忆 #${editingId}` : "添加新记忆"}
                </span>
              </div>
              <button type="button" onClick={cancelForm} className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted/60 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-foreground/85 mb-1 block">标题 / 核心结论 *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="简练明确的记忆摘要，例如：喜欢吃日料且不吃香菜"
                  className="w-full h-10 px-3.5 bg-background border border-border/80 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground/85 mb-1 block">事实细节与对话上下文</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="详细描述该记忆的具体内容、触发场景或约定细则..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all resize-none leading-relaxed"
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
                    className="w-full h-9 px-2.5 bg-background border border-border/80 rounded-xl text-xs text-foreground font-mono tabular-nums"
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
                <div className="space-y-1.5 p-3 rounded-2xl bg-muted/20 border border-border/45">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-medium">重要度</span>
                    <span className="font-semibold text-primary font-mono tabular-nums">{form.importance} / 5</span>
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

                <div className="space-y-1.5 p-3 rounded-2xl bg-muted/20 border border-border/45">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-medium">可信度</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">{form.confidence} / 5</span>
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
                    className="w-full h-9 px-3 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">情绪色彩</label>
                  <input
                    value={form.emotion}
                    onChange={(e) => setForm((f) => ({ ...f, emotion: e.target.value }))}
                    placeholder="例：温馨、期待、认真"
                    className="w-full h-9 px-3 bg-background border border-border/80 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              {selectedEvidenceText && (
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums bg-muted/30 p-2 rounded-lg">
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
            <div className="flex gap-2.5 justify-end pt-2 border-t border-border/45">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelForm}
                className="text-xs"
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveForm}
                disabled={!form.title.trim() || formConflict || createMutation.isPending || updateMutation.isPending}
                className="text-xs px-5"
              >
                <Save className="w-3.5 h-3.5" />
                保存记忆
              </Button>
            </div>
          </div>
        </CollapseSection>

        {showDaily && (!memories || memories.length === 0) && !showingForm && (
          <div className="text-center py-20 text-muted-foreground space-y-3">
            <div className="w-14 h-14 mx-auto rounded-3xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/45">
              <Clock className="w-7 h-7 opacity-40" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">暂无日常记忆</p>
              <p className="text-xs text-muted-foreground mt-1">可手动添加，或在日常对话中提取候选供审阅。</p>
            </div>
          </div>
        )}

        {showDaily && filteredMemories.length === 0 && memories && memories.length > 0 && !showingForm && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/45">
              <Filter className="w-5 h-5 opacity-40" />
            </div>
            <p className="text-xs">当前筛选条件下暂无记忆</p>
          </div>
        )}

        <div className="space-y-3.5">
          {showDaily && filteredMemories.map((m: any) => {
            const cat = m.category === "anchor"
              ? { ...CATEGORY_LABELS.memory, label: "事实锚点", emoji: "📌" }
              : CATEGORY_LABELS[m.category] || CATEGORY_LABELS.memory;
            const status = MEMORY_STATUS_LABELS[m.status || "active"] || MEMORY_STATUS_LABELS.active;
            const typeLabel = MEMORY_TYPE_LABELS[m.memoryType || "relationship_event"] || m.memoryType || "记忆";
            const sourceLabel = MEMORY_SOURCE_LABELS[m.source || "manual"] || m.source || "未知";
            const lowConfidence = (m.confidence ?? 3) <= 2;
            const keywordsList = Array.isArray(m.keywords) ? m.keywords : (m.keywords ? String(m.keywords).split(/[,，、]/) : []);
            const isConfirmingDelete = confirmDeleteId === m.id;

            return (
              <div
                key={m.id}
                className="group/card relative rounded-2xl border border-border/60 bg-card/90 hover:bg-muted/20 p-4.5 transition-colors shadow-2xs space-y-3"
              >
                {/* Left Color Indicator */}
                <div className={`absolute top-4 bottom-4 left-0 w-1 rounded-r-full ${cat.color}`} />

                {/* Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${status.tone}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>

                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cat.badgeBg} ${cat.textCol} ${cat.borderCol}`}>
                      <span>{cat.emoji}</span>
                      {cat.label}
                    </span>

                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/45">
                      {typeLabel}
                    </span>

                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground/80">
                      {sourceLabel}
                    </span>

                    {m.date && (
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground flex items-center gap-1 ml-1">
                        <Calendar className="w-3 h-3 text-muted-foreground/60" />
                        {m.date}
                      </span>
                    )}
                  </div>

                  {/* Metric Stars */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono tabular-nums">
                    <div className="flex items-center gap-0.5" title={`重要度: ${m.importance ?? 3}/5`}>
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      <span className="font-semibold text-foreground">{m.importance ?? 3}</span>
                    </div>
                    <div className="flex items-center gap-1" title={`可信度: ${m.confidence ?? 3}/5`}>
                      <span className="text-[10px] text-muted-foreground font-sans">可信</span>
                      <span className={`font-semibold ${lowConfidence ? "text-rose-500 font-bold" : "text-foreground"}`}>
                        {m.confidence ?? 3}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Title & Body */}
                <div className="pl-2 space-y-1.5">
                  <h4 className="text-sm sm:text-[15px] font-semibold text-foreground tracking-tight leading-snug">
                    {m.title}
                  </h4>
                  {m.description && (
                    <p className="text-xs sm:text-[13px] text-foreground/85 leading-relaxed bg-muted/20 rounded-xl p-3 border border-border/45">
                      {m.description}
                    </p>
                  )}
                </div>

                {/* Keywords & Tags */}
                {(keywordsList.length > 0 || m.emotion) && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-2 pt-0.5">
                    {m.emotion && (
                      <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-primary/8 text-primary font-medium border border-primary/18">
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
                  <span className="text-[10.5px] text-muted-foreground/65 font-mono tabular-nums">
                    ID: #{m.id}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-muted/55 hover:bg-primary/10 hover:text-primary text-foreground font-medium transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      编辑
                    </button>

                    {(m.status || "active") !== "active" ? (
                      <button
                        type="button"
                        onClick={() => updateStatus(m, "active")}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-medium transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        恢复有效
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => updateStatus(m, "archived")}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-muted/55 hover:bg-muted text-muted-foreground hover:text-foreground font-medium transition-colors"
                        >
                          <Archive className="w-3 h-3" />
                          归档
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatus(m, "contradicted")}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-medium transition-colors"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          标错
                        </button>
                      </>
                    )}

                    {isConfirmingDelete ? (
                      <div className="inline-flex items-center gap-1 ml-1 pl-1.5 border-l border-border/50">
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate({ id: m.id })}
                          disabled={deleteMutation.isPending}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 transition-colors"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(m.id)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-xl text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors ml-1"
                        title="删除记忆"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </MotionModal>
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

function SourceLibraryPanel({
  open,
  personaId,
  onClose,
}: {
  open: boolean;
  personaId: number;
  onClose: () => void;
}) {
  const [queryInput, setQueryInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const { data, isLoading, refetch } = trpc.sourceLibrary.overview.useQuery(
    { personaId, query: submittedQuery },
    { enabled: open && personaId > 0 }
  );
  const sources = data?.sources ?? [];
  const results = data?.search?.results ?? [];

  const runSearch = () => setSubmittedQuery(queryInput.trim());
  const clearSearch = () => {
    setQueryInput("");
    setSubmittedQuery("");
  };

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="资料库与原著知识沉淀"
      className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col p-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4.5 border-b border-border/60 bg-muted/10 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center shadow-2xs shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base text-foreground tracking-tight">资料库 & 原著知识沉淀</h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 font-mono tabular-nums">
                {formatCount(data?.stats?.sourceCount)} 个来源 / {formatCount(data?.stats?.chunkCount)} 个片段
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              原著设定、背景档案与检索召回中枢（RAG 证据源）
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void refetch(); }}
            disabled={isLoading}
            className="text-xs"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            刷新资料
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="w-8.5 h-8.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Overview Stats Bar & Search */}
      <div className="px-6 py-3.5 border-b border-border/55 bg-card/60 space-y-3 shrink-0 z-10">
        {/* Quick Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3 shadow-2xs">
            <span className="text-[10.5px] font-semibold text-muted-foreground tracking-wider block">知识来源</span>
            <p className="text-lg font-semibold text-foreground mt-0.5 font-mono tabular-nums">{formatCount(data?.stats?.sourceCount)}</p>
          </div>
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3 shadow-2xs">
            <span className="text-[10.5px] font-semibold text-muted-foreground tracking-wider block">切片片段</span>
            <p className="text-lg font-semibold text-primary mt-0.5 font-mono tabular-nums">{formatCount(data?.stats?.chunkCount)}</p>
          </div>
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3 shadow-2xs">
            <span className="text-[10.5px] font-semibold text-muted-foreground tracking-wider block">结构章节</span>
            <p className="text-lg font-semibold text-foreground mt-0.5 font-mono tabular-nums">{formatCount(data?.stats?.chapterCount)}</p>
          </div>
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3 shadow-2xs">
            <span className="text-[10.5px] font-semibold text-muted-foreground tracking-wider block">估算 Tokens</span>
            <p className="text-lg font-semibold text-foreground mt-0.5 font-mono tabular-nums">{formatCount(data?.stats?.tokenEstimate)}</p>
          </div>
        </div>

        {/* Search Box */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="检索原著设定、名台词或剧情片段..."
              className="w-full h-10 pl-10 pr-9 bg-muted/35 border border-border/70 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all shadow-2xs"
            />
            {queryInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted/60 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            type="button"
            onClick={runSearch}
            disabled={!queryInput.trim()}
            className="h-10 px-5 rounded-xl text-xs"
          >
            检索
          </Button>
        </div>

        {/* Hot Keywords */}
        {Boolean(data?.topKeywords?.length) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[10.5px] text-muted-foreground font-medium mr-1">推荐关键词:</span>
            {data!.topKeywords.slice(0, 10).map((keyword: string) => (
              <button
                type="button"
                key={keyword}
                onClick={() => {
                  setQueryInput(keyword);
                  setSubmittedQuery(keyword);
                }}
                className="text-[10.5px] font-medium px-2.5 py-1 rounded-lg bg-muted/55 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors border border-border/45"
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
            <Loader2 className="w-7 h-7 mx-auto animate-spin text-primary/70" />
            <p className="text-xs">正在读取资料库...</p>
          </div>
        )}

        {!isLoading && sources.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <div className="w-14 h-14 mx-auto rounded-3xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/45">
              <BookOpen className="w-7 h-7 opacity-40" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">暂无资料库内容</p>
              <p className="text-xs text-muted-foreground mt-1">导入原著或设定文档后，会自动在此建立知识索引</p>
            </div>
          </div>
        )}

        {/* Search Results Preview */}
        <CollapseSection open={Boolean(submittedQuery && !isLoading)}>
          <section className="rounded-2xl border border-primary/30 bg-card p-4.5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/45">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm font-semibold text-foreground truncate">检索命中预览：“{submittedQuery}”</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground font-medium font-mono tabular-nums">
                  {results.length > 0 ? `命中 ${results.length} 个知识切片` : "未匹配到证据"}
                </span>
                <button type="button" onClick={clearSearch} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">
                  清除
                </button>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                ⚠️ 资料库中未找到足够置信度的原著切片。触发此情况时，分身会自动识别并承认“记不准”，杜绝虚构幻觉。
              </div>
            ) : (
              <div className="space-y-2.5">
                {results.map((chunk: any) => (
                  <div key={chunk.id} className="rounded-xl bg-muted/20 border border-border/60 p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {chunk.sourceTitle}
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono tabular-nums">
                          {chunk.chapterTitle || `片段 #${chunk.chunkIndex + 1}`}
                        </span>
                      </div>
                      <span className="text-[10.5px] font-mono tabular-nums text-muted-foreground">
                        相关度分数: {chunk.score}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/90 leading-relaxed bg-background/85 p-3 rounded-xl border border-border/45">
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
        </CollapseSection>

        {/* Sources List */}
        {sources.map((source: any) => (
          <section
            key={source.id}
            className="relative rounded-2xl border border-border/65 bg-card/90 p-4.5 transition-colors shadow-2xs space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm font-semibold text-foreground truncate">{source.title}</p>
                  <span className="text-[10px] font-mono tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/45">
                    ID: #{source.id}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate pl-6">
                  {source.sourceType} {source.originalName ? `· ${source.originalName}` : ""}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/25 border border-border/45 p-2.5 text-center">
                <p className="text-sm font-semibold text-foreground font-mono tabular-nums">{formatCount(source.chunkCount)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">切片片段</p>
              </div>
              <div className="rounded-xl bg-muted/25 border border-border/45 p-2.5 text-center">
                <p className="text-sm font-semibold text-foreground font-mono tabular-nums">{formatCount(source.chapterCount)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">包含章节</p>
              </div>
              <div className="rounded-xl bg-muted/25 border border-border/45 p-2.5 text-center">
                <p className="text-sm font-semibold text-foreground font-mono tabular-nums">{formatCount(source.tokenEstimate)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tokens 规模</p>
              </div>
            </div>

            {Boolean(source.topKeywords?.length) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {source.topKeywords.map((keyword: string) => (
                  <button
                    type="button"
                    key={keyword}
                    onClick={() => {
                      setQueryInput(keyword);
                      setSubmittedQuery(keyword);
                    }}
                    className="text-[10.5px] px-2 py-0.5 rounded-md bg-muted/55 text-muted-foreground hover:text-foreground hover:bg-muted font-medium transition-colors"
                  >
                    #{keyword}
                  </button>
                ))}
              </div>
            )}

            {Boolean(source.chapters?.length) && (
              <div className="overflow-hidden rounded-xl border border-border/55 divide-y divide-border/40 bg-muted/10">
                {source.chapters.map((chapter: any) => (
                  <div key={`${source.id}-${chapter.title}`} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
                    <span className="text-foreground font-medium truncate">{chapter.title}</span>
                    <span className="text-muted-foreground font-mono tabular-nums text-[11px] shrink-0">{formatCount(chapter.chunkCount)} 段</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border/55 bg-muted/10 shrink-0">
        <p className="text-[11px] text-muted-foreground text-center">
          原著资料库与知识切片处于只读检索保护状态 · 随时支持对话实时语义召回
        </p>
      </div>
    </MotionModal>
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

const EMOTION_DAY_OPTIONS = [
  { value: "7" as const, label: "7天" },
  { value: "30" as const, label: "30天" },
  { value: "90" as const, label: "90天" },
];

function EmotionReport({
  open,
  personaId,
  personaName,
  onClose,
}: {
  open: boolean;
  personaId: number;
  personaName: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data: report, isLoading } = trpc.emotion.getReport.useQuery(
    { personaId, days },
    { enabled: open && personaId > 0 }
  );

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
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="心境波动与情绪档案"
      className="max-w-2xl max-h-[88vh] overflow-hidden flex flex-col p-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4.5 border-b border-border/60 bg-muted/10 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center shadow-2xs shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground tracking-tight">{personaName} 的心境波动与情绪档案</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              基于对话情感标注的每日心境走势与分布画像
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl
            layoutId="emotion-report-days"
            size="xs"
            ariaLabel="统计天数范围"
            value={String(days) as "7" | "30" | "90"}
            onChange={(v) => setDays(Number(v) as 7 | 30 | 90)}
            options={EMOTION_DAY_OPTIONS}
          />
          <button
            type="button"
            onClick={onClose}
            className="w-8.5 h-8.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Stream */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 panel-scrollbar">
        {/* Key Metrics Dashboard */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-muted-foreground block">连续记录天数</span>
            <p className="text-2xl font-semibold text-foreground mt-1 font-mono tabular-nums">{report?.totalDays || 0}</p>
          </div>
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-muted-foreground block">累计交互消息</span>
            <p className="text-2xl font-semibold text-primary mt-1 font-mono tabular-nums">{report?.totalMessages || 0}</p>
          </div>
          <div className="rounded-2xl bg-muted/25 border border-border/60 p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-muted-foreground block">主导核心心境</span>
            <div className="flex items-center justify-center gap-1.5 mt-1.5">
              <span className="text-lg">
                {mostCommon ? STATES[Object.keys(STATE_COLORS).find((k) => STATE_COLORS[k] === mostCommon.fill) || ""]?.emoji || "🌸" : "🌸"}
              </span>
              <span className="text-sm font-semibold text-foreground">{mostCommon?.name || "温柔"}</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <Loader2 className="w-7 h-7 mx-auto animate-spin text-primary/70" />
            <p className="text-xs">正在分析心境走势...</p>
          </div>
        ) : chartData.length > 0 ? (
          <>
            {/* Trend Chart */}
            <div className="rounded-2xl border border-border/65 bg-card/90 p-4.5 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">情绪波动趋势曲线</p>
                <span className="text-[11px] text-muted-foreground">柱体高低与色彩代表每日主心境</span>
              </div>

              <div className="h-44 flex items-end gap-1.5 pt-4 pb-1 px-1.5 bg-muted/15 rounded-xl border border-border/45">
                {chartData.map((d: any, i: number) => (
                  <div
                    key={`${d.date}-${i}`}
                    className="flex-1 flex flex-col items-center gap-1.5 group/bar relative h-full justify-end"
                    title={`${d.date}: ${d.label} (${d.messages} 条消息)`}
                  >
                    <div className="absolute bottom-full mb-1.5 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity bg-popover/95 backdrop-blur-md border border-border/60 text-popover-foreground text-[10px] font-mono tabular-nums px-2 py-1 rounded-lg shadow-md whitespace-nowrap z-20">
                      {d.date} · {d.label} ({d.messages} 条)
                    </div>
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ ...SPRING_SILKY, delay: Math.min(i * 0.012, 0.25) }}
                      className="w-full rounded-t-md group-hover/bar:brightness-110 transition-[filter] shadow-2xs origin-bottom"
                      style={{
                        height: `${Math.max(12, (d.value / 6) * 100)}%`,
                        backgroundColor: STATE_COLORS[d.state] || "var(--color-primary)",
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-[10.5px] font-mono tabular-nums text-muted-foreground px-1">
                <span>{chartData[0]?.date}</span>
                <span>{chartData[chartData.length - 1]?.date}</span>
              </div>
            </div>

            {/* Distribution Breakdown */}
            <div className="rounded-2xl border border-border/65 bg-card/90 p-4.5 space-y-3 shadow-2xs">
              <p className="text-sm font-semibold text-foreground">心境分布占比</p>
              <div className="space-y-2.5">
                {pieData.map((d: any) => {
                  const total = pieData.reduce((s: number, p: any) => s + p.value, 0);
                  const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: d.fill }} />
                      <span className="text-xs font-medium text-foreground w-12">{d.name}</span>
                      <div className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden border border-border/35">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={SPRING_SILKY}
                          className="h-full rounded-full shadow-2xs"
                          style={{ backgroundColor: d.fill }}
                        />
                      </div>
                      <span className="text-xs font-semibold font-mono tabular-nums text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground border border-border/45">
              <BarChart3 className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-xs">暂无情绪记录，与 TA 产生更多对话后将自动生成情绪曲线</p>
          </div>
        )}
      </div>
    </MotionModal>
  );
}

// ─── DIARY MODAL (EMBEDDED FLOATING MODAL) ──────────────────────────────────

function DiaryModal({ open, personaId, personaName, onClose }: { open: boolean; personaId: number; personaName: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmDeleteEntryId, setConfirmDeleteEntryId] = useState<number | null>(null);

  const { data: diaryDates, refetch: refetchDates } = trpc.diary.getDates.useQuery(
    { personaId },
    { enabled: open && !!personaId }
  );
  const { data: entries, refetch: refetchEntries } = trpc.diary.list.useQuery(
    { personaId },
    { enabled: open && !!personaId }
  );
  const { data: dayEntry } = trpc.diary.getByDate.useQuery(
    { personaId, date: selectedDate || "" },
    { enabled: open && !!personaId && !!selectedDate }
  );

  const generateMutation = trpc.diary.generate.useMutation({
    onSuccess: (_, input) => {
      toast.success("日记生成成功");
      void refetchDates();
      void refetchEntries();
      if (input.date) void utils.diary.getByDate.invalidate({ personaId: input.personaId, date: input.date });
    },
    onError: error => toast.error("生成失败：" + error.message),
  });

  const deleteMutation = trpc.diary.delete.useMutation({
    onSuccess: () => {
      toast.success("日记已删除");
      setConfirmDeleteEntryId(null);
      setSelectedDate(null);
      void refetchDates();
      void refetchEntries();
      void utils.diary.getByDate.invalidate({ personaId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const datesSet = new Set(diaryDates);
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
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="对话日记与心路日志"
      className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col p-0"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4.5 border-b border-border/60 bg-muted/10 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center shadow-2xs shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base text-foreground tracking-tight">{personaName} 的对话日记 & 心路日志</h3>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 font-mono tabular-nums">
                {entries?.length || 0} 篇日记
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              记录角色视角下的每日总结、情绪变化与对话摘录
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => generateMutation.mutate({ personaId, date: todayKey })}
            disabled={generateMutation.isPending || datesSet.has(todayKey)}
            className="text-xs"
          >
            <Sparkles className={`w-3.5 h-3.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            {generateMutation.isPending ? "生成中..." : datesSet.has(todayKey) ? "今日已生成" : "生成今日日记"}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="w-8.5 h-8.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 panel-scrollbar">
        {/* Calendar Box */}
        <div className="rounded-2xl border border-border/65 bg-card/90 p-4.5 space-y-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2 font-mono tabular-nums">
              <Calendar className="w-4 h-4 text-primary" />
              {year}年{month + 1}月
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-mono tabular-nums">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="h-9" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hasDiary = datesSet.has(dateStr);
              const isSelected = selectedDate === dateStr;
              const isToday = todayKey === dateStr;

              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => {
                    setConfirmDeleteEntryId(null);
                    setSelectedDate(isSelected ? null : dateStr);
                  }}
                  className={`h-9 rounded-xl flex flex-col items-center justify-center relative font-medium transition-colors ${
                    isSelected
                      ? "text-primary-foreground font-semibold"
                      : hasDiary
                        ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/16"
                        : isToday
                          ? "border border-primary/40 text-primary font-semibold"
                          : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="diary-modal-calendar-selected"
                      transition={SPRING_SNAPPY}
                      className="pointer-events-none absolute inset-0 rounded-xl bg-primary shadow-xs"
                    />
                  )}
                  <span className="relative z-10">{day}</span>
                  {hasDiary && !isSelected && (
                    <span className="w-1 h-1 rounded-full bg-primary absolute bottom-1 z-10" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Diary Detail */}
        <CollapseSection open={Boolean(selectedDate)}>
          {selectedDate && (
            <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border/45">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-foreground font-mono tabular-nums">📅 {selectedDate} 对话日记</span>
                  {activeEntry && (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold font-mono tabular-nums">
                      {activeEntry.messageCount} 条互动
                    </span>
                  )}
                </div>
                {activeEntry && (
                  confirmDeleteEntryId === activeEntry.id ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate({ id: activeEntry.id })}
                        disabled={deleteMutation.isPending}
                        className="text-xs px-3 py-1 rounded-lg bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 transition-colors"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEntryId(null)}
                        className="text-xs px-2.5 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteEntryId(activeEntry.id)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2.5 py-1 rounded-lg hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  )
                )}
              </div>

              {activeEntry ? (
                <div className="space-y-4">
                  <div className="bg-muted/20 p-4 rounded-xl border border-border/45 text-sm text-foreground leading-relaxed">
                    <p className="font-semibold text-primary text-xs mb-1.5 tracking-wider">今日摘要</p>
                    {activeEntry.summary}
                  </div>

                  {Array.isArray(activeEntry.highlights) && activeEntry.highlights.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground/85 mb-2">✨ 亮点时刻</p>
                      <ul className="space-y-1.5">
                        {activeEntry.highlights.map((h: string, idx: number) => (
                          <li key={idx} className="text-xs sm:text-sm text-foreground/90 flex items-start gap-2 bg-muted/20 p-2.5 rounded-xl border border-border/35">
                            <span className="text-primary font-bold">•</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(activeEntry.quotes) && activeEntry.quotes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground/85 mb-2">💬 触动心语</p>
                      <div className="space-y-2">
                        {activeEntry.quotes.map((q: string, idx: number) => (
                          <p key={idx} className="text-xs sm:text-sm italic text-foreground/90 border-l-2 border-primary/45 pl-3 py-1.5 bg-primary/6 rounded-r-xl">
                            “{q}”
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeEntry.reflection && (
                    <div className="bg-muted/20 border border-border/45 p-3.5 rounded-xl text-xs sm:text-sm text-foreground/90 leading-relaxed">
                      <p className="font-semibold text-primary text-xs mb-1">🌙 TA 的心声反思</p>
                      {activeEntry.reflection}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs space-y-2.5">
                  <p>该日期尚未生成对话日记</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => generateMutation.mutate({ personaId, date: selectedDate })}
                    disabled={generateMutation.isPending || selectedDate > todayKey}
                    className="text-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    为该日期补写日记
                  </Button>
                </div>
              )}
            </div>
          )}
        </CollapseSection>

        {/* All Entries List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/80 tracking-wider">历史日记流</span>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">共 {entries?.length || 0} 篇</span>
          </div>

          {(!entries || entries.length === 0) && (
            <div className="text-center py-12 text-muted-foreground text-xs space-y-2">
              <BookOpen className="w-8 h-8 mx-auto opacity-30" />
              <p>还没有日记记录，点击右上角 “生成今日日记” 开启记录吧</p>
            </div>
          )}

          {entries?.map((entry: any) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => {
                setConfirmDeleteEntryId(null);
                setSelectedDate(entry.date);
              }}
              className={`w-full text-left p-4.5 rounded-2xl border transition-colors cursor-pointer space-y-2 ${
                selectedDate === entry.date
                  ? "border-primary/45 bg-primary/6 shadow-2xs"
                  : "border-border/60 bg-card/90 hover:bg-muted/25 hover:border-border/85"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground font-mono tabular-nums">📅 {entry.date}</span>
                <span className="text-[10.5px] text-muted-foreground font-mono tabular-nums">{entry.messageCount} 条消息</span>
              </div>
              <p className="text-xs sm:text-[13px] text-foreground/85 line-clamp-2 leading-relaxed">
                {entry.summary}
              </p>
            </button>
          ))}
        </div>
      </div>
    </MotionModal>
  );
}
