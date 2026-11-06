import { describe, expect, it } from "vitest";
import {
  firstQqRoleplayUnconfirmed, projectQqRoleplayAttempts, validateQqRoleplayBeatTexts,
} from "./roleplay-repository";

describe("QQ 频道固定分段", () => {
  it("按字符数而非 UTF-16 单元限制原文，保留前后空格和换行", () => {
    const exact = " " + "舟".repeat(3997) + "🌊" + "\n";
    const texts = [exact, " 第二段 "];
    expect(() => validateQqRoleplayBeatTexts(texts)).not.toThrow();
    expect(texts).toEqual([exact, " 第二段 "]);
    expect(() => validateQqRoleplayBeatTexts([exact + "舟"])).toThrow();
  });

  it("拒绝过多分段或无法原样入库的文本", () => {
    expect(() => validateQqRoleplayBeatTexts(Array.from({ length: 32 }, () => "一段"))).not.toThrow();
    expect(() => validateQqRoleplayBeatTexts(Array.from({ length: 33 }, () => "一段"))).toThrow();
    for (const invalid of ["", "前\0后", String.fromCharCode(0xd800)]) {
      expect(() => validateQqRoleplayBeatTexts([invalid])).toThrow();
    }
  });
});

describe("QQ 频道投递历史", () => {
  const uncertain = { status: "unknown", remoteMessageId: null, reason: "transport_unconfirmed" } as const;
  const rejected = { status: "failed", remoteMessageId: null, reason: "rejected_by_api" } as const;

  it("后续明确失败不能清除先前未知；已确认回执可使该段显示已送达", () => {
    expect(projectQqRoleplayAttempts([rejected, uncertain])).toEqual({
      status: "unknown", qqMessageId: null, error: "transport_unconfirmed",
    });
    expect(projectQqRoleplayAttempts([
      { status: "confirmed", remoteMessageId: "123", reason: "confirmed_by_api" }, uncertain,
    ])).toEqual({ status: "sent", qqMessageId: "123", error: null });
  });

  it("确定未派发的停止可显示取消，但不抹掉此前的拒绝或未知", () => {
    const stopped = { status: "failed", remoteMessageId: null, reason: "cancelled_before_dispatch" } as const;
    expect(projectQqRoleplayAttempts([stopped]).status).toBe("cancelled");
    expect(projectQqRoleplayAttempts([stopped, rejected])).toMatchObject({ status: "failed", error: "rejected_by_api" });
    expect(projectQqRoleplayAttempts([stopped, uncertain]).status).toBe("unknown");
  });

  it("只跳过已确认段；未知和已取消都不能越过并发送后续", () => {
    for (const status of ["pending", "unknown", "failed", "cancelled"] as const) {
      const first = { id: "边界段", status };
      expect(firstQqRoleplayUnconfirmed([{ id: "前段", status: "sent" }, first, { id: "后段", status: "pending" }]))
        .toBe(first);
    }
  });
});
