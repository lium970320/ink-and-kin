/**
 * 场景配图参考图键的校验与归一化。
 *
 * 从自用版 `server/routers.ts` 的参考图辅助（以及 `server/image/scene-image-provider.ts`
 * 的 `isSceneImageReferenceKeyForUser`）抽出为独立模块，供场景路由与第 8 批的场景配图
 * 生成链路共用。这里只有纯字符串校验，不读取文件、不接触上传目录。
 *
 * 参考图只允许来自当前账号自己的两个上传前缀：
 *   - `scene-image-config/<userId>/` 设置页上传的参考图；
 *   - `scene-image-assets/<userId>/` 场景设置页上传的定妆图/环境图。
 */
import { TRPCError } from "@trpc/server";

/** 单张参考图/场景资产图的大小上限（10 MB）。 */
export const SCENE_IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

/** 允许的图片 MIME 类型；顺序与自用版一致。 */
export const SCENE_IMAGE_REFERENCE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type SceneImageReferenceMimeType = (typeof SCENE_IMAGE_REFERENCE_MIME_TYPES)[number];

/** 参考图键允许的字符集：路径段、下划线、点、短横线。 */
const SAFE_REFERENCE_KEY = /^[A-Za-z0-9_./-]+$/;

/** 某个账号可用的参考图键前缀。 */
export function sceneImageReferenceKeyPrefixes(userId: number): string[] {
  return [`scene-image-config/${userId}/`, `scene-image-assets/${userId}/`];
}

function normalizeReferenceKey(value: string): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

/** 供设置路由验证：参考图键必须属于当前用户的专用 uploads 前缀。 */
export function isSceneImageReferenceKeyForUser(key: string, userId: number): boolean {
  const normalized = normalizeReferenceKey(key);
  if (!normalized) return false;
  if (normalized.includes("..")) return false;
  if (!SAFE_REFERENCE_KEY.test(normalized)) return false;
  return sceneImageReferenceKeyPrefixes(userId).some(prefix => normalized.startsWith(prefix));
}

/**
 * 归一化并校验参考图键；不属于当前账号时抛 BAD_REQUEST。
 *
 * 报错文案与自用版一致，前端会直接展示这条消息。
 */
export function normalizeSceneImageReferenceKey(value: string, userId: number): string {
  const key = normalizeReferenceKey(value);
  if (!isSceneImageReferenceKeyForUser(key, userId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "参考图必须是当前账户通过场景配图设置上传的图片" });
  }
  return key;
}

/**
 * 按文件头魔数确认上传内容与所选 MIME 类型一致，返回落盘扩展名。
 *
 * 只信任文件头，不信任客户端声明的 mimeType：两者不一致时返回 null，
 * 由调用方转成 BAD_REQUEST。
 */
export function detectSceneImageReferenceExtension(
  buffer: Buffer,
  mimeType: SceneImageReferenceMimeType,
): string | null {
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "image/png" && isPng) return "png";
  if (mimeType === "image/jpeg" && isJpeg) return "jpg";
  if (mimeType === "image/webp" && isWebp) return "webp";
  return null;
}
