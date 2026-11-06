import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { personaRuntimeStates, type PersonaRuntimeStateRow } from "../../drizzle/runtime-state-schema";
import { personas } from "../../drizzle/schema";
import { getDb, getMemoriesByPersonaId } from "../db";
import { getLlmUsageSnapshot } from "../llm/usage";
import { eligibleRealityMemories } from "../memory-review";
import { sourceLibraryService } from "../source-library";
import { localClock } from "./policy";
import type { ProactiveJob, ProactivePolicy } from "./types";

const MAX_STATE_DURATION = 24 * 60 * 60 * 1000;
const MAX_STATUS_LENGTH = 200;
const MAX_REVISION = 2_147_483_647;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EVENT_TYPES = ["user_message", "scheduled_event", "system_observation"] as const;

type DayKind = "weekday" | "saturday" | "sunday";
type Availability = "silent_unless_urgent" | "brief" | "normal" | "open" | "unknown";
type EventType = typeof EVENT_TYPES[number];
type RuntimeEvent = { clock?: string; text: string; type?: EventType };

type RoutineSlot = {
  stateId: string;
  start: string;
  end: string;
  label: string | null;
  status: string | null;
  availability: Availability;
  behavior: string | null;
  description: string | null;
};

export type RuntimeScheduleState = {
  timeZone: string | null;
  dateKey: string | null;
  timeKey: string | null;
  dayKind: DayKind | "unknown";
  source: "configured_routine" | "unconfigured";
} & {
  [Key in keyof RoutineSlot]: Key extends "start" | "end" ? string | null : RoutineSlot[Key];
};

export type RuntimeLifeState = {
  status: string;
  startedAt: string;
  expiresAt: string;
  /** 兼容人物运行态面板；与 expiresAt 表示同一绝对时刻。 */
  until: string;
  source: "user";
  revision: number;
};

export type RuntimeStateView = {
  runtimeLifeState: RuntimeLifeState | null;
  runtimeStateRevision: number;
};

export type RuntimeStateInput = { id: number; status: string; expiresAt: string; expectedRevision: number };
export type RuntimeStateClearInput = { id: number; expectedRevision: number };
export type RuntimeProbeInput = { personaId: number; now?: string; inputText?: string; todayEvents?: RuntimeEvent[]; seed?: string };

type RuntimeDependencies = {
  getPolicy?(userId: number, personaId: number): Promise<ProactivePolicy>;
  listProactiveJobs?(userId: number, personaId: number): Promise<ProactiveJob[]>;
  now?(): Date;
};

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? Array.from(text).slice(0, limit).join("") : null;
}

function asAvailability(value: unknown): Availability {
  return value === "silent_unless_urgent" || value === "brief" || value === "normal" || value === "open" ? value : "unknown";
}

