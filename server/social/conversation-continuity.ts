import { getBeijingTimeParts } from "../_core/time-context";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function beijingDay(date: Date) {
  const { year, month, day } = getBeijingTimeParts(date);
  return Date.UTC(year, month - 1, day) / DAY;
}

function separatesSessions(earlier: Date, later: Date) {
  const hours = (later.getTime() - earlier.getTime()) / HOUR;
  return hours >= 6 || (hours >= 4 && beijingDay(earlier) !== beijingDay(later));
}

export function computeDailyContactGapSummary(
  messages: Array<{ role: string; createdAt?: Date | string | null }>,
  now: Date,
) {
  const history = messages.flatMap(message => {
    if (!message.createdAt || !["assistant", "user"].includes(message.role)) return [];
    const date = new Date(message.createdAt);
    return Number.isFinite(date.getTime()) && date <= now ? [{ role: message.role, date }] : [];
  }).sort((left, right) => left.date.getTime() - right.date.getTime());
  // 末尾仍在等待回复的用户消息不算一次已完成的聊天。
  while (history.length && history.at(-1)?.role !== "assistant") history.pop();
  const latest = history.at(-1)?.date;
  if (!latest) return null;
  let reference = latest;
  let resumed = false;
  if (!separatesSessions(latest, now)) {
    for (let index = history.length - 1; index >= 1; index--) {
      if (!separatesSessions(history[index - 1].date, history[index].date)) continue;
      const previous = history.slice(0, index).reverse().find(message => message.role === "assistant");
      if (previous) {
        reference = previous.date;
        resumed = true;
        break;
      }
    }
  }
  const time = getBeijingTimeParts(reference);
  return {
    lastVisibleContactAt: `${time.dateKey} ${time.timeKey}`,
    calendarDaysAgo: beijingDay(now) - beijingDay(reference),
    hoursAgo: Math.round((now.getTime() - reference.getTime()) / (HOUR / 10)) / 10,
    resumed,
  };
}
