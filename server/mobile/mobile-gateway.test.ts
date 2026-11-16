import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalIPv4, mobileIdentity, pairLink } from "./network";
import { planMobileProactiveRoute } from "./proactive";
import { consumeMobilePairingCode, createMobilePairingCode } from "./settings-store";

afterEach(() => vi.useRealTimers());

describe("手机直连配对", () => {
  it("每个账号只保留一个有效短码，用过即失效", () => {
    const first = createMobilePairingCode(20);
    const other = createMobilePairingCode(21);
    const next = createMobilePairingCode(20);
    expect(next.code).toMatch(/^\d{6}$/);
    expect(consumeMobilePairingCode(first.code)).toBeNull();
    expect(consumeMobilePairingCode(next.code)).toBe(20);
    expect(consumeMobilePairingCode(next.code)).toBeNull();
    expect(consumeMobilePairingCode(other.code)).toBe(21);
  });

  it("拒绝兑换过期配对码", () => {
    vi.useFakeTimers();
    const pairing = createMobilePairingCode(22);
    vi.advanceTimersByTime((pairing.ttlSeconds + 1) * 1000);
    expect(consumeMobilePairingCode(pairing.code)).toBeNull();
  });

  it("协议和配对 URI 使用书中人的独立标识", () => {
    const link = new URL(pairLink("http://192.0.2.10:3000", "123456"));
    expect(link.protocol).toBe("ink-and-kin:");
    expect(link.host).toBe("pair");
    expect(link.searchParams.get("url")).toBe("http://192.0.2.10:3000");
    expect(link.searchParams.get("code")).toBe("123456");
    expect(mobileIdentity).toEqual({ service: "ink-and-kin", protocolVersion: 1 });
    expect(isLocalIPv4("192.168.0.2")).toBe(true);
    expect(isLocalIPv4("192.0.2.10")).toBe(false);
    expect(isLocalIPv4("127.0.0.1")).toBe(false);
  });
});

describe("主动消息投递", () => {
  it("按手机在线状态分配投递且沿用既有 QQ 授权", () => {
    expect(planMobileProactiveRoute("qq", "mobile_first", true)).toEqual({ destination: "mobile", notifyMobile: true });
    expect(planMobileProactiveRoute("qq", "mobile_first", false)).toEqual({ destination: "qq", notifyMobile: false });
    expect(planMobileProactiveRoute("qq", "mobile_only", false)).toEqual({ destination: "mobile", notifyMobile: false });
    expect(planMobileProactiveRoute("qq", "both", true)).toEqual({ destination: "qq", notifyMobile: true });
    expect(planMobileProactiveRoute("qq", "qq_first", true)).toEqual({ destination: "qq", notifyMobile: false });
    expect(planMobileProactiveRoute("web", "both", true)).toEqual({ destination: "web", notifyMobile: true });
    expect(planMobileProactiveRoute("web", "qq_only", true)).toEqual({ destination: "web", notifyMobile: false });
  });
});
