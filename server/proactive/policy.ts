import type { ProactiveSettings } from "./types";

const MINUTE = 60_000;
const HHMM = "(?:[01][0-9]|2[0-3]):[0-5][0-9]";
const timePattern = new RegExp(`^${HHMM}$`);
const quietPattern = new RegExp(`^${HHMM}-${HHMM}$`);

const emptyTimes: string[] = [];
Object.freeze(emptyTimes);
export const defaultSettings: Readonly<ProactiveSettings> = Object.freeze({
  enabled: false,
  times: emptyTimes,
  stylePrompt: "",
  timeZone: "UTC",
  quietHours: "23:00-08:00",
  maxPerLocalDay: 3,
  minIntervalMinutes: 120,
  delivery: "web",
  ambientEnabled: false,
});

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  // Intl also accepts numeric offsets; a policy needs a named zone with calendar rules.
  if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(timeZone) || timeZone.trim() !== timeZone) {
    throw new RangeError("时区必须是有效的 IANA 时区。");
  }
  const key = timeZone.toLowerCase();
  let format = formatters.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      throw new RangeError("时区必须是有效的 IANA 时区。");
    }
    formatters.set(key, format);
  }
  return format;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length === 5 && timePattern.test(value);
}

function validInteger(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
}

export function validateSettings(input: unknown): ProactiveSettings {
  if (input === null || typeof input !== "object" ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError("主动消息设置必须是对象。");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (!Object.hasOwn(defaultSettings, key)) throw new TypeError("主动消息设置包含未知字段。");
  }
  const settings: Record<keyof ProactiveSettings, unknown> = { ...defaultSettings, ...input };
  const { enabled, times, stylePrompt, timeZone, quietHours, maxPerLocalDay, minIntervalMinutes, delivery, ambientEnabled } = settings;
  if (typeof enabled !== "boolean" || typeof ambientEnabled !== "boolean") {
    throw new TypeError("主动消息和环境触发的开关必须是布尔值。");
  }
  if (!Array.isArray(times) || times.length > 8 || !Array.from(times).every(validTime)) {
    throw new RangeError("定时最多设置 8 个时间，格式为 HH:mm。");
  }
  if (typeof stylePrompt !== "string" || stylePrompt.length > 2_000) throw new RangeError("风格提示最多 2000 个字符。");
  if (typeof timeZone !== "string" || (enabled && !Object.hasOwn(input, "timeZone"))) {
    throw new RangeError("开启主动消息前须设置有效的 IANA 时区。");
  }
  formatter(timeZone);
  if (typeof quietHours !== "string" || quietHours.length !== 11 || !quietPattern.test(quietHours)) {
    throw new RangeError("免打扰时间的格式为 HH:mm-HH:mm。");
  }
  if (!validInteger(maxPerLocalDay, 1, 10)) throw new RangeError("每日上限须在 1 至 10 次之间。");
  if (!validInteger(minIntervalMinutes, 5, 1_440)) throw new RangeError("最小间隔须在 5 至 1440 分钟之间。");
  if (delivery !== "web" && delivery !== "qq") throw new TypeError("投递方式必须是站内或 QQ。");
  return {
    enabled, times: Array.from(new Set<string>(times)), stylePrompt, timeZone, quietHours,
    maxPerLocalDay, minIntervalMinutes, delivery, ambientEnabled,
  };
}

function minuteOfDay(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
}

export function localClock(now: Date, timeZone: string): { day: string; hhmm: string; minuteOfDay: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(now).map(part => [part.type, part.value]));
  const hhmm = `${parts.hour}:${parts.minute}`;
  return { day: `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`, hhmm, minuteOfDay: minuteOfDay(hhmm) };
}

export function isQuiet(now: Date, settings: Pick<ProactiveSettings, "timeZone" | "quietHours">): boolean {
  const from = minuteOfDay(settings.quietHours.slice(0, 5));
  const to = minuteOfDay(settings.quietHours.slice(6));
  const current = localClock(now, settings.timeZone).minuteOfDay;
  // Half-open local interval; equal endpoints leave quiet hours empty.
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

export function eligibleAttempt(
  now: Date,
  settings: ProactiveSettings,
  history: { countToday: number; lastAttemptedAt: Date | null },
): boolean {
  return settings.enabled && history.countToday < settings.maxPerLocalDay && !isQuiet(now, settings) &&
    (history.lastAttemptedAt === null || +now - +history.lastAttemptedAt >= settings.minIntervalMinutes * MINUTE);
}
