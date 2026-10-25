import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  FastForward,
  GitBranch,
  Home,
  MapPin,
  Mic2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wrench,
  XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LivingWorldCandidateActionType } from "../../../server/social/living-world-packet";
import type {
  LivingWorldDeveloperProbe,
  LivingWorldProbeParallelWorld,
  LivingWorldProbeScene } from "../../../server/social/living-world-probe";
import type { LivingWorldExternalEvent } from "../../../server/social/living-world-runtime";
import type { MiroFishNaturalnessMatrixResult, MiroFishPersonaWorldBridgeResult,
  MiroFishPersonaWorldComparisonResult } from "../../../server/social/mirofish-persona-world-client";

interface LivingWorldProbePanelProps {
  personaId: number;
}

const ACTION_TYPE_LABELS: Record<LivingWorldCandidateActionType, string> = {
  reply_suppression_candidate: "睡眠/不可用压制",
  reply_context_candidate: "当前生活切片回复",
  proactive_message_candidate: "主动消息承接",
  photo_context_candidate: "照片世界状态门控",
  voice_presence_candidate: "语音陪伴门控",
  scene_mode_context_candidate: "场景模式上下文",
  drowsy_awake_reply_context: "半醒回复上下文",
  memory_write_decision: "记忆写入判定",
};

const ACTION_TYPE_OPTIONS: Array<{ value: "auto" | LivingWorldCandidateActionType; label: string;
}> = [
  { value: "auto", label: "自动选择" },
  { value: "reply_context_candidate", label: ACTION_TYPE_LABELS.reply_context_candidate,
  },
  { value: "proactive_message_candidate", label: ACTION_TYPE_LABELS.proactive_message_candidate,
  },
  { value: "photo_context_candidate", label: ACTION_TYPE_LABELS.photo_context_candidate,
  },
  { value: "voice_presence_candidate", label: ACTION_TYPE_LABELS.voice_presence_candidate,
  },
  { value: "reply_suppression_candidate", label: ACTION_TYPE_LABELS.reply_suppression_candidate,
  },
];

const DEFAULT_PROBE_INPUT = "今天真的有点撑不住，别讲道理，先陪我一下。";
const MAX_TIMELINE_EVENTS = 12;
const REPLAY_ADVANCE_OPTIONS = [
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 180, label: "3 小时" },
] as const;

type ProbeEventType = NonNullable<LivingWorldExternalEvent["type"]>;

type ProbeTimelineEventDraft = {
  id: string;
  clock: string;
  text: string;
  type: ProbeEventType;
};

type ProbeTimelineEventPayload = Pick<LivingWorldExternalEvent, "clock" | "text" | "type">;

const EVENT_TYPE_LABELS: Record<ProbeEventType, string> = {
  user_message: "用户消息",
  scheduled_event: "计划事件",
  system_observation: "环境观察",
};

const MATRIX_CATEGORY_LABELS: Record<string, string> = {
  "advice-boundary": "建议边界",
  "idle-boundary": "无新消息时保持安静",
  "remote-commitment": "远程协作与后续履行",
  "specific-topic": "具体话题回应",
  "warning-only": "套话提醒",
  "world-state-location": "地点与世界状态一致性",
};

const MATRIX_REASON_LABELS: Record<string, string> = {
  naturalness_unsolicited_coaching_formula: "用户没有求建议，却出现指导口吻",
  naturalness_generic_presence_formula: "只有“我在”式空泛回应",
  naturalness_ungrounded_location_claim: "地点说法与人物世界状态不一致",
  naturalness_channel_meta_narration: "把联系动作说成了渠道操作",
  naturalness_generic_listening_formula: "只有“我听着”式空泛回应",
  naturalness_stock_burden_formula: "出现“别一个人硬扛”式套话",
};

const MATRIX_DECISION_SOURCE_LABELS: Record<string, string> = {
  independent_llm_agents: "采用说话 Agent 候选",
  deterministic_contract_guard: "候选被拒绝，使用规则生成的替代文本",
};

const MATRIX_AGENT_LABELS: Record<string, string> = {
  personality: "性格",
  values: "价值观",
  relationship: "关系连续性",
  work: "工作与作息",
  speaking: "说话方式",
};

const LIVE_DIAGNOSTIC_CHECK_LABELS: Record<string, string> = {
  input_trace_present: "输入记录完整",
  five_agent_execution_complete: "五个角色都已运行",
  agent_call_trace_complete: "五次调用都有结果",
  provider_usage_complete: "模型用量记录完整",
  surface_trace_present: "原句与最终文本可追溯",
  runtime_memory_safe: "短期世界状态隔离",
  no_long_term_writes: "没有写入长期记忆",
  runtime_actions_isolated: "生成动作仅用于本轮诊断",
};

const WORLD_ENTITY_KIND_LABELS: Record<string, string> = {
  persona: "人物",
  partner: "关系对象",
  institution: "机构",
  place: "地点",
  runtime_context: "临时世界状态",
};

const SOCIAL_AGENT_LABELS: Record<string, string> = {
  persona_actor: "人物一致性",
  partner_state_proxy: "用户当下状态",
  work_role_agent: "工作与职责",
  relationship_continuity_agent: "关系连续性",
  schedule_gatekeeper: "作息与可用性",
  memory_guardian: "记忆边界",
  environment_agent: "环境与地点",
  relationship_modeler: "关系与情绪",
  proactive_planner: "主动承接",
  multimodal_agent: "图片与语音",
  report_agent: "证据记录",
};

const DELIBERATION_POLICY_LABELS: Record<string, string> = {
  short_lived_day_state_runtime_only: "当天生活线只在本轮推演中使用",
  suppress_regular_reply_until_available: "人物不可用时暂缓普通回复",
  bounded_reply_with_current_life_slice: "当前回应必须符合人物此刻的生活状态",
  low_pressure_proactive_from_open_thread: "在合适时段低压承接当天未完话题",
  dual_gate_photo_context_runtime_only: "照片需要地点与隐私条件同时允许",
  voice_presence_with_availability_gate: "语音需要人物当前确实可用",
};

const DELIBERATION_STANCE_LABELS: Record<string, string> = {
  support: "支持",
  block: "阻止",
  guardrail: "边界保护",
  observe: "提供观察",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  silent_unless_urgent: "仅紧急消息可打断",
  brief: "只能简短回应",
  normal: "可以正常回应",
  open: "可以充分承接",
  quiet: "适合轻声短聊",
};

const TARGET_MODULE_LABELS: Record<string, string> = {
  "ambient-proactive": "主动消息",
  "life-schedule": "人物作息",
  "persona-text-chat": "人物文字回复",
  "persona-turn-planner": "回合规划",
  "proactive-runtime": "主动消息执行",
  tts: "语音合成",
  "voice-reply-policy": "语音回复策略",
};

let nextTimelineEventId = 1;

function createTimelineEvent(now: string): ProbeTimelineEventDraft {
  return {
    id: `timeline-event-${nextTimelineEventId++}`,
    clock: now.slice(11, 16) || "12:00",
    text: "",
    type: "user_message",
  };
}

function normalizeTimelineEvents(events: ProbeTimelineEventDraft[]): ProbeTimelineEventPayload[] {
  return sortTimelineEventPayloads(events
    .map(event => ({
      clock: event.clock || undefined,
      text: event.text.trim(),
      type: event.type,
    }))
    .filter(event => event.text.length > 0),
  );
}

function sortTimelineEventPayloads(events: ProbeTimelineEventPayload[]): ProbeTimelineEventPayload[] {
  return [...events].sort((left, right) => (left.clock ?? "").localeCompare(right.clock ?? ""));
}

function timelinePayloadsToDrafts(events: ProbeTimelineEventPayload[]): ProbeTimelineEventDraft[] {
  return events.map(event => ({
    id: `timeline-event-${nextTimelineEventId++}`,
    clock: event.clock ?? "",
    text: event.text,
    type: event.type ?? "user_message",
  }));
}

function appendTimelineEvent(
  events: ProbeTimelineEventPayload[],
  event: ProbeTimelineEventPayload): ProbeTimelineEventPayload[] {
  const signature = timelineEventSignature([event]);
  if (events.some(existing => timelineEventSignature([existing]) === signature)) return events;
  return sortTimelineEventPayloads([...events, event]);
}

function timelineEventSignature(
  events: ReadonlyArray<Pick<LivingWorldExternalEvent, "clock" | "text" | "type">>): string {
  return JSON.stringify(events.map(event => ({
    clock: event.clock ?? "",
    text: event.text.trim(),
    type: event.type ?? "user_message",
  })),
  );
}

