// 书中人 全站时间展示固定北京时间：人物活在北京时区，服务端注入提示词的
// 时间也是北京时间；浏览器/系统时区可能被用户切到海外，展示层跟着系统走
// 会和人物口中的时间对不上，所以统一经这里格式化。
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

type DateInput = string | number | Date;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** 北京时间的 yyyy-MM-dd 键，用于“今天/昨天”等跨日比较。 */
export function beijingDateKey(value: DateInput = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatBeijingTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString("zh-CN", { timeZone: BEIJING_TIME_ZONE, ...options });
}

export function formatBeijingDate(value: DateInput, options: Intl.DateTimeFormatOptions = {}): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString("zh-CN", { timeZone: BEIJING_TIME_ZONE, ...options });
}

export function formatBeijingDateTime(value: DateInput, options: Intl.DateTimeFormatOptions = {}): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString("zh-CN", { timeZone: BEIJING_TIME_ZONE, ...options });
}
