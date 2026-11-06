import { and, eq, inArray, isNull } from "drizzle-orm";
import { channelBindings, personas, reminderDeliveries } from "../../drizzle/schema";
import { proactivePolicies } from "../../drizzle/proactive-schema";
import { ENV } from "../_core/env";
import { getDb, lockQqChannelConfig, type DbTransaction } from "../db";
import { isQuiet, localClock } from "../proactive/policy";
import type { Reminder } from "./reminders";

const PENDING = "dispatch_pending";
const STARTED = "dispatch_started";

type CalendarPolicy = { revision: number; timeZone: string; quietHours: string };
type LegacyChannel = "wechat" | "feishu";
type Route = { channel: LegacyChannel; targetId: string; send: () => Promise<boolean> };
type Receipt = "confirmed" | "failed" | "unknown";
export interface ReminderDeliveryInput {
  userId: number;
  reminder: Reminder;
  now: Date;
  signal?: AbortSignal;
}

export function reminderDay(now: Date, timeZone?: string): string {
  if (timeZone) return localClock(now, timeZone).day;
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isQuietHour(now: Date, spec: string): boolean {
  const match = /^([0-9]{1,2}):([0-9]{2}) *- *([0-9]{1,2}):([0-9]{2})$/.exec(spec.trim().replace(/\s/g, " "));
  if (!match) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function reminderIsQuiet(now: Date, policy: CalendarPolicy | null): boolean {
  return policy && policy.revision > 0 ? isQuiet(now, policy) : isQuietHour(now, ENV.reminderQuietHours);
}

interface ReminderDeliveryStore {
  recordWeb(input: ReminderDeliveryInput): Promise<boolean>;
  reserve(input: ReminderDeliveryInput, route: Route): Promise<number | null>;
  start(input: ReminderDeliveryInput, route: Route, id: number, initiate: () => Promise<boolean>): Promise<{ completion: Promise<boolean> } | null>;
  settle(input: ReminderDeliveryInput, id: number, status: Receipt, reason: string): Promise<boolean>;
}

async function untilStopped(completion: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return completion;
  if (signal.aborted) return false;
  let abort!: () => void;
  const stopped = new Promise<boolean>(resolve => { abort = () => resolve(false); });
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([completion, stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function createReminderDelivery(store: ReminderDeliveryStore) {
  return async (input: ReminderDeliveryInput, route?: Route): Promise<boolean> => {
    if (input.signal?.aborted) return false;
    if (!route) return store.recordWeb(input);
    const id = await store.reserve(input, route);
    if (id === null) return false;
    let initiated = false;
    let status: Receipt = "failed";
    let reason = "preflight_rejected";
    try {
      const started = await store.start(input, route, id, () => {
        initiated = true;
        try { return Promise.resolve(route.send()).then(result => result === true, () => false); }
        catch { return Promise.resolve(false); }
      });
      if (initiated) {
        const confirmed = started && await untilStopped(started.completion, input.signal);
        status = confirmed ? "confirmed" : "unknown";
        reason = confirmed ? "adapter_confirmed" : "dispatch_unconfirmed";
      } else if (input.signal?.aborted) {
        reason = "scheduler_stopped";
      }
    } catch {
      if (initiated) {
        status = "unknown";
        reason = "dispatch_unconfirmed";
      }
    }
    try {
      const saved = await store.settle(input, id, status, reason);
      return saved && status === "confirmed";
    } catch {
      // The durable reservation is still unknown; never try the send again.
      return false;
    }
  };
}

async function lockedCalendar(tx: DbTransaction, input: ReminderDeliveryInput): Promise<{ policy: CalendarPolicy | null } | null> {
  await lockQqChannelConfig(tx, input.userId);
  const [persona] = await tx.select({ remindersEnabled: personas.remindersEnabled, graduationStatus: personas.graduationStatus })
    .from(personas).where(and(eq(personas.id, input.reminder.personaId), eq(personas.userId, input.userId),
      eq(personas.analysisStatus, "ready"))).limit(1).for("share");
  if (!persona?.remindersEnabled || persona.graduationStatus === "graduated" || input.signal?.aborted) return null;
  const [policy] = await tx.select({
    revision: proactivePolicies.revision, timeZone: proactivePolicies.timeZone, quietHours: proactivePolicies.quietHours,
  }).from(proactivePolicies).where(and(eq(proactivePolicies.userId, input.userId),
    eq(proactivePolicies.personaId, input.reminder.personaId))).limit(1).for("share");
  return { policy: policy ?? null };
}

function mayDispatch(input: ReminderDeliveryInput, policy: CalendarPolicy | null, time: Date): boolean {
  if (input.signal?.aborted || reminderIsQuiet(time, policy)) return false;
  const timeZone = policy && policy.revision > 0 ? policy.timeZone : undefined;
  return input.reminder.dedupeKey.endsWith(`:${reminderDay(time, timeZone)}`);
}

function identity(input: ReminderDeliveryInput, id: number) {
  return and(eq(reminderDeliveries.id, id), eq(reminderDeliveries.userId, input.userId),
    eq(reminderDeliveries.personaId, input.reminder.personaId), eq(reminderDeliveries.dedupeKey, input.reminder.dedupeKey));
}

function reminderValues(input: ReminderDeliveryInput) {
  const { personaId, kind, text, dedupeKey } = input.reminder;
  return { userId: input.userId, personaId, kind, text, dedupeKey, scheduledFor: input.now };
}

export function createDatabaseReminderDeliveryStore(now = () => new Date()): ReminderDeliveryStore {
  return {
    async recordWeb(input) {
      const db = await getDb();
      if (!db || input.signal?.aborted) return false;
      return db.transaction(async tx => {
        const locked = await lockedCalendar(tx, input);
        const time = now();
        if (!locked || !mayDispatch(input, locked.policy, time)) return false;
        const [row] = await tx.insert(reminderDeliveries).values({
          ...reminderValues(input), channel: "web", status: "confirmed", reason: "web_inbox", deliveredAt: time,
        }).onConflictDoNothing({ target: [reminderDeliveries.userId, reminderDeliveries.dedupeKey] }).returning({ id: reminderDeliveries.id });
        input.signal?.throwIfAborted();
        return Boolean(row);
      });
    },

    async reserve(input, route) {
      const db = await getDb();
      if (!db || input.signal?.aborted) return null;
      return db.transaction(async tx => {
        const locked = await lockedCalendar(tx, input);
        if (!locked || !mayDispatch(input, locked.policy, now())) return null;
        const [row] = await tx.insert(reminderDeliveries).values({
          ...reminderValues(input), channel: route.channel, status: "unknown", reason: PENDING,
        }).onConflictDoNothing({ target: [reminderDeliveries.userId, reminderDeliveries.dedupeKey] }).returning({ id: reminderDeliveries.id });
        return row?.id ?? null;
      });
    },

    async start(input, route, id, initiate) {
      const db = await getDb();
      if (!db || input.signal?.aborted) return null;
      return db.transaction(async tx => {
        const locked = await lockedCalendar(tx, input);
        if (!locked) return null;
        const [binding] = await tx.select({ id: channelBindings.id }).from(channelBindings).where(and(
          eq(channelBindings.userId, input.userId), eq(channelBindings.personaId, input.reminder.personaId),
          eq(channelBindings.channel, route.channel), eq(channelBindings.targetId, route.targetId), eq(channelBindings.isActive, true),
        )).limit(1).for("share");
        if (!binding || !mayDispatch(input, locked.policy, now())) return null;
        const [reserved] = await tx.update(reminderDeliveries).set({ reason: STARTED }).where(and(
          identity(input, id), eq(reminderDeliveries.channel, route.channel), eq(reminderDeliveries.status, "unknown"),
          eq(reminderDeliveries.reason, PENDING), isNull(reminderDeliveries.dismissedAt),
        )).returning({ id: reminderDeliveries.id });
        if (!reserved || !mayDispatch(input, locked.policy, now())) return null;
        // Return an object: the transaction does not adopt or wait for the adapter promise.
        return { completion: initiate() };
      });
    },

    async settle(input, id, status, reason) {
      const db = await getDb();
      if (!db) return false;
      const [row] = await db.update(reminderDeliveries).set({ status, reason, deliveredAt: status === "confirmed" ? now() : null })
        .where(and(identity(input, id), eq(reminderDeliveries.status, "unknown"),
          status === "confirmed" ? eq(reminderDeliveries.reason, STARTED) : inArray(reminderDeliveries.reason, [PENDING, STARTED])))
        .returning({ id: reminderDeliveries.id });
      return Boolean(row);
    },
  };
}

export const persistReminderDelivery = createReminderDelivery(createDatabaseReminderDeliveryStore());