function minutes(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function routineSlots(routines: Record<string, unknown>, kind: DayKind): RoutineSlot[] {
  const slots = routines[kind];
  if (!Array.isArray(slots)) return [];
  return slots.slice(0, 96).flatMap(raw => {
    const slot = asRecord(raw);
    if (typeof slot.start !== "string" || typeof slot.end !== "string" || !CLOCK.test(slot.start)
      || !(CLOCK.test(slot.end) || slot.end === "24:00") || slot.start === slot.end) return [];
    return [{ start: slot.start, end: slot.end,
      stateId: optionalText(slot.stateId, 80) ?? "configured_slot", label: optionalText(slot.label, 100),
      status: optionalText(slot.status, 100), availability: asAvailability(slot.availability),
      behavior: optionalText(slot.behavior, 400), description: optionalText(slot.description, 400) }];
  });
}

function dayKind(weekday: number): DayKind {
  return weekday === 0 ? "sunday" : weekday === 6 ? "saturday" : "weekday";
}

function configuredClock(now: Date, timeZone: string | null): ReturnType<typeof localClock> | null {
  if (!timeZone || !Number.isFinite(now.getTime())) return null;
  try { return localClock(now, timeZone); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}

/** 作息配置是角色设定；按该用户已保存时区推算，不声称观察到实际活动。 */
export function previewRuntimeSchedule(personaData: unknown, now: Date, timeZone: string | null): RuntimeScheduleState {
  const clock = configuredClock(now, timeZone);
  const day = clock ? new Date(`${clock.day}T00:00:00.000Z`).getUTCDay() : null;
  const kind = day === null || !Number.isFinite(day) ? null : dayKind(day);
  const base = { timeZone: clock ? timeZone : null, dateKey: clock?.day ?? null, timeKey: clock?.hhmm ?? null };
  if (clock && day !== null && kind !== null) {
    const life = asRecord(asRecord(asRecord(personaData).profileSections).life);
    const routines = asRecord(life.routines);
    const minute = clock.minuteOfDay;
    const slot = routineSlots(routines, kind).find(({ start, end }) => {
      const from = minutes(start), to = minutes(end);
      return minute >= from && (from > to || minute < to);
    }) ?? routineSlots(routines, dayKind((day + 6) % 7)).find(({ start, end }) =>
      minutes(start) > minutes(end) && minute < minutes(end));
    if (slot) return { ...base, ...slot, dayKind: kind, source: "configured_routine" };
  }
  return { ...base, dayKind: kind ?? "unknown", source: "unconfigured", stateId: "unknown", label: null,
    start: null, end: null, status: null, availability: "unknown", behavior: null, description: null };
}

function parseInstant(value: string, message: string): Date {
  const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,3})?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.exec(value);
  if (!parts) return badRequest(message);
  const calendarDay = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00Z`);
  const parsed = new Date(value);
  if (!Number.isFinite(calendarDay.getTime()) || !Number.isFinite(parsed.getTime())
    || calendarDay.toISOString().slice(0, 10) !== `${parts[1]}-${parts[2]}-${parts[3]}`) return badRequest(message);
  return parsed;
}

export function validateRuntimeStateDraft(input: Pick<RuntimeStateInput, "status" | "expiresAt">, now: Date) {
  const status = input.status.trim();
  if (!status || Array.from(status).length > MAX_STATUS_LENGTH || status.includes("\0")) {
    return badRequest("临时状态须为 1 到 200 个字符，且不得含空字符。");
  }
  const expiresAt = parseInstant(input.expiresAt, "请提供有效且包含时区的过期时间。");
  const duration = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_STATE_DURATION) return badRequest("临时状态须在未来 24 小时内到期。");
  return { status, startedAt: now, expiresAt, source: "user" as const };
}

export function projectRuntimeState(row: PersonaRuntimeStateRow | null | undefined, now: Date): RuntimeStateView {
  const runtimeStateRevision = row?.revision ?? 0;
  if (!row?.status || row.source !== "user" || !row.startedAt || !row.expiresAt || row.expiresAt <= now) {
    return { runtimeLifeState: null, runtimeStateRevision };
  }
  const expiresAt = row.expiresAt.toISOString();
  return { runtimeStateRevision, runtimeLifeState: {
    status: row.status, startedAt: row.startedAt.toISOString(), expiresAt, until: expiresAt, source: row.source, revision: row.revision,
  } };
}

/** 模拟输入只在这个对象内存在，不调用任何生成器、任务仓储或写入路径。 */
export function buildRuntimePreview(input: {
  personaId: number; personaName: string; personaData: unknown; now: Date; timeZone: string | null;
  inputText?: string; todayEvents?: RuntimeEvent[]; seed?: string;
}) {
  const { personaId, personaName, now, timeZone } = input;
  if (!Number.isFinite(now.getTime())) return badRequest("推演时间无效。");
  if (input.todayEvents && input.todayEvents.length > 12) return badRequest("一次推演最多 12 条模拟事件。");
  if (input.inputText && Array.from(input.inputText).length > 500) return badRequest("推演输入最多 500 个字符。");
  if (input.seed && Array.from(input.seed).length > 120) return badRequest("推演标识最多 120 个字符。");
  const scheduleState = previewRuntimeSchedule(input.personaData, now, timeZone);
  const timelineEvents = (input.todayEvents ?? []).map(event => {
    const text = event.text.trim();
    if (!text || Array.from(text).length > 500 || (event.clock !== undefined && !CLOCK.test(event.clock))
      || (event.type !== undefined && !EVENT_TYPES.includes(event.type))) return badRequest("模拟事件的文字、时间或类型无效。");
    return { clock: event.clock, text, type: event.type ?? "user_message", source: "simulated_input" as const };
  });
  return {
    simulated: true as const, persisted: false as const, personaId, personaName, timeZone: scheduleState.timeZone, scheduleState,
    current: { now: now.toISOString(), clock: scheduleState.timeKey, inputText: input.inputText?.trim() ?? "", timelineEvents },
    seed: input.seed?.trim() || null,
    note: "只根据已配置作息与本次模拟输入试算；不会写入状态、日程、消息或记忆。",
  };
}

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "暂时无法读取人物运行态。" });
  return db;
}

async function readOwnedSnapshot(userId: number, personaId: number) {
  const db = await database();
  const [snapshot] = await db.select({
    persona: { id: personas.id, name: personas.name, data: personas.personaData, emotionalState: personas.emotionalState },
    runtime: personaRuntimeStates,
  }).from(personas).leftJoin(personaRuntimeStates, and(eq(personas.id, personaRuntimeStates.personaId), eq(personas.userId, personaRuntimeStates.userId)))
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!snapshot) throw new TRPCError({ code: "NOT_FOUND", message: "人物不存在。" });
  return snapshot;
}

function policyTimeZone(policy: ProactivePolicy | null): string | null {
  return policy && policy.revision > 0 ? policy.timeZone : null;
}

function runtimeProactiveDiagnostics(policy: ProactivePolicy | null, jobs: ProactiveJob[], now: Date) {
  const savedTimeZone = policyTimeZone(policy);
  const timeZone = configuredClock(now, savedTimeZone) ? savedTimeZone : null;
  const scheduled = jobs.filter(job => job.kind === "scheduled");
  const lastSent: Record<string, string> = {};
  for (const job of scheduled.filter(job => job.status === "confirmed").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
    const slot = configuredClock(job.dueAt, timeZone);
    if (slot) lastSent[slot.hhmm] = slot.day;
  }
  const next = jobs.filter(job => ["pending", "generating", "ready"].includes(job.status) && job.expiresAt > now)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  return {
    proactiveRuntime: { randomizedSchedule: null, lastSent, ambientPresence: null, timeZone,
      nextDueAt: next?.dueAt.toISOString() ?? null,
      jobs: jobs.slice(0, 20).map(job => ({ id: job.id, kind: job.kind, status: job.status, dueAt: job.dueAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(), attemptedAt: job.attemptedAt?.toISOString() ?? null })) },
    proactiveSettings: { enabled: policy?.enabled ?? false, times: policy?.times ?? [],
      configuredSlotCount: policy?.times.length ?? 0, stylePromptConfigured: !!policy?.stylePrompt,
      stylePromptPreview: optionalText(policy?.stylePrompt, 160), timeZone, delivery: policy?.delivery ?? "web" as const },
  };
}

export function createPersonaRuntimeService(deps: RuntimeDependencies = {}) {
  const clock = deps.now ?? (() => new Date());
  const policyFor = (userId: number, personaId: number) => deps.getPolicy?.(userId, personaId) ?? Promise.resolve(null);
  async function mutate(userId: number, input: RuntimeStateClearInput, set?: RuntimeStateInput) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > MAX_REVISION) {
      return badRequest("临时状态版本无效。");
    }
    const db = await database();
    return db.transaction(async tx => {
      // 以人物行序列化首写与清空；外键也保证不存在跨账号状态行。
      const [owned] = await tx.select({ id: personas.id }).from(personas)
        .where(and(eq(personas.id, input.id), eq(personas.userId, userId))).limit(1).for("update");
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "人物不存在。" });
      const scope = and(eq(personaRuntimeStates.userId, userId), eq(personaRuntimeStates.personaId, input.id));
      const [prior] = await tx.select().from(personaRuntimeStates).where(scope).limit(1);
      const now = clock();
      const revision = prior?.revision ?? 0;
      if (input.expectedRevision !== revision) throw new TRPCError({ code: "CONFLICT", message: "临时状态已更新，请刷新后再操作。" });
      if (revision === MAX_REVISION) throw new TRPCError({ code: "CONFLICT", message: "临时状态版本已达上限。" });
      const fields = set ? validateRuntimeStateDraft(set, now) : { status: null, startedAt: null, expiresAt: null, source: null };
      const next = { ...fields, revision: revision + 1 };
      const [saved] = await tx.insert(personaRuntimeStates).values({ userId, personaId: input.id, ...next })
        .onConflictDoUpdate({ target: [personaRuntimeStates.userId, personaRuntimeStates.personaId], set: next }).returning();
      return projectRuntimeState(saved, now);
    });
  }

  return {
    async getRuntimeStateForChat(userId: number, personaId: number): Promise<RuntimeStateView> {
      const snapshot = await readOwnedSnapshot(userId, personaId);
      return projectRuntimeState(snapshot.runtime, clock());
    },
    async getRuntimeState(userId: number, personaId: number) {
      const { persona, runtime } = await readOwnedSnapshot(userId, personaId);
      const now = clock();
      const [policy, jobs, sourceOverview, memories] = await Promise.all([
        policyFor(userId, personaId), deps.listProactiveJobs?.(userId, personaId) ?? Promise.resolve([]),
        sourceLibraryService.overview(userId, personaId),
        getMemoriesByPersonaId(personaId, userId).then(rows => eligibleRealityMemories(rows, userId, personaId)),
      ]);
      const recent = memories.filter(memory => memory.lastRecalledAt !== null)
        .sort((a, b) => (b.lastRecalledAt?.getTime() ?? 0) - (a.lastRecalledAt?.getTime() ?? 0)).slice(0, 6);
      const { proactiveRuntime, proactiveSettings } = runtimeProactiveDiagnostics(policy, jobs, now);
      return {
        personaId: persona.id, name: persona.name, emotionalState: persona.emotionalState,
        scheduleState: previewRuntimeSchedule(persona.data, now, policyTimeZone(policy)),
        ...projectRuntimeState(runtime, now),
        runtimeStorage: "dedicated" as const, runtimeDiagnostics: null, personaDataKeys: Object.keys(asRecord(persona.data)).sort(),
        personaRuntime: { proactiveMessages: proactiveRuntime }, outputStrategy: { proactiveMessages: proactiveSettings },
        sourceLibrary: sourceOverview.stats,
        memoryStats: { active: memories.length, highImportance: memories.filter(memory => (memory.importance ?? 3) >= 4).length,
          lowConfidence: memories.filter(memory => (memory.confidence ?? 3) <= 2).length, recentlyAccessed: recent.length },
        recentlyAccessedMemories: recent.map(({ id, title, description, importance, confidence, lastRecalledAt }) =>
          ({ id, title, description, importance, confidence, lastRecalledAt })),
        llmUsage: getLlmUsageSnapshot(now, { userId, personaId }),
        architecture: { runtimeLifeState: "独立临时状态，仅当前账号可读写", scheduleState: "只推算已配置作息，不记录为事实", llmUsage: "当前人物在此进程内的用量" },
      };
    },
    setRuntimeState(userId: number, input: RuntimeStateInput) {
      return mutate(userId, input, input);
    },
    clearRuntimeState(userId: number, input: RuntimeStateClearInput) {
      return mutate(userId, input);
    },
    async probe(userId: number, input: RuntimeProbeInput) {
      const { persona } = await readOwnedSnapshot(userId, input.personaId);
      const policy = await policyFor(userId, input.personaId);
      const now = input.now === undefined ? clock() : parseInstant(input.now, "请提供有效且包含时区的推演时间。");
      return buildRuntimePreview({ ...input, personaId: persona.id, personaName: persona.name, personaData: persona.data, timeZone: policyTimeZone(policy), now });
    },
  };
}

export const personaRuntimeService = createPersonaRuntimeService();
export type PersonaRuntimeView = Awaited<ReturnType<typeof personaRuntimeService.getRuntimeState>>;
export type RuntimePreview = ReturnType<typeof buildRuntimePreview>;
