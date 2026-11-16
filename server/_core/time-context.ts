export const BEIJING_TIME_ZONE = "Asia/Shanghai";
export const BEIJING_TIME_ZONE_LABEL = "北京时间（UTC+08:00）";

export type BeijingDayPart = "凌晨" | "清晨" | "上午" | "中午" | "下午" | "晚上" | "深夜";

export const BEIJING_DAY_PARTS: BeijingDayPart[] = ["凌晨", "清晨", "上午", "中午", "下午", "晚上", "深夜"];

export type BeijingTimeParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  weekdayName: string;
  hour: number;
  minute: number;
  minuteOfDay: number;
  dateKey: string;
  timeKey: string;
  dayPart: BeijingDayPart;
  timeZone: typeof BEIJING_TIME_ZONE;
  timeZoneLabel: typeof BEIJING_TIME_ZONE_LABEL;
  display: string;
};

const BEIJING_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(part => part.type === type)?.value ?? "";
}

export function getBeijingDayPartForMinute(minuteOfDay: number): BeijingDayPart {
  if (minuteOfDay < 5 * 60) return "凌晨";
  if (minuteOfDay < 8 * 60) return "清晨";
  if (minuteOfDay < 11 * 60) return "上午";
  if (minuteOfDay < 13 * 60) return "中午";
  if (minuteOfDay < 18 * 60) return "下午";
  if (minuteOfDay < 22 * 60) return "晚上";
  return "深夜";
}

export function getBeijingTimeParts(now = new Date()): BeijingTimeParts {
  const parts = BEIJING_FORMATTER.formatToParts(now);
  const year = Number(partValue(parts, "year"));
  const month = Number(partValue(parts, "month"));
  const day = Number(partValue(parts, "day"));
  const rawHour = Number(partValue(parts, "hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(partValue(parts, "minute"));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekdayName = partValue(parts, "weekday") || WEEKDAY_NAMES[weekday];
  const minuteOfDay = hour * 60 + minute;
  const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
  const timeKey = `${pad2(hour)}:${pad2(minute)}`;
  const dayPart = getBeijingDayPartForMinute(minuteOfDay);

  return {
    year,
    month,
    day,
    weekday,
    weekdayName,
    hour,
    minute,
    minuteOfDay,
    dateKey,
    timeKey,
    dayPart,
    timeZone: BEIJING_TIME_ZONE,
    timeZoneLabel: BEIJING_TIME_ZONE_LABEL,
    display: `${dateKey} ${weekdayName} ${timeKey}（${dayPart}，${BEIJING_TIME_ZONE_LABEL}）`,
  };
}

export function formatBeijingDateTime(now = new Date()): string {
  return getBeijingTimeParts(now).display;
}

export function getBeijingDateKey(now = new Date()): string {
  return getBeijingTimeParts(now).dateKey;
}

export function getBeijingTimeKey(now = new Date()): string {
  return getBeijingTimeParts(now).timeKey;
}

export function getBeijingMinuteOfDay(now = new Date()): number {
  return getBeijingTimeParts(now).minuteOfDay;
}

/** 北京时间纯公历日期结构（不含具体时分，免受宿主本地时区影响）。 */
export type BeijingCalendarDate = {
  year: number;
  month: number;
  day: number;
  dateKey: string;
};

/** 判断公历年份是否为闰年。 */
export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 返回指定公历年月的总天数（非法月份返回 0）。 */
export function getGregorianMonthDays(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }
  switch (month) {
    case 2:
      return isGregorianLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/** 校验公历年月日是否真实合法。 */
export function isValidGregorianDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1000 || year > 9999) return false;
  const maxDay = getGregorianMonthDays(year, month);
  return maxDay > 0 && day >= 1 && day <= maxDay;
}

/** 将合法公历年月日格式化为 YYYY-MM-DD。 */
export function formatBeijingDateKeyFromYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 构造北京时间指定公历日正午 12:00 对应的 UTC Date（即 UTC 当日 04:00:00）。
 * 用于传给 Intl.DateTimeFormat(..., { timeZone: "Asia/Shanghai" })，避免任意宿主时区在子夜边界跨天偏移。
 */
export function beijingMiddayUtcFromYmd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 4, 0, 0, 0));
}

/**
 * 将 Date 或日期字符串（支持 YYYY-MM-DD、YYYY/MM/DD、YYYY年M月D日 及 ISO 时间戳）解析为北京时间公历日。
 * 解析失败或日期不存在（如 2026-02-30）时返回 null。
 */
export function parseBeijingCalendarDate(
  input: Date | string | null | undefined,
): BeijingCalendarDate | null {
  if (!input) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const parts = getBeijingTimeParts(input);
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      dateKey: parts.dateKey,
    };
  }
  const trimmed = input.trim();
  if (!trimmed) return null;

  const ymdMatch = trimmed.match(
    /^(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})\s*日?$/,
  );
  if (ymdMatch) {
    const year = Number.parseInt(ymdMatch[1], 10);
    const month = Number.parseInt(ymdMatch[2], 10);
    const day = Number.parseInt(ymdMatch[3], 10);
    if (!isValidGregorianDate(year, month, day)) return null;
    return {
      year,
      month,
      day,
      dateKey: formatBeijingDateKeyFromYmd(year, month, day),
    };
  }

  // 若是带 T 或时区的 ISO 字符串，优先按实际时刻转换到北京时间；若是 YYYY-MM-DD 开头前缀也安全提取
  if (/T|\d{2}:\d{2}/.test(trimmed)) {
    const parsedDate = new Date(trimmed);
    if (!Number.isNaN(parsedDate.getTime())) {
      const parts = getBeijingTimeParts(parsedDate);
      return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        dateKey: parts.dateKey,
      };
    }
  }

  const leadingYmd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (leadingYmd) {
    const year = Number.parseInt(leadingYmd[1], 10);
    const month = Number.parseInt(leadingYmd[2], 10);
    const day = Number.parseInt(leadingYmd[3], 10);
    if (!isValidGregorianDate(year, month, day)) return null;
    return {
      year,
      month,
      day,
      dateKey: formatBeijingDateKeyFromYmd(year, month, day),
    };
  }

  return null;
}

/** 计算两个北京时间公历日之间的精确整数天数差（to - from）。 */
export function diffBeijingCalendarDays(
  from: Pick<BeijingCalendarDate, "year" | "month" | "day">,
  to: Pick<BeijingCalendarDate, "year" | "month" | "day">,
): number {
  const fromUtcMs = Date.UTC(from.year, from.month - 1, from.day);
  const toUtcMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtcMs - fromUtcMs) / 86_400_000);
}

/** 在北京时间日历日上增减整数天数并返回新的公历日。 */
export function addBeijingCalendarDays(
  base: Pick<BeijingCalendarDate, "year" | "month" | "day">,
  deltaDays: number,
): BeijingCalendarDate {
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + Math.trunc(deltaDays)));
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    dateKey: formatBeijingDateKeyFromYmd(year, month, day),
  };
}
