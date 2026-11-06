import { describe, expect, it } from "vitest";
import { defaultSettings, eligibleAttempt, isQuiet, localClock, validateSettings } from "./policy";

const at = (time: string) => new Date(time);

describe("主动消息策略", () => {
  it("使用关闭且站内的默认值，开启时须明确给出命名时区", () => {
    const settings = validateSettings({});
    expect(settings).toEqual({
      enabled: false, times: [], stylePrompt: "", timeZone: "UTC", quietHours: "23:00-08:00",
      maxPerLocalDay: 3, minIntervalMinutes: 120, delivery: "web", ambientEnabled: false,
    });
    settings.times.push("10:00");
    expect(defaultSettings.times).toEqual([]);
    expect(() => validateSettings({ enabled: true })).toThrow(/时区/);
    expect(validateSettings({ enabled: true, timeZone: "Asia/Shanghai", times: ["10:00", "10:00"] }).times).toEqual(["10:00"]);
  });

  it.each([
    { timeZone: "Mars/Olympus" }, { timeZone: "+08:00" }, { timeZone: " UTC" }, { timeZone: "" },
    { times: ["9:00"] }, { times: ["24:00"] }, { times: ["12:60"] }, { times: ["12:00\n"] },
    { times: Array(9).fill("09:00") }, { times: Array(1) }, { quietHours: "24:00-08:00" },
    { quietHours: "" }, { stylePrompt: "中".repeat(2001) }, { delivery: "preferred" },
    { maxPerLocalDay: 0 }, { maxPerLocalDay: 11 }, { minIntervalMinutes: 4 }, { minIntervalMinutes: 1441 },
    { maxPerLocalDay: 1.5 }, { enabled: "true" }, { ambientEnabled: 1 },
    { lastSent: { "09:00": "2026-11-06" } }, { revision: 100 }, { qqConsent: {} },
  ])("拒绝非法设置 %j", input => {
    expect(() => validateSettings(input)).toThrow();
  });

  it("按用户时区取本地日期，午夜为 00:00，免打扰区间含起点且不含终点", () => {
    const timeZone = "Asia/Shanghai";
    const settings = validateSettings({ timeZone });
    expect(localClock(at("2026-11-05T16:00:00Z"), timeZone)).toEqual({ day: "2026-11-06", hhmm: "00:00", minuteOfDay: 0 });
    expect(isQuiet(at("2026-11-05T14:59:00Z"), settings)).toBe(false);
    expect(isQuiet(at("2026-11-05T15:00:00Z"), settings)).toBe(true);
    expect(isQuiet(at("2026-11-05T23:59:00Z"), settings)).toBe(true);
    expect(isQuiet(at("2026-11-06T00:00:00Z"), settings)).toBe(false);
    expect(isQuiet(at("2026-11-06T00:00:00Z"), { ...settings, quietHours: "08:00-09:00" })).toBe(true);
    expect(isQuiet(at("2026-11-06T00:00:00Z"), { ...settings, quietHours: "08:00-08:00" })).toBe(false);
  });

  it("即使本地日切换或时钟回拨，最小间隔仍按真实经过时间计算", () => {
    const settings = validateSettings({ enabled: true, timeZone: "America/New_York", quietHours: "00:00-00:00", minIntervalMinutes: 90 });
    const lastAttemptedAt = at("2026-11-01T03:50:00Z"); // 前一个本地日 23:50。
    expect(eligibleAttempt(at("2026-11-01T04:05:00Z"), settings, { countToday: 0, lastAttemptedAt })).toBe(false);
    expect(eligibleAttempt(at("2026-11-01T05:20:00Z"), settings, { countToday: 0, lastAttemptedAt })).toBe(true);
    const firstOneThirty = at("2026-11-01T05:30:00Z");
    const secondOneThirty = at("2026-11-01T06:30:00Z");
    expect(localClock(firstOneThirty, settings.timeZone)).toEqual(localClock(secondOneThirty, settings.timeZone));
    expect(eligibleAttempt(secondOneThirty, settings, { countToday: 1, lastAttemptedAt: firstOneThirty })).toBe(false);
    expect(eligibleAttempt(secondOneThirty, settings, { countToday: 3, lastAttemptedAt: null })).toBe(false);
    expect(eligibleAttempt(secondOneThirty, { ...settings, enabled: false }, { countToday: 0, lastAttemptedAt: null })).toBe(false);
    expect(eligibleAttempt(secondOneThirty, { ...settings, quietHours: "01:00-02:00" }, { countToday: 0, lastAttemptedAt: null })).toBe(false);
  });
});
