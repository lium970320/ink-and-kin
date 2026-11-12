import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { ENV } from "../_core/env";
import type { SceneImageMimeType } from "./provider-types";

export const SCENE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SCENE_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_PNG_FILTERED_BYTES = 64 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2]);
const MIME_EXT: Record<SceneImageMimeType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LEAF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,170}\.(?:png|jpe?g|webp)$/i;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function invalidImage(): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式、内容或尺寸不符合要求（仅支持 10 MiB 内的静态 PNG、JPEG 或 WebP）。" });
}
function invalidAsset(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在、不可读取或不属于当前账号。" });
}
function storageError(): never {
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "图片存储暂不可用。" });
}
function positiveId(id: number) { return Number.isSafeInteger(id) && id > 0; }
function ascii(buffer: Buffer, start: number, length: number) { return buffer.toString("latin1", start, start + length); }
function dimensions(width: number, height: number) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > SCENE_IMAGE_MAX_PIXELS) return invalidImage();
  return { width, height };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer: Buffer, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngStructure(buffer: Buffer) {
  let width = 0, height = 0, bitsPerPixel = 0, interlaced = false, indexed = false, depth = 0;
  let palette = false, idatClosed = false, ended = false;
  const data: Buffer[] = [];
  for (let offset = 8, chunks = 0; offset < buffer.length;) {
    if (++chunks > 4096 || offset + 12 > buffer.length) return invalidImage();
    const length = buffer.readUInt32BE(offset);
    const type = ascii(buffer, offset + 4, 4);
    const begin = offset + 8;
    const end = begin + length;
    if (end + 4 > buffer.length || !/^[A-Za-z]{4}$/.test(type) || crc32(buffer, offset + 4, end) !== buffer.readUInt32BE(end)) return invalidImage();
    if (chunks === 1 && type !== "IHDR") return invalidImage();
    if (type === "IHDR") {
      if (chunks !== 1 || length !== 13) return invalidImage();
      width = buffer.readUInt32BE(begin); height = buffer.readUInt32BE(begin + 4);
      dimensions(width, height);
      depth = buffer[begin + 8];
      const color = buffer[begin + 9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      if (!depths[color]?.includes(depth) || buffer[begin + 10] !== 0 || buffer[begin + 11] !== 0 || buffer[begin + 12] > 1) return invalidImage();
      bitsPerPixel = channels[color] * depth;
      indexed = color === 3;
      interlaced = buffer[begin + 12] === 1;
    } else if (type === "PLTE") {
      if (palette || data.length || length < 3 || length % 3 || length > 768 || (indexed && length / 3 > 2 ** depth)) return invalidImage();
      palette = true;
    } else if (type === "IDAT") {
      if (idatClosed || (indexed && !palette)) return invalidImage();
      data.push(buffer.subarray(begin, end));
    } else if (type === "IEND") {
      if (length !== 0 || end + 4 !== buffer.length || !data.length) return invalidImage();
      ended = true;
    } else {
      if (/^[A-Z]/.test(type) || ["acTL", "fcTL", "fdAT"].includes(type)) return invalidImage();
      if (data.length) idatClosed = true;
    }
    offset = end + 4;
  }
  if (!ended) return invalidImage();
  const passes = interlaced ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = passes.flatMap(([x, y, stepX, stepY]) => {
    const passWidth = Math.ceil((width - x) / stepX), passHeight = Math.ceil((height - y) / stepY);
    return passWidth > 0 && passHeight > 0 ? [{ height: passHeight, rowBytes: Math.ceil(passWidth * bitsPerPixel / 8) + 1 }] : [];
  });
  const expected = rows.reduce((sum, row) => sum + row.height * row.rowBytes, 0);
  if (!expected || expected > MAX_PNG_FILTERED_BYTES) return invalidImage();
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); }
  catch { return invalidImage(); }
  if (decoded.length !== expected) return invalidImage();
  let offset = 0;
  for (const row of rows) for (let line = 0; line < row.height; line++, offset += row.rowBytes) {
    if (decoded[offset] > 4) return invalidImage();
  }
  return { width, height };
}

