/**
 * Proactive reminders.
 *
 * The product document describes "memory triggers" — the app reaching out
 * when a date comes round, rather than only when the user opens it. This
 * module decides what is worth saying and when; `server/scheduler/index.ts`
 * runs it on a tick.
 */
import * as db from "../db";
import { getChannelAdapter } from "../channels";
import { proactiveRepository } from "../proactive";
import type { ProactivePolicy } from "../proactive/types";
import { persistReminderDelivery, reminderDay, reminderIsQuiet } from "./reminder-delivery";
export { isQuietHour } from "./reminder-delivery";

export type ReminderKind = "anniversary" | "together_years" | "memory_trigger";

export interface Reminder {
  kind: ReminderKind;
  personaId: number;
  personaName: string;
  /** A stable key for today — the same reminder is only delivered once. */
  dedupeKey: string;
  /** The text to deliver. */
  text: string;
}

/** Date-only settings are calendar dates, not midnight UTC instants. */
function parseStartDate(value: string, timeZone?: string): { year: number; month: number; day: number } | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return null;
    return { year, month, day };
  }

  // Legacy timestamps describe instants in the chosen calendar.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = reminderDay(parsed, timeZone).split("-").map(Number);
  return { year, month, day };
}

/**
 * Works out which reminders are due for a persona today.
 */
export function collectReminders(params: {
  persona: { id: number; name: string; togetherFrom: string | null; remindersEnabled: boolean };
  anniversaries: Array<{ id: number; title: string; date: string | null }>;
  /** Photos the user shared, each with whatever was extracted from it. */
  photos?: Array<{ id: number; originalName: string; extractedMemory: string | null; createdAt: Date }>;
  now?: Date;
  timeZone?: string;
}): Reminder[] {
  const now = params.now ?? new Date();
  const reminders: Reminder[] = [];

  if (!params.persona.remindersEnabled) return reminders;

  const dayKey = reminderDay(now, params.timeZone);
  const monthDay = dayKey.slice(5, 10); // Local MM-DD, shared by all reminder kinds.

  for (const anniversary of params.anniversaries) {
    if (!anniversary.date) continue;
    const date = anniversary.date.trim();
    // Either "MM-DD" (a yearly anniversary) or a full date.
    const matches =
      date === monthDay ||
      (date.length >= 10 && date.slice(5, 10) === monthDay) ||
      date === dayKey;
    if (!matches) continue;

    reminders.push({
      kind: "anniversary",
      personaId: params.persona.id,
      personaName: params.persona.name,
      dedupeKey: `anniversary:${anniversary.id}:${dayKey}`,
      text: `今天是「${anniversary.title}」的日子。`,
    });
  }

  const from = params.persona.togetherFrom?.trim();
  if (from) {
    const start = parseStartDate(from, params.timeZone);
    if (start) {
      const years = Number(dayKey.slice(0, 4)) - start.year;
      // Match the whole local day. February 29 has no implicit replacement in a non-leap year.
      if (monthDay === `${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}` && years > 0) {
        reminders.push({
          kind: "together_years",
          personaId: params.persona.id,
          personaName: params.persona.name,
          dedupeKey: `together_years:${params.persona.id}:${dayKey}`,
          text: `今天是你和 ${params.persona.name} 认识的第 ${years} 年。`,
        });
      }
    }
  }

  // A photo the user shared can carry its own date. When that date comes
  // round again, the persona has something to say about it.
  for (const photo of params.photos ?? []) {
    const label = photo.originalName?.trim() || "那张照片";
    const date = photoCalendarDate(photo.extractedMemory, photo.createdAt, params.timeZone);
    if (!date) continue;

    const matches =
      date === monthDay ||
      (date.length >= 10 && date.slice(5, 10) === monthDay) ||
      date === dayKey;
    if (!matches) continue;

    reminders.push({
      kind: "memory_trigger",
      personaId: params.persona.id,
      personaName: params.persona.name,
      dedupeKey: `memory_trigger:${photo.id}:${dayKey}`,
      text: `今天可以和 ${params.persona.name} 一起回顾你分享过的「${label}」。`,
    });
  }

  return reminders;
}