function toLocalDatetimeInput(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function advanceLocalDatetime(isoNow: string, minutes: number): string {
  const current = new Date(isoNow);
  if (Number.isNaN(current.getTime())) return toLocalDatetimeInput();
  return toLocalDatetimeInput(new Date(current.getTime() + minutes * 60_000));
}

function displayActionType(value?: string | null): string {
  if (!value) return "未选中";
  if (value === "day_state") return "当天生活状态";
  return ACTION_TYPE_LABELS[value as LivingWorldCandidateActionType] || value;
}

function displayDeliberationPolicy(value?: string | null): string {
  if (!value) return "未形成主导判断";
  return DELIBERATION_POLICY_LABELS[value] || value;
}

function displayAvailability(value?: string | null): string {
  if (!value) return "未注明可用状态";
  return AVAILABILITY_LABELS[value] || value;
}

function displayInternalDiagnosticText(value?: string | null): string {
  let output = value?.trim() || "暂无";
  for (const [agentId, label] of Object.entries(SOCIAL_AGENT_LABELS)) {
    output = output.split(agentId).join(label);
  }
  const phraseReplacements: Array<[string, string]> = [
    ["生成后续 carryover", "形成后续待承接的话题"],
    ["text_presence_fallback", "文字陪伴备用方案"],
    ["runtime context", "本轮运行上下文"],
    ["open thread", "未完话题"],
    ["carryover", "后续延续"],
    ["packet", "动作包"],
    ["seed", "生成种子"],
    ["timeline", "时间线"],
    ["Agent", "内部角色"],
    ["fallback", "备用方案"],
  ];
  for (const [source, replacement] of phraseReplacements) {
    output = output.split(source).join(replacement);
  }
  return output;
}

function displayText(value?: string | null): string {
  return value?.trim() || "暂无";
}

function diagnosticSurfaceStatusLabel(value: string): string {
  if (value === "accepted") return "原句采用";
  if (value === "corrected") return "原句已修正";
  if (value === "rejected") return "原句被拒绝";
  return "没有候选";
}

function diagnosticReasonLabel(value: string): string {
  return MATRIX_REASON_LABELS[value] || value;
}

function displaySlotSource(value?: string | null): string {
  if (value === "external_event") return "外部事件";
  if (value === "derived_carryover") return "前序延续";
  return "计划时段";
}

function displayEventSource(value?: string | null): string {
  if (value === "current_input") return "当前输入";
  if (value === "persisted_user_event") return "已记录的用户事件";
  if (value === "generated_carryover") return "前序推演延续";
  if (value === "fixed_reference_fixture") return "固定验收样例";
  return value ? `其他来源：${value}` : "未注明来源";
}

function compactList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map(value => String(value)).filter(Boolean)
    : [];
}

function decisionSummary(scene: LivingWorldProbeScene): string {
  const decision = scene.decision;
  if (!decision) return "未选中 packet";
  if (decision.suppressReply) return "压制即时回复";
  if (decision.photoContext) return decision.photoContext.allowed ? "照片允许" : "照片阻断";
  if (decision.voicePresence) return decision.voicePresence.shouldAttemptVoice ? "语音候选" : "文字兜底";
  if (decision.proactiveText) return "主动承接";
  return "回复上下文";
}

function SceneIcon({ scene }: { scene: LivingWorldProbeScene }) {
  const actionType = scene.selectedPacket?.actionType;
  if (actionType === "photo_context_candidate") return <Camera className="h-4 w-4" />;
  if (actionType === "voice_presence_candidate") return <Mic2 className="h-4 w-4" />;
  if (actionType === "proactive_message_candidate") return <GitBranch className="h-4 w-4" />;
  return <Route className="h-4 w-4" />;
}