function jpegStructure(buffer: Buffer) {
  let result: ReturnType<typeof dimensions> | undefined;
  let scan = false, quantization = false, huffman = false;
  for (let offset = 2, segments = 0; offset < buffer.length;) {
    if (++segments > 4096 || buffer[offset] !== 0xff) return invalidImage();
    while (buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return invalidImage();
    const marker = buffer[offset++];
    if (marker === 0xd9) {
      if (offset !== buffer.length || !result || !scan || !quantization || !huffman) return invalidImage();
      return result;
    }
    if (marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd8) || offset + 2 > buffer.length) return invalidImage();
    const size = buffer.readUInt16BE(offset);
    const begin = offset + 2, end = offset + size;
    if (size < 2 || end > buffer.length) return invalidImage();
    if (JPEG_SOF.has(marker)) {
      if (result || size < 11 || ![8, 12].includes(buffer[begin])) return invalidImage();
      const components = buffer[begin + 5];
      if (![1, 3, 4].includes(components) || size !== 8 + 3 * components) return invalidImage();
      result = dimensions(buffer.readUInt16BE(begin + 3), buffer.readUInt16BE(begin + 1));
    } else if (marker === 0xdb) {
      for (let cursor = begin; cursor < end;) {
        const tag = buffer[cursor++];
        if ((tag >> 4) > 1 || (tag & 15) > 3) return invalidImage();
        cursor += (tag >> 4) ? 128 : 64;
        if (cursor > end) return invalidImage();
        quantization = true;
      }
    } else if (marker === 0xc4) {
      for (let cursor = begin; cursor < end;) {
        if (cursor + 17 > end || (buffer[cursor] >> 4) > 1 || (buffer[cursor] & 15) > 3) return invalidImage();
        const symbols = buffer.subarray(cursor + 1, cursor + 17).reduce((sum, count) => sum + count, 0);
        cursor += 17 + symbols;
        if (symbols < 1 || symbols > 256 || cursor > end) return invalidImage();
        huffman = true;
      }
    }
    offset = end;
    if (marker !== 0xda) continue;
    if (!result || size < 8 || size !== 6 + 2 * buffer[begin] || !buffer[begin]) return invalidImage();
    let data = false;
    for (;;) {
      const ff = buffer.indexOf(0xff, offset);
      if (ff < 0) return invalidImage();
      if (ff > offset) data = true;
      let next = ff + 1;
      while (buffer[next] === 0xff) next++;
      if (next >= buffer.length) return invalidImage();
      const escaped = buffer[next];
      if (escaped === 0 || (escaped >= 0xd0 && escaped <= 0xd7)) {
        if (escaped === 0) data = true;
        offset = next + 1;
        continue;
      }
      offset = ff;
      break;
    }
    if (!data) return invalidImage();
    scan = true;
  }
  return invalidImage();
}

function webpStructure(buffer: Buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(4) + 8 !== buffer.length) return invalidImage();
  let canvas: ReturnType<typeof dimensions> | undefined;
  let result: ReturnType<typeof dimensions> | undefined;
  for (let offset = 12, chunks = 0; offset < buffer.length;) {
    if (++chunks > 4096 || offset + 8 > buffer.length) return invalidImage();
    const type = ascii(buffer, offset, 4);
    const length = buffer.readUInt32LE(offset + 4);
    const begin = offset + 8, end = begin + length;
    if (end + (length % 2) > buffer.length || (length % 2 && buffer[end] !== 0)) return invalidImage();
    if (type === "VP8X") {
      if (chunks !== 1 || length !== 10 || (buffer[begin] & 0xc3) !== 0 || buffer.readUIntLE(begin + 1, 3) !== 0) return invalidImage();
      canvas = dimensions(buffer.readUIntLE(begin + 4, 3) + 1, buffer.readUIntLE(begin + 7, 3) + 1);
    } else if (type === "VP8L") {
      if (result || length < 6 || buffer[begin] !== 0x2f) return invalidImage();
      const header = buffer.readUInt32LE(begin + 1);
      if ((header >>> 29) !== 0) return invalidImage();
      result = dimensions((header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1);
    } else if (type === "VP8 ") {
      if (result || length < 11 || buffer[begin + 3] !== 0x9d || buffer[begin + 4] !== 0x01 || buffer[begin + 5] !== 0x2a) return invalidImage();
      const frame = buffer.readUIntLE(begin, 3);
      const partitionLength = frame >>> 5;
      if ((frame & 1) !== 0 || !partitionLength || partitionLength > length - 10) return invalidImage();
      result = dimensions(buffer.readUInt16LE(begin + 6) & 0x3fff, buffer.readUInt16LE(begin + 8) & 0x3fff);
    } else if (type === "ANIM" || type === "ANMF") return invalidImage();
    offset = end + (length % 2);
  }
  if (!result || (canvas && (canvas.width !== result.width || canvas.height !== result.height))) return invalidImage();
  return result;
}

