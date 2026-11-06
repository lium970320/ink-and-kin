import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { ENV } from "../../_core/env";
import { sanitizeFileName } from "../../_core/filename";
import { getFilesByPersonaId } from "../../db";
import { QqError } from "./core";

const MAX_QQ_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_QQ_IMAGE_CANDIDATES = 50;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_FIRST_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);

type QqImageMime = "image/png" | "image/jpeg" | "image/webp";
export type QqMediaAsset = { id: number; name: string; size: number; sha256: string };
export type LoadedQqMediaAsset = QqMediaAsset & { mime: QqImageMime; data: Buffer };
type PersonaFileRow = { id: number; userId: number; personaId: number; fileType: string; originalName: string; fileKey: string };
type AssetReaderDependencies = {
  uploadDir: string;
  getFiles(personaId: number, userId: number): Promise<readonly PersonaFileRow[]>;
};

function unavailable() {
  return new QqError("BAD_REQUEST", "图片不可用，或不属于当前绑定角色。");
}

function isPositiveId(id: number) {
  return Number.isSafeInteger(id) && id > 0;
}

function isOwnedImage(row: PersonaFileRow, userId: number, personaId: number) {
  return row.userId === userId && row.personaId === personaId && row.fileType === "image" && isPositiveId(row.id);
}

function mimeFromBytes(data: Buffer): QqImageMime | null {
  if (data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return "image/png";
  if (data.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return "image/jpeg";
  if (data.length >= 16 && data.toString("latin1", 0, 4) === "RIFF" &&
    data.toString("latin1", 8, 12) === "WEBP" && WEBP_FIRST_CHUNKS.has(data.toString("latin1", 12, 16))) return "image/webp";
  return null;
}

function sameFileVersion(before: Stats, after: Stats) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

async function readImage(uploadDir: string, row: PersonaFileRow, userId: number, personaId: number): Promise<LoadedQqMediaAsset> {
  const prefix = `personas/${userId}/${personaId}/`;
  if (!isOwnedImage(row, userId, personaId) || !row.fileKey.startsWith(prefix)) throw unavailable();
  const leaf = row.fileKey.slice(prefix.length);
  // 上传端只生成一个文件名段；不允许路径分隔符、绝对路径、ADS 或 Windows 末尾别名。
  if (!leaf || leaf === "." || leaf === ".." || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(leaf) || /[. ]$/.test(leaf)) throw unavailable();
  try {
    const root = await realpath(uploadDir);
    const target = path.resolve(root, "personas", String(userId), String(personaId), leaf);
    const resolved = await realpath(target);
    // 只接受真实路径仍与归属路径一致的文件，包括拒绝跳到根内其他角色的链接。
    if (path.relative(target, resolved) !== "") throw unavailable();
    const before = await lstat(resolved);
    if (!before.isFile() || before.size < 1 || before.size > MAX_QQ_IMAGE_BYTES) throw unavailable();

    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const handle = await open(resolved, flags);
    try {
      const opened = await handle.stat();
      if (!sameFileVersion(before, opened) || path.relative(target, await realpath(target)) !== "") throw unavailable();
      // 按已检查的大小读取；并发增长也不能导致超过 8 MiB 的分配或读取。
      const data = Buffer.allocUnsafe(opened.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
        if (!bytesRead) throw unavailable();
        offset += bytesRead;
      }
      if (!sameFileVersion(opened, await handle.stat())) throw unavailable();
      const mime = mimeFromBytes(data);
      if (!mime) throw new QqError("BAD_REQUEST", "仅支持 PNG、JPEG 或 WebP 图片。");
      return {
        id: row.id, name: sanitizeFileName(row.originalName), size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"), mime, data,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof QqError) throw error;
    // 文件系统异常可能带绝对路径；只返回固定的公开错误。
    throw unavailable();
  }
}

/** 依赖注入用于隔离文件系统校验测试，生产入口只使用已认证的数据库与上传根。 */
export function createQqMediaAssetReader(deps: AssetReaderDependencies) {
  async function ownedImages(userId: number, personaId: number) {
    if (!isPositiveId(userId) || !isPositiveId(personaId)) throw unavailable();
    try {
      return (await deps.getFiles(personaId, userId)).filter(row => isOwnedImage(row, userId, personaId));
    } catch {
      throw new QqError("PRECONDITION_FAILED", "暂时无法读取可发送的图片。");
    }
  }

  return {
    async listQqMediaAssets(userId: number, personaId: number): Promise<QqMediaAsset[]> {
      const rows = (await ownedImages(userId, personaId)).slice(0, MAX_QQ_IMAGE_CANDIDATES);
      const assets: QqMediaAsset[] = [];
      for (const row of rows) {
        try {
          const { id, name, size, sha256 } = await readImage(deps.uploadDir, row, userId, personaId);
          assets.push({ id, name, size, sha256 });
        } catch (error) {
          if (!(error instanceof QqError)) throw error;
          // 已删除、损坏或不合规的上传不进入选择列表。
        }
      }
      return assets;
    },
    async loadQqMediaAsset(userId: number, personaId: number, assetId: number, expectedSha256?: string): Promise<LoadedQqMediaAsset> {
      if (!isPositiveId(assetId)) throw unavailable();
      const row = (await ownedImages(userId, personaId)).find(item => item.id === assetId);
      if (!row) throw unavailable();
      const image = await readImage(deps.uploadDir, row, userId, personaId);
      if (expectedSha256 !== undefined && image.sha256 !== expectedSha256.toLowerCase()) {
        throw new QqError("CONFLICT", "图片内容已变化，请刷新列表后重新选择。");
      }
      return image;
    },
  };
}

export const { listQqMediaAssets, loadQqMediaAsset } = createQqMediaAssetReader({
  uploadDir: ENV.uploadDir,
  getFiles: (personaId, userId) => getFilesByPersonaId(personaId, userId),
});