/**
 * Finds the date a photo belongs to.
 *
 * The extracted text usually mentions it ("2021-05-20 在海边"); when it does
 * not, the upload date is used only to schedule a reminder.
 */
export function extractPhotoDate(
  extractedMemory: string | null | undefined,
  createdAt: Date,
): string | null {
  return photoCalendarDate(extractedMemory, createdAt);
}

function photoCalendarDate(extractedMemory: string | null | undefined, createdAt: Date, timeZone?: string): string | null {
  if (extractedMemory) {
    const match = extractedMemory.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/);
    if (match) return match[0];
  }
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return null;
  return reminderDay(createdAt, timeZone);
}

type CalendarPolicy = Pick<ProactivePolicy, "revision" | "timeZone" | "quietHours">;

export async function deliverReminder(params: {
  userId: number;
  reminder: Reminder;
  targetId?: string | null;
  channel?: string | null;
  now?: Date;
  signal?: AbortSignal;
  policy?: CalendarPolicy;
}): Promise<boolean> {
  const { userId, reminder, channel, targetId, signal } = params;
  const now = params.now ?? new Date();
  if (signal?.aborted) return false;
  const policy = params.policy ?? await proactiveRepository.getPolicy(userId, reminder.personaId);
  if (signal?.aborted || reminderIsQuiet(now, policy)) return false;
  const input = { userId, reminder, now, signal };
  if ((channel === "wechat" || channel === "feishu") && targetId) {
    const adapter = getChannelAdapter(channel);
    if (adapter) {
      return persistReminderDelivery(input, {
        channel, targetId,
        async send() {
          // WeChat resolves only after sendWeixinText reports success. Feishu's
          // adapter does not expose an application-level receipt.
          await adapter.send(userId, targetId, reminder.text);
          return channel === "wechat";
        },
      });
    }
  }
  // A missing legacy route (including QQ-only bindings) keeps the web card.
  return persistReminderDelivery(input);
}

export async function runReminderSweep(now = new Date(), signal?: AbortSignal): Promise<number> {
  let delivered = 0;
  if (signal?.aborted) return delivered;
  try {
    const people = await db.getAllPersonasForReminders();
    for (const persona of people) {
      if (signal?.aborted) break;
      try {
        const policy = await proactiveRepository.getPolicy(persona.userId, persona.id);
        if (signal?.aborted) break;
        if (reminderIsQuiet(now, policy)) continue;
        const anniversaries = await db.getMemoriesByPersonaId(persona.id, persona.userId);
        if (signal?.aborted) break;
        const files = await db.getFilesByPersonaId(persona.id, persona.userId);
        if (signal?.aborted) break;
        const reminders = collectReminders({
          persona,
          anniversaries: anniversaries.filter(m => m.category === "anniversary").map(m => ({ id: m.id, title: m.title, date: m.date })),
          photos: files.filter(f => f.fileType === "image").map(f => ({
            id: f.id, originalName: f.originalName, extractedMemory: f.extractedMemory, createdAt: f.createdAt,
          })),
          now, timeZone: policy.revision > 0 ? policy.timeZone : undefined,
        });
        if (!reminders.length) continue;
        const bindings = await db.getChannelBindingsByUserId(persona.userId);
        if (signal?.aborted) break;
        const binding = bindings.find(b => b.isActive && b.personaId === persona.id && (b.channel === "wechat" || b.channel === "feishu"));
        for (const reminder of reminders) {
          if (signal?.aborted) break;
          if (await deliverReminder({ userId: persona.userId, reminder, channel: binding?.channel,
            targetId: binding?.targetId, now, policy, signal })) delivered++;
        }
      } catch (error) {
        if (!signal?.aborted && (!(error instanceof Error) || !("code" in error) || error.code !== "NOT_FOUND")) {
          console.warn("[Reminders] 未能处理一项纪念提醒。");
        }
      }
    }
  } catch {
    if (!signal?.aborted) console.warn("[Reminders] 未能读取待处理的纪念提醒。");
  }
  return delivered;
}
