import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSceneImageAssets, decodeSceneImageBase64, inspectSceneImageBytes, SCENE_IMAGE_MAX_BYTES } from "./assets";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64");
const widePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAIAEAAAABCAAAAAC84hSCAAAAIklEQVR4nO3BMQ0AAAwDoPapf8nTsQToAgAAAAAAAADkuwMAGQAIqTyJ/wAAAABJRU5ErkJggg==", "base64");
// Independent encoder fixtures: a single 2 x 3 color frame in each container.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlqKKK+4PlD//Z", "base64");
const WEBP = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+8JtD/2Dv5wH5wH9MH/5+ZfLfvjMAAAA=", "base64");

describe("场景图片格式和边界", () => {
  it.each([[PNG, "image/png", 1, 1], [JPEG, "image/jpeg", 2, 3], [WEBP, "image/webp", 2, 3]] as const)(
    "读取真实静态图片的尺寸，并拒绝截断",
    (image, mime, width, height) => {
      expect(inspectSceneImageBytes(image, mime)).toMatchObject({ mimeType: mime, width, height });
      expect(() => inspectSceneImageBytes(image.subarray(0, image.length - 1), mime)).toThrow();
    },
  );
  it("拒绝伪造魔数、尺寸越界、错误 MIME 和非规范 Base64", () => {
    expect(() => inspectSceneImageBytes(Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(20)]))).toThrow();
    expect(() => inspectSceneImageBytes(widePng)).toThrow();
    expect(() => inspectSceneImageBytes(PNG, "image/jpeg")).toThrow();
    expect(() => decodeSceneImageBase64("data:image/png;base64," + PNG.toString("base64"))).toThrow();
    expect(() => decodeSceneImageBase64("Zh==")).toThrow();
  });
});

describe("场景图片属主文件", () => {
  let temporary: string;
  let base: string;
  let assets: ReturnType<typeof createSceneImageAssets>;
  beforeEach(async () => {
    base = await realpath(tmpdir());
    temporary = await mkdtemp(path.join(base, "ink-kin-scene-image-"));
    assets = createSceneImageAssets(temporary);
  });
  afterEach(async () => {
    if (!temporary) return;
    const resolved = await realpath(temporary);
    if (path.relative(base, path.dirname(resolved)) !== "" || !path.basename(resolved).startsWith("ink-kin-scene-image-")) throw new Error("临时目录不属于测试。");
    await rm(resolved, { recursive: true, force: true });
  });

  it("存取参考图仅限属主，输出写入不同目录且只删除指定文件", async () => {
    const reference = await assets.uploadSceneImageReference(7, PNG.toString("base64"), "image/png");
    expect(reference).toMatchObject({ key: expect.stringMatching(/^scene-image-config\/7\//), url: `/uploads/${reference.key}` });
    await expect(assets.readSceneImageAsset(7, reference.key)).resolves.toEqual({ key: reference.key, buffer: PNG, mimeType: "image/png" });
    await expect(assets.readSceneImageAsset(8, reference.key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const generated = await assets.writeSceneImageOutput(7, PNG, "image/png");
    const probe = await assets.writeSceneImageOutput(7, PNG, "image/png", true);
    expect(generated.key).toMatch(/^scene-images\/7\//);
    expect(probe.key).toMatch(/^scene-image-tests\/7\//);
    await expect(assets.deleteSceneImageOutput(8, generated.key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assets.deleteSceneImageOutput(7, reference.key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assets.deleteSceneImageOutput(7, generated.key)).resolves.toBe(true);
    await expect(assets.deleteSceneImageOutput(7, generated.key)).resolves.toBe(false);
    await expect(readFile(path.join(temporary, probe.key))).resolves.toEqual(PNG);
  });

  it("拒绝点段和目录链接，读取超限文件前先检查大小", async () => {
    const other = path.join(temporary, "outside-owner");
    await mkdir(other);
    await writeFile(path.join(other, "image.png"), PNG);
    const scope = path.join(temporary, "scene-image-config");
    await mkdir(scope);
    const link = path.join(scope, "7");
    await symlink(other, link, process.platform === "win32" ? "junction" : "dir");
    try {
      await expect(assets.readSceneImageAsset(7, "scene-image-config/7/image.png")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(assets.uploadSceneImageReference(7, PNG.toString("base64"), "image/png")).rejects.toThrow();
    } finally { await unlink(link); }
    await expect(lstat(path.join(other, "image.png"))).resolves.toMatchObject({ size: PNG.length });
    await expect(assets.readSceneImageAsset(7, "scene-image-config/7/../image.png")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assets.readSceneImageAsset(7, "scene-image-config/7/..\\image.png")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const scene = path.join(temporary, "scene-image-assets", "7", "8");
    await mkdir(scene, { recursive: true });
    const file = path.join(scene, "reference.png");
    await writeFile(file, PNG);
    await expect(assets.readSceneImageAsset(7, "scene-image-assets/7/8/reference.png")).resolves.toMatchObject({ mimeType: "image/png" });
    await truncate(file, SCENE_IMAGE_MAX_BYTES + 1);
    await expect(assets.readSceneImageAsset(7, "scene-image-assets/7/8/reference.png")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
