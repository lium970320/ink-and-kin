import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MobileLanSettings from "./MobileLanSettings";

const mocks = vi.hoisted(() => ({ getOverview: vi.fn(), mutate: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    mobile: {
      getOverview: { useQuery: mocks.getOverview },
      createPairingCode: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
      updateSettings: { useMutation: () => ({ isPending: false }) },
      revokeDevice: { useMutation: () => ({ isPending: false }) },
    },
  },
}));

describe("手机直连设置", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("显示独立开关及监听配置", () => {
    mocks.getOverview.mockReturnValue({ data: { enabled: false } });
    const markup = renderToStaticMarkup(React.createElement(MobileLanSettings));
    expect(markup).toContain("APP_MOBILE_ENABLED=true");
    expect(markup).toContain("APP_HOST");
    expect(markup).not.toContain("生成配对码");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("按服务器报告的可访问地址生成安装入口", () => {
    const reportedOrigin = "http://192.0.2.20:3000";
    mocks.getOverview.mockReturnValue({
      data: {
        enabled: true,
        isLanListening: true,
        discoveryPort: 30003,
        lanUrls: [reportedOrigin, "http://127.0.0.1:3000", "https://example.test/unrelated"],
        primaryLanUrl: "https://example.test",
        proactiveTargetMode: "qq_first",
        onlineCount: 0,
        devices: [],
        apk: { available: true, versionName: "1.0" },
      },
    });
    const markup = renderToStaticMarkup(React.createElement(MobileLanSettings));
    expect(markup).toContain(`href="${reportedOrigin}/api/mobile/download/apk"`);
    expect(markup).toContain("30003");
    expect(markup).toContain("人物已授权的 QQ 渠道");
    expect(markup).not.toContain("127.0.0.1");
    expect(markup).not.toContain("example.test");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