function Metric({
  icon: Icon,
  label,
  value,
  note }: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  note?: string }) {
  return (
    <div className="min-w-0 border-l-2 border-primary/25 px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-foreground">{value}</div>
      {note && <div className="mt-0.5 truncate text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function ProbeSummary({ probe }: { probe: LivingWorldDeveloperProbe }) {
  const context = probe.dayState.inferredContext;
  return (
    <div className="grid gap-x-3 gap-y-4 border-y border-border/70 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={BrainCircuit} label="当天种子" value={probe.dayState.seedId} note={probe.dayState.dateKey} />
      <Metric icon={Activity} label="候选动作" value={probe.packetAudit.packetCount} note={probe.packetAudit.actionTypes.map(displayActionType).join(" / ")} />
      <Metric icon={MapPin} label="工作地点" value={context.workLocation} note={`家：${context.homeLocation}`} />
      <Metric icon={ShieldCheck} label="记忆边界" value={probe.packetAudit.allRuntimeOnly ? "仅本轮使用" : "需要检查"} note="模拟生活不会写入长期记忆" />
    </div>
  );
}

function DayPlan({ probe }: { probe: LivingWorldDeveloperProbe }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarClock className="h-3.5 w-3.5 text-primary" />
            当天生活与事件推进
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            计划时段、真实消息和前序延续按北京时间排列。
          </p>
        </div>
        <Badge variant="outline" className="w-fit text-[10px]">{probe.dayState.dayPlan.length} 个时段</Badge>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border/70">
        {probe.dayState.dayPlan.map(item => (
          <details key={`${item.clock}-${item.phase}`} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[3.75rem_minmax(0,1fr)] gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
              <span className="pt-0.5 font-mono text-xs font-semibold text-foreground">{item.clock}</span>
              <span className="min-w-0">
                <span className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{item.activity}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={item.availability === "open" || item.availability === "normal" ? "secondary" : "outline"} className="hidden text-[10px] sm:inline-flex">
                      {displayAvailability(item.availability)}
                    </Badge>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant={item.availability === "open" || item.availability === "normal" ? "secondary" : "outline"} className="text-[10px] sm:hidden">
                    {displayAvailability(item.availability)}
                  </Badge>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-primary" />
                    {item.location}
                  </span>
                  <Badge variant="outline" className="bg-muted/20 text-[10px]">{displaySlotSource(item.source)}</Badge>
                  {item.eventSource && !(item.source === "derived_carryover" && item.eventSource === "generated_carryover") && (
                    <Badge variant="outline" className="bg-muted/20 text-[10px]">{displayEventSource(item.eventSource)}</Badge>
                  )}
                  {item.carryover.length > 0 && (
                    <span className="text-[10px]">{item.carryover.length} 个未完话题</span>
                  )}
                </span>
              </span>
            </summary>
            <div className="border-t border-border/70 bg-muted/15 px-3 py-3 sm:ml-[4.5rem] sm:border-l sm:border-t-0">
              <p className="text-[10px] font-semibold text-muted-foreground">状态依据</p>
              <p className="mt-1 text-xs leading-5 text-foreground">{displayInternalDiagnosticText(item.internalState)}</p>
              {item.carryover.length > 0 && (
                <div className="mt-3 border-t border-border/70 pt-2.5">
                  <p className="text-[10px] font-semibold text-muted-foreground">延续中的话题</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.carryover.map(thread => (
                      <Badge key={thread} variant="secondary" className="text-[10px]">{thread}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function SceneCard({ scene }: { scene: LivingWorldProbeScene }) {
  const actionType = scene.selectedPacket?.actionType;
  const location = scene.selectedPacket?.lifeContextPatch?.currentLocation;
  const deliberation = scene.deliberation;
  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/8 text-primary">
            <SceneIcon scene={scene} />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-foreground">{scene.label}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="bg-muted/25 text-[10px]">{scene.clock}</Badge>
              <Badge variant="outline" className="bg-muted/25 text-[10px]">{displayActionType(actionType)}</Badge>
              {scene.injectedEvent?.source && (
                <Badge variant="outline" className="bg-muted/25 font-mono text-[10px]">{displayEventSource(scene.injectedEvent.source)}</Badge>
              )}
              <Badge variant={scene.memorySafeRuntimeOnly ? "secondary" : "destructive"} className="text-[10px]">
                {scene.memorySafeRuntimeOnly ? "memory safe" : "memory risk"}
              </Badge>
              {location && (
                <Badge variant="outline" className="bg-muted/25 text-[10px]">{location}</Badge>
              )}
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px]">{decisionSummary(scene)}</Badge>
      </div>

      {deliberation && (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">{deliberation.dominantPolicy}</Badge>
            {deliberation.blockingAgents.map(agent => (
              <Badge key={`${scene.sceneId}-block-${agent}`} variant="destructive" className="text-[10px]">{agent} block</Badge>
            ))}
            {deliberation.guardrailAgents.map(agent => (
              <Badge key={`${scene.sceneId}-guard-${agent}`} variant="outline" className="bg-background/50 text-[10px]">{agent} guard</Badge>
            ))}
          </div>
          {deliberation.conflicts.length > 0 && <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{deliberation.conflicts.join(" / ")}</p>}
        </div>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Before 书中人</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{scene.beforeApp}</p>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-primary">After LivingWorld</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{scene.afterApp}</p>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{scene.whyThisShowsMiroFishValue}</p>
    </article>
  );
}

function CurrentDecision({ probe }: { probe: LivingWorldDeveloperProbe }) {
  const packet = probe.current.selectedPacket;
  const decision = probe.current.decision;
  const location = packet?.lifeContextPatch?.currentLocation;
  const openThreads = compactList(probe.dayState.inferredContext.openThreads);
  const replyTexture = compactList(probe.dayState.inferredContext.replyTexture);
  const visibleDecisionText = decision?.suppressReply ? "本轮暂不即时回复。" : decision?.voicePresence?.speechText || decision?.proactiveText || decision?.photoContext?.caption || decision?.replyContext || decision?.currentLifeSlice || decision?.promptInstruction;
  const deliveryLabel = decision?.voicePresence ? (decision.voicePresence.shouldAttemptVoice ? "优先语音，失败时发送文字" : "发送文字") : null;

  return (
    <div className="border-l-2 border-primary bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="h-3 w-3" />
          {displayActionType(packet?.actionType)}
        </Badge>
        {location && (
          <Badge variant="outline" className="gap-1"><Home className="h-3 w-3" />{location}</Badge>
        )}
        <Badge variant={decision?.memoryRuntimeOnly ? "secondary" : "outline"} className="gap-1">
          {decision?.memoryRuntimeOnly ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {decision?.memoryRuntimeOnly ? "仅本轮使用" : "未确认"}
        </Badge>
        {deliveryLabel && (
          <Badge variant="outline" className="gap-1">
            <Mic2 className="h-3 w-3" />
            {deliveryLabel}
          </Badge>
        )}
      </div>
      <div className="mt-3">
        <div>
          <p className="text-xs font-semibold text-foreground">建议采用的回应</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">
            {displayText(visibleDecisionText)}
          </p>
        </div>
        <div className="mt-3 grid gap-3 border-t border-primary/15 pt-3 md:grid-cols-3">
        <div>
            <p className="text-xs font-semibold text-foreground">依据的生活状态</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{displayText(decision?.currentLifeSlice)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">当天未完话题</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{openThreads.length ? openThreads.join(" / ") : "暂无"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">回应方式</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{replyTexture.length ? replyTexture.join(" / ") : "暂无"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonaWorldSimulationPanel({ probe }: { probe: LivingWorldDeveloperProbe }) {
  const simulation = probe.personaWorldSimulation;
  const outcome = simulation.outcome;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Network className="h-3.5 w-3.5 text-primary" />
            人物关系世界
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            先把人物资料整理成关系与生活约束，再让真实消息经过六个内部角色的连续判断。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">{simulation.worldGraph.entities.length} 个实体</Badge>
          <Badge variant="outline" className="text-[10px]">{simulation.worldGraph.relations.length} 条关系</Badge>
          <Badge variant="outline" className="text-[10px]">{simulation.agentProfiles.length} 个内部角色</Badge>
          <Badge variant="secondary" className="text-[10px]">综合符合度 {Math.round(simulation.scorecard.overall * 100)}%</Badge>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="living-world-entities-heading">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 id="living-world-entities-heading" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" />
              参与推演的人物、地点与临时状态
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              默认呈现影响判断的资料摘要，完整原文仍按实体保留。
            </p>
          </div>
          <Badge variant="outline" className="w-fit text-[10px]">生成内容不写入长期记忆</Badge>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border/70">
          {simulation.worldGraph.entities.map(entity => {
            const evidenceItems = entity.evidence.length > 0
              ? entity.evidence
              : Object.values(entity.attributes).filter(Boolean);
            const evidencePreview = evidenceItems[0] || "由人物资料派生";
            return (
              <details key={entity.entityId} className="group">
                <summary className="cursor-pointer list-none px-3 py-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground">{entity.name}</span>
                        <Badge variant="outline" className="bg-muted/20 text-[10px]">
                          {WORLD_ENTITY_KIND_LABELS[entity.kind] ?? entity.kind}
                        </Badge>
                        <Badge variant={entity.runtimeOnly ? "secondary" : "outline"} className="text-[10px]">
                          {entity.runtimeOnly ? "本轮临时" : "人物资料"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">可信度 {Math.round(entity.confidence * 100)}%</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {evidencePreview}
                      </p>
                    </div>
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                  </div>
                </summary>
                <div className="border-t border-border/70 bg-muted/15 px-3 py-3">
                  <p className="text-[10px] font-semibold text-muted-foreground">完整资料</p>
                  <div className="mt-2 space-y-2">
                    {evidenceItems.map((item, index) => (
                      <p key={`${entity.entityId}-evidence-${index}`} className="border-l-2 border-primary/25 pl-2.5 text-xs leading-5 text-foreground">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="space-y-2 border-t border-border/70 pt-4" aria-labelledby="living-world-agents-heading">
        <div>
          <h4 id="living-world-agents-heading" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Target className="h-3.5 w-3.5 text-primary" />
            六个内部角色分别负责什么
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            每个角色先按自己的职责提出判断，再共同决定当前回应与后续行动。
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border/70">
          {simulation.agentProfiles.map(agent => (
            <details key={agent.agentId} title={agent.agentId} className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(8.5rem,0.38fr)_minmax(0,1fr)] sm:items-start">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {SOCIAL_AGENT_LABELS[agent.agentId] ?? agent.agentId}
                    </p>
                    <Badge variant="outline" className="mt-1.5 text-[10px]">
                      影响 {Math.round(agent.influenceWeight * 100)}%
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-foreground">{agent.role}</p>
                </div>
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="border-t border-border/70 bg-muted/15 px-3 py-3 sm:pl-[10.25rem]">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[10px] font-semibold text-muted-foreground">本轮目标</dt>
                    <dd className="mt-1 text-xs leading-5 text-foreground">{agent.objectives[0]}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold text-muted-foreground">不能越过的边界</dt>
                    <dd className="mt-1 text-xs leading-5 text-foreground">{agent.constraints[0]}</dd>
                  </div>
                </dl>
              </div>
            </details>
          ))}
        </div>
      </section>

      {(simulation.triggeringEvent || simulation.continuityEvent) && (
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
          <div className="rounded-lg border border-border bg-card px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
              <Activity className="h-3.5 w-3.5 text-primary" />最新消息
              {simulation.triggeringEvent?.source && (
                <Badge variant="outline" className="font-mono text-[10px] normal-case">{displayEventSource(simulation.triggeringEvent.source)}</Badge>
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">
              {simulation.triggeringEvent?.clock} · {displayText(simulation.triggeringEvent?.text)}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">负责这一刻的即时回应。</p>
          </div>
          <div className="hidden items-center justify-center text-muted-foreground md:flex">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-primary">
              <Target className="h-3.5 w-3.5" />当天关键连续性事件
              {simulation.continuityEvent?.source && (
                <Badge variant="outline" className="font-mono text-[10px] normal-case">{displayEventSource(simulation.continuityEvent.source)}</Badge>
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-foreground">
              {simulation.continuityEvent?.clock} · {displayText(simulation.continuityEvent?.text)}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              负责未完承诺与后续主动行动，不会被后面的普通闲聊覆盖。
            </p>
          </div>
        </div>
      )}

      {simulation.rounds.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border bg-muted/35 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">事件传播因果链</span>
            <Badge variant="outline" className="text-[10px]">{simulation.rounds.length} rounds</Badge>
          </div>
          <div className="grid gap-px bg-border/70 lg:grid-cols-3">
            {simulation.rounds.map((round, index) => (
              <div key={`${round.round}-${round.stage}`} className="relative min-w-0 bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{round.round}</span>
                  <span className="truncate text-xs font-semibold text-foreground">{round.stage}</span>
                  {index < simulation.rounds.length - 1 && <ArrowRight className="ml-auto hidden h-3.5 w-3.5 text-muted-foreground lg:block" />}
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{round.winningAction}</p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{round.observations.join(" / ")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">没有人物世界</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{displayText(simulation.baselineComparison.withoutLivingWorld.immediateReply)}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{simulation.baselineComparison.withoutLivingWorld.limitation}</p>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase text-primary">关系图 + 多轮推演</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">当前：{displayText(outcome.currentReplyCandidate)}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">后续：{displayText(outcome.proactiveFollowUpCandidate)}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{simulation.baselineComparison.withLivingWorld.improvement}</p>
        </div>
      </div>
    </div>
  );
}

function MiroFishLiveDiagnosticPanel({
  result,
}: {
  result: MiroFishPersonaWorldBridgeResult;
}) {
  const diagnostic = result.liveDiagnostic;
  if (!diagnostic.contractVersion && !diagnostic.contractValid) return null;

  const statusLabel = diagnostic.status === "complete"
    ? "本次运行记录完整"
    : diagnostic.status === "fallback"
      ? "真实模型运行失败，已回退"
      : diagnostic.status === "incomplete"
        ? "本次运行记录不完整"
        : diagnostic.status === "not_requested"
          ? "本次未请求真实模型"
          : "没有诊断记录";
  const statusVariant = diagnostic.status === "complete"
    ? ("secondary" as const)
    : diagnostic.status === "not_requested"
      ? ("outline" as const)
      : ("destructive" as const);

  const renderSurfaceTrace = (
    label: string,
    raw: string,
    finalText: string,
    status: string,
    decisionSource: string,
    rejectionReasons: string[],
    warningReasons: string[],
  ) => {
    const reasons = [...rejectionReasons, ...warningReasons];
    return (
      <div className="min-w-0 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">{label}</p>
          <Badge variant={status === "rejected" ? "destructive" : "outline"} className="text-[10px]">
            {diagnosticSurfaceStatusLabel(status)}
          </Badge>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
          <span className="text-[10px] font-semibold text-muted-foreground">模型原句</span>
          <p className="min-w-0 break-words text-xs leading-relaxed text-foreground">{displayText(raw)}</p>
          <span className="text-[10px] font-semibold text-muted-foreground">最终文本</span>
          <p className="min-w-0 break-words text-xs leading-relaxed text-foreground">{displayText(finalText)}</p>
          <span className="text-[10px] font-semibold text-muted-foreground">采用来源</span>
          <p className="min-w-0 break-words text-[10px] leading-relaxed text-muted-foreground">
            {MATRIX_DECISION_SOURCE_LABELS[decisionSource] || displayText(decisionSource)}
          </p>
        </div>
        {reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
            {rejectionReasons.map(reason => (
              <Badge key={`${label}-reject-${reason}`} variant="destructive" className="whitespace-normal text-left text-[10px] leading-relaxed">
                {diagnosticReasonLabel(reason)}
              </Badge>
            ))}
            {warningReasons.map(reason => (
              <Badge key={`${label}-warn-${reason}`} variant="outline" className="whitespace-normal text-left text-[10px] leading-relaxed">
                提醒：{diagnosticReasonLabel(reason)}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="border-y border-border bg-muted/10" data-testid="mirofish-live-diagnostic">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" />
            本次真实运行诊断
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            直接整理这一轮五个角色已经产生的记录，不再调用额外角色，也不做主观自然度评分。
          </p>
        </div>
        <Badge variant={statusVariant} className="w-fit shrink-0 text-[10px]">{statusLabel}</Badge>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="min-w-0 border-b border-border px-3 py-3 lg:border-b-0 lg:border-r sm:px-4">
          <p className="text-[10px] font-semibold text-muted-foreground">实际采用的输入</p>
          <p className="mt-1.5 break-words text-sm leading-relaxed text-foreground">
            {displayText(diagnostic.inputTrace.primaryEvent.text)}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>{diagnostic.inputTrace.primaryEvent.clock || "时间未知"}</span>
            <span>{diagnostic.inputTrace.primaryEvent.source || "来源未知"}</span>
            <span>{diagnostic.inputTrace.eventCount} 条当天事件</span>
            <span className="font-mono">输入指纹 {diagnostic.inputTrace.inputSha256.slice(0, 12)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-3 sm:px-4">
          {[
            ["角色调用", `${diagnostic.executionTrace.successfulAgentCallCount}/${diagnostic.executionTrace.expectedAgentCount} · ${diagnostic.executionTrace.clientOrigin === "default_mirofish_llm_client" ? "MiroFish 默认客户端" : diagnostic.executionTrace.clientOrigin}`],
            ["总用量", `${diagnostic.executionTrace.totalTokens.toLocaleString("zh-CN")} tokens`],
            ["累计耗时", `${diagnostic.executionTrace.totalLatencyMs.toLocaleString("zh-CN")} ms`],
            ["模型", diagnostic.executionTrace.models.join(", ") || "未取得"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
              <p className="mt-1 break-words text-xs font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {renderSurfaceTrace(
          "当前回复",
          diagnostic.surfaceTrace.rawCurrent,
          diagnostic.surfaceTrace.finalCurrent,
          diagnostic.surfaceTrace.currentStatus,
          diagnostic.surfaceTrace.currentDecisionSource,
          diagnostic.surfaceTrace.currentRejectionReasons,
          diagnostic.surfaceTrace.currentWarningReasons,
        )}
        {renderSurfaceTrace(
          "后续动作",
          diagnostic.surfaceTrace.rawFollowUp,
          diagnostic.surfaceTrace.finalFollowUp,
          diagnostic.surfaceTrace.followUpStatus,
          diagnostic.surfaceTrace.followUpDecisionSource,
          diagnostic.surfaceTrace.followUpRejectionReasons,
          diagnostic.surfaceTrace.followUpWarningReasons,
        )}
      </div>

      <div className="border-t border-border px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-muted-foreground">逐次模型调用</p>
          <p className="text-[10px] text-muted-foreground">
            输入 {diagnostic.executionTrace.totalInputTokens.toLocaleString("zh-CN")} · 输出 {diagnostic.executionTrace.totalOutputTokens.toLocaleString("zh-CN")}
          </p>
        </div>
        <div className="mt-2 divide-y divide-border border-y border-border">
          {result.telemetry.agentCalls.map(call => (
            <div key={`${call.callIndex}-${call.agentId}`} className="grid min-w-0 gap-1.5 py-2 sm:grid-cols-[minmax(8rem,1.2fr)_minmax(8rem,1fr)_auto_auto] sm:items-center sm:gap-3">
              <p className="truncate text-xs font-semibold text-foreground">
                {call.callIndex}. {MATRIX_AGENT_LABELS[call.profileDimension] || call.profileDimension}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">{call.provider} · {call.model}</p>
              <p className="text-[10px] text-muted-foreground">{call.totalTokens ?? 0} tokens</p>
              <p className="text-[10px] text-muted-foreground">{call.latencyMs} ms</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-3 py-3 sm:px-4">
        <p className="text-[10px] font-semibold text-muted-foreground">自动检查</p>
        <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {diagnostic.checks.map(check => (
            <div key={check.checkId} className="flex min-w-0 items-start gap-1.5 text-[10px] leading-relaxed">
              {check.passed
                ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
              <span className={check.passed ? "text-muted-foreground" : "text-destructive"}>
                {LIVE_DIAGNOSTIC_CHECK_LABELS[check.checkId] || check.checkId}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-border pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground">写入边界</p>
            <Badge variant="outline" className="text-[10px]">不需要人工评分</Badge>
          </div>
          <div
            className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-3"
            data-testid="mirofish-live-write-summary">
            <div className="min-w-0" data-testid="mirofish-live-long-term-writes">
              <p className="text-[10px] leading-relaxed text-muted-foreground">实际长期记忆写入</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {diagnostic.sideEffects.longTermWriteCount}
              </p>
            </div>
            <div className="min-w-0" data-testid="mirofish-live-blocked-writes">
              <p className="text-[10px] leading-relaxed text-muted-foreground">已阻止的写入尝试</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {diagnostic.memoryTrace.blockedWriteCount}
              </p>
            </div>
            <div className="min-w-0" data-testid="mirofish-live-product-writes">
              <p className="text-[10px] leading-relaxed text-muted-foreground">实际产品状态写入</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {diagnostic.sideEffects.productStateWriteCount}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            被阻止的写入尝试没有进入长期记忆或产品状态。
          </p>
        </div>
      </div>
    </section>
  );
}

function MiroFishIndependentAgentPanel({
  result,
  probe }: {
  result: MiroFishPersonaWorldBridgeResult;
  probe: LivingWorldDeveloperProbe }) {
  const statusLabel = result.status === "disabled"
    ? "未启用"
    : result.status === "unavailable"
      ? "服务不可用"
      : result.status === "rejected"
        ? "安全拒绝"
        : result.status === "fallback"
          ? "确定性回退"
          : result.executionMode === "llm"
            ? "真实 LLM Agent"
            : "外部确定性";
  const statusTone = result.status === "success"
    ? ("secondary" as const) : result.status === "disabled"
      ? ("outline" as const) : ("destructive" as const);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Network className="h-3.5 w-3.5 text-primary" />
            MiroFish 独立 Agent 执行
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            外部改造服务只交换人物资料与 runtime-only JSON，不进入长期记忆。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={statusTone} className="text-[10px]">{statusLabel}</Badge>
          {result.executionMode && (
            <Badge variant="outline" className="text-[10px]">mode {result.executionMode}</Badge>
          )}
          {result.executionMode === "llm" && (
            <Badge variant="outline" className="text-[10px]">{result.independentCallCount} independent calls</Badge>
          )}
        </div>
      </div>

      {result.status === "disabled" && <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          当前只显示 书中人 本地确定性人物推演；外部 MiroFish persona-world 开关未启用。
        </div>}

      {(result.status === "unavailable" || result.status === "rejected") && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <XCircle className="h-3.5 w-3.5" />{statusLabel}
          </p>
          <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{result.error}</p>
        </div>
      )}

      {result.status === "fallback" && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">请求了 LLM，但本次实际使用确定性回退</p>
          <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{result.fallbackReason || "外部服务没有返回独立 LLM Agent 结果。"}</p>
        </div>
      )}

      {result.safeToUse && (
        <>
          <MiroFishLiveDiagnosticPanel result={result} />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Winner</p>
              <p className="mt-1 truncate text-xs font-semibold text-foreground">{result.winner?.agentId || "deterministic runner"}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{result.winner?.profileDimension || result.executionMode}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">World Graph</p>
              <p className="mt-1 text-xs font-semibold text-foreground">{result.worldGraph.entityCount} entities · {result.worldGraph.relationCount} relations</p>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">{result.worldGraph.graphId}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Follow-up</p>
              <p className="mt-1 text-xs font-semibold text-foreground">{result.enhancedFollowUpFulfilled ? "fulfilled" : "missing"}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">baseline {result.baselineFollowUpFulfilled ? "fulfilled" : "forgot"}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />Memory Guard
              </p>
              <p className="mt-1 text-xs font-semibold text-foreground">{result.memorySafe ? "runtime-only" : "rejected"}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">generated life 不落长期事实</p>
            </div>
          </div>

          {result.agentActions.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/35 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">独立提案</span>
                <Badge variant="outline" className="text-[10px]">{result.agentActions.length} agents</Badge>
              </div>
              <div className="grid gap-px bg-border/70 sm:grid-cols-2 xl:grid-cols-5">
                {result.agentActions.map(action => (
                  <div key={`${action.agentId}-${action.callIndex}`} className="min-w-0 bg-card px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {MATRIX_AGENT_LABELS[action.profileDimension] || action.profileDimension}
                      </span>
                      <Badge variant={result.winner?.agentId === action.agentId ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                        {action.priority.toFixed(0)}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{action.proposal || action.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">无人物世界</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">{displayText(result.baselineCurrentAction)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">后续：没有履约动作</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">书中人 本地推演</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">当前：{displayText(probe.personaWorldSimulation.outcome.currentReplyCandidate)}</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">后续：{displayText(probe.personaWorldSimulation.outcome.proactiveFollowUpCandidate)}</p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-primary">MiroFish 实际结果</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">当前：{displayText(result.currentAction)}</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">后续：{displayText(result.followUpAction)}</p>
            </div>
          </div>

          {result.report.answer && (
            <div className="border-y border-border bg-muted/15 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ScanSearch className="h-3.5 w-3.5 text-primary" />
                  MiroFish ReportAgent 诊断
                </p>
                <Badge variant="outline" className="text-[10px]">
                  {result.report.evidenceMode === "independent_llm_agent_actions"
                    ? "真实五 Agent 证据"
                    : "确定性 fallback 证据"}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {result.report.answer}
              </p>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Agent 冲突</p>
                  <div className="mt-1.5 space-y-1.5">
                    {result.report.conflicts.length > 0 ? (
                      result.report.conflicts.map(conflict => (
                      <div key={`${conflict.kind}-${conflict.agentIds.join("-")}`} className="text-[10px] leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">{conflict.kind}</span>
                        <span className="ml-1">{conflict.summary}</span>
                      </div>
                      ))) : (
                      <p className="text-[10px] text-muted-foreground">未记录到结构化 Agent 分歧。</p>
                    )}
                  </div>
                </div>

                <div className="min-w-0 lg:border-l lg:border-border lg:pl-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    <Wrench className="h-3 w-3" />施工定位
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {result.report.diagnosticTargets.map(target => (
                      <div key={`${target.module}-${target.reason}`} className="text-[10px] leading-relaxed text-muted-foreground">
                        <span className="font-mono font-semibold text-foreground">{target.module}</span>
                        <span className="ml-1">{target.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MiroFishParallelWorldPanel({
  comparison }: {
  comparison: MiroFishPersonaWorldComparisonResult }) {
  if (!comparison.enabled) return null;

  const changedFieldLabels: Record<MiroFishPersonaWorldComparisonResult["changedFields"][number], string> = {
    winner: "胜出 Agent",
    current_action: "当前动作",
    follow_up_action: "后续动作",
    follow_up_fulfilled: "履约状态",
  };
  const usable = comparison.status === "success" || comparison.status === "fallback";

  return (
    <div className="space-y-3 border-y border-primary/20 bg-primary/[0.025] py-4" data-testid="mirofish-parallel-worlds">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <GitBranch className="h-3.5 w-3.5" />
            MiroFish 真实平行世界
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            同一人物和事件账本分别执行 baseline 与 intervention，两边都来自外部 persona-world。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">2 worlds</Badge>
          <Badge variant="outline" className="text-[10px]">{comparison.totalIndependentCallCount} independent calls</Badge>
          <Badge variant={comparison.memorySafe ? "secondary" : "destructive"} className="text-[10px]">
            {comparison.memorySafe ? "runtime-only" : "memory risk"}
          </Badge>
        </div>
      </div>

      {comparison.interventionEvent ? (
        <div className="border-l-2 border-primary bg-primary/5 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase text-primary">唯一干预变量</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">
            {comparison.interventionEvent.clock} · {comparison.interventionEvent.text}
          </p>
        </div>
      ) : (
        <p className="border-l-2 border-border px-3 py-1 text-xs text-muted-foreground">
          当前没有独立输入事件，只执行了一个 MiroFish 世界；添加输入后才会形成双世界对照。
        </p>
      )}

      {!usable && (
        <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          双世界没有形成可用的 MiroFish 结果：baseline={comparison.baseline.status}，intervention={comparison.intervention.status}。
        </div>
      )}

      {usable && comparison.interventionEvent && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border-l-2 border-border px-3 py-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Baseline · 没有本次输入</p>
                <Badge variant="outline" className="text-[10px]">{comparison.baseline.independentCallCount} calls</Badge>
              </div>
              <p className="mt-2 text-xs font-semibold text-foreground">
                winner: {comparison.baseline.winner?.agentId || comparison.baseline.executionMode}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">当前：{displayText(comparison.baseline.currentAction)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">后续：{displayText(comparison.baseline.followUpAction)}</p>
            </div>
            <div className="border-l-2 border-primary bg-primary/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase text-primary">Intervention · 加入本次输入</p>
                <Badge variant="secondary" className="text-[10px]">{comparison.intervention.independentCallCount} calls</Badge>
              </div>
              <p className="mt-2 text-xs font-semibold text-foreground">
                winner: {comparison.intervention.winner?.agentId || comparison.intervention.executionMode}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">当前：{displayText(comparison.intervention.currentAction)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">后续：{displayText(comparison.intervention.followUpAction)}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={comparison.meaningfulDifference ? "secondary" : "outline"} className="text-[10px]">
              {comparison.meaningfulDifference ? "检测到世界分歧" : "本次没有可见分歧"}
            </Badge>
            {comparison.changedFields.map(field => (
              <Badge key={field} variant="outline" className="text-[10px]">{changedFieldLabels[field]}
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MiroFishNaturalnessMatrixPanel({ result }: { result: MiroFishNaturalnessMatrixResult }) {
  if (!result.enabled) return null;

  const statusLabel = result.status === "success" ? "证据检查通过" : result.status === "unavailable" ? "矩阵服务不可用" : "矩阵结果被拒绝";
  const rejectedScenarioCount = result.scenarios.filter(scenario => scenario.surface.currentStatus === "rejected" || scenario.surface.followUpStatus === "rejected").length;
  const decisionLabel = (value: string) => MATRIX_DECISION_SOURCE_LABELS[value] || (value ? value : "没有外发动作");
  const reasonLabels = (values: string[]) => values.map(value => MATRIX_REASON_LABELS[value] || value);

  return (
    <section className="space-y-3 border-y border-border bg-muted/[0.08] py-4" data-testid="mirofish-naturalness-matrix">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-foreground">
            <ScanSearch className="h-3.5 w-3.5 text-primary" />
            MiroFish 自然度场景检查
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">冻结场景使用可重复的测试候选运行完整五 Agent 服务，不访问真实模型，也不要求人工评分。这里证明规则和记忆边界按预期执行，不代表真实聊天自然度已经通过。</p>
        </div>
        <Badge variant={result.status === "success" ? "secondary" : "destructive"} className="w-fit shrink-0 text-[10px]">
          {statusLabel}
        </Badge>
      </div>

      {!result.safeToInspect && (
        <div className="border-l-2 border-destructive bg-destructive/8 px-3 py-2.5">
          <p className="text-xs font-semibold text-destructive">当前矩阵证据不能采用</p>
          <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{result.error || "服务没有返回完整的只读检查证据。"}</p>
        </div>
      )}

      {result.safeToInspect && (
        <>
          <div className="grid border-y border-border bg-background/45 sm:grid-cols-4 lg:grid-cols-8 sm:divide-x sm:divide-border">
            {[
              ["场景", `${result.summary.passedScenarioCount}/${result.summary.scenarioCount}`],
              ["规则检查总数", `${result.summary.checkCount} 项`],
              ["Agent 调用", `${result.summary.injectedAgentCallCount} 次`],
              ["出现拒绝的场景", `${rejectedScenarioCount} 个`],
              ["真实模型调用", `${result.summary.networkCalls} 次`],
              ["人工评分", result.summary.humanScoresRequired ? "需要" : "不需要"],
              ["产品开关", result.summary.productFlagsChanged ? "发生变化" : "未改变"],
              ["长期记忆写入", `${result.summary.longTermWriteCount} 条`],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-border px-3 py-2.5 last:border-b-0 sm:border-b-0">
                <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                <p className="mt-1 text-xs font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-border" data-testid="mirofish-naturalness-scenarios">
            {result.scenarios.map((scenario, index) => {
              const rejectedReasons = reasonLabels([...scenario.surface.currentReasons, ...scenario.surface.followUpReasons]);
              const warningReasons = reasonLabels([...scenario.surface.currentWarnings, ...scenario.surface.followUpWarnings]);
              const hasFollowUpEvidence = Boolean(scenario.surface.candidateFollowUp || scenario.surface.finalFollowUp || scenario.surface.followUpStatus === "rejected");
              return (
                <details key={scenario.id} className="group border-b border-border bg-background/25">
                  <summary className="grid cursor-pointer list-none gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {index + 1}. {MATRIX_CATEGORY_LABELS[scenario.category] || scenario.category}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                        {scenario.worldState.clock} · {scenario.worldState.eventText}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {scenario.checkCount} 项检查
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        五 Agent 完整
                      </Badge>
                      <Badge variant={scenario.memory.passed ? "outline" : "destructive"} className="text-[10px]">
                        {scenario.memory.passed ? "无长期记忆写入" : "记忆风险"}
                      </Badge>
                    </span>
                  </summary>

                  <div className="space-y-4 border-t border-border px-3 py-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(13rem,0.9fr)]">
                      <div className="border-l-2 border-primary pl-3">
                        <p className="text-[10px] font-semibold uppercase text-primary">输入后的世界状态</p>
                        <p className="mt-1 text-xs leading-relaxed text-foreground">{scenario.worldState.eventText}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          {scenario.worldState.clock} · 地点：
                          {scenario.worldState.groundedLocation || "未声明"} · 联系边界：
                          {scenario.worldState.contactMode === "remote_only" ? "仅远程联系" : "未限定"}
                        </p>
                      </div>
                      <div className="border-l-2 border-border pl-3">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">五 Agent 裁决</p>
                        <p className="mt-1 text-xs font-semibold text-foreground">
                          胜出：
                          {MATRIX_AGENT_LABELS[scenario.fiveAgent.winner.profileDimension] || scenario.fiveAgent.winner.profileDimension}
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          {scenario.fiveAgent.winner.proposal} · 优先级 {scenario.fiveAgent.winner.priority}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">五个独立提案</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {scenario.fiveAgent.actions.map(action => (
                          <div key={`${scenario.id}-${action.agentId}`} className={`border-l-2 pl-2.5 ${scenario.fiveAgent.winner.agentId === action.agentId ? "border-primary" : "border-border"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[10px] font-semibold text-foreground">{MATRIX_AGENT_LABELS[action.profileDimension] || action.profileDimension}</p>
                              <span className="shrink-0 text-[10px] text-muted-foreground">{action.priority}</span>
                            </div>
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{action.proposal || "仅提供约束，没有表层文案"}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`grid gap-3 ${hasFollowUpEvidence ? "lg:grid-cols-2" : ""}`}>
                      <div className="border-l-2 border-border pl-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground">当前回复：候选与最终文本</p>
                          <Badge variant={scenario.surface.currentStatus === "rejected" ? "destructive" : "outline"} className="text-[10px]">
                            {scenario.surface.currentStatus === "rejected" ? "候选已拒绝" : "候选可用"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">候选：{displayText(scenario.surface.candidateCurrent)}</p>
                        <p className="mt-1 text-xs leading-relaxed text-foreground">最终：{displayText(scenario.surface.finalCurrent)}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{decisionLabel(scenario.surface.currentDecisionSource)}</p>
                      </div>

                      {hasFollowUpEvidence && (
                        <div className="border-l-2 border-border pl-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">后续动作：候选与最终文本</p>
                            <Badge variant={scenario.surface.followUpStatus === "rejected" ? "destructive" : "outline"} className="text-[10px]">
                              {scenario.surface.followUpStatus === "rejected" ? "候选已拒绝" : "候选可用"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            候选：
                            {displayText(scenario.surface.candidateFollowUp)}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-foreground">最终：{displayText(scenario.surface.finalFollowUp)}</p>
                          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{decisionLabel(scenario.surface.followUpDecisionSource)}</p>
                        </div>
                      )}
                    </div>

                    {(rejectedReasons.length > 0 || warningReasons.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {rejectedReasons.map(reason => (
                          <Badge key={`rejected-${reason}`} variant="destructive" className="text-[10px]">
                            拒绝原因：{reason}</Badge>
            ))}
                        {warningReasons.map(reason => (
                          <Badge key={`warning-${reason}`} variant="outline" className="text-[10px]">
                            提醒：{reason}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                      本场景长期记忆写入 {scenario.memory.longTermWriteCount} 条；拦截了 {scenario.memory.blockedWriteCount} 条模拟生活记录。
                    </p>
                  </div>
        </details>
              );
            })}
    </div>
        </>
      )}
    </section>
  );
}

function AgentDeliberationPanel({ probe }: { probe: LivingWorldDeveloperProbe }) {
  const reports = probe.agentDeliberations.length > 0
    ? probe.agentDeliberations
    : probe.dayState.agentDeliberations;
  if (reports.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <BrainCircuit className="h-3.5 w-3.5 text-primary" />
            内部角色怎样形成判断
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            每份记录对应一种候选动作，保留参与角色、判断理由和需要平衡的意见。
          </p>
        </div>
        <Badge variant="outline" className="w-fit text-[10px]">{reports.length} 份判断</Badge>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border/70">
        {reports.map(report => {
          const blockingCount = report.votes.filter(vote => vote.stance === "block").length;
          const guardrailCount = report.votes.filter(vote => vote.stance === "guardrail").length;
          return (
            <details key={report.reportId} className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{displayActionType(report.targetAction)}</Badge>
                    <Badge variant="outline" className="bg-muted/20 text-[10px]">{report.clock}</Badge>
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold leading-5 text-foreground">
                    {displayDeliberationPolicy(report.dominantPolicy)}
                  </span>
                </span>
                <span className="flex flex-wrap items-start justify-end gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{report.votes.length} 个角色</Badge>
                  {blockingCount > 0 && <Badge variant="destructive" className="text-[10px]">{blockingCount} 个阻止</Badge>}
                  {guardrailCount > 0 && <Badge variant="outline" className="text-[10px]">{guardrailCount} 项边界</Badge>}
                  <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <div className="border-t border-border/70 bg-muted/10">
                <div className="divide-y divide-border/70">
                  {report.votes.map((vote, index) => (
                    <div key={`${report.reportId}-${vote.agentId}-${vote.stance}-${index}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[8.5rem_5.5rem_minmax(0,1fr)] sm:items-start">
                      <span title={vote.agentId} className="text-xs font-semibold text-foreground">
                        {SOCIAL_AGENT_LABELS[vote.agentId] ?? vote.agentId}
                      </span>
                      <Badge variant={vote.stance === "block" ? "destructive" : vote.stance === "support" ? "secondary" : "outline"} className="w-fit text-[10px]">
                        {DELIBERATION_STANCE_LABELS[vote.stance] ?? vote.stance}
                      </Badge>
                      <p className="text-xs leading-5 text-foreground">{displayInternalDiagnosticText(vote.rationale)}</p>
                    </div>
                  ))}
                </div>
                {report.conflicts.length > 0 && (
                  <div className="border-t border-amber-500/25 bg-amber-500/8 px-3 py-3">
                    <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">需要平衡的意见</p>
                    <div className="mt-1.5 space-y-1.5">
                      {report.conflicts.map(conflict => (
                        <p key={conflict} className="text-xs leading-5 text-foreground">{displayInternalDiagnosticText(conflict)}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ParallelWorldCard({ comparison }: { comparison: LivingWorldProbeParallelWorld }) {
  const baselinePolicy = comparison.baseline.deliberation?.dominantPolicy;
  const interventionPolicy = comparison.intervention.deliberation?.dominantPolicy;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch className="h-4 w-4 text-primary" />
            {comparison.label}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="bg-muted/25 text-[10px]">seed {comparison.sharedSeedId}</Badge>
            <Badge variant="outline" className="bg-muted/25 text-[10px]">{comparison.clock}</Badge>
            <Badge variant={comparison.delta.changed ? "secondary" : "outline"} className="text-[10px]">
              {comparison.delta.changed ? "delta changed" : "no visible delta"}
            </Badge>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 bg-muted/25 text-[10px]">
          {comparison.interventionEvent.clock} · {comparison.interventionEvent.text}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">{comparison.baseline.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{comparison.baseline.afterApp}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">
            open threads: {comparison.baseline.openThreads.length ? comparison.baseline.openThreads.join(" / ") : "none"}
          </p>
          {baselinePolicy && (
            <Badge variant="outline" className="mt-2 bg-background/50 text-[10px]">{baselinePolicy}</Badge>
          )}
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-primary">{comparison.intervention.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{comparison.intervention.afterApp}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">
            open threads: {comparison.intervention.openThreads.length ? comparison.intervention.openThreads.join(" / ") : "none"}
          </p>
          {interventionPolicy && (
            <Badge variant="secondary" className="mt-2 text-[10px]">{interventionPolicy}</Badge>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{comparison.delta.explanation}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{comparison.whyThisShowsMiroFishValue}</p>
    </div>
  );
}

export default function LivingWorldProbePanel({ personaId }: LivingWorldProbePanelProps) {
  const [inputText, setInputText] = useState(DEFAULT_PROBE_INPUT);
  const [submittedInputText, setSubmittedInputText] = useState(DEFAULT_PROBE_INPUT);
  const [now, setNow] = useState(() => toLocalDatetimeInput());
  const [submittedNow, setSubmittedNow] = useState(now);
  const [timelineEvents, setTimelineEvents] = useState<ProbeTimelineEventDraft[]>([]);
  const [submittedTimelineEvents, setSubmittedTimelineEvents] = useState<ProbeTimelineEventPayload[]>([]);
  const [replayAdvanceMinutes, setReplayAdvanceMinutes] = useState(60);
  const [seed, setSeed] = useState("");
  const [submittedSeed, setSubmittedSeed] = useState("");
  const [preferredAction, setPreferredAction] = useState<"auto" | LivingWorldCandidateActionType>("auto");
  const [submittedPreferredAction, setSubmittedPreferredAction] = useState<"auto" | LivingWorldCandidateActionType>("auto");
  const [miroFishEnabled, setMiroFishEnabled] = useState(false);
  const [submittedMiroFishEnabled, setSubmittedMiroFishEnabled] = useState(false);
  const [resultView, setResultView] = useState<"current" | "reference">("current");

  const probeMutation = trpc.livingWorld.probe.useMutation();
  const probeData = probeMutation.data;
  const submittedTimelineSignature = timelineEventSignature(submittedTimelineEvents);
  const probe = (probeData?.current.inputText?.trim() || "") === submittedInputText
    && timelineEventSignature(probeData?.current.timelineEvents ?? []) === submittedTimelineSignature
    && probeData?.miroFishPersonaWorld.enabled === submittedMiroFishEnabled
    ? probeData
    : undefined;
  const normalizedTimelineEvents = normalizeTimelineEvents(timelineEvents);
  const hasUnsubmittedInput = inputText.trim() !== submittedInputText
    || now !== submittedNow
    || seed.trim() !== submittedSeed
    || preferredAction !== submittedPreferredAction
    || timelineEventSignature(normalizedTimelineEvents) !== submittedTimelineSignature
    || miroFishEnabled !== submittedMiroFishEnabled;
  const isProbePending = probeMutation.isPending;
  const currentInputWillArchive = Boolean(probe?.current.inputText?.trim());
  const currentInputAlreadyArchived = Boolean(probe?.current.inputText?.trim()
    && submittedTimelineEvents.some(event => timelineEventSignature([event]) === timelineEventSignature([{
      clock: probe.current.clock,
      text: probe.current.inputText ?? "",
      type: "user_message",
    },
          ]),
      ),
  );
  const replayWouldOverflow = currentInputWillArchive
    && !currentInputAlreadyArchived
    && submittedTimelineEvents.length >= MAX_TIMELINE_EVENTS;
  const currentReplayDatetime = probe ? toLocalDatetimeInput(new Date(probe.current.now)) : null;
  const nextReplayDatetime = probe ? advanceLocalDatetime(probe.current.now, replayAdvanceMinutes) : null;
  const replayCrossesDay = Boolean(currentReplayDatetime
    && nextReplayDatetime
    && currentReplayDatetime.slice(0, 10) !== nextReplayDatetime.slice(0, 10));
  const nextReplayTime = nextReplayDatetime?.slice(11, 16) ?? null;

  const executeProbe = ({
    inputText: nextInput,
    now: nextNow,
    seed: nextSeed,
    preferredAction: nextPreferredAction,
    timelineEvents: nextTimelineEvents,
    miroFishEnabled: nextMiroFishEnabled,
  }: {
    inputText: string;
    now: string;
    seed: string;
    preferredAction: "auto" | LivingWorldCandidateActionType;
    timelineEvents: ProbeTimelineEventPayload[];
    miroFishEnabled: boolean;
  }) => {
    setResultView("current");
    setSubmittedInputText(nextInput);
    setSubmittedNow(nextNow);
    setSubmittedSeed(nextSeed);
    setSubmittedPreferredAction(nextPreferredAction);
    setSubmittedTimelineEvents(nextTimelineEvents);
    setSubmittedMiroFishEnabled(nextMiroFishEnabled);
    probeMutation.mutate({
      personaId,
      inputText: nextInput || undefined,
      now: nextNow || undefined,
      seed: nextSeed || undefined,
      preferredActionTypes: nextPreferredAction === "auto" ? undefined : [nextPreferredAction],
      miroFishEnabled: nextMiroFishEnabled,
      miroFishAgentMode: "llm",
      recentLimit: 12,
      todayEvents: nextTimelineEvents.length > 0 ? nextTimelineEvents : undefined,
    });
  };

  const runProbe = () => {
    executeProbe({
      inputText: inputText.trim(),
      now,
      seed: seed.trim(),
      preferredAction,
      timelineEvents: normalizeTimelineEvents(timelineEvents),
      miroFishEnabled,
    });
  };

  const addTimelineEvent = () => {
    setTimelineEvents(events => (events.length >= MAX_TIMELINE_EVENTS
      ? events
      : [...events, createTimelineEvent(now)]));
  };

  const updateTimelineEvent = (id: string, patch: Partial<ProbeTimelineEventDraft>) => {
    setTimelineEvents(events => events.map(event => (event.id === id ? { ...event, ...patch } : event)));
  };

  const removeTimelineEvent = (id: string) => {
    setTimelineEvents(events => events.filter(event => event.id !== id));
  };

  const continueReplay = () => {
    if (!probe || probeMutation.isPending || hasUnsubmittedInput || replayWouldOverflow || replayCrossesDay) return;
    const currentInput = probe.current.inputText?.trim();
    const nextTimelineEvents = currentInput
      ? appendTimelineEvent(submittedTimelineEvents, {
        clock: probe.current.clock,
        text: currentInput,
        type: "user_message",
      })
      : submittedTimelineEvents;

    setTimelineEvents(timelinePayloadsToDrafts(nextTimelineEvents));
    setInputText("");
    const nextNow = advanceLocalDatetime(probe.current.now, replayAdvanceMinutes);
    setNow(nextNow);
    executeProbe({
      inputText: "",
      now: nextNow,
      seed: submittedSeed,
      preferredAction: submittedPreferredAction,
      timelineEvents: nextTimelineEvents,
      miroFishEnabled: submittedMiroFishEnabled,
    });
  };

  return (
    <section className="warm-card overflow-hidden p-0">
      <div className="border-b border-border/70 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <BrainCircuit className="h-4 w-4 text-primary" />
            LivingWorld 沙盘探针
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">当前人物 · 最近消息 · 当天时间</p>
        </div>
        <Badge variant="outline" className="gap-1.5 bg-background/70 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            只读检查
          </Badge>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="living-world-probe-input" className="text-sm font-semibold text-foreground">
                这次要推演的消息
              </Label>
            {hasUnsubmittedInput && (
                <Badge variant="outline" className="text-xs">
                  修改尚未运行
                </Badge>
              )}
          </div>
          <Textarea
              id="living-world-probe-input"
              data-testid="living-world-probe-input"
            value={inputText}
            onChange={event => setInputText(event.target.value)}
            rows={3}
            className="min-h-24 resize-y rounded-md border-border bg-background text-sm leading-6 focus-visible:ring-2 focus-visible:ring-primary/35"
            />
        </div>
        <div className="space-y-2" data-testid="living-world-engine-selector">
          <Label className="text-sm font-semibold text-foreground">推演方式</Label>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/35 p-1" role="group" aria-label="推演引擎选择">
              <Button type="button" size="sm" variant={miroFishEnabled ? "secondary" : "ghost"} onClick={() => setMiroFishEnabled(true)} aria-pressed={miroFishEnabled} data-testid="living-world-engine-mirofish" className="h-8 rounded-sm px-2 text-xs">
                <Network className="mr-1.5 h-3.5 w-3.5" />
                MiroFish
              </Button>
              <Button type="button" size="sm" variant={!miroFishEnabled ? "secondary" : "ghost"} onClick={() => setMiroFishEnabled(false)} aria-pressed={!miroFishEnabled} data-testid="living-world-engine-local" className="h-8 rounded-sm px-2 text-xs">
                <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />
                本地
              </Button>
            </div>
            <p className="min-h-9 text-xs leading-relaxed text-muted-foreground">{miroFishEnabled ? "外部 MiroFish · 两个五角色世界" : "本地参考 · 不调用外部服务"}</p>
            <Button size="sm" onClick={runProbe} disabled={probeMutation.isPending} data-testid="living-world-probe-run" className="h-10 w-full rounded-md text-sm font-semibold">
              {probeMutation.isPending ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              {miroFishEnabled ? "运行 MiroFish" : "运行本地参考"}
            </Button>
          </div>
        </div>

        <Accordion type="multiple" defaultValue={timelineEvents.length > 0 ? ["events"] : []} className="border-y border-border/70">
          <AccordionItem value="settings" className="border-border/70">
            <AccordionTrigger className="py-3 text-sm hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pr-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-semibold text-foreground">时间与生成选项</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {now.slice(0, 10)} {now.slice(11, 16)} · {ACTION_TYPE_OPTIONS.find(option => option.value === preferredAction)?.label}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="living-world-probe-now" className="text-xs font-semibold text-foreground">
                    当前时间</Label>
          <Input id="living-world-probe-now" type="datetime-local"
            value={now}
            onChange={event => setNow(event.target.value)}
            className="h-10 rounded-md border-border bg-background text-sm focus-visible:ring-2 focus-visible:ring-primary/35" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="living-world-probe-action" className="text-xs font-semibold text-foreground">动作偏好</Label>
          <select
                    id="living-world-probe-action"
                    value={preferredAction}
            onChange={event => setPreferredAction(event.target.value as "auto" | LivingWorldCandidateActionType)}
            className="h-10 w-full cursor-pointer rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/35"
                  >
            {ACTION_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value} className="bg-card">{option.label}</option>
            ))}
          </select>
      </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="living-world-probe-seed" className="text-xs font-semibold text-foreground">
                    生成种子（可选）
                  </Label>
          <Input
                    id="living-world-probe-seed"
                    value={seed}
            onChange={event => setSeed(event.target.value)}
            placeholder="留空时根据人物资料、日期和最近消息生成"
                    className="h-10 rounded-md border-border bg-background text-sm focus-visible:ring-2 focus-visible:ring-primary/35"
                  />
        </div>
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="events" className="border-b-0" data-testid="living-world-timeline-editor">
          <AccordionTrigger className="py-3 text-sm hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <Activity className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-semibold text-foreground">当天事件</span>
            <Badge variant="outline" className="font-mono text-xs">
                  {timelineEvents.length}/{MAX_TIMELINE_EVENTS}
                </Badge>
              </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">补充今天更早发生、并应影响本次推演的消息或事件。</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addTimelineEvent}
            disabled={timelineEvents.length >= MAX_TIMELINE_EVENTS}
            data-testid="living-world-add-timeline-event"
            className="h-8 rounded-md px-2.5 text-xs"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            添加事件
          </Button>
        </div>

        {timelineEvents.length === 0 ? (
          <p className="mt-3 border-l-2 border-border px-3 py-1 text-xs text-muted-foreground">尚无额外事件，当前输入仍会参与本次推演。</p>
        ) : (
          <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
            {timelineEvents.map((event, index) => (
              <div
                key={event.id}
                data-testid={`living-world-timeline-event-${index}`}
                className="grid gap-2 py-3 sm:grid-cols-[6rem_7rem_minmax(0,1fr)_2.25rem] sm:items-center">
                <Input
                  type="time"
                  value={event.clock}
                  onChange={changeEvent => updateTimelineEvent(event.id, { clock: changeEvent.target.value,
                          })}
                  aria-label={`事件 ${index + 1} 时间`}
                  className="h-9 rounded-md bg-background text-xs"
                      />
                <select
                  value={event.type}
                  onChange={changeEvent => updateTimelineEvent(event.id, { type: changeEvent.target.value as ProbeEventType,
                          })}
                  aria-label={`事件 ${index + 1} 类型`}
                  className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/35"
                      >
                  {(Object.entries(EVENT_TYPE_LABELS) as Array<[ProbeEventType, string]>).map(([value, label]) => (
                    <option key={value} value={value} className="bg-card">{label}</option>
                  ))}
                </select>
                <Input
                  value={event.text}
                  onChange={changeEvent => updateTimelineEvent(event.id, { text: changeEvent.target.value,
                          })}
                  maxLength={500}
                  placeholder="输入该时刻发生的消息或事件"
                  aria-label={`事件 ${index + 1} 内容`}
                  className="h-9 min-w-0 rounded-md bg-background text-sm"
                      />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeTimelineEvent(event.id)}
                  aria-label={`删除事件 ${index + 1}`}
                  title="删除事件"
                  className="h-9 w-9 rounded-md text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {probe && (
          <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-center sm:justify-between" data-testid="living-world-replay-controls">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">继续当天推演</span>
              <Badge variant="outline" className="font-mono text-xs">
                {probe.current.clock} → {nextReplayTime}
              </Badge>
              {hasUnsubmittedInput && (
                <Badge variant="outline" className="text-xs">需先运行修改</Badge>
              )}
            {replayCrossesDay && (
                <Badge variant="outline" className="text-xs">已到当天边界</Badge>
              )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/35 p-1" role="group" aria-label="连续推演时间步长">
              {REPLAY_ADVANCE_OPTIONS.map(option => (
                <Button
                  key={option.minutes}
                  type="button"
                  size="sm"
                  variant={replayAdvanceMinutes === option.minutes ? "secondary" : "ghost"}
                  onClick={() => setReplayAdvanceMinutes(option.minutes)}
                  aria-pressed={replayAdvanceMinutes === option.minutes}
                  data-testid={`living-world-replay-step-${option.minutes}`}
                  className="h-8 rounded-sm px-2 text-xs"
                  >
                  {option.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={continueReplay}
              disabled={probeMutation.isPending || hasUnsubmittedInput || replayWouldOverflow || replayCrossesDay}
              title={replayWouldOverflow
                ? "事件账本已满，无法归档当前输入"
                : replayCrossesDay
                  ? "当前版本只推进同一个自然日"
                  : submittedMiroFishEnabled
                    ? "归档当前输入、推进世界时钟，并再次调用 MiroFish"
                    : "归档当前输入并推进世界时钟"}
              data-testid="living-world-continue-replay"
              className="h-10 rounded-md px-3 text-sm"
              >
              <FastForward className="mr-1.5 h-4 w-4" />
              {submittedMiroFishEnabled ? "继续并运行 MiroFish" : "继续推进"}
            </Button>
          </div>
        </div>
        )}

        {isProbePending && <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          正在生成 LivingWorld 沙盘...
        </div>}

      {probeMutation.error && <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
          {probeMutation.error.message}
        </div>}

      {probe && (
        <div className="space-y-4">
          <div className="grid w-full max-w-md grid-cols-2 gap-1 rounded-md border border-border bg-muted/35 p-1" role="tablist" aria-label="沙盘结果视图">
            <Button
              type="button"
              size="sm"
              variant={resultView === "current" ? "secondary" : "ghost"}
              onClick={() => setResultView("current")}
              data-testid="living-world-probe-current-view"
              aria-pressed={resultView === "current"}
              className="h-9 rounded-sm px-3 text-sm">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              当前输入推演
            </Button>
            <Button
              type="button"
              size="sm"
              variant={resultView === "reference" ? "secondary" : "ghost"}
              onClick={() => setResultView("reference")}
              data-testid="living-world-probe-reference-view"
              aria-pressed={resultView === "reference"}
              className="h-9 rounded-sm px-3 text-sm">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              固定验收样例
            </Button>
          </div>

          {resultView === "current" ? (
            <>
              <div data-testid="living-world-probe-current-input" className="border-l-2 border-primary bg-primary/5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-primary">本次推演输入</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-mono text-xs">{probe.current.clock}</Badge>
                    {probe.current.inputSource && (
                      <Badge variant="outline" className="text-xs">{displayEventSource(probe.current.inputSource)}</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 break-words text-sm leading-6 text-foreground">{displayText(probe.current.inputText)}</p>
              </div>

              {probe.current.timelineEvents.length > 0 && (
                <div data-testid="living-world-probe-timeline-events" className="border-y border-border/70">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">本次事件账本</p>
                    <Badge variant="outline" className="text-xs">{probe.current.timelineEvents.length} 条
                      </Badge>
                  </div>
                  <div className="divide-y divide-border/70">
                    {probe.current.timelineEvents.map((event, index) => (
                      <div key={`${event.clock ?? "now"}-${index}`} className="grid grid-cols-[4.5rem_6rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs">
                        <span className="font-mono text-muted-foreground">{event.clock ?? "当前"}</span>
                        <span className="text-muted-foreground">{EVENT_TYPE_LABELS[event.type ?? "user_message"]}</span>
                        <span className="min-w-0 break-words text-foreground">{event.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {submittedMiroFishEnabled && (
                <>
                  <div className="flex flex-col gap-2 border-l-2 border-primary bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="living-world-active-engine">
                    <div>
                      <p className="text-xs font-semibold text-primary">本次包含 MiroFish 外部推演</p>
                      <p className="mt-1 text-sm text-foreground">改造版 MiroFish · 人物世界接口</p>
                    </div>
                    <Badge variant={probe.miroFishPersonaWorld.status === "success" ? "secondary" : "destructive"} className="w-fit text-xs">
                      {probe.miroFishPersonaWorld.status === "success" ? "外部服务结果已校验" : probe.miroFishPersonaWorld.status}
                    </Badge>
                  </div>
                    <Accordion type="multiple" className="border-y border-border/70">
                      <AccordionItem value="mirofish-agents" className="border-border/70">
                        <AccordionTrigger className="py-3 text-sm hover:no-underline">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                            <Network className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-semibold text-foreground">五类角色判断</span>
                            <Badge variant="outline" className="text-xs">
                              {probe.miroFishPersonaWorld.independentCallCount} 次调用
                            </Badge>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <MiroFishIndependentAgentPanel result={probe.miroFishPersonaWorld} probe={probe} />
                        </AccordionContent>
                  </AccordionItem>
                      <AccordionItem value="mirofish-worlds" className="border-border/70">
                        <AccordionTrigger className="py-3 text-sm hover:no-underline">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                            <GitBranch className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-semibold text-foreground">两个世界的结果差异</span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <MiroFishParallelWorldPanel comparison={probe.miroFishPersonaWorldComparison} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="mirofish-naturalness" className="border-b-0">
                        <AccordionTrigger className="py-3 text-sm hover:no-underline">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-semibold text-foreground">自然度自动场景</span>
                            <Badge variant={probe.miroFishNaturalnessMatrix.status === "success" ? "secondary" : "outline"} className="text-xs">
                              {probe.miroFishNaturalnessMatrix.status === "success" ? "证据可用" : "需要检查"}
                            </Badge>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">
                  <MiroFishNaturalnessMatrixPanel result={probe.miroFishNaturalnessMatrix} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    <div className="border-t border-border pt-4">
                    <p className="text-sm font-semibold text-foreground">书中人 本地参考</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">下面只用于对照，不代表 MiroFish 外部结果。</p>
                  </div>
                </>
              )}

              <ProbeSummary probe={probe} />
              <CurrentDecision probe={probe} />

                <Accordion type="multiple" className="border-y border-border/70" data-testid="living-world-probe-evidence-sections">
                  <AccordionItem value="persona-world" className="border-border/70">
              <AccordionTrigger className="py-3 text-sm hover:no-underline">
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                        <Network className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-semibold text-foreground">人物世界推演依据</span>
                        <Badge variant="outline" className="text-xs">
                          {probe.personaWorldSimulation.rounds.length} 轮
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <PersonaWorldSimulationPanel probe={probe} />
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="agent-deliberation" className="border-border/70">
                    <AccordionTrigger className="py-3 text-sm hover:no-underline">
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                        <BrainCircuit className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-semibold text-foreground">内部角色判断</span>
                        <Badge variant="outline" className="text-xs">
                          {probe.agentDeliberations.length || probe.dayState.agentDeliberations.length} 份
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <AgentDeliberationPanel probe={probe} />
                    </AccordionContent>
                  </AccordionItem>

              <AccordionItem value="day-plan" className="border-b-0">
                <AccordionTrigger className="py-3 text-sm hover:no-underline">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-semibold text-foreground">完整当天时间线</span>
                    <Badge variant="outline" className="text-xs">{probe.dayState.dayPlan.length} 个时段
                        </Badge>
                  </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                  <DayPlan probe={probe} />
                <details className="group border-t border-border/70 pt-3">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="block text-xs font-semibold text-foreground">开发影响范围</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        本次推演结果可能进入的人物作息、回复、主动消息和语音模块。
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{probe.packetAudit.targetModules.length} 个模块</Badge>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {probe.packetAudit.targetModules.map(moduleName => (
                      <Badge key={moduleName} title={moduleName} variant="outline" className="bg-muted/20 text-xs">
                        {TARGET_MODULE_LABELS[moduleName] ?? moduleName}
                      </Badge>
                    ))}
                  </div>
                </details>
              </AccordionContent>
                  </AccordionItem>
                </Accordion>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 border-l-2 border-muted-foreground/40 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">固定回归输入</p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">照片、语音、疲惫和主动履约的受控反事实样例。</p>
                </div>
                <Badge variant="outline" className="w-fit text-xs">
                    独立固定样例
                  </Badge>
              </div>

              {probe.referenceSuite.parallelWorlds.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">同一种子下的两个世界</h3>
                    <Badge variant="outline" className="text-xs">{probe.referenceSuite.parallelWorlds.length} 组
                      </Badge>
                  </div>
                  {probe.referenceSuite.parallelWorlds.map(comparison => (
                    <ParallelWorldCard key={comparison.comparisonId} comparison={comparison} />
                  ))}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">前后结果小场景</h3>
                  <Badge variant="outline" className="text-xs">{probe.referenceSuite.scenes.length} 个
                    </Badge>
                </div>
                <div className="space-y-3">
                  {probe.referenceSuite.scenes.map(scene => (
                    <SceneCard key={scene.sceneId} scene={scene} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </section>
  );
}
