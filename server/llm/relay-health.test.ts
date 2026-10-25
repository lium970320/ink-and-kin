import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRelayHealth, isRelayCoolingDown, markRelaySuccess, markRelayTransientFailure, selectAvailableCandidates } from "./relay-health";

describe("用户与站点隔离的健康状态", () => {
  beforeEach(() => { clearRelayHealth(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T00:00:00Z")); });
  afterEach(() => { clearRelayHealth(); vi.useRealTimers(); });

  it("故障冷却从五分钟递增，最高三十分钟", () => {
    expect([1, 2, 3, 4, 5].map(() => markRelayTransientFailure(1, 10))).toEqual([300000, 600000, 1200000, 1800000, 1800000]);
    expect(isRelayCoolingDown(1, 10)).toBe(true);
    vi.advanceTimersByTime(1800000);
    expect(isRelayCoolingDown(1, 10)).toBe(false);
  });

  it("相同站点编号不会让另一用户冷却，另一站也不受影响", () => {
    markRelayTransientFailure(1, 10);
    expect(isRelayCoolingDown(2, 10)).toBe(false);
    expect(isRelayCoolingDown(1, 11)).toBe(false);
  });

  it("成功清除连续失败次数", () => {
    markRelayTransientFailure(1, 10); markRelayTransientFailure(1, 10);
    markRelaySuccess(1, 10);
    expect(isRelayCoolingDown(1, 10)).toBe(false);
    expect(markRelayTransientFailure(1, 10)).toBe(300000);
  });

  it("配置变更可只清当前用户，也可显式清全部", () => {
    markRelayTransientFailure(1, 10); markRelayTransientFailure(10, 10);
    clearRelayHealth(1);
    expect(isRelayCoolingDown(1, 10)).toBe(false);
    expect(isRelayCoolingDown(10, 10)).toBe(true);
    clearRelayHealth();
    expect(isRelayCoolingDown(10, 10)).toBe(false);
  });

  it("仅过滤冷却站，保持调用方已排好的顺序和原优先级", () => {
    const rows = [{ relayId: 3, priority: 300 }, { relayId: 1, priority: 200 }, { relayId: 2, priority: 100 }];
    markRelayTransientFailure(1, 1);
    expect(selectAvailableCandidates(rows, 1)).toEqual([rows[0], rows[2]]);
    expect(rows.map(row => row.relayId)).toEqual([3, 1, 2]);
  });

  it("全部冷却仅租用一个探测，租约期间不再探测其他站，之后可恢复", () => {
    const rows = [{ relayId: 1 }, { relayId: 2 }];
    markRelayTransientFailure(1, 1); markRelayTransientFailure(1, 2);
    expect(selectAvailableCandidates(rows, 1)).toEqual([rows[0]]);
    expect(selectAvailableCandidates(rows, 1)).toEqual([]);
    vi.advanceTimersByTime(120001);
    expect(selectAvailableCandidates(rows, 1)).toEqual([rows[0]]);
    markRelaySuccess(1, 1);
    expect(selectAvailableCandidates(rows, 1)).toEqual([rows[0]]);
  });

  it("全部冷却优先探测较早恢复的站，未跟踪的环境候选保持可用", () => {
    markRelayTransientFailure(1, 1); markRelayTransientFailure(1, 1);
    markRelayTransientFailure(1, 2);
    expect(selectAvailableCandidates([{ relayId: 1 }, { relayId: 2 }], 1)).toEqual([{ relayId: 2 }]);
    expect(selectAvailableCandidates([{ relayId: 1 }, {}], 1)).toEqual([{}]);
  });
});
