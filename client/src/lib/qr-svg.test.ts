import { describe, expect, it } from "vitest";
import { encodeQrMatrix } from "./qr-svg";

describe("手机直连二维码", () => {
  it.each([
    ["http://192.0.2.20:3000/api/mobile/pair/landing?code=012345", 33],
    ["http://192.0.2.20:3000/api/mobile/download/apk", 29],
  ])("为 %s 生成对应尺寸的二维码", (address, size) => {
    const qr = encodeQrMatrix(address);
    expect(qr.size).toBe(size);
    expect(qr.modules).toHaveLength(size);
    expect(qr.modules.every(row => row.length === size)).toBe(true);
    expect(qr.svgPath).toMatch(/^M0,0/);
    expect(qr.svgPath).not.toContain(address);
  });

  it("超过 UTF-8 字节容量时报告错误", () => {
    expect(encodeQrMatrix("书".repeat(90)).size).toBe(57);
    expect(() => encodeQrMatrix("书".repeat(91))).toThrow(/271/);
  });
});
