import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The reminder scheduler runs every minute, so the paths that decide
 * *whether* to send something matter more than usual: a mistake there means
 * the same message arriving a hundred times a day, or never arriving at all.
 */

const getAllPersonasForReminders = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const hasReminderDelivery = vi.fn();
const recordReminder = vi.fn();

vi.mock("../db", () => ({
  getAllPersonasForReminders: (...a: unknown[]) => getAllPersonasForReminders(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  hasReminderDelivery: (...a: unknown[]) => hasReminderDelivery(...a),
  recordReminder: (...a: unknown[]) => recordReminder(...a),
}));

const send = vi.fn();
const getChannelAdapter = vi.fn();

vi.mock("../channels", () => ({
  getChannelAdapter: (...a: unknown[]) => getChannelAdapter(...a),
}));

import {
  isQuietHour,
  collectReminders,
  deliverReminder,
  runReminderSweep,
  extractPhotoDate,
} from "./reminders";

const persona = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  name: "小A",
  // Deliberately not the day the sweep runs on, so the anniversary reminder
  // and the "years together" reminder do not overlap in every test.
  togetherFrom: "2021-03-14",
  remindersEnabled: true,
  ...overrides,
});

describe("isQuietHour", () => {
  it("treats a window that does not wrap as a plain range", () => {
    expect(isQuietHour(new Date(2024, 0, 1, 13, 0), "12:00-15:00")).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 16, 0), "12:00-15:00")).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const spec = "23:00-08:00";
    expect(isQuietHour(new Date(2024, 0, 1, 23, 30), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 2, 0), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 7, 59), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 8, 0), spec)).toBe(false);
    expect(isQuietHour(new Date(2024, 0, 1, 12, 0), spec)).toBe(false);
  });

  it("ignores a malformed setting", () => {
    expect(isQuietHour(new Date(), "not-a-window")).toBe(false);
  });
});

describe("collectReminders", () => {
  const now = new Date(2024, 4, 20, 10, 0); // 2024-05-20

  it("returns nothing when reminders are switched off", () => {
    const reminders = collectReminders({
      persona: persona({ remindersEnabled: false }),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders).toEqual([]);
  });

  it("matches an anniversary written as MM-DD", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].kind).toBe("anniversary");
    expect(reminders[0].dedupeKey).toContain("anniversary:1");
  });

  it("matches an anniversary written as a full date", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 2, title: "第一次见面", date: "2019-05-20" }],
      now,
    });
    expect(reminders).toHaveLength(1);
  });

  it("does not match an anniversary on another day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 3, title: "别的日子", date: "06-01" }],
      now,
    });
    expect(reminders).toEqual([]);
  });

  it("fires on the anniversary of the day the two met", () => {
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2021-05-20" }),
      anniversaries: [],
      now,
    });
    expect(reminders.some((r) => r.kind === "together_years")).toBe(true);
  });

  it.each([[0, 0], [12, 0], [15, 30], [23, 59]])(
    "matches a date-only starting day at local %i:%i without rounding elapsed hours",
    (hour, minute) => {
      const reminders = collectReminders({
        persona: persona({ togetherFrom: "2021-05-20" }),
        anniversaries: [],
        now: new Date(2024, 4, 20, hour, minute),
      });
      expect(reminders).toMatchObject([{
        kind: "together_years",
        dedupeKey: "together_years:1:2024-05-20",
        text: "今天是你和 小A 认识的第 3 年。",
      }]);
    },
  );

  it.each([
    [new Date(2024, 4, 19, 23, 59), false],
    [new Date(2024, 4, 20, 0, 0), true],
    [new Date(2024, 4, 20, 23, 59), true],
    [new Date(2024, 4, 21, 0, 0), false],
  ] as const)("uses the same local midnight boundary for every kind at %s", (date, due) => {
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2021-05-20" }),
      anniversaries: [{ id: 2, title: "启程", date: "05-20" }],
      photos: [{ id: 7, originalName: "map.png", extractedMemory: null, createdAt: new Date(2020, 4, 20, 0, 15) }],
      now: date,
    });
    expect(reminders.map(reminder => reminder.kind)).toEqual(due
      ? ["anniversary", "together_years", "memory_trigger"]
      : []);
    if (due) {
      expect(reminders.map(reminder => reminder.dedupeKey)).toEqual([
        "anniversary:2:2024-05-20",
        "together_years:1:2024-05-20",
        "memory_trigger:7:2024-05-20",
      ]);
    }
  });

  it.each([
    "2025-06-15T00:15:00+14:00",
    "2025-06-15T23:45:00-11:00",
    "2025-01-01T00:15:00+08:00",
  ])("interprets timestamp %s in the runtime's calendar rather than the input offset", timestamp => {
    const instant = new Date(timestamp);
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(instant);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    const expectedDay = `${part("year")}-${part("month")}-${part("day")}`;
    const reminders = collectReminders({
      persona: persona({ togetherFrom: null }),
      anniversaries: [{ id: 2, title: "启程", date: expectedDay }],
      now: instant,
    });
    expect(reminders).toMatchObject([{ dedupeKey: `anniversary:2:${expectedDay}` }]);
    expect(extractPhotoDate(null, instant)).toBe(expectedDay);
  });

  it("matches February 29 consistently in a leap year, including the afternoon", () => {
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2020-02-29" }),
      anniversaries: [{ id: 2, title: "启程", date: "02-29" }],
      photos: [{ id: 7, originalName: "map.png", extractedMemory: null, createdAt: new Date(2020, 1, 29, 0, 15) }],
      now: new Date(2024, 1, 29, 15, 30),
    });
    expect(reminders.map(reminder => reminder.kind)).toEqual(["anniversary", "together_years", "memory_trigger"]);
    expect(reminders.find(reminder => reminder.kind === "together_years")?.text).toContain("第 4 年");
  });

  it.each([new Date(2025, 1, 28, 15, 30), new Date(2025, 2, 1, 0, 0)])(
    "does not silently move February 29 to another day in a non-leap year: %s", date => {
      expect(collectReminders({
        persona: persona({ togetherFrom: "2020-02-29" }),
        anniversaries: [{ id: 2, title: "启程", date: "02-29" }],
        now: date,
      })).toEqual([]);
    },
  );

  it("does not normalize an invalid date-only starting day into another date", () => {
    expect(collectReminders({
      persona: persona({ togetherFrom: "2021-02-29" }),
      anniversaries: [],
      now: new Date(2024, 2, 1, 10, 0),
    })).toEqual([]);
  });

  it("fires a memory trigger for a photo taken on this day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [],
      photos: [
        {
          id: 7,
          originalName: "sea.png",
          extractedMemory: "2019-05-20 在海边",
          createdAt: new Date(2019, 4, 20),
        },
      ],
      now,
    });
    const trigger = reminders.find((r) => r.kind === "memory_trigger");
    expect(trigger).toBeDefined();
    expect(trigger!.dedupeKey).toContain("memory_trigger:7");
  });

  it("does not fire a memory trigger for a photo from another day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [],
      photos: [
        {
          id: 8,
          originalName: "sea.png",
          extractedMemory: "2019-06-01 在海边",
          createdAt: new Date(2019, 5, 1),
        },
      ],
      now,
    });
    expect(reminders.filter((r) => r.kind === "memory_trigger")).toEqual([]);
  });
});

