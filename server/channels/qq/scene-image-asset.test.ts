import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getFilesByPersonaId: vi.fn() }));
import { loadQqSceneImageAsset } from "./media-assets";

const name = "00000000-0000-4000-8000-000000000001.png";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function fixture(run: (root: string, relativeKey: string, file: string) => Promise<void>) {
  const tmp = await realpath(os.tmpdir());
  const prefix = "ink-qq-scene-image-";
  const root = await mkdtemp(path.join(tmp, prefix));
  try {
    const dir = path.join(root, "scene-images", "17");
    await mkdir(dir, { recursive: true });
    await run(root, `scene-images/17/${name}`, path.join(dir, name));
  } finally {
    const checked = await realpath(root);
    if (path.relative(tmp, path.dirname(checked)) !== "" || !path.basename(checked).startsWith(prefix)) throw new Error("测试临时目录不在指定根内");
    await rm(checked, { recursive: true, force: true });
  }
}

describe("QQ 读取已发布的场景配图", () => {
  it("只从自己的作品键读取，不读取其他账号、路径或 URL", async () => fixture(async (root, key, file) => {
    await writeFile(file, png);
    expect(await loadQqSceneImageAsset(17, key, root)).toMatchObject({ mime: "image/png", data: png, size: png.length });
    await expect(loadQqSceneImageAsset(18, key, root)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const candidate of [`/uploads/${key}`, `https://ignored.invalid/${key}`, file, `scene-images/17/../18/${name}`,
      `scene-images/17/%2e%2e%2f${name}`, `scene-images/17/${name}:stream`, `scene-images/17/${name}\n`]) {
      await expect(loadQqSceneImageAsset(17, candidate, root)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  }));

  it("拒绝超限文件、错误魔数和重定向到其他目录的账号路径", async () => fixture(async (root, key, file) => {
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff]));
    await expect(loadQqSceneImageAsset(17, key, root)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(loadQqSceneImageAsset(17, key, root)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const alias = path.join(root, "scene-images", "18");
    await writeFile(file, png);
    await symlink(path.dirname(file), alias, "junction");
    await expect(loadQqSceneImageAsset(18, `scene-images/18/${name}`, root)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }));
});
