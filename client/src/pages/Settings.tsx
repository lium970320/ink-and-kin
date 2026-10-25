import { useState, useEffect, useMemo, useCallback, useRef, useId, type ChangeEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { formatBeijingDate, formatBeijingDateTime } from "@/lib/beijing-time";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Wifi, WifiOff, Settings2, Sliders, ChevronDown, ChevronUp, Check,
  User, Shield, Database, Download, Trash2, KeyRound, Mail, Calendar,
  MessageCircle, FileText, HardDrive, Users, Clock, Pencil, AlertTriangle,
  Leaf, Eye, EyeOff, Activity, Server, Cpu, Volume2, ImageIcon, Radio,
  RefreshCw, Terminal, Copy, ExternalLink, Plus, Sparkles,
} from "lucide-react";
import { useTilt } from "@/hooks/useTilt";
import { toast } from "sonner";

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "profile", label: "个人资料", icon: User },
  { key: "ai", label: "AI 设置", icon: Settings2 },
  { key: "qq", label: "QQ", icon: MessageCircle },
  { key: "diagnostics", label: "运维诊断", icon: Activity },
  { key: "data", label: "数据管理", icon: Database },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── SLIDER FIELD ────────────────────────────────────────────────────────────

function SliderField({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  return (
    <div className="space-y-3 p-4 bg-muted/20 border border-border/30 rounded-xl">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-foreground/90">{label}</Label>
        <span className="text-sm font-bold text-primary bg-primary/8 px-2.5 py-0.5 rounded-full">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary" />
      <div className="flex justify-between text-[11px] text-muted-foreground/80 font-medium px-0.5">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── PROVIDER CONFIG ROW ─────────────────────────────────────────────────────

type ProviderConfigSummary = {
  name: string;
  configured: boolean;
  supportsModelList?: boolean;
  /** 后端声明的能力：能不能设「思考程度」。缺省时回退到旧白名单，保证兼容。 */
  supportsReasoningEffort?: boolean;
  baseUrl?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  dynamicRouting?: boolean;
  relays?: ProviderRelaySummary[];
};

function providerSelectLabel(provider: Pick<ProviderConfigSummary, "name" | "dynamicRouting">): string {
  return provider.name === "DeepSeek" && provider.dynamicRouting
    ? "DeepSeek（动态 Flash/Pro）"
    : provider.name;
}

type ProviderRelaySummary = {
  id: number;
  relayName: string;
  priority: number;
  enabled: boolean;
  baseUrl?: string | null;
  model?: string | null;
  /** 这一站自己的「思考程度」；null/缺省 = 沿用供应商默认。 */
  reasoningEffort?: string | null;
  apiKeyConfigured: boolean;
};

/** 思考程度档位；null = 不设置（沿用供应商默认/上游默认）。 */
type ReasoningEffortValue = "low" | "medium" | "high" | "xhigh";
const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffortValue | null; label: string }> = [
  { value: null, label: "不设置" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
];

/**
 * 紧凑的思考程度选择器：一行放得下，点一下即选定。
 * 站级与供应商级共用；站级由"保存中转站"一起提交，供应商级点一下立即保存。
 */
function ReasoningEffortPicker({ value, onSelect, disabled, compact }: {
  value: ReasoningEffortValue | null;
  onSelect: (next: ReasoningEffortValue | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="group" aria-label="思考程度">
      {REASONING_EFFORT_OPTIONS.map(option => (
        <button
          key={option.value ?? "unset"}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onSelect(option.value)}
          className={`rounded-md font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 ${
            compact ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-xs"
          } ${
            value === option.value
              ? "bg-background text-primary shadow-sm"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type ProviderModel = {
  id: string;
  ownedBy?: string;
  created?: number;
};

// 界面采用 1—10 档，内部保留旧优先级尺度：100 对应中间的 5 档。
// 原值在用户调档前保持不变，避免仅编辑其他字段就改写已有站点顺序。
function relayPriorityLevel(priority: number): number {
  return Math.max(1, Math.min(10, Math.round((priority - 50) / 10)));
}

function RelayPriorityControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const level = relayPriorityLevel(value);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground/70">优先级<span className="ml-1.5 text-[10px] font-normal text-muted-foreground">10 档最优先</span></span>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">{level} 档</span>
      </div>
      <div className="relay-priority-levels" role="group" aria-label="优先级档位">
        {Array.from({ length: 10 }, (_, index) => index + 1).map(option => (
          <button type="button" key={option} aria-label={`优先级 ${option} 档`} aria-pressed={level === option}
            onClick={() => { if (option !== level) onChange(50 + option * 10); }}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsDisclosure({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle: string; icon: typeof Settings2; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="warm-card overflow-hidden">
      <h2>
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={id}
          className="ai-disclosure-trigger flex w-full items-center gap-3 p-4 text-left sm:p-5">
          <span className="section-chip"><Icon className="h-4.5 w-4.5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">{subtitle}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`ai-disclosure-chevron h-4 w-4 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <div id={id} className="collapse-grid" data-open={open} aria-hidden={!open} inert={!open}>
        <div><div className="border-t border-border/40 p-4 sm:p-5">{children}</div></div>
      </div>
    </section>
  );
}

function RelayConfigEditor({
  provider,
  relay,
  draftId,
  defaultName,
  defaultPriority,
  index = 0,
  onChanged,
  onRemoveDraft,
}: {
  provider: ProviderConfigSummary;
  relay?: ProviderRelaySummary;
  draftId?: number;
  defaultName: string;
  defaultPriority: number;
  /** 列表序号：只用于错开入场动画。 */
  index?: number;
  onChanged: () => void;
  onRemoveDraft: () => void;
}) {
  const [relayName, setRelayName] = useState(relay?.relayName ?? defaultName);
  const [priority, setPriority] = useState(relay?.priority ?? defaultPriority);
  const [enabled, setEnabled] = useState(relay?.enabled ?? true);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(relay?.baseUrl ?? "");
  const [model, setModel] = useState(relay?.model ?? "");
  // 这一站自己的思考程度；null = 不设置，运行时沿用供应商级或上游默认。
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortValue | null>(
    (relay?.reasoningEffort as ReasoningEffortValue) ?? null,
  );
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [probeStatus, setProbeStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(!relay);
  const panelId = useId();

  useEffect(() => {
    setRelayName(relay?.relayName ?? defaultName);
    setPriority(relay?.priority ?? defaultPriority);
    setEnabled(relay?.enabled ?? true);
    setApiKey("");
    setBaseUrl(relay?.baseUrl ?? "");
    setModel(relay?.model ?? "");
    setReasoningEffort((relay?.reasoningEffort as ReasoningEffortValue) ?? null);
    setModels([]);
    setProbeStatus(null);
  }, [relay?.id, relay?.relayName, relay?.priority, relay?.enabled, relay?.baseUrl, relay?.model, relay?.reasoningEffort, draftId, defaultName, defaultPriority]);

  const saveRelay = trpc.llmConfig.saveRelay.useMutation({
    onSuccess: () => {
      toast.success("中转站已保存");
      setApiKey("");
      onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const deleteRelay = trpc.llmConfig.deleteRelay.useMutation({
    onSuccess: () => {
      toast.success("中转站已删除");
      onChanged();
    },
    onError: error => toast.error(error.message),
  });
  const testConnection = trpc.llmConfig.testConnection.useMutation({
    onSuccess: result => setProbeStatus({
      ok: true,
      text: result.reflectsCurrentChatRoute
        ? `基础生成成功${result.model ? ` · ${result.model}` : ""} · ${result.durationMs}ms · 当前已保存且启用的中转站已通过基础生成检查；人物聊天与本检查均为单站最多等待两分钟`
        : result.relayEnabled === false
          ? `基础生成成功${result.model ? ` · ${result.model}` : ""} · ${result.durationMs}ms · 该中转站目前已停用，人物聊天不会使用它`
          : `基础生成成功${result.model ? ` · ${result.model}` : ""} · ${result.durationMs}ms · 本次使用当前填写值，保存并启用后才会用于人物聊天`,
    }),
    onError: error => setProbeStatus({ ok: false, text: error.message }),
  });
  const listModels = trpc.llmConfig.listModels.useMutation({
    onSuccess: result => {
      setModels(result.models);
      setProbeStatus({
        ok: true,
        text: `已获取 ${result.models.length}${result.truncated ? "+" : ""} 个模型`,
      });
    },
    onError: error => setProbeStatus({ ok: false, text: error.message }),
  });
  const probeInput = () => ({
    relayId: relay?.id,
    providerName: provider.name,
    apiKey: apiKey || undefined,
    baseUrl,
    model,
    reasoningEffort,
  });
  const modelOptions = model && !models.some(item => item.id === model)
    ? [{ id: model }, ...models]
    : models;

  return (
    <div style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
      className={`relay-card overflow-hidden rounded-xl border ${enabled ? "border-border/60 bg-background/45" : "border-border/35 bg-muted/20"}`}>
      <button type="button" aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${expanded ? "收起" : "展开"}中转站 ${relayName || defaultName}`}
        onClick={() => setExpanded(value => !value)}
        className="ai-disclosure-trigger flex w-full items-center gap-3 p-3.5 text-left">
        <Server aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{relayName || defaultName}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{relay ? `优先级 ${relayPriorityLevel(priority)} 档 · ${enabled ? "已启用" : "已停用"}` : "新中转站 · 待保存"}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${relay ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
          {relay ? "配置详情" : "待保存"}
        </span>
        <ChevronDown aria-hidden="true" className={`ai-disclosure-chevron h-4 w-4 shrink-0 text-muted-foreground ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} className="collapse-grid" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
      <div><div className="relay-editor space-y-3 border-t border-border/40 p-3.5 sm:p-4">
      <div className="relay-field-grid">
        <div className="min-w-0">
          <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
            <Label htmlFor={`${panelId}-name`} className="text-xs font-medium text-foreground/70">中转站名称</Label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Switch aria-label="启用中转站" checked={enabled} onCheckedChange={setEnabled} className="scale-75 origin-right" />启用
            </label>
          </div>
          <Input id={`${panelId}-name`} aria-label="中转站名称" autoComplete="off" value={relayName} onChange={event => setRelayName(event.target.value)}
            placeholder={defaultName} className="h-9 rounded-lg border-border/50 bg-muted/25 text-sm" />
        </div>
        <RelayPriorityControl value={priority} onChange={setPriority} />
      </div>
      <div className="relay-field-grid">
        <div className="min-w-0">
          <Label htmlFor={`${panelId}-url`} className="text-xs font-medium text-foreground/70">中转地址</Label>
          <Input id={`${panelId}-url`} aria-label="中转地址" autoComplete="off" value={baseUrl} onChange={event => setBaseUrl(event.target.value)}
            placeholder="https://example.com/v1" className="mt-1 h-9 rounded-lg border-border/50 bg-muted/25 text-sm" />
        </div>
      <div className="min-w-0">
        <Label htmlFor={`${panelId}-key`} className="text-xs font-medium text-foreground/70">API Key</Label>
        <Input id={`${panelId}-key`} aria-label="API Key" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)}
          placeholder={relay?.apiKeyConfigured ? "已配置，不回显；留空表示不修改" : "请输入该中转站的密钥"}
          type="password" className="mt-1 h-9 rounded-lg border-border/50 bg-muted/25 text-sm" />
      </div>
      </div>
      {/* 思考程度紧邻模型，窄屏时自然换行；站级配置仍随保存一起提交。 */}
      <div className="relay-model-grid">
        <div className="min-w-0">
          <Label htmlFor={`${panelId}-model`} className="text-xs font-medium text-foreground/70">模型</Label>
          <Input id={`${panelId}-model`} aria-label="模型" autoComplete="off" value={model} onChange={event => setModel(event.target.value)}
            placeholder="模型名称" className="mt-1 h-9 rounded-lg border-border/50 bg-muted/25 text-sm" />
        </div>
        {provider.supportsReasoningEffort && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-foreground/70">思考程度</Label>
            <ReasoningEffortPicker compact value={reasoningEffort} onSelect={setReasoningEffort} />
          </div>
        )}
      </div>
      {provider.supportsReasoningEffort && (
        <p className="-mt-1 text-[11px] text-muted-foreground">
          {reasoningEffort
            ? "只对这一站生效，随「保存中转站」提交"
            : `不设置＝沿用供应商默认${provider.reasoningEffort ? `（${provider.reasoningEffort}）` : "（上游默认）"}`}
        </p>
      )}
      <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs"
            onClick={() => testConnection.mutate(probeInput())}
            disabled={testConnection.isPending || listModels.isPending}>
            <Wifi className="mr-1 h-3.5 w-3.5" />
            {testConnection.isPending ? "测试中..." : "测试基础生成"}
          </Button>
          {provider.supportsModelList && (
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs"
              onClick={() => listModels.mutate(probeInput())}
              disabled={testConnection.isPending || listModels.isPending}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {listModels.isPending ? "获取中..." : "获取模型"}
            </Button>
          )}
        </div>
        {probeStatus && (
          <p className={`text-xs ${probeStatus.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {probeStatus.text}
          </p>
        )}
        {models.length > 0 && (
          <select value={model} onChange={event => setModel(event.target.value)}
            className="h-9 w-full rounded-lg border border-border/60 bg-background/60 px-2 text-xs text-foreground">
            <option value="">请选择模型</option>
            {modelOptions.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        )}
        <details className="text-[11px] leading-5 text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium hover:text-foreground">测试说明</summary>
          <p className="mt-1">
          这是单站、短文本的生成检查，不会带入人物设定和聊天历史。只有结果明确写出“当前已保存且启用”时，才与人物聊天使用同一份配置、每站仅一次的切换规则，以及单站最多两分钟的等待时间。
          </p>
        </details>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" size="sm" className="h-8 rounded-lg text-xs"
          onClick={() => saveRelay.mutate({
            id: relay?.id,
            providerName: provider.name,
            relayName: relayName.trim() || defaultName,
            priority,
            enabled,
            apiKey: apiKey || undefined,
            baseUrl,
            model,
            reasoningEffort,
          })}
          disabled={saveRelay.isPending}>
          <Check className="mr-1 h-3.5 w-3.5" />
          {saveRelay.isPending ? "保存中..." : "保存中转站"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg text-xs text-destructive"
          onClick={() => {
            if (!relay) {
              onRemoveDraft();
              return;
            }
            if (window.confirm(`确认删除“${relay.relayName}”吗？`)) {
              deleteRelay.mutate({ id: relay.id });
            }
          }}
          disabled={deleteRelay.isPending}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {relay ? "删除" : "取消添加"}
        </Button>
      </div>
      </div></div>
      </div>
    </div>
  );
}

function ProviderConfigRow({ provider, expanded, onToggle, isDefault, isFallback, defaultPending, onSaveProvider, onSetDefault, onChanged }: {
  provider: ProviderConfigSummary;
  expanded: boolean;
  onToggle: () => void;
  isDefault: boolean;
  isFallback: boolean;
  defaultPending: boolean;
  onSaveProvider: (data: {
    providerName: string;
    /** null = 清除供应商级档位，回到环境默认/上游默认。 */
    reasoningEffort?: ReasoningEffortValue | null;
    deepseekDynamicRouting?: boolean;
  }) => void;
  onSetDefault: () => void;
  onChanged: () => void;
}) {
  const panelId = useId();
  // null = 这一家没有保存过档位。以前初始值是 "medium"，界面上凭空高亮「中」，
  // 但没保存时其实一个参数都不发——显示与生效不一致，很容易误判。
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high" | "xhigh" | null>(null);
  const [dynamicRouting, setDynamicRouting] = useState(false);
  const [draftRelays, setDraftRelays] = useState<Array<{ id: number; priority: number }>>([]);
  const isDeepSeek = provider.name.toLowerCase() === "deepseek";

  useEffect(() => {
    setReasoningEffort(
      ["low", "medium", "high", "xhigh"].includes(provider.reasoningEffort ?? "")
        ? (provider.reasoningEffort as "low" | "medium" | "high" | "xhigh")
        : null,
    );
  }, [provider.name, provider.reasoningEffort]);

  useEffect(() => {
    setDynamicRouting(Boolean(provider.dynamicRouting));
  }, [provider.name, provider.dynamicRouting]);

  // 能力由后端声明（OpenAI 兼容 provider 与 Claude 都支持）；只有拿不到这个字段时才
  // 回退到旧白名单，避免旧数据把开关藏掉。
  const supportsReasoningEffort =
    provider.supportsReasoningEffort === true ||
    (provider.supportsReasoningEffort === undefined &&
      ["openai", "grok", "gemini", "deepseek", "claude", "kimi", "qwen", "doubao", "302ai"].includes(
        provider.name.toLowerCase(),
      ));
  const relays = provider.relays ?? [];
  const currentPriorities = [
    ...relays.map(relay => relay.priority),
    ...draftRelays.map(relay => relay.priority),
  ];
  const nextPriority = currentPriorities.length > 0
    ? Math.min(...currentPriorities) - 10
    : 100;

  return (
    <div className={`provider-card ${expanded ? "provider-card--expanded" : ""} ${provider.configured ? "" : "provider-card--unconfigured"}`}>
      <div className="provider-summary">
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${expanded ? "收起" : "展开"} ${provider.name} 配置`}
        className="ai-disclosure-trigger flex min-w-0 flex-1 items-center gap-3 p-3.5 text-left sm:p-4">
        <span aria-hidden="true" className={`provider-monogram ${isDefault ? "provider-monogram--default" : ""}`}>{provider.name.slice(0, 2)}</span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold tracking-tight text-foreground">{provider.name}</span>
            {isDefault && <span className="ai-role-badge bg-primary/12 text-primary">默认</span>}
            {isFallback && <span className="ai-role-badge bg-sky-500/10 text-sky-700 dark:text-sky-300">备用</span>}
            {isDeepSeek && dynamicRouting && <span className="ai-role-badge bg-muted text-muted-foreground">动态分流</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${provider.configured ? "bg-emerald-500" : "bg-muted-foreground/45"}`} />{provider.configured ? "已配置" : "未配置"}</span>
            <span aria-hidden="true">·</span>
            <span>{relays.length ? `${relays.filter(relay => relay.enabled).length} / ${relays.length} 个中转站启用` : provider.configured ? "使用本机配置" : "点击添加配置"}</span>
            {draftRelays.length > 0 && <span className="text-primary">{draftRelays.length} 项待保存</span>}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`ai-disclosure-chevron h-4 w-4 shrink-0 text-muted-foreground ${expanded ? "rotate-180" : ""}`} />
      </button>
      {provider.configured && !isDefault && <Button type="button" size="sm" variant="ghost" onClick={onSetDefault}
        disabled={defaultPending} aria-label={`将 ${provider.name} 设为默认`}
        className="provider-default-action h-8 shrink-0 rounded-lg px-2 text-xs text-primary">设为默认</Button>}
      </div>
      {/* 展开区用 grid-rows 0fr→1fr 做高度过渡（纯 CSS，不猜 max-height）。
          收起时保持挂载：中转站草稿状态不丢；同时禁掉指针与 tab 焦点。 */}
      <div id={panelId} className="collapse-grid" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className={expanded ? undefined : "pointer-events-none"}>
        <div className="border-t border-border/40 bg-muted/10 p-3.5 space-y-4 sm:p-4">
          {isDeepSeek && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs font-medium text-foreground/70">动态选择 Flash / Pro</Label>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  打开后，选择 DeepSeek 会按用途自动分流到 Flash 或 Pro。关闭后始终使用当前中转站保存的模型。
                </p>
              </div>
              <Switch
                checked={dynamicRouting}
                onCheckedChange={checked => {
                  setDynamicRouting(checked);
                  onSaveProvider({ providerName: provider.name, deepseekDynamicRouting: checked });
                }}
                className="mt-0.5 data-[state=checked]:bg-primary"
              />
            </div>
          )}
          {supportsReasoningEffort && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
              <Label className="text-xs font-medium text-foreground/70">供应商默认思考程度</Label>
              <ReasoningEffortPicker
                value={reasoningEffort}
                onSelect={next => {
                  setReasoningEffort(next);
                  onSaveProvider({ providerName: provider.name, reasoningEffort: next });
                }}
              />
              <span className="text-[11px] text-muted-foreground">
                {reasoningEffort
                  ? "未单独设置的中转站沿用这一档"
                  : `未设置：请求里不带档位参数${provider.reasoningEffort ? `（环境默认 ${provider.reasoningEffort}）` : "，由上游默认决定"}`}
              </span>
            </div>
          )}
          <div className="space-y-3">
            {relays.map((relay, index) => (
              <RelayConfigEditor key={relay.id} provider={provider} relay={relay} index={index}
                defaultName={`中转站 ${index + 1}`} defaultPriority={relay.priority}
                onChanged={onChanged} onRemoveDraft={() => undefined} />
            ))}
            {draftRelays.map((draft, index) => (
              <RelayConfigEditor key={`draft-${draft.id}`} provider={provider} draftId={draft.id} index={relays.length + index}
                defaultName={`中转站 ${relays.length + index + 1}`} defaultPriority={draft.priority}
                onChanged={() => {
                  setDraftRelays(current => current.filter(item => item.id !== draft.id));
                  onChanged();
                }}
                onRemoveDraft={() => setDraftRelays(current => current.filter(item => item.id !== draft.id))} />
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="h-9 w-full rounded-lg border-dashed text-xs"
            onClick={() => setDraftRelays(current => [...current, { id: Date.now() + current.length, priority: nextPriority }])}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加中转站
          </Button>
          <p className="text-[11px] text-muted-foreground">
            人物聊天会按优先级从高到低尝试；本供应商所有已启用中转站都失败后，才会进入备用供应商。
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── STAT ITEM ───────────────────────────────────────────────────────────────

function StatItem({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary/70" />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── DIAGNOSTIC PRIMITIVES ───────────────────────────────────────────────────

type StatusTone = "ok" | "warn" | "error" | "muted";
type DiagnosticAdvice = {
  id?: string;
  scope?: string;
  title: string;
  detail: string;
  tone: StatusTone;
  rawError?: string;
  evidence?: string;
  actions?: string[];
};

const toneClasses: Record<StatusTone, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/10 text-red-700 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
};

function toneForEnabled(value: boolean): StatusTone {
  return value ? "ok" : "muted";
}

function StatusBadge({ label, tone = "muted" }: { label: string; tone?: StatusTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}>
      {(tone === "ok" || tone === "error") && <span className="pulse-dot" />}
      {label}
    </span>
  );
}

function BoolBadge({ value, trueLabel = "已配置", falseLabel = "未配置" }: {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return <StatusBadge label={value ? trueLabel : falseLabel} tone={toneForEnabled(value)} />;
}

const SECTION_HUES = {
  emerald: "oklch(0.54 0.12 164)",
  sky: "oklch(0.55 0.13 235)",
  violet: "oklch(0.55 0.15 290)",
  amber: "oklch(0.62 0.13 70)",
  rose: "oklch(0.60 0.15 15)",
  teal: "oklch(0.55 0.12 195)",
  indigo: "oklch(0.52 0.14 265)",
  pink: "oklch(0.62 0.15 340)",
} as const;
type SectionHue = keyof typeof SECTION_HUES;

function SectionHeader({ icon: Icon, title, subtitle, action, tone = "default", hue }: {
  icon: any;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
  hue?: SectionHue;
}) {
  const chipColor = tone === "danger" ? "var(--color-destructive)" : hue ? SECTION_HUES[hue] : undefined;
  const titleClass = tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <div className="section-chip" style={chipColor ? ({ "--chip-color": chipColor } as any) : undefined}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <h2 className={`font-semibold leading-tight ${titleClass}`}>{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0 sm:pt-1">{action}</div>}
    </div>
  );
}

function DiagnosticCard({ icon, title, subtitle, action, hue, children }: {
  icon: any;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  hue?: SectionHue;
  children: ReactNode;
}) {
  return (
    <section className="warm-card p-5 space-y-4">
      <SectionHeader icon={icon} title={title} subtitle={subtitle} action={action} hue={hue} />
      {children}
    </section>
  );
}

function formatCompact(value: number | undefined | null): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num) >= 100000000) return `${(num / 100000000).toFixed(1)} 亿`;
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(1)} 万`;
  return num.toLocaleString("zh-CN");
}

function DiagnosticRow({ label, value, mono = false, badge }: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 py-2.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs text-muted-foreground flex-shrink-0 sm:pt-0.5">{label}</span>
      <span className={`min-w-0 text-sm text-foreground sm:text-right ${mono ? "font-mono text-xs break-all" : "break-words"}`}>
        {badge ?? value}
      </span>
    </div>
  );
}

function DiagGroup({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="hud-corners rounded-lg border border-border/50 bg-muted/10 p-3">
      <div className="flex items-baseline justify-between gap-2 pb-2 mb-1 border-b border-border/40">
        <span className="text-xs font-semibold tracking-wide text-foreground/80">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function StatTile({ value, label, sub, tone }: { value: ReactNode; label: string; sub?: string; tone?: StatusTone }) {
  const display = typeof value === "number" ? formatCompact(value) : value;
  const fullValue = typeof value === "number" ? value.toLocaleString("zh-CN") : undefined;
  const numberClass = tone === "error" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "stat-tile-number";
  return (
    <div className="stat-tile px-3 py-2.5 min-w-0" title={fullValue}>
      <div className={`text-lg font-bold tabular-nums truncate leading-tight ${numberClass}`}>{display}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/80 leading-tight mt-0.5">{sub}</div>}
    </div>
  );
}

function useCountUp(target: number, durationMs = 750) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return display;
}

function KpiTile({ value, text, label, sub, tone }: {
  value?: number; text?: string; label: string; sub?: string; tone?: StatusTone;
}) {
  const animated = useCountUp(value ?? 0);
  const tilt = useTilt(6);
  const display = text ?? formatCompact(animated);
  const numberClass = tone === "error" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "stat-tile-number";
  return (
    <div ref={tilt.ref} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}
      className="stat-tile glow-border tilt-card rounded-xl px-4 py-3.5 min-w-0"
      title={typeof value === "number" ? value.toLocaleString("zh-CN") : undefined}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums leading-tight truncate ${numberClass}`}>{display}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground/80 truncate">{sub}</div>}
    </div>
  );
}

function compactList(items: string[] | undefined, empty = "无") {
  if (!items || items.length === 0) return empty;
  return items.join("、");
}

function formatDiagnosticTime(value: string | undefined) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatBeijingDateTime(date, { hour12: false });
}

function platformStatusLabel(platform: "qq", status: string | undefined) {
  const labels: Record<string, string> = {
    connected: "已连接",
    error: "连接异常",
    disabled: "未启用",
    unknown: "未知",
  };
  return labels[status || "unknown"] || status || "未知";
}

function runtimeCapabilityLabel(key: string) {
  const labels: Record<string, string> = {
    text: "文本",
    media: "媒体",
    voiceInput: "语音输入",
    voiceOutput: "语音输出",
    stickers: "表情包",
    proactiveMessages: "主动消息",
    autoBindSingleReadyPersona: "自动绑定单角色",
  };
  return labels[key] || key;
}

function voiceModeLabel(mode: string | undefined) {
  const labels: Record<string, string> = {
    never: "永不发语音",
    requested: "仅明确要求",
    smart: "智能判定",
    sometimes: "低频自然发送",
    always: "总是语音",
  };
  return labels[mode || ""] || mode || "未知";
}

function ttsProviderLabel(provider: string | undefined) {
  const labels: Record<string, string> = {
    "windows-sapi": "Windows SAPI",
    edge: "Edge TTS",
    voxcpm: "VoxCPM",
    minimax: "MiniMax",
    none: "无降级",
  };
  return labels[provider || ""] || provider || "未知";
}

function llmUsageSourceLabel(source: string | undefined) {
  const labels: Record<string, string> = {
    database: "数据库持久化",
    "in-memory-runtime": "当前进程内",
  };
  return labels[source || ""] || source || "未知";
}

function llmBudgetStatusLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    disabled: "未配置",
    ok: "额度内",
    warn: "接近上限",
    exceeded: "已超额",
  };
  return labels[status || ""] || status || "未知";
}

function llmBudgetTone(status: string | undefined): StatusTone {
  if (status === "exceeded") return "error";
  if (status === "warn") return "warn";
  if (status === "ok") return "ok";
  return "muted";
}

function llmEconomyLevelLabel(level: string | undefined) {
  const labels: Record<string, string> = {
    off: "未启用",
    conservative: "保守",
    strict: "严格",
  };
  return labels[level || ""] || level || "未知";
}

function llmEconomyTone(level: string | undefined): StatusTone {
  if (level === "strict") return "error";
  if (level === "conservative") return "warn";
  return "muted";
}

function tokenBudgetText(item: any) {
  const limit = Number(item?.limit ?? 0);
  const used = Number(item?.used ?? 0);
  if (!limit) return "未配置";
  return `${used} / ${limit} tokens · 剩余 ${item?.remaining ?? 0}`;
}

function llmEconomyActionText(economy: any) {
  if (!economy?.enabled) return "未执行自动降成本";
  const actions = [
    economy.voice?.allowSmartJudge === false ? "暂停语音智能判断" : "",
    economy.tts?.allowLlmSpeechEnrichment === false ? "暂停 TTS LLM 润色" : "",
    economy.proactive?.allowScheduled === false ? "暂停定时主动消息" : "",
    economy.proactive?.allowAmbient === false ? "暂停环境主动消息" : "",
  ].filter(Boolean);
  return actions.length ? actions.join("、") : "保留当前链路";
}

function llmEconomyLimitText(summary: any, kind: "context" | "memory" | "source") {
  if (!summary) return "暂无";
  if (kind === "context") {
    const context = summary.context ?? {};
    return `读取 ${context.historyFetchLimit ?? "-"} 条 · 进 LLM ${context.llmHistoryLimit ?? "-"} 条 · 连续性 ${context.continuityRecentLimit ?? "-"} 条`;
  }
  if (kind === "memory") {
    const memory = summary.memoryRecall ?? {};
    return `${memory.maxMemories ?? "-"} 条 · 每条 ${memory.maxDescriptionChars ?? "-"} 字`;
  }
  const source = summary.sourceRecall ?? {};
  return `${source.maxChunks ?? "-"} 段 · 摘录 ${source.maxExcerptChars ?? "-"} 字 · 改写 ${source.maxRewriteTokens ?? "-"} tokens`;
}

function llmUsageBucketText(items: any[] | undefined, key: string, empty = "暂无") {
  const list = (items ?? []).slice(0, 4)
    .map(item => {
      const rawName = item?.[key] ?? item?.name ?? "未归属";
      const name = rawName === null || rawName === "" ? "未归属" : String(rawName);
      return `${name} ${item?.totalTokens ?? 0}`;
    });
  return list.length ? list.join("、") : empty;
}

function parseOptionalIntegerInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseUsageLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

function optionalUsageText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function usageErrorPreview(value: string | undefined) {
  if (!value) return "";
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

function usageRecordMeta(record: any) {
  const parts = [
    record?.purpose || "unknown",
    record?.route || "unknown",
    record?.reasoningEffort ? `推理 ${record.reasoningEffort}` : "",
    record?.userId == null ? "未归属用户" : `用户 #${record.userId}`,
    record?.personaId == null ? "未归属角色" : `角色 #${record.personaId}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function sceneImageLogReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "已生成";
  const labels: Record<string, string> = {
    disabled: "场景配图未启用或缺少完整配置",
    cooldown: "当前处于间隔限制",
    hourly_limit: "已达到本小时上限",
    timeout: "图片接口在等待时间内没有完成",
    network_error: "无法连接图片接口",
    invalid_response: "图片接口返回的数据无法识别",
    image_missing: "图片接口已响应，但没有返回图片",
    reference_missing: "用户或人物主参考图不可用",
    reference_protocol_unverified: "已配置图片站，但尚未确认支持正式人物参考图；正式 /p 配图已跳过该站点",
    storage_error: "图片已生成，但本机保存失败",
    pipeline_error: "图片任务在本机处理时中断",
    generation_failed: "图片接口没有生成可用图片",
  };
  if (labels[reason]) return labels[reason];
  const httpCode = /^http_(\d+)$/.exec(reason)?.[1];
  if (httpCode === "400") return "上游拒绝了此次图片请求或不支持当前参数";
  if (httpCode === "401" || httpCode === "403") return "上游拒绝此次图片请求";
  if (httpCode === "429") return "上游当前限流";
  if (httpCode === "500" || httpCode === "502" || httpCode === "503" || httpCode === "504") {
    return `上游服务暂不可用（HTTP ${httpCode}）`;
  }
  return "图片任务未完成";
}

function sceneImageChannelLabel(channel: string | null | undefined): string {
  if (channel === "qq") return "QQ";
  if (channel === "web") return "网页";
  return "未标记入口";
}

function sceneImageLogSourceLabel(source: string | null | undefined): string {
  if (source === "relay_test_neutral") return "中转站测试（中性）";
  if (source === "relay_test_scene") return "中转站测试（场景）";
  return "场景配图";
}

function sceneImageReferenceModeLabel(mode: string | null | undefined): string {
  const labels: Record<string, string> = {
    grok_single_image_edit: "仅人物主图已通过 Grok 单图编辑请求提交",
    grok_multi_image_edit: "人物主图与用户图已通过 Grok 多图编辑请求提交",
    google_single_image_input: "仅人物主图已作为 Google 单图输入提交",
    google_multi_image_input: "人物主图与用户图已作为 Google 多图输入提交",
    compatibility_single_image_edit: "仅人物主图已通过兼容接口的标准单图编辑请求提交",
    compatibility_multi_image_edit: "人物主图与用户图已通过兼容接口的标准多图编辑请求提交",
    compatibility_single_reference_input: "仅人物主图已按兼容字段提交；上游是否采用需以该站说明为准",
    compatibility_reference_input: "人物主图与用户图已按兼容字段提交；上游是否采用需以该站说明为准",
    merged_reference_image: "人物主图与用户图已合并为一张图后提交（兼容回退）",
    no_reference: "本次是无参考图的中性测试",
    reference_unavailable: "人物主图或用户图当时不可读取",
    not_attempted: "本次未开始图片接口调用",
  };
  return labels[mode ?? ""] ?? "历史记录未保存参考图提交状态";
}

function sceneImageOutputUrl(key: string | null | undefined): string | null {
  const normalized = (key ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  return /^(?:scene-images|scene-image-tests)\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(normalized)
    ? `/uploads/${normalized}`
    : null;
}

function platformDiagnosticAdvice(platform: "qq", status: any): DiagnosticAdvice | null {
  const message = String(status?.lastError || "").trim();

  if (platform === "qq") {
    if (!status?.enabled || status?.status === "disabled") {
      return {
        title: "QQ 未启用",
        detail: "在本机运行副本 .env 设置 QQ_ENABLED=true，重启 书中人 后再检查 NapCat。",
        tone: "muted",
      };
    }
    if (status?.status === "connected") {
      return {
        title: "NapCat 已连接",
        detail: "OneBot HTTP API 可访问，后续重点检查联系人绑定和 webhook 上报。",
        tone: "ok",
      };
    }
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)) {
      return {
        title: "NapCat / OneBot 不可访问",
        detail: "确认 NapCat 已启动，HTTP API 端口与 QQ_ONEBOT_BASE_URL 一致，并允许本机访问。",
        tone: "error",
      };
    }
    if (/401|403|unauthorized|token|access/i.test(message)) {
      return {
        title: "OneBot access token 可能不匹配",
        detail: "核对 NapCat accessToken 与 QQ_ONEBOT_ACCESS_TOKEN；事件上报 token 另看 webhook token。",
        tone: "error",
      };
    }
    if (message) {
      return {
        title: "QQ 接入异常",
        detail: message,
        tone: "error",
      };
    }
  }

  return null;
}

function AdvisoryBox({ advice }: { advice: DiagnosticAdvice | null }) {
  if (!advice) return null;
  const borderClasses: Record<StatusTone, string> = {
    ok: "border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200",
    warn: "border-amber-500/20 bg-amber-500/5 text-amber-800 dark:text-amber-200",
    error: "border-red-500/20 bg-red-500/5 text-red-800 dark:text-red-200",
    muted: "border-border/60 bg-muted/10 text-muted-foreground",
  };
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${borderClasses[advice.tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{advice.title}</span>
        {advice.scope && <span className="rounded-full bg-background/55 px-1.5 py-0.5 font-mono text-[10px] uppercase">{advice.scope}</span>}
      </div>
      <div className="mt-1 break-words">{advice.detail}</div>
      {advice.rawError && (
        <div className="mt-2 rounded-md bg-background/45 px-2 py-1.5 font-mono text-[11px] break-all">
          {advice.rawError}
        </div>
      )}
      {advice.actions && advice.actions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {advice.actions.map((action, index) => (
            <li key={`${advice.id ?? advice.title}-${index}`} className="break-words">
              {index + 1}. {action}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: profile, refetch } = trpc.user.getProfile.useQuery();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => { toast.success("资料已更新"); refetch(); setEditing(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { toast.success("密码已修改"); setShowPasswordDialog(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const resetPassword = trpc.user.resetPassword.useMutation({
    onSuccess: result => setResetPasswordValue(result.temporaryPassword),
    onError: (e: any) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  useEffect(() => {
    if (profile) {
      setEditName(profile.name || "");
      setEditEmail(profile.email || "");
    }
  }, [profile]);

  if (!profile) return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6 card-stagger">
      {/* Avatar + Basic Info */}
      <div className="warm-card p-6">
        <div className="flex items-start gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
              <span className="text-3xl font-bold text-primary">{(profile.name || profile.username).charAt(0).toUpperCase()}</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">昵称</Label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">邮箱</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    type="email" placeholder="your@email.com"
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                    onClick={() => updateProfile.mutate({ name: editName.trim() || undefined, email: editEmail.trim() || undefined })}
                    disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? "保存中..." : "保存"}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setEditing(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-semibold text-foreground">{profile.name || profile.username}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{profile.role}</span>
                </div>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.email && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" /> {profile.email}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 加入 {memberDays} 天
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> 上次登录 {formatBeijingDate(profile.lastSignedIn)}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 text-xs text-primary hover:text-primary/80 rounded-xl h-7 px-2"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3 h-3 mr-1" /> 编辑资料
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Account Stats */}
      {accountStats && (
        <div className="warm-card p-5 space-y-4">
          <SectionHeader icon={Database} title="账户统计" subtitle="账号内各类数据的总量" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatItem icon={Users} label="数字分身" value={accountStats.totalPersonas} />
            <StatItem icon={MessageCircle} label="总对话次数" value={accountStats.totalChats} />
            <StatItem icon={MessageCircle} label="总消息数" value={accountStats.totalMessages} />
            <StatItem icon={FileText} label="上传文件" value={accountStats.totalFiles} />
            <StatItem icon={HardDrive} label="存储空间" value={formatBytes(accountStats.storageUsed)} />
            <StatItem icon={Calendar} label="使用天数" value={memberDays} />
          </div>
        </div>
      )}

      {/* Security */}
      <div className="warm-card p-5 space-y-4">
        <SectionHeader icon={Shield} title="安全设置" subtitle="密码与登录方式" />
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl">
            <div className="flex items-center gap-3">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录密码</p>
                <p className="text-xs text-muted-foreground">定期修改密码以保护账户安全</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl text-xs border-border"
              onClick={() => setShowPasswordDialog(true)}>
              修改密码
            </Button>
          </div>
          <div className="flex items-center justify-between p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <RefreshCw className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-foreground">一键重置密码</p>
                <p className="text-xs text-muted-foreground">仅本地开发环境可用，自动生成一次性临时密码</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl text-xs border-amber-500/30 flex-shrink-0"
              onClick={() => { setResetPasswordValue(""); setShowResetPasswordDialog(true); }}
              disabled={resetPassword.isPending}>
              {resetPassword.isPending ? "重置中..." : "重置密码"}
            </Button>
          </div>
          {profile.loginMethod && (
            <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录方式</p>
                <p className="text-xs text-muted-foreground">{profile.loginMethod}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">修改密码</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">当前密码</Label>
              <div className="relative">
                <Input value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                  type={showCurrentPwd ? "text" : "password"} placeholder="输入当前密码"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">新密码</Label>
              <div className="relative">
                <Input value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  type={showNewPwd ? "text" : "password"} placeholder="至少 6 位"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <p className="text-xs text-destructive">密码至少需要 6 个字符</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">确认新密码</Label>
              <Input value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                type="password" placeholder="再次输入新密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
              {confirmPwd && confirmPwd !== newPwd && (
                <p className="text-xs text-destructive">两次输入的密码不一致</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPasswordDialog(false)} className="rounded-xl">取消</Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
              disabled={!currentPwd || newPwd.length < 6 || newPwd !== confirmPwd || changePassword.isPending}
              onClick={() => changePassword.mutate({ currentPassword: currentPwd, newPassword: newPwd })}>
              {changePassword.isPending ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetPasswordDialog} onOpenChange={open => {
        setShowResetPasswordDialog(open);
        if (!open) setResetPasswordValue("");
      }}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">{resetPasswordValue ? "临时密码已生成" : "一键重置密码"}</DialogTitle>
          </DialogHeader>
          {resetPasswordValue ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">旧密码已失效。临时密码只在这里显示一次，关闭窗口后不会再次显示。</p>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
                <code className="flex-1 min-w-0 break-all text-sm font-semibold text-foreground">{resetPasswordValue}</code>
                <Button size="icon" variant="outline" className="h-8 w-8 flex-shrink-0 rounded-lg" title="复制临时密码"
                  onClick={() => navigator.clipboard.writeText(resetPasswordValue).then(() => toast.success("临时密码已复制"))}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">系统会自动生成随机临时密码，当前登录态保持不变，旧密码会立即失效。</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">请确认你已准备好保存新生成的临时密码。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResetPasswordDialog(false)} className="rounded-xl">
              {resetPasswordValue ? "关闭" : "取消"}
            </Button>
            {!resetPasswordValue && (
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                onClick={() => resetPassword.mutate()} disabled={resetPassword.isPending}>
                {resetPassword.isPending ? "重置中..." : "确认重置"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI SETTINGS TAB ─────────────────────────────────────────────────────────

type SceneImageReference = { key: string; url: string };
type SceneImageProtocol = "auto" | "openai" | "google_gemini" | "comfyui";

type SceneImageRelaySummary = {
  id: number | null;
  relayName: string;
  priority: number;
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  protocol: SceneImageProtocol;
  size: string;
  timeoutMs: number;
  formalReferenceEnabled: boolean;
  workflowJson?: string | null;
  extraConfig?: Record<string, any> | null;
};

type SceneImageRelayDraft = SceneImageRelaySummary & {
  clientId: string;
  apiKey: string;
};

type SceneImageRelayTestMode = "neutral" | "scene";

type SceneImageTestResult = {
  status: "running" | "success" | "error";
  durationMs?: number;
  imageUrl?: string | null;
  reason?: string | null;
  errorMessage?: string | null;
  isSavedRelay?: boolean;
  enabledForSceneImages?: boolean;
  testMode?: SceneImageRelayTestMode;
  referenceMode?: string | null;
  recorded?: boolean | null;
};

type SceneImageModelOption = {
  id: string;
  displayName: string | null;
};

type SceneImageModelLookup = {
  status: "loading" | "success" | "error";
  models?: SceneImageModelOption[];
  protocol?: Exclude<SceneImageProtocol, "auto">;
  filteredToImageModels?: boolean;
  message?: string | null;
};

type SceneImagePromptRewriteRelayOption = {
  relayId: number;
  providerName: string;
  relayName: string;
  priority: number;
  model: string | null;
};

type SceneImageSettingsSummary = {
  source: "saved" | "environment" | "none";
  hasSavedConfig: boolean;
  enabled: boolean;
  priorityStrategy: "comfyui_first" | "relay_first" | "comfyui_only" | "relay_only";
  comfyPromptTemplate: string | null;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  size: string;
  timeoutMs: number;
  cooldownMinutes: number;
  maxPerHour: number;
  relays: SceneImageRelaySummary[];
  userReference: SceneImageReference | null;
  personaReferences: SceneImageReference[];
  activePersonaReferenceKey: string | null;
  /** null 表示自动优先 Claude。 */
  promptRewriteRelayId: number | null;
  promptRewriteDefaultRelayId: number | null;
  promptRewriteRelayOptions: SceneImagePromptRewriteRelayOption[];
  environmentReferenceAvailable: boolean;
};

function createSceneImageRelayDraft(relay: SceneImageRelaySummary, index: number): SceneImageRelayDraft {
  return { ...relay, clientId: relay.id === null ? `environment-${index}` : `saved-${relay.id}`, apiKey: "" };
}

function createNewSceneImageRelayDraft(index: number): SceneImageRelayDraft {
  return {
    id: null,
    clientId: `draft-${Date.now()}-${index}`,
    relayName: `云端中转站 ${index + 1}`,
    priority: Math.max(10, 100 - index * 10),
    enabled: true,
    apiKeyConfigured: false,
    apiKey: "",
    baseUrl: "",
    model: "",
    protocol: "openai",
    size: "1024x1024",
    timeoutMs: 180000,
    formalReferenceEnabled: false,
    workflowJson: null,
    extraConfig: null,
  };
}

function sceneImageTestReasonLabel(reason?: string | null): string {
  if (!reason) return "图片接口没有返回可用图片";
  if (reason === "timeout") return "等待时间已到，图片接口没有在设定时间内完成";
  if (reason === "network_error") return "无法连接图片接口";
  if (reason === "invalid_response") return "图片接口返回的数据无法识别";
  if (reason === "image_missing") return "图片接口已响应，但没有返回图片";
  if (reason === "reference_missing") return "测试配置不完整";
  if (reason === "reference_protocol_unverified") return "图片接口虽已配置，但尚未确认支持正式人物参考图；正式 /p 配图已跳过该站点";
  if (reason === "storage_error") return "图片已生成，但本机保存测试结果失败";
  if (/^http_\d+$/.test(reason)) return `图片接口返回了 HTTP ${reason.slice(5)} 错误`;
  return "图片接口测试失败";
}

function sceneImageRelaySupportsReferences(relay: Pick<SceneImageRelaySummary, "baseUrl" | "model" | "protocol">): boolean {
  return relay.protocol === "google_gemini"
    || relay.protocol === "comfyui"
    || /generativelanguage\.googleapis\.com/i.test(relay.baseUrl)
    || /^grok-imagine-image/i.test(relay.model.trim());
}

function readImageFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result.split(",")[1] : "";
      if (!value) {
        reject(new Error("参考图读取失败"));
        return;
      }
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

function SceneImageSettingsCard() {
  const configQuery = trpc.sceneImageConfig.get.useQuery();
  const config = configQuery.data as SceneImageSettingsSummary | undefined;
  const [enabled, setEnabled] = useState(false);
  const [priorityStrategy, setPriorityStrategy] = useState<"comfyui_first" | "relay_first" | "comfyui_only" | "relay_only">("comfyui_first");
  const [comfyPromptTemplate, setComfyPromptTemplate] = useState<string>("");
  const [editingPromptTemplateDialog, setEditingPromptTemplateDialog] = useState(false);
  const [editingWorkflowDraft, setEditingWorkflowDraft] = useState<{ clientId: string; json: string } | null>(null);
  const [userReference, setUserReference] = useState<SceneImageReference | null>(null);
  const [personaReferences, setPersonaReferences] = useState<SceneImageReference[]>([]);
  const [activePersonaReferenceKey, setActivePersonaReferenceKey] = useState<string | null>(null);
  const [promptRewriteRelayId, setPromptRewriteRelayId] = useState<number | null>(null);
  const [uploadingTarget, setUploadingTarget] = useState<"user" | "personaMain" | "personaBackup" | null>(null);
  const [relayDrafts, setRelayDrafts] = useState<SceneImageRelayDraft[]>([]);
  const [testResults, setTestResults] = useState<Record<string, SceneImageTestResult>>({});
  const [relayTestMode, setRelayTestMode] = useState<SceneImageRelayTestMode>("neutral");
  const [relayTestScenePrompt, setRelayTestScenePrompt] = useState("");
  const [modelLookups, setModelLookups] = useState<Record<string, SceneImageModelLookup>>({});
  const automaticModelLookupIds = useRef(new Set<string>());

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setPriorityStrategy(config.priorityStrategy ?? "comfyui_first");
    setComfyPromptTemplate(config.comfyPromptTemplate ?? "");
    setUserReference(config.userReference);
    setPersonaReferences(config.personaReferences);
    setActivePersonaReferenceKey(config.activePersonaReferenceKey);
    setPromptRewriteRelayId(
      config.promptRewriteRelayId && config.promptRewriteRelayOptions.some(option => option.relayId === config.promptRewriteRelayId)
        ? config.promptRewriteRelayId
        : null,
    );
    setRelayDrafts(config.relays.map(createSceneImageRelayDraft));
    setModelLookups({});
    automaticModelLookupIds.current.clear();
  }, [config]);

  const saveConfig = trpc.sceneImageConfig.save.useMutation({
    onSuccess: () => {
      toast.success("场景配图设置已保存");
      configQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const persistSceneImageConfig = () => saveConfig.mutateAsync({
    enabled,
    userReferenceKey: userReference?.key ?? null,
    personaReferenceKeys: personaReferences.map(reference => reference.key),
    activePersonaReferenceKey: activePersonaReferenceKey && personaReferences.some(reference => reference.key === activePersonaReferenceKey)
      ? activePersonaReferenceKey
      : null,
    promptRewriteRelayId,
    priorityStrategy,
    comfyPromptTemplate: comfyPromptTemplate.trim() || null,
  });
  const uploadReference = trpc.sceneImageConfig.uploadReference.useMutation({
    onError: error => toast.error(error.message),
  });
  const importLocalReferences = trpc.sceneImageConfig.importLocalReferences.useMutation({
    onSuccess: () => {
      toast.success("本机已有的用户主图、人物主图和备用图已导入当前账户");
      configQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const saveRelay = trpc.sceneImageConfig.saveRelay.useMutation({
    onSuccess: () => {
      toast.success("图片设置已保存");
      configQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const deleteRelay = trpc.sceneImageConfig.deleteRelay.useMutation({
    onSuccess: () => {
      toast.success("图片设置已移除");
      configQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const testRelay = trpc.sceneImageConfig.testRelay.useMutation();
  const listRelayModels = trpc.sceneImageConfig.listRelayModels.useMutation();

  const uploadReferenceFile = async (target: "user" | "personaMain" | "personaBackup", file: File) => {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("参考图仅支持 PNG、JPEG 或 WebP 格式");
      return;
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      toast.error("参考图必须小于 10 MB");
      return;
    }
    setUploadingTarget(target);
    try {
      const fileContent = await readImageFileAsBase64(file);
      const reference = await uploadReference.mutateAsync({
        fileContent,
        mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
      });
      if (target === "user") {
        setUserReference(reference);
      } else {
        setPersonaReferences(previous => [...previous, reference]);
        if (target === "personaMain") setActivePersonaReferenceKey(reference.key);
        else setActivePersonaReferenceKey(previous => previous ?? reference.key);
      }
      toast.success("参考图已加入，点击保存后才会用于出图");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图上传失败");
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleReferenceInput = (target: "user" | "personaMain" | "personaBackup", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadReferenceFile(target, file);
  };

  const handleWorkflowJsonUpload = (clientId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result || "");
        JSON.parse(text);
        updateRelayDraft(clientId, { workflowJson: text });
        toast.success(`已成功读取并导入工作流：${file.name}`);
      } catch {
        toast.error("所选文件不是合法的 JSON 格式，请确认导出自 ComfyUI API 格式");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const removePersonaReference = (key: string) => {
    setPersonaReferences(previous => {
      const next = previous.filter(reference => reference.key !== key);
      setActivePersonaReferenceKey(current => current === key ? next[0]?.key ?? null : current);
      return next;
    });
  };

  const updateRelayDraft = (clientId: string, patch: Partial<SceneImageRelayDraft>) => {
    setRelayDrafts(previous => {
      const exists = previous.some(r => r.clientId === clientId);
      if (!exists) {
        const newDraft: SceneImageRelayDraft = {
          id: null,
          clientId,
          relayName: "本地 ComfyUI",
          priority: 200,
          enabled: true,
          apiKeyConfigured: false,
          apiKey: "",
          baseUrl: "",
          model: "",
          protocol: "comfyui",
          size: "1024x1024",
          timeoutMs: 180000,
          formalReferenceEnabled: true,
          workflowJson: null,
          extraConfig: null,
          ...patch,
        };
        return [...previous, newDraft];
      }
      return previous.map(relay => relay.clientId === clientId ? { ...relay, ...patch } : relay);
    });
  };

  const removeRelayDraft = (relay: SceneImageRelayDraft) => {
    if (relay.id !== null) {
      deleteRelay.mutate({ id: relay.id });
      return;
    }
    setRelayDrafts(previous => previous.filter(item => item.clientId !== relay.clientId));
  };

  const relayPayload = useCallback((relay: SceneImageRelayDraft) => ({
    ...(relay.id !== null ? { id: relay.id } : {}),
    relayName: relay.relayName.trim() || (relay.protocol === "comfyui" ? "本地 ComfyUI" : "未命名图片中转站"),
    priority: relay.priority,
    enabled: relay.enabled,
    apiKey: relay.apiKey.trim() || undefined,
    baseUrl: relay.baseUrl.trim(),
    model: relay.model.trim(),
    protocol: relay.protocol,
    size: relay.size.trim() || "1024x1024",
    timeoutMs: relay.timeoutMs,
    formalReferenceEnabled: relay.protocol === "comfyui" ? true : relay.formalReferenceEnabled,
    workflowJson: relay.workflowJson ?? null,
    extraConfig: (relay.extraConfig as Record<string, any> | null) ?? null,
  }), []);

  const loadRelayModels = useCallback(async (relay: SceneImageRelayDraft) => {
    const isComfy = relay.protocol === "comfyui";
    if (!isComfy && !relay.apiKey.trim() && !relay.apiKeyConfigured) {
      toast.error("获取模型前请先填写图片接口密钥");
      return;
    }
    setModelLookups(previous => ({
      ...previous,
      [relay.clientId]: { status: "loading", models: [], filteredToImageModels: true, message: null },
    }));
    try {
      const result = await listRelayModels.mutateAsync(relayPayload(relay));
      setModelLookups(previous => ({
        ...previous,
        [relay.clientId]: {
          status: "success",
          models: result.models,
          filteredToImageModels: result.filteredToImageModels,
          message: result.message,
        },
      }));
      if (result.models.length > 0 && (!relay.model || !result.models.some(model => model.id === relay.model))) {
        if (!isComfy) {
          updateRelayDraft(relay.clientId, { model: result.models[0].id });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取图片模型失败";
      setModelLookups(previous => ({
        ...previous,
        [relay.clientId]: {
          status: "error",
          models: [],
          filteredToImageModels: true,
          message,
        },
      }));
      toast.error(message);
    }
  }, [listRelayModels, relayPayload]);

  const runRelayTest = async (relay: SceneImageRelayDraft) => {
    const isComfy = relay.protocol === "comfyui";
    if (!isComfy && !relay.apiKey.trim() && !relay.apiKeyConfigured) {
      toast.error("测试前请先填写图片接口密钥");
      return;
    }
    if (relayTestMode === "scene" && !relayTestScenePrompt.trim()) {
      toast.error("场景提示词测试需要填写一段画面描述");
      return;
    }
    setTestResults(previous => ({
      ...previous,
      [relay.clientId]: { status: "running", testMode: relayTestMode },
    }));
    try {
      const result = await testRelay.mutateAsync({
        ...relayPayload(relay),
        testMode: relayTestMode,
        scenePrompt: relayTestMode === "scene" ? relayTestScenePrompt.trim() : undefined,
      });
      setTestResults(previous => ({
        ...previous,
        [relay.clientId]: {
          status: result.success ? "success" : "error",
          imageUrl: result.imageUrl,
          durationMs: result.durationMs,
          reason: result.reason,
          errorMessage: result.errorMessage,
          testMode: result.testMode,
          referenceMode: result.referenceMode,
          recorded: Boolean(result.recorded),
          enabledForSceneImages: relay.enabled,
        },
      }));
      if (result.success) {
        toast.success(`${relay.relayName || (isComfy ? "本地 ComfyUI" : "图片中转站")}实际生成测试成功`);
      } else {
        toast.error(result.errorMessage ? `测试未成功：${result.errorMessage}` : "图片接口没有返回可用图片");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片中转站测试失败";
      setTestResults(previous => ({
        ...previous,
        [relay.clientId]: {
          status: "error",
          errorMessage: message,
          testMode: relayTestMode,
          referenceMode: "not_attempted",
          recorded: false,
          enabledForSceneImages: relay.enabled,
        },
      }));
      toast.error(message);
    }
  };

  const savedSceneTestReferencesReady = Boolean(config?.userReference && config?.activePersonaReferenceKey);
  const promptRewriteOptions = config?.promptRewriteRelayOptions ?? [];
  const defaultPromptRewriteRelay = promptRewriteOptions.find(option => option.relayId === config?.promptRewriteDefaultRelayId);

  // 拆分：本地 ComfyUI 配置项与云端图片中转站列表
  const comfyRelay = relayDrafts.find(r => r.protocol === "comfyui") || {
    id: null,
    clientId: "comfyui-default",
    relayName: "本地 ComfyUI",
    priority: 200,
    enabled: true,
    apiKeyConfigured: false,
    apiKey: "",
    baseUrl: "",
    model: "",
    protocol: "comfyui" as const,
    size: "1024x1024",
    timeoutMs: 180000,
    formalReferenceEnabled: true,
    workflowJson: null,
    extraConfig: null,
  };
  const cloudRelays = relayDrafts.filter(r => r.protocol !== "comfyui");

  // 解析 ComfyUI 节点数摘要
  const comfyNodeCount = useMemo(() => {
    if (!comfyRelay.workflowJson) return 0;
    try {
      const obj = JSON.parse(comfyRelay.workflowJson);
      return Object.keys(obj).length;
    } catch {
      return 0;
    }
  }, [comfyRelay.workflowJson]);

  return (
    <section className="space-y-6">
      {/* 1. 顶部全局开关与提示词模型 */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 p-4 rounded-xl border border-border/60 bg-muted/20">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2">
            <Label className="text-base font-semibold text-foreground">剧情场景配图（/p 指令）</Label>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
              {enabled ? "已全局启用" : "未开启"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            在聊天中输入 <code className="px-1 py-0.5 rounded bg-muted font-mono text-primary font-medium">/p</code> 时，系统会提取剧情分镜、由提示词模型编写视觉剧照描述，并自动调用本地 ComfyUI 或云端中转站出图。
          </p>
        </div>
        <Button variant={enabled ? "default" : "outline"} className="rounded-xl shrink-0" onClick={() => setEnabled(!enabled)}>
          {enabled ? "已启用：点击关闭" : "已关闭：点击开启"}
        </Button>
      </div>

      {/* 2. 出图渠道优先级策略 */}
      <div className="space-y-3 rounded-xl border border-border/50 bg-background/35 p-4">
        <div>
          <Label className="text-sm font-semibold text-foreground">出图渠道优先级</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">自由决定优先由本地 ComfyUI 还是云端中转站生图；一方失败或未配置时自动故障转移。</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { key: "comfyui_first", title: "⚡ 优先本地 ComfyUI", desc: "本地优先出图，失败自动回退到云端中转站（推荐）" },
            { key: "relay_first", title: "☁️ 优先云端中转站", desc: "云端中转站优先，失败自动尝试本地 ComfyUI" },
            { key: "comfyui_only", title: "🖥️ 仅使用本地 ComfyUI", desc: "只使用本地算力，不消耗外部中转站额度" },
            { key: "relay_only", title: "🌐 仅使用云端中转站", desc: "只使用云端图片中转站生图" },
          ].map(strat => (
            <button key={strat.key} type="button"
              onClick={() => setPriorityStrategy(strat.key as any)}
              className={`rounded-xl border p-3 text-left transition-all ${priorityStrategy === strat.key ? "border-primary bg-primary/8 ring-1 ring-primary/30" : "border-border/60 bg-muted/15 hover:bg-muted/35"}`}>
              <span className="block text-xs font-semibold text-foreground">{strat.title}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground leading-4">{strat.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. 提示词改写模型 */}
      <div className="space-y-2 rounded-xl border border-border/50 bg-muted/10 p-4">
        <Label className="text-sm font-semibold text-foreground">提示词编写模型（由文字中转站提供）</Label>
        <p className="text-xs text-muted-foreground">改写模型负责将当前剧情提炼为具有视觉张力的写实电影剧照分镜。本地 ComfyUI 生图将完全放开敏感审核与打码限制。</p>
        <select value={promptRewriteRelayId ?? ""} onChange={event => setPromptRewriteRelayId(event.target.value ? Number(event.target.value) : null)}
          className="w-full h-9 px-3 bg-muted/50 border border-border rounded-lg text-xs text-foreground mt-1">
          <option value="">{defaultPromptRewriteRelay ? `自动优先（当前将使用：${defaultPromptRewriteRelay.relayName}）` : "自动优先 Claude 文字中转站"}</option>
          {promptRewriteOptions.map(option => (
            <option key={option.relayId} value={option.relayId}>
              {option.relayName}（{option.providerName} / {option.model || "未指定模型"} / 优先级 {option.priority}）
            </option>
          ))}
        </select>
      </div>

      {/* 4. 参考图设置（四视图） */}
      <div className="space-y-3 rounded-xl border border-border/50 p-4">
        <div>
          <Label className="text-sm font-semibold text-foreground">参考图设置（四视图）</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">用于保持人物在不同画面中的脸型、五官与外貌一致性。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 rounded-xl border border-border/40 bg-muted/15 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">用户主参考图</Label>
              <label className="cursor-pointer text-[11px] font-medium text-primary hover:underline">
                {userReference ? "更换图片" : "上传主图"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                  onChange={event => handleReferenceInput("user", event)} />
              </label>
            </div>
            {userReference ? (
              <div className="relative group rounded-lg overflow-hidden border border-border aspect-[4/3] bg-background/50 flex items-center justify-center">
                <img src={userReference.url} alt="用户主参考图" className="w-full h-full object-contain" />
                <button type="button" onClick={() => setUserReference(null)} className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/80 aspect-[4/3] flex flex-col items-center justify-center text-muted-foreground text-xs p-4 text-center">
                <ImageIcon className="w-8 h-8 mb-1.5 opacity-40" />
                <span>暂无用户参考图</span>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-border/40 bg-muted/15 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">人物主参考图</Label>
              <label className="cursor-pointer text-[11px] font-medium text-primary hover:underline">
                添加备用/主图
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                  onChange={event => handleReferenceInput("personaBackup", event)} />
              </label>
            </div>
            {personaReferences.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {personaReferences.map(ref => {
                  const isActive = ref.key === activePersonaReferenceKey;
                  return (
                    <div key={ref.key} onClick={() => setActivePersonaReferenceKey(ref.key)}
                      className={`relative group rounded-lg overflow-hidden border cursor-pointer aspect-square bg-background/50 flex items-center justify-center transition-all ${isActive ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-primary/50"}`}>
                      <img src={ref.url} alt="人物参考图" className="w-full h-full object-contain" />
                      {isActive && <span className="absolute bottom-1 left-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1 rounded">当前主图</span>}
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePersonaReference(ref.key); }} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/80 aspect-[4/3] flex flex-col items-center justify-center text-muted-foreground text-xs p-4 text-center">
                <ImageIcon className="w-8 h-8 mb-1.5 opacity-40" />
                <span>暂无人物参考图</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. 实际生成测试选择 */}
      <div className="space-y-3 rounded-xl border border-border/50 bg-muted/10 p-4">
        <div>
          <Label className="text-sm font-semibold text-foreground">实际出图测试模式</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">选择下方中转站或本地 ComfyUI 执行测试时要提交的测试内容：</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" aria-pressed={relayTestMode === "neutral"}
            onClick={() => setRelayTestMode("neutral")}
            className={`min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors ${relayTestMode === "neutral" ? "border-primary bg-primary/5" : "border-border/60 bg-background/35 hover:bg-muted/30"}`}>
            <span className="block text-xs font-semibold text-foreground">中性静物测试</span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">固定的白色陶瓷杯提示词；不读取人物、场景、参考图或聊天内容。</span>
          </button>
          <button type="button" aria-pressed={relayTestMode === "scene"}
            onClick={() => setRelayTestMode("scene")}
            className={`min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors ${relayTestMode === "scene" ? "border-primary bg-primary/5" : "border-border/60 bg-background/35 hover:bg-muted/30"}`}>
            <span className="block text-xs font-semibold text-foreground">场景提示词测试</span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">提交你填写的画面描述，并携带当前已保存的用户主图和人物主图。</span>
          </button>
        </div>
        {relayTestMode === "scene" && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-background/35 p-2.5">
            <Label htmlFor="scene-image-relay-test-prompt" className="text-xs text-foreground/80">测试用场景提示词</Label>
            <textarea id="scene-image-relay-test-prompt" value={relayTestScenePrompt}
              onChange={event => setRelayTestScenePrompt(event.target.value)} maxLength={1200} rows={3}
              placeholder="例如：九十年代傍晚的教室里，两人隔着讲台轻声交谈，暖黄灯光，写实电影中景。"
              className="w-full resize-y rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* 6. 【板块一】本地 ComfyUI 工作流生图设置（独立卡片）                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const relay = comfyRelay;
        const result = testResults[relay.clientId];
        const modelLookup = modelLookups[relay.clientId];
        const upstreamModels = modelLookup?.models ?? [];
        const modelOptions = relay.model && !upstreamModels.some(m => m.id === relay.model)
          ? [{ id: relay.model, displayName: null }, ...upstreamModels]
          : upstreamModels;
        const sceneTestBlocked = relayTestMode === "scene"
          && (!relayTestScenePrompt.trim() || !savedSceneTestReferencesReady);

        return (
          <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-primary/20 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary" />
                  <Label className="text-base font-semibold text-foreground">本地 ComfyUI 工作流生图</Label>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${relay.enabled ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                    {relay.enabled ? "已启用本地生图" : "已停用"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  直接连接本地运行的 ComfyUI 实例，支持全自动参数注入（正向/负向提示词、尺寸、随机种子），完全放开提示词审核限制。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs text-foreground/70">ComfyUI 接口地址</Label>
                <Input value={relay.baseUrl} onChange={event => updateRelayDraft(relay.clientId, { baseUrl: event.target.value })}
                  placeholder="http://127.0.0.1:8188（留空默认此地址）"
                  className="h-9 bg-background/60 border-border rounded-lg font-mono text-xs" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-foreground/70">Checkpoint 模型（本地选择）</Label>
                  <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 rounded-md px-2 text-[11px]"
                    disabled={modelLookup?.status === "loading"}
                    onClick={() => void loadRelayModels(relay)}>
                    <Download className="mr-1 h-3 w-3" />
                    {modelLookup?.status === "loading" ? "获取中..." : "获取本地模型"}
                  </Button>
                </div>
                <select value={relay.model} onChange={event => updateRelayDraft(relay.clientId, { model: event.target.value })}
                  className="w-full h-9 px-3 bg-background/60 border border-border rounded-lg text-xs text-foreground">
                  <option value="">沿用工作流内置模型（不覆盖）</option>
                  {modelOptions.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.displayName && model.displayName !== model.id ? `${model.displayName}（${model.id}）` : model.id}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">留空即沿用工作流原本连接的模型文件，也可点击右侧按钮拉取后强制指定。</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">图片尺寸</Label>
                <select value={relay.size} onChange={event => updateRelayDraft(relay.clientId, { size: event.target.value })}
                  className="w-full h-9 px-3 bg-background/60 border border-border rounded-lg text-xs text-foreground">
                  <option value="auto">沿用工作流尺寸（不覆盖）</option>
                  <option value="same_as_reference">跟图片一样（自适应参考图尺寸）</option>
                  <option value="1024x1024">1024 × 1024（正方形）</option>
                  <option value="1024x1536">1024 × 1536（竖图）</option>
                  <option value="1536x1024">1536 × 1024（横图）</option>
                </select>
                <p className="text-[11px] text-muted-foreground">选“跟图片一样”时，自动读取输入参考图尺寸并等比对齐为 64 的倍数。</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">单张最长等待（秒）</Label>
                <Input
                  type="number" min={10} max={1800} step={10}
                  value={Math.round(relay.timeoutMs / 1000)}
                  onChange={event => {
                    const val = Number.parseInt(event.target.value, 10);
                    const seconds = Number.isFinite(val) ? Math.max(10, Math.min(1800, val)) : 180;
                    updateRelayDraft(relay.clientId, { timeoutMs: seconds * 1000 });
                  }}
                  placeholder="180" className="h-9 bg-background/60 border-border rounded-lg"
                />
              </div>

              {/* 工作流模板管理区域（紧凑版，不直接在页面拉出大输入框） */}
              <div className="space-y-2 md:col-span-2 rounded-xl border border-border/70 bg-background/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs font-semibold text-foreground">工作流模板状态</Label>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${relay.workflowJson ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {relay.workflowJson ? `已配置自定义工作流（${comfyNodeCount} 个节点）` : "使用内置标准文生图工作流"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">支持直接上传 ComfyUI 导出的 API 格式 JSON 文件；点击右侧可弹窗查看或编辑。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg border border-border bg-muted/60 text-xs font-medium cursor-pointer hover:bg-muted">
                      <Download className="w-3.5 h-3.5" />
                      上传工作流 JSON 文件
                      <input type="file" accept=".json,application/json" className="sr-only"
                        onChange={event => handleWorkflowJsonUpload(relay.clientId, event)} />
                    </label>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                      onClick={() => setEditingWorkflowDraft({ clientId: relay.clientId, json: relay.workflowJson ?? "" })}>
                      <Eye className="w-3.5 h-3.5 mr-1" />
                      查看 / 编辑工作流
                    </Button>
                    {relay.workflowJson && (
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => updateRelayDraft(relay.clientId, { workflowJson: null })}>
                        恢复内置默认
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* 提示词模板管理区域（思考模式专属） */}
              <div className="space-y-2 md:col-span-2 rounded-xl border border-primary/20 bg-background/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      <Label className="text-xs font-semibold text-foreground">AI 提示词生成模板（思考模式）</Label>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${comfyPromptTemplate.trim() ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" : "bg-muted text-muted-foreground"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {comfyPromptTemplate.trim() ? "已配置专属提示词模板" : "使用内置高表现力分镜格式"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      大模型为 ComfyUI 编写分镜提示词时将强制开启思考模式（Reasoning），并严格按此模板结构输出（如 MiniMax H3 / Flux 专属指令）。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                      onClick={() => setEditingPromptTemplateDialog(true)}>
                      <Sparkles className="w-3.5 h-3.5 mr-1 text-primary" />
                      查看 / 编辑提示词模板
                    </Button>
                    {comfyPromptTemplate.trim() && (
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setComfyPromptTemplate("")}>
                        恢复内置格式
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
              <Button size="sm" variant={relay.enabled ? "default" : "outline"} className="h-8 rounded-lg"
                onClick={() => updateRelayDraft(relay.clientId, { enabled: !relay.enabled })}>
                {relay.enabled ? "已启用：点击停用" : "已停用：点击启用"}
              </Button>
              <Button size="sm" className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={saveRelay.isPending} onClick={() => saveRelay.mutate(relayPayload(relay))}>
                <Check className="w-3.5 h-3.5 mr-1" />{saveRelay.isPending ? "保存中..." : "保存本地工作流设置"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-lg"
                disabled={testRelay.isPending || sceneTestBlocked} onClick={() => void runRelayTest(relay)}>
                <ImageIcon className="w-3.5 h-3.5 mr-1" />{result?.status === "running" ? "正在实际生成..." : relayTestMode === "scene" ? "场景提示词测试" : "中性实际生成测试"}
              </Button>
            </div>

            {result && (
              <div className={`rounded-lg border p-2.5 text-xs ${result.status === "success" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200" : result.status === "running" ? "border-primary/30 bg-primary/5 text-foreground" : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"}`}>
                {result.status === "running" ? (
                  result.testMode === "scene" ? "正在调用本地 ComfyUI 执行场景生图测试..." : "正在调用本地 ComfyUI 执行中性测试..."
                ) : result.status === "success" ? (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <span>ComfyUI 生图测试成功，用时 {Math.max(1, Math.round((result.durationMs ?? 0) / 1000))} 秒。</span>
                    {result.imageUrl && <a href={result.imageUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">打开测试图</a>}
                  </div>
                ) : (
                  <span>测试失败：{result.errorMessage || sceneImageTestReasonLabel(result.reason)}</span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* 7. 【板块二】云端图片中转站列表（独立卡片）                                 */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4 rounded-xl border border-border/50 bg-muted/10 p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-border/40 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              <Label className="text-base font-semibold text-foreground">云端图片中转站列表</Label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              配置 OpenAI、Google Gemini、Grok 等第三方图片 API。每张卡片为独立的地址、密钥和模型，支持多站故障转移。
            </p>
          </div>
          <Button size="sm" variant="outline" className="rounded-lg shrink-0"
            onClick={() => setRelayDrafts(previous => [...previous, createNewSceneImageRelayDraft(previous.length)])}>
            <Plus className="w-3.5 h-3.5 mr-1" />添加云端图片中转站
          </Button>
        </div>

        {cloudRelays.length === 0 ? (
          <p className="rounded-lg bg-background/50 p-4 text-xs text-muted-foreground text-center">
            暂未添加云端图片中转站。如需使用外部 API 作为备用或主力生图通道，点击上方按钮添加。
          </p>
        ) : cloudRelays.map((relay, index) => {
          const result = testResults[relay.clientId];
          const modelLookup = modelLookups[relay.clientId];
          const upstreamModels = modelLookup?.models ?? [];
          const modelOptions = relay.model && !upstreamModels.some(m => m.id === relay.model)
            ? [{ id: relay.model, displayName: null }, ...upstreamModels]
            : upstreamModels;
          const sceneTestBlocked = relayTestMode === "scene"
            && (!relayTestScenePrompt.trim() || !savedSceneTestReferencesReady);

          return (
            <div key={relay.clientId} className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">{index + 1}</span>
                  <p className="text-sm font-semibold text-foreground truncate">{relay.relayName || "未命名图片中转站"}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${relay.enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{relay.enabled ? "参与配图" : "已停用"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${relay.formalReferenceEnabled ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                    {relay.formalReferenceEnabled ? "允许正式人物配图" : "仅测试"}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">优先级 {relay.priority}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">中转站名称</Label>
                  <Input value={relay.relayName} onChange={event => updateRelayDraft(relay.clientId, { relayName: event.target.value })}
                    className="h-9 bg-muted/40 border-border rounded-lg" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">优先级</Label>
                  <Input value={relay.priority} type="number" min={-10000} max={10000}
                    onChange={event => updateRelayDraft(relay.clientId, { priority: Number(event.target.value) || 0 })}
                    className="h-9 bg-muted/40 border-border rounded-lg" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-foreground/70">图片接口地址</Label>
                  <Input value={relay.baseUrl} onChange={event => updateRelayDraft(relay.clientId, { baseUrl: event.target.value })}
                    placeholder="https://你的图片接口地址/v1" className="h-9 bg-muted/40 border-border rounded-lg font-mono text-xs" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-foreground/70">图片接口密钥</Label>
                  <Input value={relay.apiKey} onChange={event => updateRelayDraft(relay.clientId, { apiKey: event.target.value })} type="password"
                    placeholder={relay.apiKeyConfigured ? "已保存；留空即保持不变" : "填写该中转站的图片接口密钥"}
                    autoComplete="new-password" className="h-9 bg-muted/40 border-border rounded-lg" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-foreground/70">图片模型（从上游选择）</Label>
                    <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 rounded-md px-2 text-[11px]"
                      disabled={modelLookup?.status === "loading"}
                      onClick={() => void loadRelayModels(relay)}>
                      <Download className="mr-1 h-3 w-3" />
                      {modelLookup?.status === "loading" ? "获取中..." : "获取上游模型"}
                    </Button>
                  </div>
                  <select value={relay.model} onChange={event => updateRelayDraft(relay.clientId, { model: event.target.value })}
                    disabled={modelLookup?.status !== "success" || modelOptions.length === 0}
                    className="w-full h-9 px-3 bg-muted/40 border border-border rounded-lg text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60">
                    <option value="">{modelLookup?.status === "loading" ? "正在读取模型..." : modelOptions.length > 0 ? "请选择模型" : relay.model ? `当前模型：${relay.model}` : "先填写地址和密钥，再获取上游模型"}</option>
                    {modelOptions.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.displayName && model.displayName !== model.id ? `${model.displayName}（${model.id}）` : model.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">接口协议</Label>
                  <select value={relay.protocol} onChange={event => updateRelayDraft(relay.clientId, { protocol: event.target.value as SceneImageProtocol })}
                    className="w-full h-9 px-3 bg-muted/40 border border-border rounded-lg text-xs text-foreground">
                    <option value="auto">自动识别（Google 直连会用原生接口）</option>
                    <option value="openai">OpenAI 兼容图片接口</option>
                    <option value="google_gemini">Google Gemini 原生图片接口</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">图片尺寸</Label>
                  <select value={relay.size} onChange={event => updateRelayDraft(relay.clientId, { size: event.target.value })}
                    className="w-full h-9 px-3 bg-muted/40 border border-border rounded-lg text-xs text-foreground">
                    <option value="1024x1024">1024 × 1024（正方形）</option>
                    <option value="1024x1536">1024 × 1536（竖图）</option>
                    <option value="1536x1024">1536 × 1024（横图）</option>
                    <option value="auto">由图片模型决定</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/70">单张最长等待（秒）</Label>
                  <Input
                    type="number" min={10} max={1800} step={10}
                    value={Math.round(relay.timeoutMs / 1000)}
                    onChange={event => {
                      const val = Number.parseInt(event.target.value, 10);
                      const seconds = Number.isFinite(val) ? Math.max(10, Math.min(1800, val)) : 180;
                      updateRelayDraft(relay.clientId, { timeoutMs: seconds * 1000 });
                    }}
                    placeholder="180" className="h-9 bg-muted/40 border-border rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={relay.enabled ? "default" : "outline"} className="h-8 rounded-lg"
                  onClick={() => updateRelayDraft(relay.clientId, { enabled: !relay.enabled })}>
                  {relay.enabled ? "已启用：点击停用" : "已停用：点击启用"}
                </Button>
                <label className={`inline-flex items-center gap-2 rounded-lg border px-2.5 h-8 text-[11px] ${sceneImageRelaySupportsReferences(relay) ? "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300" : "border-border/60 bg-background/35 text-muted-foreground"}`}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary"
                    checked={relay.formalReferenceEnabled}
                    disabled={sceneImageRelaySupportsReferences(relay)}
                    onChange={event => updateRelayDraft(relay.clientId, { formalReferenceEnabled: event.target.checked })} />
                  {sceneImageRelaySupportsReferences(relay) ? "已确认协议：正式配图固定开启" : "允许正式人物配图"}
                </label>
                <Button size="sm" className="h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={saveRelay.isPending || !relay.model.trim()} onClick={() => saveRelay.mutate(relayPayload(relay))}>
                  <Check className="w-3.5 h-3.5 mr-1" />{saveRelay.isPending ? "保存中..." : "保存此中转站"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-lg"
                  disabled={testRelay.isPending || !relay.model.trim() || sceneTestBlocked} onClick={() => void runRelayTest(relay)}>
                  <ImageIcon className="w-3.5 h-3.5 mr-1" />{result?.status === "running" ? "正在实际生成..." : relayTestMode === "scene" ? "场景提示词测试" : "中性实际生成测试"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 rounded-lg text-muted-foreground hover:text-destructive"
                  disabled={deleteRelay.isPending} onClick={() => removeRelayDraft(relay)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />移除
                </Button>
              </div>

              {result && (
                <div className={`rounded-lg border p-2.5 text-xs ${result.status === "success" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200" : result.status === "running" ? "border-primary/30 bg-primary/5 text-foreground" : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"}`}>
                  {result.status === "running" ? result.testMode === "scene"
                    ? "正在用当前填写的场景提示词生成测试图，并提交已保存的用户主图和人物主图；不会写入聊天或 QQ。"
                    : "正在用固定的中性静物提示词生成一张测试图；不会读取人物、场景、参考图或聊天记录。"
                    : result.status === "success" ? (
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <span>{result.testMode === "scene" ? "场景提示词测试" : "中性静物测试"}成功，用时 {Math.max(1, Math.round((result.durationMs ?? 0) / 1000))} 秒。{result.testMode === "scene" ? `参考图：${sceneImageReferenceModeLabel(result.referenceMode)}。` : "未使用人物或用户参考图。"}{result.recorded ? "测试记录已写入场景配图记录。" : "测试记录暂未写入场景配图记录。"}{result.enabledForSceneImages ? "这张已启用的中转站会参与场景配图。" : "但这张中转站当前停用，日常场景配图不会使用它。"}</span>
                      {result.imageUrl && <a href={result.imageUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">打开测试图</a>}
                    </div>
                  ) : (
                    <span>
                      {sceneImageTestReasonLabel(result.reason)}
                      {result.errorMessage ? `：${result.errorMessage}` : ""}
                      {result.recorded ? "。本次失败记录已写入场景配图记录。" : "。本次失败记录暂未写入场景配图记录。"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">模型名称由上游模型列表获取后选择；模型列表成功只说明发现接口可用，仍须通过“实际生成测试”确认该模型能够出图。你可以选择不带人物资料的中性静物，或带已保存主参考图的场景提示词测试；两种测试都会消耗该接口额度、保存测试图并写入场景配图记录，但都不会保存为聊天消息。</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">{enabled && relayDrafts.length === 0 ? "启用前还需要至少保存一个图片中转站。" : "场景配图不再设置冷却或每小时上限；是否生成完全由你发出的 /p 指令控制。"}</p>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
          disabled={saveConfig.isPending || uploadingTarget !== null}
          onClick={() => void persistSceneImageConfig()}>
          <Check className="w-3.5 h-3.5 mr-1.5" />
          {saveConfig.isPending ? "保存中..." : "保存配图设置"}
        </Button>
      </div>

      {/* 提示词模板查看与编辑弹窗（Dialog） */}
      <Dialog open={editingPromptTemplateDialog} onOpenChange={setEditingPromptTemplateDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              ComfyUI AI 提示词生成模板（思考模式）
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              在此输入自定义的提示词模板结构。大模型在为本地 ComfyUI 编写分镜提示词时，将强制开启深度思考模式（Reasoning），并严格遵循此结构将剧情分镜要素填入对应字段。
            </p>
          </DialogHeader>
          <div className="flex-1 min-h-[360px] my-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">快捷预设模板：</span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] rounded-md"
                onClick={() => {
                  setComfyPromptTemplate(
`subject_definitions:
<Picture 1> is the identity, pose, scene and light reference for [Shot 1]: {persona_name} in the scene.
<Picture 2> supplies the appearance and identity features for <Subject 2>: {user_label}.
<Subject 1> is {persona_name}: keep facial identity from <Picture 1>, natural body proportions.
<Subject 2> is {user_label}: identity from <Picture 2>.

summary:
[reference generation] The target image depicts {plot_scene_summary}, realistic lighting, coherent style.

retention_analysis:
<Picture 1> (persona reference): fully_preserved facial identity and character features.
<Picture 2> (user reference): fully_preserved identity.

detailed_description:
The target image is a photorealistic still of {scene_setting}, shallow depth of field, natural soft lighting.
[Shot 1] {detailed_action_interaction_and_lighting}.

overall_soundscape:
Silent; a still image.`
                  );
                  toast.success("已填入 MiniMax H3 专属双人指令模板预设");
                }}>
                MiniMax H3 双人指令模板
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] rounded-md"
                onClick={() => {
                  setComfyPromptTemplate(
`核心分镜：{核心定格瞬间与动作神态}
服装与造型：{服装材质、款式与细节}
动作与互动：{角色之间的肢体交互、身体朝向与手部动作}
场景与道具：{所处空间、时代环境与关键物品}
光线与情绪：{光源类型、光影层次与情绪基调}
构图与镜头：{景别与电影级视角}
成片要求：极致写实细节、电影级光影、无文字无水印`
                  );
                  toast.success("已填入极致写实分镜模板预设");
                }}>
                极致写实分镜模板
              </Button>
            </div>
            <textarea
              value={comfyPromptTemplate}
              onChange={event => setComfyPromptTemplate(event.target.value)}
              placeholder="在此处输入自定义提示词模板结构。例如 MiniMax H3 的 subject_definitions / retention_analysis / detailed_description 结构，或 Flux / SDXL 专属的提示词格式..."
              className="flex-1 w-full font-mono text-xs leading-relaxed bg-muted/30 resize-none p-3 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            />
          </div>
          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3">
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                onClick={() => {
                  if (comfyPromptTemplate) {
                    navigator.clipboard.writeText(comfyPromptTemplate);
                    toast.success("已复制模板到剪贴板");
                  }
                }}>
                <Copy className="w-3.5 h-3.5 mr-1" />
                复制内容
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setComfyPromptTemplate("")}>
                清空模板（使用内置默认）
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                onClick={() => setEditingPromptTemplateDialog(false)}>
                关闭（未保存）
              </Button>
              <Button type="button" size="sm" className="h-8 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={saveConfig.isPending}
                onClick={() => void persistSceneImageConfig().then(() => setEditingPromptTemplateDialog(false))}>
                <Check className="w-3.5 h-3.5 mr-1" />
                {saveConfig.isPending ? "保存中..." : "保存并应用"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 工作流 JSON 查看与编辑弹窗（Dialog） */}
      <Dialog open={editingWorkflowDraft !== null} onOpenChange={open => { if (!open) setEditingWorkflowDraft(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">ComfyUI 工作流模板（API JSON 格式）</DialogTitle>
            <p className="text-xs text-muted-foreground">
              请在此处查看或直接粘贴 ComfyUI「Save (API Format)」导出的工作流 JSON。生图时系统会自动注入提示词、尺寸与随机种子。
            </p>
          </DialogHeader>
          <div className="flex-1 min-h-[360px] my-2 flex flex-col">
            <textarea
              value={editingWorkflowDraft?.json ?? ""}
              onChange={event => setEditingWorkflowDraft(prev => prev ? { ...prev, json: event.target.value } : null)}
              placeholder="在此处粘贴 ComfyUI API 格式导出的 JSON 内容..."
              className="flex-1 w-full font-mono text-xs leading-relaxed bg-muted/30 resize-none p-3 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            />
          </div>
          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3">
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                onClick={() => {
                  if (editingWorkflowDraft?.json) {
                    navigator.clipboard.writeText(editingWorkflowDraft.json);
                    toast.success("已复制 JSON 到剪贴板");
                  }
                }}>
                <Copy className="w-3.5 h-3.5 mr-1" />
                复制内容
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setEditingWorkflowDraft(prev => prev ? { ...prev, json: "" } : null)}>
                清空内容
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs rounded-lg"
                onClick={() => setEditingWorkflowDraft(null)}>
                取消
              </Button>
              <Button type="button" size="sm" className="h-8 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  if (!editingWorkflowDraft) return;
                  const trimmed = editingWorkflowDraft.json.trim();
                  if (trimmed) {
                    try {
                      JSON.parse(trimmed);
                    } catch {
                      toast.error("当前输入的不是合法的 JSON 格式，请检查语法");
                      return;
                    }
                  }
                  updateRelayDraft(editingWorkflowDraft.clientId, { workflowJson: trimmed || null });
                  setEditingWorkflowDraft(null);
                  toast.success("已更新工作流配置，请点击「保存本地工作流设置」落库");
                }}>
                <Check className="w-3.5 h-3.5 mr-1" />
                确定并应用
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AISettingsTab() {
  const providers = trpc.llmConfig.listProviders.useQuery();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const upsertConfig = trpc.llmConfig.upsert.useMutation({
    onSuccess: () => { toast.success("配置已保存"); providers.refetch(); },
    onError: error => toast.error(error.message),
  });
  const setDefault = trpc.llmConfig.setDefault.useMutation({
    onSuccess: () => { toast.success("默认提供商已更新"); defaultConfig.refetch(); },
    onError: error => toast.error(error.message),
  });
  const setFallback = trpc.llmConfig.setFallback.useMutation({
    onSuccess: () => { toast.success("备用提供商已更新"); defaultConfig.refetch(); },
    onError: error => toast.error(error.message),
  });
  const updateExtra = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => { toast.success("对话参数已保存"); defaultConfig.refetch(); },
    onError: error => toast.error(error.message),
  });

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [contextLimit, setContextLimit] = useState(20);
  const [fallbackProvider, setFallbackProvider] = useState("");
  const [providerFilter, setProviderFilter] = useState<"configured" | "all" | "unconfigured">("configured");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);
  const routePanelId = useId();
  const allProviders = providers.data ?? [];
  const configuredCount = allProviders.filter(provider => provider.configured).length;
  const savedFallback = (defaultConfig.data as any)?.fallbackProvider || "";
  const visibleProviders = allProviders.filter(provider =>
    providerFilter === "all" || provider.configured === (providerFilter === "configured"),
  );
  const visibleNames = new Set(visibleProviders.map(provider => provider.name));

  useEffect(() => {
    if (defaultConfig.data?.extraConfig) {
      const e = defaultConfig.data.extraConfig as any;
      if (e.temperature != null) setTemperature(e.temperature);
      if (e.maxTokens != null) setMaxTokens(e.maxTokens);
      if (e.contextLimit != null) setContextLimit(e.contextLimit);
    }
  }, [defaultConfig.data]);

  useEffect(() => {
    const fallback = (defaultConfig.data as any)?.fallbackProvider;
    if (typeof fallback === "string" && fallback.trim()) {
      setFallbackProvider(fallback);
    }
  }, [defaultConfig.data]);

  return (
    <div className="space-y-6 card-stagger">
      <section className="warm-card ai-provider-section p-4 sm:p-6 space-y-4">
        <SectionHeader icon={Settings2} title="AI 提供商" subtitle="集中管理提供商，按需展开连接配置。"
          action={<span className="ai-count-badge"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{configuredCount} / {allProviders.length} 已配置</span>} />
        <div className="ai-provider-overview">
          <span className="ai-overview-chip"><Cpu aria-hidden="true" className="h-3.5 w-3.5 text-primary" /><span className="text-muted-foreground">默认</span><strong className="font-semibold text-primary">{defaultConfig.data?.providerName || "未设置"}</strong></span>
          <span className="ai-overview-chip"><Shield aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">备用</span><strong className="font-semibold">{savedFallback || "未设置"}</strong></span>
          <Button type="button" variant="ghost" size="sm" aria-expanded={showRoutes} aria-controls={routePanelId}
            onClick={() => setShowRoutes(value => !value)} className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground">
            {showRoutes ? "收起路由" : "路由设置"}<ChevronDown aria-hidden="true" className={`ai-disclosure-chevron ml-1.5 h-3.5 w-3.5 ${showRoutes ? "rotate-180" : ""}`} />
          </Button>
        </div>
        <div id={routePanelId} className="collapse-grid" data-open={showRoutes} aria-hidden={!showRoutes} inert={!showRoutes}>
          <div><div className="rounded-xl border border-border/50 bg-muted/15 p-3">
        <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-medium text-foreground/70">备用提供商</Label>
              <select aria-label="备用提供商" value={fallbackProvider}
                onChange={e => setFallbackProvider(e.target.value)}
                className="w-full h-9 px-2 bg-background/60 border border-border/60 rounded-lg text-xs text-foreground">
                {(providers.data ?? []).map(provider => (
                  <option key={provider.name} value={provider.name}>
                    {providerSelectLabel(provider)}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
              onClick={() => setFallback.mutate({ providerName: fallbackProvider })}
              disabled={!fallbackProvider || setFallback.isPending}>
              <Check className="w-3.5 h-3.5 mr-1" />
              {setFallback.isPending ? "保存中..." : "保存备用"}
            </Button>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            默认提供商失败后自动尝试备用。只有 DeepSeek 打开动态开关时，才会按用途自动分流到 Flash 或 Pro。
          </div>
        </div>
        </div>
          </div></div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="ai-provider-filters" role="group" aria-label="提供商筛选">
              {([
                { value: "configured", label: "已配置", count: configuredCount },
                { value: "all", label: "全部", count: allProviders.length },
                { value: "unconfigured", label: "未配置", count: allProviders.length - configuredCount },
              ] as const).map(filter => <button type="button" key={filter.value} aria-pressed={providerFilter === filter.value}
                onClick={() => { setProviderFilter(filter.value); setExpandedProvider(null); }}>
                {filter.label}<span className="ml-1.5 tabular-nums opacity-60">{filter.count}</span>
              </button>)}
            </div>
            <Button type="button" size="sm" variant="ghost" disabled={!expandedProvider} onClick={() => setExpandedProvider(null)}
              className="h-8 rounded-lg text-xs text-muted-foreground"><ChevronUp className="mr-1 h-3.5 w-3.5" />收起详情</Button>
          </div>
        </div>
        <div className="space-y-2.5">
          {providers.isPending && <div role="status" className="rounded-xl bg-muted/30 p-6 text-center text-sm text-muted-foreground">正在加载提供商…</div>}
          {providers.isError && <div role="alert" className="rounded-xl border border-destructive/20 p-4 text-sm">
            <p className="text-destructive">提供商加载失败，请重试。</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => providers.refetch()}>重新加载</Button>
          </div>}
          {allProviders.map(provider => <div key={provider.name} hidden={!visibleNames.has(provider.name)}>
            <ProviderConfigRow provider={provider} expanded={expandedProvider === provider.name}
              onToggle={() => setExpandedProvider(current => current === provider.name ? null : provider.name)}
              isDefault={defaultConfig.data?.providerName === provider.name} isFallback={savedFallback === provider.name}
              defaultPending={setDefault.isPending}
              onSaveProvider={data => upsertConfig.mutate(data)}
              onSetDefault={() => setDefault.mutate({ providerName: provider.name })}
              onChanged={() => providers.refetch()} />
          </div>)}
          {!providers.isPending && !providers.isError && visibleProviders.length === 0 && <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
            <Cpu aria-hidden="true" className="mx-auto mb-3 h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm font-medium">此分类下暂无提供商</p>
            <p className="mt-1 text-xs text-muted-foreground">切换到全部提供商，添加需要的配置。</p>
            <Button type="button" size="sm" variant="outline" className="mt-4 rounded-lg" onClick={() => setProviderFilter("all")}>查看全部提供商</Button>
          </div>}
        </div>
        <p aria-live="polite" className="text-xs text-muted-foreground">显示 {visibleProviders.length} 个提供商 · 点击卡片展开，中转站配置可单独收纳。</p>
      </section>


      <SettingsDisclosure icon={ImageIcon} title="剧情场景配图" subtitle="管理本地工作流、云端图片中转站与人物参考图。">
        <SceneImageSettingsCard />
      </SettingsDisclosure>

      <SettingsDisclosure icon={Sliders} title="对话参数" subtitle="调整创造性、回复长度与上下文窗口。">
        <div className="space-y-4">
        <SliderField label="Temperature（创造性）" value={temperature} onChange={setTemperature}
          min={0} max={2} step={0.1} />
        <SliderField label="Max Tokens（最大回复长度）" value={maxTokens} onChange={setMaxTokens}
          min={256} max={8192} step={256} />
        <SliderField label="上下文消息数" value={contextLimit} onChange={setContextLimit}
          min={5} max={50} step={5} unit=" 条" />
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
          onClick={() => updateExtra.mutate({ extraConfig: { temperature, maxTokens, contextLimit } })}
          disabled={updateExtra.isPending}>
          {updateExtra.isPending ? "保存中..." : "保存参数"}
        </Button>
        </div>
      </SettingsDisclosure>
    </div>
  );
}

// ─── QQ TAB ──────────────────────────────────────────────────────────────────

function QqTab() {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ink-and-kin_selected_qq_persona_id") || "";
    }
    return "";
  });

  const qqStatus = trpc.qq.getStatus.useQuery(undefined, { refetchInterval: 5000 });
  const recentContacts = trpc.qq.recentContacts.useQuery(undefined, { refetchInterval: 3000 });
  const bindings = trpc.qq.listBindings.useQuery(undefined, { refetchInterval: 3000 });
  const personas = trpc.persona.list.useQuery();
  const bot = qqStatus.data;
  const webhookUrl = typeof window === "undefined"
    ? "/api/qq/onebot/event"
    : `${window.location.origin}/api/qq/onebot/event`;

  const readyPersonas = useMemo(
    () => (personas.data ?? []).filter((p: any) => p.analysisStatus === "ready"),
    [personas.data],
  );
  const personaById = useMemo(
    () => new Map((personas.data ?? []).map((p: any) => [p.id, p])),
    [personas.data],
  );
  const bindingByContactId = useMemo(
    () => new Map((bindings.data ?? []).map((b: any) => [b.wechatContactId, b])),
    [bindings.data],
  );

  const handleSelectPersona = (id: string) => {
    setSelectedPersonaId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("ink-and-kin_selected_qq_persona_id", id);
    }
  };

  useEffect(() => {
    if (readyPersonas.length === 0) return;
    const exists = readyPersonas.some((p: any) => String(p.id) === selectedPersonaId);
    if (!exists) {
      const boundPersonaId = bindings.data?.[0]?.personaId;
      const boundExists = boundPersonaId && readyPersonas.some((p: any) => p.id === boundPersonaId);
      const targetId = boundExists ? String(boundPersonaId) : String(readyPersonas[0].id);
      setSelectedPersonaId(targetId);
      if (typeof window !== "undefined") {
        localStorage.setItem("ink-and-kin_selected_qq_persona_id", targetId);
      }
    }
  }, [readyPersonas, selectedPersonaId, bindings.data]);

  const bindContact = trpc.qq.bindContact.useMutation({
    onSuccess: () => { toast.success("QQ 联系人已绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const unbindContact = trpc.qq.unbindContact.useMutation({
    onSuccess: () => { toast.success("已解除绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const openManualLoginPage = trpc.qq.openManualLoginPage.useMutation({
    onSuccess: () => toast.success("已打开独立 QQ 扫码登录页，请完成扫码验证"),
    onError: (e: any) => toast.error(e.message),
  });

  const handleBind = (contact: { id: string; name: string }) => {
    const personaId = Number(selectedPersonaId);
    if (!personaId) {
      toast.error("请先选择分身");
      return;
    }
    bindContact.mutate({
      personaId,
      qqContactId: contact.id,
      qqName: contact.name,
    });
  };

  const selectedPersona = personaById.get(Number(selectedPersonaId)) as any;
  const previewUnavailable = (bot as any)?.previewUnavailable === true;
  const statusText = previewUnavailable ? "未接通（界面预览）" : bot?.status === "connected" ? "已连接"
    : bot?.status === "error" ? "连接异常"
    : "未启用";

  return (
    <div className="space-y-6 card-stagger">
      <section className="warm-card p-5 space-y-4">
        <SectionHeader icon={bot?.status === "connected" ? Wifi : WifiOff} title="QQ OneBot 接入"
          subtitle={previewUnavailable ? "此预览未连接 QQ，不会启动或操作真实服务" : "NapCat 独立运行，书中人 通过 OneBot HTTP API 收发消息"}
          action={<StatusBadge label={statusText}
            tone={bot?.status === "connected" ? "ok" : bot?.status === "error" ? "error" : "muted"} />} />

        <div className="p-4 bg-muted/20 rounded-xl space-y-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              bot?.status === "connected" ? "bg-emerald-500" :
              bot?.status === "error" ? "bg-red-400" : "bg-muted-foreground/30"
            }`} />
            <span className="text-sm text-foreground font-medium">
              {previewUnavailable ? "QQ 服务未接通（界面预览）" : bot?.status === "connected" ? `NapCat 已连接${bot.loggedInUser ? `：${bot.loggedInUser}` : ""}` :
               bot?.status === "error" ? "NapCat / OneBot HTTP API 不可用" : "QQ 端未启用"}
            </span>
          </div>

          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>QQ 端由 NapCatQQ 独立运行，书中人 通过 OneBot HTTP API 发消息，并通过 HTTP POST 上报接收消息。</p>
            <p>NapCat HTTP API 地址：<span className="font-mono text-foreground">{previewUnavailable ? "未接通" : bot?.baseUrl ?? "http://127.0.0.1:3001"}</span></p>
            <p>NapCat 事件上报地址：<span className="font-mono text-foreground break-all">{webhookUrl}</span></p>
            {bot?.webhookSecretConfigured && (
              <p className="text-amber-600">已启用 webhook token 校验，上报时需要带 `?token=你的 QQ_ONEBOT_WEBHOOK_SECRET` 或 `x-ink-and-kin-token` 请求头。</p>
            )}
            {!bot?.enabled && !previewUnavailable && (
              <p>要启用 QQ：在本机运行副本 `.env` 设置 `QQ_ENABLED=true`，再重启 书中人。</p>
            )}
            {bot?.lastError && (
              <p className="text-red-500">最近错误：{bot.lastError}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="rounded-xl border-border"
            onClick={() => qqStatus.refetch()} disabled={qqStatus.isFetching}>
            {qqStatus.isFetching ? "刷新中..." : "刷新状态"}
          </Button>
          <Button size="sm" variant="outline" className="rounded-xl border-border"
            onClick={() => openManualLoginPage.mutate()} disabled={openManualLoginPage.isPending}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            {openManualLoginPage.isPending ? "正在启动并打开..." : "打开 QQ 扫码登录"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {previewUnavailable ? "界面预览保留此操作入口；当前未接后台，点击不会启动 QQ 服务或打开真实登录窗口。" : "点击后会启动尚未运行的隔离 QQ 服务，并打开独立浏览器窗口，可能需要等待约一分钟；已有登录或验证会话不会被重启。打开后完成扫码验证，再点“刷新状态”确认。"}
        </p>
      </section>

      <section className="warm-card p-5 space-y-4">
        <SectionHeader icon={Users} title="QQ 联系人绑定" subtitle="把私聊联系人绑定到 ready 状态的分身"
          action={<StatusBadge label={`${bindings.data?.length ?? 0} 个已绑定`}
            tone={(bindings.data?.length ?? 0) > 0 ? "ok" : "muted"} />} />

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">选择分身</Label>
            <select value={selectedPersonaId} onChange={e => handleSelectPersona(e.target.value)}
              className="w-full h-10 px-3 bg-muted/50 border border-border rounded-lg text-sm text-foreground">
              {readyPersonas.length === 0 && <option value="">暂无可绑定分身</option>}
              {readyPersonas.map((persona: any) => (
                <option key={persona.id} value={persona.id}>{persona.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">最近 QQ 联系人</Label>
            <div className="space-y-2">
              {(recentContacts.data ?? []).length === 0 && (
                <div className="p-3 bg-muted/20 rounded-lg text-sm text-muted-foreground">
                  暂无联系人。启用 NapCat 上报后，让要绑定的 QQ 先发一条私聊消息。
                </div>
              )}

              {(recentContacts.data ?? []).map((contact: any) => {
                const binding = bindingByContactId.get(contact.id) as any;
                const boundPersona = binding ? personaById.get(binding.personaId) as any : null;
                const isDifferentPersonaSelected = binding && selectedPersonaId && String(binding.personaId) !== selectedPersonaId;

                return (
                  <div key={contact.id} className="p-3 bg-muted/20 rounded-lg flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-primary/60 flex-shrink-0" />
                        <span className="font-medium text-sm text-foreground truncate">{contact.name}</span>
                        <span className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                          {contact.kind === "group" ? "群聊" : "私聊"}
                        </span>
                        {binding && (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            已绑定 {boundPersona?.name ?? `#${binding.personaId}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatBeijingDateTime(contact.lastMessageAt, { hour12: false })}</span>
                        <span className="truncate">{contact.lastMessagePreview}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {binding ? (
                        <>
                          {isDifferentPersonaSelected && selectedPersona && (
                            <Button size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl shadow-xs hover:shadow-md active:scale-[0.98] transition-all text-xs"
                              onClick={() => handleBind(contact)}
                              disabled={bindContact.isPending}>
                              换绑为 {selectedPersona.name}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="rounded-xl border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 active:scale-[0.98] transition-all"
                            onClick={() => unbindContact.mutate({ id: binding.id })}
                            disabled={unbindContact.isPending}>
                            解除绑定
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl shadow-xs hover:shadow-md active:scale-[0.98] transition-all"
                          onClick={() => handleBind(contact)}
                          disabled={bindContact.isPending || !selectedPersonaId}>
                          绑定为 {selectedPersona?.name ?? "当前分身"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── OPERATIONS DIAGNOSTICS TAB ─────────────────────────────────────────────

function OperationsDiagnosticsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [usageFilters, setUsageFilters] = useState({
    from: "",
    to: "",
    userId: "",
    personaId: "",
    route: "",
    provider: "",
    purpose: "",
    success: "all",
    limit: "50",
  });
  const [sceneImageLogFilters, setSceneImageLogFilters] = useState({
    from: "",
    to: "",
    personaId: "",
    relayId: "",
    success: "all",
    limit: "50",
  });
  const diagnostics = trpc.system.operationsDiagnostics.useQuery(undefined, { refetchInterval: 10000 });
  const usageDetailsInput = useMemo(() => ({
    from: optionalUsageText(usageFilters.from),
    to: optionalUsageText(usageFilters.to),
    userId: isAdmin ? parseOptionalIntegerInput(usageFilters.userId) : undefined,
    personaId: parseOptionalIntegerInput(usageFilters.personaId),
    route: optionalUsageText(usageFilters.route),
    provider: optionalUsageText(usageFilters.provider),
    purpose: optionalUsageText(usageFilters.purpose),
    success: usageFilters.success === "success" ? true : usageFilters.success === "failed" ? false : undefined,
    limit: parseUsageLimit(usageFilters.limit),
  }), [isAdmin, usageFilters]);
  const usageDetails = trpc.system.llmUsageDetails.useQuery(usageDetailsInput, { refetchInterval: 10000 });
  const sceneImageLogDetailsInput = useMemo(() => ({
    from: optionalUsageText(sceneImageLogFilters.from),
    to: optionalUsageText(sceneImageLogFilters.to),
    personaId: parseOptionalIntegerInput(sceneImageLogFilters.personaId),
    relayId: parseOptionalIntegerInput(sceneImageLogFilters.relayId),
    success: sceneImageLogFilters.success === "success" ? true : sceneImageLogFilters.success === "failed" ? false : undefined,
    limit: parseUsageLimit(sceneImageLogFilters.limit),
  }), [sceneImageLogFilters]);
  const sceneImageLogDetails = trpc.system.sceneImageLogDetails.useQuery(sceneImageLogDetailsInput, { refetchInterval: 10000 });
  const data = diagnostics.data as any;

  if (diagnostics.isLoading) {
    return (
      <div className="warm-card p-6 text-sm text-muted-foreground">
        正在读取运行诊断...
      </div>
    );
  }

  if (diagnostics.error || !data || data.previewUnavailable) {
    return (
      <div className="warm-card p-5 space-y-4 border-destructive/20">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">{data?.previewUnavailable ? "诊断未接通（界面预览）" : "诊断读取失败"}</span>
        </div>
        <p className="text-xs text-muted-foreground break-words">{diagnostics.error?.message ?? data?.message ?? "暂无诊断数据"}</p>
        <Button size="sm" variant="outline" className="rounded-xl border-border"
          onClick={() => diagnostics.refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />重新读取
        </Button>
      </div>
    );
  }

  const databaseModeLabel: Record<string, string> = {
    local: "本机 PostgreSQL",
    neon: "Neon PostgreSQL",
    remote: "远程 PostgreSQL",
    unconfigured: "未配置",
    invalid: "连接串异常",
  };
  const databaseTone: Record<string, StatusTone> = {
    local: "ok",
    neon: "ok",
    remote: "warn",
    unconfigured: "error",
    invalid: "error",
  };
  const qqLive = data.live?.qq;
  const qqStatusTone: StatusTone = qqLive?.status === "connected" ? "ok" : qqLive?.status === "error" ? "error" : "muted";
  const troubleshootingItems = data.troubleshooting?.items ?? [];
  const qqAdvice = data.troubleshooting?.platforms?.qq ?? platformDiagnosticAdvice("qq", qqLive);
  const configuredProviders = (data.llm?.providers ?? []).filter((provider: any) => provider.configured);
  const enabledStickerTypes = Object.entries(data.stickers?.enabledByType ?? {})
    .map(([type, count]) => `${type} ${count}`)
    .join("、") || "无";
  const providerOverrideText = Object.entries(data.proactiveMessages?.llmProviderOverrides ?? {})
    .map(([provider, count]) => `${provider} ${count}`)
    .join("、") || "无";
  const usageDetailsData = usageDetails.data as any;
  const usageRecords = usageDetailsData?.records ?? [];
  const sceneImageLogData = sceneImageLogDetails.data as any;
  const sceneImageLogRecords = sceneImageLogData?.records ?? [];

  return (
    <div className="space-y-6 card-stagger">
      <section className="warm-card p-5">
        <SectionHeader icon={Activity} title="运维诊断"
          subtitle={`${formatDiagnosticTime(data.generatedAt)} · ${data.runtime?.nodeEnv ?? "development"}`}
          action={
            <Button size="sm" variant="outline" className="rounded-xl border-border"
              onClick={() => diagnostics.refetch()} disabled={diagnostics.isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${diagnostics.isFetching ? "animate-spin" : ""}`} />
              {diagnostics.isFetching ? "刷新中..." : "刷新"}
            </Button>
          } />
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile value={data.llm?.usage?.today?.totalTokens ?? 0} label="今日 tokens"
          sub={`${data.llm?.usage?.today?.calls ?? 0} 次调用${(data.llm?.usage?.today?.failedCalls ?? 0) > 0 ? ` · 失败 ${data.llm?.usage?.today?.failedCalls}` : ""}`}
          tone={(data.llm?.usage?.today?.failedCalls ?? 0) > 0 ? "warn" : undefined} />
        <KpiTile value={data.llm?.usage?.week?.totalTokens ?? 0} label="本周 tokens"
          sub={`${data.llm?.usage?.week?.calls ?? 0} 次调用`} />
        <KpiTile value={data.llm?.usage?.month?.totalTokens ?? 0} label="本月 tokens"
          sub={`${data.llm?.usage?.month?.calls ?? 0} 次调用`} />
        <KpiTile text={llmBudgetStatusLabel(data.llm?.budget?.status)} label="软额度状态"
          sub={data.llm?.budget?.recommendation ?? "未配置软额度"}
          tone={llmBudgetTone(data.llm?.budget?.status) === "ok" ? undefined : llmBudgetTone(data.llm?.budget?.status)} />
      </div>

      <DiagnosticCard icon={AlertTriangle} title="运维排障清单" hue="amber"
        subtitle={`${data.troubleshooting?.summary?.errors ?? 0} 个错误 · ${data.troubleshooting?.summary?.warnings ?? 0} 个提醒`}>
        {troubleshootingItems.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {troubleshootingItems.map((item: DiagnosticAdvice, index: number) => (
              <AdvisoryBox key={item.id ?? `${item.scope}-${index}`} advice={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground">
            当前没有需要处理的配置或运行错误；如外部平台仍异常，请刷新诊断或查看本机服务日志。
          </div>
        )}
      </DiagnosticCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6 min-w-0">
        <DiagnosticCard icon={Server} title="运行与数据库" hue="sky"
          subtitle={<span className="font-mono break-all">{data.runtime?.cwd}</span>}>
          <div className="space-y-3">
            <DiagGroup title="数据库"
              hint={<StatusBadge label={databaseModeLabel[data.database?.mode] ?? data.database?.mode ?? "未知"} tone={databaseTone[data.database?.mode] ?? "muted"} />}>
              <DiagnosticRow label="Host" value={data.database?.host || "未配置"} mono />
              <DiagnosticRow label="Database" value={data.database?.database || "未配置"} mono />
              <DiagnosticRow label="推荐命令" value={data.database?.recommendedDevCommand || "corepack pnpm run dev"} mono />
            </DiagGroup>
            <DiagGroup title="本机目录">
              <DiagnosticRow label="运行副本" value={data.runtime?.localWorktree || "未提供"} mono />
              <DiagnosticRow label="运行数据" value={data.runtime?.localDataRoot || "未提供"} mono />
              <DiagnosticRow label="上传目录" value={data.runtime?.uploadDir || "未配置"} mono />
              <DiagnosticRow label="贴图目录" value={data.runtime?.stickerBaseDir || "未配置"} mono />
            </DiagGroup>
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={MessageCircle} title="平台接入" hue="teal"
          subtitle="QQ 实时状态与绑定策略">
          <DiagGroup title="QQ / OneBot"
            hint={<StatusBadge label={platformStatusLabel("qq", qqLive?.status)} tone={qqStatusTone} />}>
            <DiagnosticRow label="QQ 开关" value=""
              badge={<BoolBadge value={Boolean(data.qq?.enabled)} trueLabel="已启用" falseLabel="未启用" />} />
            <DiagnosticRow label="OneBot" value={data.qq?.onebotEndpoint?.origin || "未配置"} mono />
            <DiagnosticRow label="Webhook token" value=""
              badge={<BoolBadge value={Boolean(data.qq?.webhookSecretConfigured)} />} />
            <DiagnosticRow label="群聊" value=""
              badge={<BoolBadge value={Boolean(data.qq?.allowGroups)} trueLabel="允许" falseLabel="关闭" />} />
            {qqLive?.lastError && <DiagnosticRow label="QQ 原始错误" value={qqLive.lastError} />}
            <div className="mt-2">
              <AdvisoryBox advice={qqAdvice} />
            </div>
          </DiagGroup>
        </DiagnosticCard>

        <DiagnosticCard icon={Volume2} title="语音" hue="emerald">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="回复策略" value=""
              badge={<StatusBadge label={voiceModeLabel(data.voice?.policy?.mode)} tone={data.voice?.policy?.enabled ? "ok" : "muted"} />} />
            <DiagnosticRow label="概率 / 冷却" value={`${data.voice?.policy?.probability ?? 0} · ${data.voice?.policy?.cooldownSeconds ?? 0}s`} />
            <DiagnosticRow label="ASR" value={`${data.voice?.asr?.provider ?? "未知"} · ${data.voice?.asr?.model ?? "未知"}`} />
            <DiagnosticRow label="TTS" value={`${ttsProviderLabel(data.voice?.tts?.provider)} -> ${ttsProviderLabel(data.voice?.tts?.fallbackProvider)}`} />
            <DiagnosticRow label="VoxCPM" value={data.voice?.tts?.voxcpmEndpoint?.origin ?? "未配置"} mono />
            <DiagnosticRow label="MiniMax" value=""
              badge={<BoolBadge value={Boolean(data.voice?.tts?.minimaxConfigured)} />} />
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={ImageIcon} title="表情包" hue="pink">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="策略" value=""
              badge={<BoolBadge value={Boolean(data.stickers?.policy?.enabled)} trueLabel="启用" falseLabel="关闭" />} />
            <DiagnosticRow label="总量 / 启用" value={`${data.stickers?.total ?? 0} / ${data.stickers?.enabled ?? 0}`} />
            <DiagnosticRow label="类型" value={enabledStickerTypes} />
            <DiagnosticRow label="概率 / 冷却" value={`${data.stickers?.policy?.probability ?? 0} · ${data.stickers?.policy?.cooldownSeconds ?? 0}s`} />
            <DiagnosticRow label="目录" value={data.stickers?.baseDir ?? "未配置"} mono />
          </div>
        </DiagnosticCard>
        </div>

        <div className="space-y-6 min-w-0">
        <DiagnosticCard icon={Cpu} title="LLM 路由" hue="violet"
          subtitle="动态路由、成本归属与额度策略">
          <DiagGroup title="路由">
            <DiagnosticRow label="默认提供商" value={data.llm?.defaultProvider || "未设置"} />
            <DiagnosticRow label="备用提供商" value={data.llm?.fallbackProvider || "未设置"} />
            <DiagnosticRow label="DeepSeek 动态路由" value=""
              badge={<BoolBadge value={Boolean(data.llm?.dynamicDeepSeekRouting || data.llm?.dynamicDeepSeekFallback)} trueLabel="启用" falseLabel="未启用" />} />
          </DiagGroup>

          <DiagGroup title="今日成本归属" hint={llmUsageSourceLabel(data.llm?.usage?.source)}>
            <DiagnosticRow label="用户" value={llmUsageBucketText(data.llm?.usage?.byUser, "userId")} />
            <DiagnosticRow label="角色" value={llmUsageBucketText(data.llm?.usage?.byPersona, "personaId")} />
            <DiagnosticRow label="入口" value={llmUsageBucketText(data.llm?.usage?.byRoute, "route")} />
          </DiagGroup>

          <DiagGroup title="软额度"
            hint={<StatusBadge label={llmBudgetStatusLabel(data.llm?.budget?.status)} tone={llmBudgetTone(data.llm?.budget?.status)} />}>
            <DiagnosticRow label="每日软额度" value={tokenBudgetText(data.llm?.budget?.daily)} />
            <DiagnosticRow label="月度软额度" value={tokenBudgetText(data.llm?.budget?.monthly)} />
            <DiagnosticRow label="额度建议" value={data.llm?.budget?.recommendation ?? "未配置软额度"} />
          </DiagGroup>

          <DiagGroup title="省额度模式"
            hint={<StatusBadge label={llmEconomyLevelLabel(data.llm?.economy?.level)} tone={llmEconomyTone(data.llm?.economy?.level)} />}>
            <DiagnosticRow label="自动降成本" value={llmEconomyActionText(data.llm?.economy)} />
            <DiagnosticRow label="上下文上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "context")} />
            <DiagnosticRow label="记忆召回上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "memory")} />
            <DiagnosticRow label="资料库召回上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "source")} />
            <DiagnosticRow label="执行建议" value={data.llm?.economy?.recommendation ?? "省额度模式未启用。"} />
            <DiagnosticRow label="上限说明" value={data.llm?.economy?.limitsSummary?.safeguards?.[0] ?? "这些数字是每轮保护上限，不是质量目标。"} />
          </DiagGroup>
        </DiagnosticCard>

        <DiagnosticCard icon={Radio} title="Runtime 收敛" hue="indigo"
          subtitle="Web / QQ 的人物运行时能力">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(data.platformRuntime ?? {}).map(([platform, runtime]: [string, any]) => (
              <div key={platform} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold uppercase text-foreground">{platform}</span>
                  <BoolBadge value={Boolean(runtime.enabled)} trueLabel="启用" falseLabel="关闭" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(runtime)
                    .filter(([key]) => key !== "enabled")
                    .map(([key, value]) => (
                      <StatusBadge key={key} label={runtimeCapabilityLabel(key)} tone={value ? "ok" : "muted"} />
                    ))}
                </div>
              </div>
            ))}
          </div>
          <DiagGroup title="运行时模块">
            <DiagnosticRow label="文本 runtime" value={data.architecture?.textRuntime} mono />
            <DiagnosticRow label="媒体 runtime" value={data.architecture?.mediaRuntime} mono />
            <DiagnosticRow label="请求规范" value={data.architecture?.runtimeRequest} mono />
          </DiagGroup>
        </DiagnosticCard>

        <DiagnosticCard icon={Terminal} title="主动消息" hue="amber">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="总角色 / Ready" value={`${data.proactiveMessages?.totalPersonas ?? 0} / ${data.proactiveMessages?.readyPersonas ?? 0}`} />
            <DiagnosticRow label="启用角色" value={data.proactiveMessages?.enabledPersonas ?? 0} />
            <DiagnosticRow label="定时槽位" value={data.proactiveMessages?.configuredSlotCount ?? 0} />
            <DiagnosticRow label="时间" value={compactList(data.proactiveMessages?.uniqueTimes)} />
            <DiagnosticRow label="风格提示" value={`${data.proactiveMessages?.stylePromptConfiguredPersonas ?? 0} 个角色`} />
            <DiagnosticRow label="角色模型覆盖" value={providerOverrideText} />
          </div>
        </DiagnosticCard>
        </div>
      </div>

      <DiagnosticCard icon={Cpu} title="AI 提供商" hue="sky"
        subtitle={`${configuredProviders.length}/${data.llm?.providers?.length ?? 0} 个已配置`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {(data.llm?.providers ?? []).map((provider: any) => (
            <div key={provider.name} className="stat-tile px-3 py-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground truncate">{provider.name}</span>
                <BoolBadge value={provider.configured} />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground font-mono truncate">
                {[provider.model || provider.endpoint?.origin || "未设置模型", provider.reasoningEffort ? `推理 ${provider.reasoningEffort}` : ""].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      </DiagnosticCard>

      <DiagnosticCard icon={Activity} title="用量明细" hue="violet"
        subtitle={usageDetailsData
          ? `${llmUsageSourceLabel(usageDetailsData.source)} · ${usageDetailsData.summary?.calls ?? 0} 次 · ${formatCompact(usageDetailsData.summary?.totalTokens ?? 0)} tokens`
          : "读取中..."}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
              onClick={() => usageDetails.refetch()} disabled={usageDetails.isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${usageDetails.isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
              onClick={() => setUsageFilters({
                from: "",
                to: "",
                userId: "",
                personaId: "",
                route: "",
                provider: "",
                purpose: "",
                success: "all",
                limit: "50",
              })}>
              清空
            </Button>
          </div>
        }>
        <div className="space-y-3">

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">开始时间</Label>
                <Input type="datetime-local" value={usageFilters.from}
                  onChange={e => setUsageFilters(filters => ({ ...filters, from: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">结束时间</Label>
                <Input type="datetime-local" value={usageFilters.to}
                  onChange={e => setUsageFilters(filters => ({ ...filters, to: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              {isAdmin && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">用户 ID</Label>
                  <Input value={usageFilters.userId} inputMode="numeric" placeholder="全部"
                    onChange={e => setUsageFilters(filters => ({ ...filters, userId: e.target.value }))}
                    className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">角色 ID</Label>
                <Input value={usageFilters.personaId} inputMode="numeric" placeholder="全部"
                  onChange={e => setUsageFilters(filters => ({ ...filters, personaId: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">入口</Label>
                <Input value={usageFilters.route} placeholder="social.qq"
                  onChange={e => setUsageFilters(filters => ({ ...filters, route: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Provider</Label>
                <Input value={usageFilters.provider} placeholder="DeepSeek"
                  onChange={e => setUsageFilters(filters => ({ ...filters, provider: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Purpose</Label>
                <Input value={usageFilters.purpose} placeholder="chat"
                  onChange={e => setUsageFilters(filters => ({ ...filters, purpose: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">结果</Label>
                <select value={usageFilters.success}
                  onChange={e => setUsageFilters(filters => ({ ...filters, success: e.target.value }))}
                  className="w-full h-9 px-2 bg-background/60 border border-border/60 rounded-lg text-xs text-foreground">
                  <option value="all">全部</option>
                  <option value="success">成功</option>
                  <option value="failed">失败</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">条数</Label>
                <Input value={usageFilters.limit} inputMode="numeric"
                  onChange={e => setUsageFilters(filters => ({ ...filters, limit: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
            </div>

            {usageDetailsData && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.calls ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">调用</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.failedCalls ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">失败</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.totalTokens ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">tokens</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.averageDurationMs ?? 0}ms</div>
                  <div className="text-[11px] text-muted-foreground">平均耗时</div>
                </div>
              </div>
            )}

            {usageDetails.error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300 break-words">
                {usageDetails.error.message}
              </div>
            )}

            {!usageDetails.error && usageDetails.isLoading && (
              <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
                正在读取用量明细...
              </div>
            )}

            {!usageDetails.error && !usageDetails.isLoading && usageRecords.length === 0 && (
              <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
                当前筛选下暂无记录。
              </div>
            )}

            {usageRecords.length > 0 && (
              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {usageRecords.map((record: any) => (
                  <div key={record.id} className="rounded-lg border border-border/50 bg-background/45 px-3 py-2.5 min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{formatDiagnosticTime(record.startedAt)}</span>
                          <StatusBadge label={record.success ? "成功" : "失败"} tone={record.success ? "ok" : "error"} />
                        </div>
                        <div className="mt-1 text-sm font-medium text-foreground break-words">
                          {record.provider}{record.model ? ` · ${record.model}` : ""}{record.reasoningEffort ? ` · 推理 ${record.reasoningEffort}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground break-words">
                          {usageRecordMeta(record)}
                        </div>
                        {record.error && (
                          <div className="mt-2 rounded-md bg-red-500/5 px-2 py-1.5 font-mono text-[11px] text-red-700 dark:text-red-300 break-all">
                            {usageErrorPreview(record.error)}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:min-w-[210px]">
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.totalTokens ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground">total</div>
                        </div>
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.inputTokens ?? 0}/{record.outputTokens ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground">in/out</div>
                        </div>
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.durationMs ?? 0}ms</div>
                          <div className="text-[10px] text-muted-foreground">耗时</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </DiagnosticCard>

      <DiagnosticCard icon={ImageIcon} title="场景配图记录" hue="pink"
        subtitle={sceneImageLogData
          ? `数据库持久化 · ${sceneImageLogData.summary?.calls ?? 0} 条图片生成记录`
          : "读取中..."}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
              onClick={() => sceneImageLogDetails.refetch()} disabled={sceneImageLogDetails.isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${sceneImageLogDetails.isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
              onClick={() => setSceneImageLogFilters({
                from: "",
                to: "",
                personaId: "",
                relayId: "",
                success: "all",
                limit: "50",
              })}>
              清空
            </Button>
          </div>
        }>
        <div className="space-y-3">
          <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            这里记录场景配图和图片中转站实际生成测试的开始时间、入口、尝试次数、中转站、模型、结果、耗时、参考图提交方式，以及实际提交给图片接口的已收敛提示词。不会保存原始聊天正文、密钥或参考图内容。图片失败不会再向人物聊天发送技术提示。
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">开始时间</Label>
              <Input type="datetime-local" value={sceneImageLogFilters.from}
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, from: e.target.value }))}
                className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">结束时间</Label>
              <Input type="datetime-local" value={sceneImageLogFilters.to}
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, to: e.target.value }))}
                className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">角色 ID</Label>
              <Input value={sceneImageLogFilters.personaId} inputMode="numeric" placeholder="全部"
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, personaId: e.target.value }))}
                className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">中转站 ID</Label>
              <Input value={sceneImageLogFilters.relayId} inputMode="numeric" placeholder="全部"
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, relayId: e.target.value }))}
                className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">结果</Label>
              <select value={sceneImageLogFilters.success}
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, success: e.target.value }))}
                className="w-full h-9 px-2 bg-background/60 border border-border/60 rounded-lg text-xs text-foreground">
                <option value="all">全部</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">条数</Label>
              <Input value={sceneImageLogFilters.limit} inputMode="numeric"
                onChange={e => setSceneImageLogFilters(filters => ({ ...filters, limit: e.target.value }))}
                className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
            </div>
          </div>

          {sceneImageLogData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-md bg-background/45 px-2.5 py-2">
                <div className="text-sm font-semibold text-foreground">{sceneImageLogData.summary?.calls ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">记录</div>
              </div>
              <div className="rounded-md bg-background/45 px-2.5 py-2">
                <div className="text-sm font-semibold text-foreground">{sceneImageLogData.summary?.successfulCalls ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">成功</div>
              </div>
              <div className="rounded-md bg-background/45 px-2.5 py-2">
                <div className="text-sm font-semibold text-foreground">{sceneImageLogData.summary?.failedCalls ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">失败</div>
              </div>
              <div className="rounded-md bg-background/45 px-2.5 py-2">
                <div className="text-sm font-semibold text-foreground">{sceneImageLogData.summary?.averageDurationMs ?? 0}ms</div>
                <div className="text-[11px] text-muted-foreground">平均耗时</div>
              </div>
            </div>
          )}

          {sceneImageLogDetails.error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300 break-words">
              {sceneImageLogDetails.error.message}
            </div>
          )}

          {!sceneImageLogDetails.error && sceneImageLogDetails.isLoading && (
            <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
              正在读取场景配图记录...
            </div>
          )}

          {!sceneImageLogDetails.error && !sceneImageLogDetails.isLoading && sceneImageLogRecords.length === 0 && (
            <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
              当前筛选下暂无场景配图记录。新的 `/p` 图片任务和图片中转站实际生成测试都会写入这里。
            </div>
          )}

          {sceneImageLogRecords.length > 0 && (
            <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
              {sceneImageLogRecords.map((record: any) => {
                const outputUrl = sceneImageOutputUrl(record.outputKey);
                return (
                  <div key={record.id} className="rounded-lg border border-border/50 bg-background/45 px-3 py-2.5 min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{formatDiagnosticTime(record.startedAt)}</span>
                          <StatusBadge label={record.success ? "成功" : "失败"} tone={record.success ? "ok" : "error"} />
                          <span className="text-[11px] text-muted-foreground">
                            {sceneImageLogSourceLabel(record.source)} · {sceneImageChannelLabel(record.channel)} · {(record.attempt ?? 0) > 0 ? `第 ${record.attempt} 次` : "未调用图片接口"}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-medium text-foreground break-words">
                          {record.relayName || "未选择图片中转站"}{record.model ? ` · ${record.model}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground break-words">
                          {record.personaId == null ? "设置页测试" : `角色 #${record.personaId}`} · 中转站 #{record.relayId ?? "-"}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground break-words">
                          参考图：{sceneImageReferenceModeLabel(record.referenceMode)}
                        </div>
                        {!record.success && (
                          <div className="mt-2 rounded-md bg-red-500/5 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300 break-words">
                            {sceneImageLogReasonLabel(record.reason)}
                          </div>
                        )}
                        {record.promptText ? (
                          <details className="mt-2 rounded-md border border-border/50 bg-muted/10 px-2.5 py-2 text-[11px] text-muted-foreground">
                            <summary className="cursor-pointer select-none font-medium text-foreground">查看实际提交的最终图片提示词</summary>
                            <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-foreground/85">{record.promptText}</pre>
                          </details>
                        ) : (
                          <div className="mt-2 text-[11px] text-muted-foreground">这条历史记录生成于提示词记录功能启用之前，未保存最终提示词。</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 sm:min-w-[160px]">
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.durationMs ?? 0}ms</div>
                          <div className="text-[10px] text-muted-foreground">耗时</div>
                        </div>
                        {outputUrl && (
                          <a href={outputUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline underline-offset-2">
                            打开图片
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DiagnosticCard>

      <DiagnosticCard icon={Database} title="持久化与数据安全" hue="rose"
        subtitle="运行态、导出、删除和迁移覆盖">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <DiagGroup title="存储与脚本">
              <DiagnosticRow label="角色运行态" value={data.persistence?.runtimeStorage?.personaRuntime ?? "persona_runtime_states"} mono />
              <DiagnosticRow label="LLM 用量" value={data.persistence?.runtimeStorage?.llmUsage ?? "llm_usage_records"} mono />
              <DiagnosticRow label="本机清理脚本" value={data.persistence?.localRuntimeCleanupScript ?? "scripts/cleanup-local-runtime.ps1"} mono />
              <DiagnosticRow label="同步脚本" value={data.persistence?.syncScript ?? "scripts/sync-local-worktree.ps1"} mono />
              <DiagnosticRow label="正式迁移" value={compactList(data.persistence?.requiredMigrations, "暂无")} mono />
            </DiagGroup>
            <div className="space-y-3">
              <DiagGroup title="导出覆盖">
                <p className="text-[11px] leading-relaxed text-muted-foreground break-words">
                  {compactList(data.persistence?.exportSections)}
                </p>
              </DiagGroup>
              <DiagGroup title="删除覆盖">
                <p className="text-[11px] leading-relaxed text-muted-foreground break-words">
                  {compactList(data.persistence?.deleteSections)}
                </p>
              </DiagGroup>
            </div>
          </div>
          <div className="space-y-2">
            {(data.persistence?.notes ?? []).map((note: string, index: number) => (
              <div key={index} className="rounded-lg border border-border/50 bg-background/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
      </DiagnosticCard>

    </div>
  );
}

// ─── DATA MANAGEMENT TAB ─────────────────────────────────────────────────────

function DataManagementTab() {
  const [, navigate] = useLocation();
  const { logout } = useAuth();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const exportData = trpc.user.exportData.useMutation({
    onSuccess: (data) => {
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ink-and-kin-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("数据导出成功");
    },
    onError: (e: any) => toast.error("导出失败：" + e.message),
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deleteAccount = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("账户已删除");
      logout();
      navigate(getLoginUrl());
    },
    onError: (e: any) => toast.error(e.message),
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6 card-stagger">
      {/* Storage Overview */}
      {accountStats && (
        <section className="warm-card p-5 space-y-4">
          <SectionHeader icon={HardDrive} title="存储概览" subtitle="数据库记录与上传文件占用" />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已用空间</span>
              <span className="font-medium text-foreground">{formatBytes(accountStats.storageUsed)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${Math.min(100, (accountStats.storageUsed / (100 * 1048576)) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <StatTile value={accountStats.totalPersonas} label="分身" />
              <StatTile value={accountStats.totalMessages} label="消息" />
              <StatTile value={accountStats.totalFiles} label="文件" />
              <StatTile value={accountStats.totalMemories ?? 0} label="记忆" />
              <StatTile value={accountStats.totalSources ?? 0} label="资料" />
              <StatTile value={accountStats.totalRoleplayChannels ?? 0} label="Roleplay 频道" />
              <StatTile value={accountStats.totalLlmUsageRecords ?? 0} label="用量记录" />
              <StatTile value={accountStats.totalSceneImageGenerationLogs ?? 0} label="场景配图记录" />
              <StatTile value={accountStats.totalRuntimeStates ?? 0} label="运行态" />
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      <section className="warm-card p-5 space-y-4">
        <SectionHeader icon={Download} title="数据导出"
          subtitle="导出账户资料、分身、角色运行态、对话、记忆、资料库、日记、Roleplay 频道、平台绑定、LLM 用量和场景配图记录。JSON 不包含密码哈希、会话 Cookie、LLM API Key、本机上传文件实体、TTS 缓存或本机数据库文件。" />
        <Button size="sm" variant="outline" className="rounded-xl border-border"
          onClick={() => exportData.mutate()}
          disabled={exportData.isPending}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          {exportData.isPending ? "导出中..." : "导出全部数据"}
        </Button>
      </section>

      {/* Danger Zone */}
      <section className="warm-card p-5 space-y-4 border-destructive/20">
        <SectionHeader icon={AlertTriangle} title="危险操作" tone="danger" subtitle="不可撤销的账户级操作" />
        <div className="p-4 bg-destructive/5 rounded-xl border border-destructive/10">
          <p className="text-sm text-foreground font-medium mb-1">删除账户</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            永久删除你的账户和所有相关数据库记录，包括分身、角色运行态、对话、记忆、资料库、Roleplay、平台绑定和 LLM 用量记录。此操作不可撤销。
          </p>
          <Button size="sm" variant="destructive" className="rounded-xl"
            onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 删除账户
          </Button>
        </div>
      </section>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">确认删除账户</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-destructive/5 rounded-xl border border-destructive/10">
              <p className="text-xs text-destructive leading-relaxed">
                此操作将永久删除你的账户及所有数据，包括 {accountStats?.totalPersonas || 0} 个分身、
                {accountStats?.totalMessages || 0} 条消息、{accountStats?.totalRuntimeStates || 0} 条运行态和 {accountStats?.totalFiles || 0} 个文件元数据。
                此操作不可撤销。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入密码确认</Label>
              <Input value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                type="password" placeholder="输入你的登录密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入 "删除我的账户" 确认</Label>
              <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="删除我的账户"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="rounded-xl">取消</Button>
            <Button variant="destructive" className="rounded-xl"
              disabled={!deletePassword || deleteConfirmText !== "删除我的账户" || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate({ confirmPassword: deletePassword })}>
              {deleteAccount.isPending ? "删除中..." : "永久删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MAIN SETTINGS PAGE ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [activeTab, setActiveTabState] = useState<TabKey>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    return TABS.some(tab => tab.key === fromUrl) ? (fromUrl as TabKey) : "profile";
  });
  const setActiveTab = (key: TabKey) => {
    setActiveTabState(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background relative">
      <div className="gradient-mesh-bg" /><div className="tech-particles" />
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <div>
              <h1 className="app-nav-title">用户中心</h1>
              <p className="app-nav-subtitle">资料、AI 与数据管理</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 max-w-6xl mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 items-start">
          {/* 左侧侧边栏 (大屏常驻，移动端横向滚动) */}
          <aside className="flex md:flex-col gap-1 p-1.5 bg-card/60 backdrop-blur-md border border-border/40 rounded-2xl md:sticky md:top-20 overflow-x-auto scrollbar-hide">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 md:w-full relative ${
                    isActive
                      ? "bg-gradient-to-r from-primary/15 to-primary/5 text-primary font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30 hover:translate-x-0.5"
                  }`}>
                  {isActive && (
                    <span className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-full hidden md:block" />
                  )}
                  <Icon className={`w-4.5 h-4.5 ${isActive ? "text-primary" : "text-muted-foreground/80"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* 右侧内容 */}
          <div className="space-y-6 min-w-0">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "ai" && <AISettingsTab />}
            {activeTab === "qq" && <QqTab />}
            {activeTab === "diagnostics" && <OperationsDiagnosticsTab />}
            {activeTab === "data" && <DataManagementTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
