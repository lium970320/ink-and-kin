import { describe, expect, it } from "vitest";
import { buildRuntimePreview, previewRuntimeSchedule, projectRuntimeState, validateRuntimeStateDraft } from "./runtime";

const syntheticPersona = { profileSections: { life: { routines: {
  weekday: [{ start: "09:00", end: "10:00", stateId: "reading", label: "读书", availability: "open", description: "角色设定安排了阅读时段。" }],
  saturday: [{ start: "23:30", end: "01:30", stateId: "observing", label: "观星" }],
  sunday: [],
} } } };

const instant = new Date("2026-11-06T14:30:00.000Z");

describe("人物临时状态", () => {
  it("只接受有效、带时区且在未来 24 小时内的状态，来源由服务端确定", () => {
    expect(validateRuntimeStateDraft({ status: " 借阅室休息 ", expiresAt: "2026-11-06T10:30:00-05:00" }, instant)).toEqual({
      status: "借阅室休息", startedAt: instant, expiresAt: new Date("2026-11-06T15:30:00Z"), source: "user",
    });
    expect(() => validateRuntimeStateDraft({ status: "🌊".repeat(200), expiresAt: "2026-11-07T14:30:00Z" }, instant)).not.toThrow();
    for (const expiresAt of ["2026-11-06T14:30:00Z", "2026-11-07T14:30:00.001Z", "2026-11-06T15:30", "2026-02-30T15:30:00Z"]) {
      expect(() => validateRuntimeStateDraft({ status: "休息", expiresAt }, instant)).toThrow();
    }
    expect(() => validateRuntimeStateDraft({ status: "🌊".repeat(201), expiresAt: "2026-11-06T15:30:00Z" }, instant)).toThrow();
  });

  it("过期和清空均读空，仍返回版本以拒绝旧页面重放", () => {
    const expiresAt = new Date("2026-11-06T15:00:00Z");
    const row = { userId: 7, personaId: 8, status: "暂时离开", startedAt: instant, expiresAt, source: "user" as const, revision: 4 };
    expect(projectRuntimeState(row, instant)).toMatchObject({ runtimeStateRevision: 4, runtimeLifeState: {
      status: "暂时离开", expiresAt: expiresAt.toISOString(), until: expiresAt.toISOString(), source: "user", revision: 4,
    } });
    expect(projectRuntimeState(row, expiresAt)).toEqual({ runtimeLifeState: null, runtimeStateRevision: 4 });
    expect(projectRuntimeState({ ...row, status: null, source: null, startedAt: null, expiresAt: null, revision: 5 }, expiresAt))
      .toEqual({ runtimeLifeState: null, runtimeStateRevision: 5 });
    expect(projectRuntimeState(null, expiresAt)).toEqual({ runtimeLifeState: null, runtimeStateRevision: 0 });
  });
});

describe("人物作息和只读推演", () => {
  it("同一绝对时刻按用户保存的时区求配置槽位，空档和无时区不推断活动", () => {
    expect(previewRuntimeSchedule(syntheticPersona, instant, "America/New_York"))
      .toMatchObject({ dateKey: "2026-11-06", timeKey: "09:30", dayKind: "weekday", stateId: "reading", source: "configured_routine" });
    expect(previewRuntimeSchedule(syntheticPersona, instant, "UTC"))
      .toMatchObject({ timeKey: "14:30", stateId: "unknown", availability: "unknown", source: "unconfigured" });
    expect(previewRuntimeSchedule(syntheticPersona, instant, null))
      .toMatchObject({ timeZone: null, timeKey: null, stateId: "unknown", start: null });
    expect(previewRuntimeSchedule({ profileSections: { life: { routines: { weekday: [{ start: "28:00", end: "29:00" }] } } } }, instant, "UTC").stateId).toBe("unknown");
  });

  it("跨午夜使用前一日的明确槽位，夏令时重复的本地分钟产生相同诊断", () => {
    for (const time of ["2026-11-01T05:10:00Z", "2026-11-01T06:10:00Z"]) {
      expect(previewRuntimeSchedule(syntheticPersona, new Date(time), "America/New_York"))
        .toMatchObject({ dateKey: "2026-11-01", timeKey: "01:10", dayKind: "sunday", stateId: "observing" });
    }
    expect(previewRuntimeSchedule(syntheticPersona, new Date("2026-11-01T06:30:00Z"), "America/New_York").stateId).toBe("unknown");
  });

  it("模拟只保留本次输入，事件和结果均明确标记，不修改角色资料", () => {
    const original = JSON.stringify(syntheticPersona);
    const input = { personaId: 8, personaName: "旅人", personaData: syntheticPersona, now: instant, timeZone: "UTC",
      inputText: "试算输入", todayEvents: [{ clock: "14:00", text: "推演中的约定", type: "scheduled_event" as const }] };
    expect(buildRuntimePreview(input)).toMatchObject({ simulated: true, persisted: false, scheduleState: { stateId: "unknown" },
      current: { inputText: "试算输入", timelineEvents: [{ clock: "14:00", text: "推演中的约定", source: "simulated_input" }] } });
    expect(buildRuntimePreview({ ...input, inputText: undefined, todayEvents: undefined }).current.timelineEvents).toEqual([]);
    expect(JSON.stringify(syntheticPersona)).toBe(original);
  });
});