describe("extractPhotoDate", () => {
  it("reads a date out of the extracted text", () => {
    expect(extractPhotoDate("2019-05-20 在海边", new Date(2020, 0, 1))).toBe(
      "2019-05-20",
    );
  });

  it("falls back to the upload date", () => {
    expect(extractPhotoDate(null, new Date(2019, 4, 20, 0, 15))).toBe(
      "2019-05-20",
    );
  });

  it("keeps the local upload day until midnight", () => {
    expect(extractPhotoDate(null, new Date(2019, 4, 20, 23, 59))).toBe("2019-05-20");
    expect(extractPhotoDate(null, new Date(2019, 4, 21, 0, 0))).toBe("2019-05-21");
  });

  it("returns null when there is no usable date", () => {
    expect(extractPhotoDate(null, new Date("nonsense"))).toBeNull();
  });
});

describe("deliverReminder", () => {
  beforeEach(() => {
    for (const fn of [
      getAllPersonasForReminders,
      getMemoriesByPersonaId,
      getFilesByPersonaId,
      getChannelBindingsByUserId,
      hasReminderDelivery,
      recordReminder,
      send,
      getChannelAdapter,
    ]) {
      fn.mockReset();
    }
    hasReminderDelivery.mockResolvedValue(false);
    recordReminder.mockResolvedValue(true);
    getChannelAdapter.mockReturnValue({ send });
  });

  const reminder = {
    kind: "anniversary" as const,
    personaId: 1,
    personaName: "小A",
    dedupeKey: "anniversary:1:2024-05-20",
    text: "今天是「第一次见面」的日子。",
  };

  it("does not send a reminder that was already delivered today", async () => {
    // The sweep runs every minute. Without this check the same reminder
    // would be pushed to the channel once a minute for the whole day.
    hasReminderDelivery.mockResolvedValue(true);

    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(delivered).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once and records the delivery", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(recordReminder).toHaveBeenCalledTimes(1);
    expect(delivered).toBe(true);
  });

  it("stays quiet during the quiet hours", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 23, 30),
    });

    expect(delivered).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("falls back to the web card when no channel is bound", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(send).not.toHaveBeenCalled();
    expect(recordReminder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "web" }),
    );
    expect(delivered).toBe(true);
  });
});

describe("runReminderSweep", () => {
  beforeEach(() => {
    for (const fn of [
      getAllPersonasForReminders,
      getMemoriesByPersonaId,
      getFilesByPersonaId,
      getChannelBindingsByUserId,
      hasReminderDelivery,
      recordReminder,
      send,
      getChannelAdapter,
    ]) {
      fn.mockReset();
    }
    hasReminderDelivery.mockResolvedValue(false);
    recordReminder.mockResolvedValue(true);
    getChannelAdapter.mockReturnValue({ send });
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getAllPersonasForReminders.mockResolvedValue([persona()]);
  });

  it("does not push a reminder into a conversation bound to another persona", async () => {
    // 小A has an anniversary today, but the only bound conversation is set
    // up for 小B. The reminder must not be pushed there.
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: null,
        category: "anniversary",
        date: "05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);
    getChannelBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        channel: "wechat",
        targetId: "wx-1",
        targetName: null,
        personaId: 2,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await runReminderSweep(new Date(2024, 4, 20, 10, 0));

    expect(send).not.toHaveBeenCalled();
    expect(recordReminder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "web" }),
    );
  });

  it("pushes to the conversation bound to the same persona", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: null,
        category: "anniversary",
        date: "05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);
    getChannelBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        channel: "wechat",
        targetId: "wx-1",
        targetName: null,
        personaId: 1,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await runReminderSweep(new Date(2024, 4, 20, 10, 0));

    expect(send).toHaveBeenCalledTimes(1);
  });
});