/** Bounded, static image container validation. JPEG/WebP entropy is not fully decoded. */
export function inspectSceneImageBytes(buffer: Buffer, expectedMime?: SceneImageMimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > SCENE_IMAGE_MAX_BYTES) return invalidImage();
  const mimeType: SceneImageMimeType | null = buffer.subarray(0, 8).equals(PNG_MAGIC) ? "image/png"
    : buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? "image/jpeg"
      : ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP" ? "image/webp" : null;
  if (!mimeType || (expectedMime !== undefined && mimeType !== expectedMime)) return invalidImage();
  const size = mimeType === "image/png" ? pngStructure(buffer) : mimeType === "image/jpeg" ? jpegStructure(buffer) : webpStructure(buffer);
  return { ...size, mimeType, extension: MIME_EXT[mimeType] };
}

export function decodeSceneImageBase64(value: string): Buffer {
  if (typeof value !== "string" || !value || value.length > 4 * Math.ceil(SCENE_IMAGE_MAX_BYTES / 3) || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return invalidImage();
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > SCENE_IMAGE_MAX_BYTES || !decoded.length || decoded.toString("base64") !== value) return invalidImage();
  return decoded;
}

type AssetScope = "scene-image-config" | "scene-image-assets" | "scene-images" | "scene-image-tests";
function parseKey(userId: number, key: string, output: boolean): string[] {
  if (!positiveId(userId) || typeof key !== "string" || key.length > 250) return invalidAsset();
  const parts = key.split("/");
  const scope = parts[0];
  if (parts[1] !== String(userId) || (output ? scope !== "scene-images" && scope !== "scene-image-tests"
    : scope !== "scene-image-config" && scope !== "scene-image-assets")) return invalidAsset();
  if (scope === "scene-image-assets") {
    if (parts.length !== 4 || !/^[1-9][0-9]{0,15}$/.test(parts[2]) || !positiveId(Number(parts[2]))) return invalidAsset();
  } else if (parts.length !== 3) return invalidAsset();
  const leaf = parts[parts.length - 1];
  if (!LEAF.test(leaf) || WINDOWS_DEVICE.test(leaf) || leaf.includes("..")) return invalidAsset();
  return parts;
}

export function sceneImageReferenceKey(userId: number, key: string) {
  return parseKey(userId, key, false).join("/");
}

