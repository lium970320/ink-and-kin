import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQqMediaAssetReader } from "./media-assets";

vi.mock("../../db", () => ({ getFilesByPersonaId: vi.fn() }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([8, 0, 0, 0]), Buffer.from("WEBPVP8L")]);
const photo = { id: 10, userId: 7, personaId: 11, fileType: "image", fileKey: "personas/7/11/example.png", originalName: "已有图片.png" };
const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const denied = { code: "BAD_REQUEST", message: "图片不可用，或不属于当前绑定角色。" };

describe("QQ 私聊图片资产读取", () => {
  let root: string;
  let uploadDir: string;
  let rows: Array<typeof photo>;
  const getFiles = vi.fn(async (_personaId: number, _userId: number) => rows);
  const reader = () => createQqMediaAssetReader({ uploadDir, getFiles });
  const assetPath = () => path.join(uploadDir, photo.fileKey);

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ink-kin-qq-images-"));
    uploadDir = path.join(root, "uploads");
    rows = [photo];
    getFiles.mockClear();
  });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function writeAsset(data: Buffer) {
    await mkdir(path.dirname(assetPath()), { recursive: true });
    await writeFile(assetPath(), data);
  }

  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/webp", WEBP],
  ] as const)("根据实际字节识别 %s，列表只返回安全元数据", async (mime, bytes) => {
    await writeAsset(bytes);
    const meta = { id: photo.id, name: photo.originalName, size: bytes.length, sha256: digest(bytes) };
    await expect(reader().listQqMediaAssets(7, 11)).resolves.toEqual([meta]);
    await expect(reader().loadQqMediaAsset(7, 11, photo.id, meta.sha256)).resolves.toEqual({ ...meta, mime, data: bytes });
    expect(getFiles).toHaveBeenCalledWith(11, 7);
  });

  it("再次核对账号、绑定角色、文件类型，不返回同一键的其他行", async () => {
    await writeAsset(PNG);
    rows.push(
      { ...photo, id: 20, userId: 8 },
      { ...photo, id: 21, personaId: 12 },
      { ...photo, id: 22, fileType: "video" },
    );
    await expect(reader().listQqMediaAssets(7, 11)).resolves.toHaveLength(1);
    for (const id of [20, 21, 22]) {
      await expect(reader().loadQqMediaAsset(7, 11, id)).rejects.toMatchObject(denied);
    }
  });

  it.each([
    "personas/7/12/example.png",
    "personas/7/11/../12/example.png",
    "personas/7/11/example.png:alternate",
    "https://example.test/image.png",
  ])("拒绝越界或非上传键，错误不返回键值", async fileKey => {
    rows = [{ ...photo, fileKey }];
    await expect(reader().listQqMediaAssets(7, 11)).resolves.toEqual([]);
    await expect(reader().loadQqMediaAsset(7, 11, photo.id)).rejects.toMatchObject(denied);
  });

  it("归属目录是指向上传根外的目录链接时拒绝读取", async () => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "example.png"), PNG);
    const personaDir = path.dirname(assetPath());
    await mkdir(path.dirname(personaDir), { recursive: true });
    await symlink(outside, personaDir, process.platform === "win32" ? "junction" : "dir");

    await expect(reader().listQqMediaAssets(7, 11)).resolves.toEqual([]);
    await expect(reader().loadQqMediaAsset(7, 11, photo.id)).rejects.toMatchObject(denied);
  });

  it("扩展名是 PNG 但魔数不合法时拒绝；按磁盘实际大小拒绝超过 8 MiB", async () => {
    await writeAsset(Buffer.from("非图片内容"));
    await expect(reader().loadQqMediaAsset(7, 11, photo.id)).rejects.toMatchObject({
      code: "BAD_REQUEST", message: "仅支持 PNG、JPEG 或 WebP 图片。",
    });
    await writeAsset(PNG);
    await truncate(assetPath(), 8 * 1024 * 1024 + 1);
    await expect(reader().listQqMediaAssets(7, 11)).resolves.toEqual([]);
    await expect(reader().loadQqMediaAsset(7, 11, photo.id)).rejects.toMatchObject(denied);
  });

  it("选择后字节发生变化时，以内容哈希拒绝发送旧选择", async () => {
    await writeAsset(PNG);
    const [listed] = await reader().listQqMediaAssets(7, 11);
    const changed = Buffer.concat([PNG.subarray(0, -1), Buffer.from([0x02])]);
    await writeAsset(changed);
    await expect(reader().loadQqMediaAsset(7, 11, photo.id, listed.sha256)).rejects.toMatchObject({
      code: "CONFLICT", message: "图片内容已变化，请刷新列表后重新选择。",
    });
    await expect(reader().loadQqMediaAsset(7, 11, photo.id, digest(changed))).resolves.toMatchObject({ data: changed });
  });

  it("列表只检查现有顺序中的前五十张候选图片", async () => {
    await writeAsset(PNG);
    rows = [
      photo,
      ...Array.from({ length: 49 }, (_, i) => ({ ...photo, id: 100 + i, fileKey: `personas/7/11/missing-${i}.png` })),
      { ...photo, id: 200 },
    ];
    await expect(reader().listQqMediaAssets(7, 11)).resolves.toEqual([
      { id: photo.id, name: photo.originalName, size: PNG.length, sha256: digest(PNG) },
    ]);
  });
});