function samePath(left: string, right: string) { return path.relative(left, right) === ""; }
function sameFile(before: Stats, after: Stats) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
function isMissing(error: unknown) { return (error as NodeJS.ErrnoException | null)?.code === "ENOENT"; }
const OPEN_NOFOLLOW = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export function createSceneImageAssets(uploadDir: string) {
  async function safeRoot(create: boolean) {
    const configured = path.resolve(uploadDir);
    if (create) await mkdir(configured, { recursive: true });
    const root = await realpath(configured);
    if (!(await lstat(root)).isDirectory()) return invalidAsset();
    return root;
  }
  async function safeParent(root: string, pieces: string[], create: boolean) {
    let parent = root;
    for (const piece of pieces) {
      parent = path.join(parent, piece);
      if (create) {
        try { await mkdir(parent); }
        catch (error) { if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error; }
      }
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(parent, await realpath(parent))) return invalidAsset();
    }
    return parent;
  }
  async function safeExisting(parts: string[]) {
    const root = await safeRoot(false);
    const parent = await safeParent(root, parts.slice(0, -1), false);
    const target = path.join(parent, parts[parts.length - 1]);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(target, await realpath(target))) return invalidAsset();
    return { target, stat };
  }
  async function write(userId: number, scope: AssetScope, buffer: Buffer, mimeType: SceneImageMimeType) {
    if (!positiveId(userId)) return invalidAsset();
    const { extension } = inspectSceneImageBytes(buffer, mimeType);
    const leaf = `${randomUUID()}.${extension}`;
    const key = `${scope}/${userId}/${leaf}`;
    let root: string | undefined;
    let target: string | undefined;
    let created = false;
    try {
      root = await safeRoot(true);
      const parent = await safeParent(root, [scope, String(userId)], true);
      target = path.join(parent, leaf);
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | OPEN_NOFOLLOW, 0o600);
      created = true;
      try {
        if (!samePath(target, await realpath(target))) return invalidAsset();
        await handle.writeFile(buffer);
        if (!samePath(target, await realpath(target))) return invalidAsset();
      } finally { await handle.close(); }
      return { key, url: `/uploads/${key}` };
    } catch {
      if (created && target && root) {
        const contained = await realpath(target).then(actual => samePath(target!, actual), () => false);
        if (contained) await unlink(target).catch(() => {});
      }
      return storageError();
    }
  }
  return {
    uploadSceneImageReference(userId: number, base64: string, mimeType: SceneImageMimeType) {
      return write(userId, "scene-image-config", decodeSceneImageBase64(base64), mimeType);
    },
    async readSceneImageAsset(userId: number, key: string) {
      const parts = parseKey(userId, key, false);
      let buffer: Buffer;
      try {
        const { target, stat } = await safeExisting(parts);
        if (stat.size < 1 || stat.size > SCENE_IMAGE_MAX_BYTES) return invalidImage();
        const file = await open(target, constants.O_RDONLY | OPEN_NOFOLLOW);
        try {
          const checked = await file.stat();
          if (!sameFile(stat, checked) || !samePath(target, await realpath(target))) return invalidAsset();
          buffer = Buffer.allocUnsafe(checked.size);
          for (let offset = 0; offset < buffer.length;) {
            const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) return invalidAsset();
            offset += bytesRead;
          }
          if (!sameFile(checked, await file.stat()) || !samePath(target, await realpath(target))) return invalidAsset();
        } finally { await file.close(); }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return invalidAsset();
      }
      const leaf = parts[parts.length - 1].toLowerCase();
      const expected = leaf.endsWith(".png") ? "image/png" : leaf.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const { mimeType } = inspectSceneImageBytes(buffer, expected);
      return { buffer, mimeType, key: parts.join("/") };
    },
    writeSceneImageOutput(userId: number, buffer: Buffer, mimeType: SceneImageMimeType, isTest = false) {
      return write(userId, isTest ? "scene-image-tests" : "scene-images", buffer, mimeType);
    },
    async deleteSceneImageReference(userId:number,key:string) {
      const parts=parseKey(userId,key,false);
      try {const {target}=await safeExisting(parts);await unlink(target);return true;}
      catch(error){if(isMissing(error))return false;if(error instanceof TRPCError)throw error;return storageError();}
    },
    async deleteSceneImageOutput(userId: number, key: string) {
      const parts = parseKey(userId, key, true);
      try {
        const { target } = await safeExisting(parts);
        await unlink(target);
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        if (error instanceof TRPCError) throw error;
        return storageError();
      }
    },
  };
}

export const { uploadSceneImageReference, readSceneImageAsset, writeSceneImageOutput, deleteSceneImageOutput, deleteSceneImageReference } = createSceneImageAssets(ENV.uploadDir);
