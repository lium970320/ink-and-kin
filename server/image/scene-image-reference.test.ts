import { describe, expect, it } from "vitest";
import {
  SCENE_IMAGE_REFERENCE_MAX_BYTES,
  SCENE_IMAGE_REFERENCE_MIME_TYPES,
  detectSceneImageReferenceExtension,
  isSceneImageReferenceKeyForUser,
  normalizeSceneImageReferenceKey,
} from "./scene-image-reference";

/** A PNG header, padded so the length checks see a real file-like buffer. */
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

describe("scene image reference constants", () => {
  it("accepts the three image types the upload endpoint allows", () => {
    expect([...SCENE_IMAGE_REFERENCE_MIME_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  it("caps a reference image at 10 MB", () => {
    expect(SCENE_IMAGE_REFERENCE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("detectSceneImageReferenceExtension", () => {
  it("returns the extension matching the file header", () => {
    expect(detectSceneImageReferenceExtension(PNG_HEADER, "image/png")).toBe("png");
    expect(detectSceneImageReferenceExtension(JPEG_HEADER, "image/jpeg")).toBe("jpg");
    expect(detectSceneImageReferenceExtension(WEBP_HEADER, "image/webp")).toBe("webp");
  });

  it("rejects a header that does not match the declared type", () => {
    expect(detectSceneImageReferenceExtension(PNG_HEADER, "image/jpeg")).toBeNull();
    expect(detectSceneImageReferenceExtension(JPEG_HEADER, "image/webp")).toBeNull();
    expect(detectSceneImageReferenceExtension(WEBP_HEADER, "image/png")).toBeNull();
  });

  it("rejects an empty or truncated buffer", () => {
    expect(detectSceneImageReferenceExtension(Buffer.alloc(0), "image/png")).toBeNull();
    expect(detectSceneImageReferenceExtension(Buffer.from([137, 80]), "image/png")).toBeNull();
  });
});

describe("isSceneImageReferenceKeyForUser", () => {
  it("accepts the account's own config and asset prefixes", () => {
    expect(isSceneImageReferenceKeyForUser("scene-image-config/7/ref.png", 7)).toBe(true);
    expect(isSceneImageReferenceKeyForUser("scene-image-assets/7/3/env-1.png", 7)).toBe(true);
  });

  it("refuses another account's prefix", () => {
    expect(isSceneImageReferenceKeyForUser("scene-image-config/8/ref.png", 7)).toBe(false);
    expect(isSceneImageReferenceKeyForUser("scene-image-assets/8/ref.png", 7)).toBe(false);
  });

  it("refuses path traversal and unrelated upload prefixes", () => {
    expect(isSceneImageReferenceKeyForUser("scene-image-config/7/../8/ref.png", 7)).toBe(false);
    expect(isSceneImageReferenceKeyForUser("personas/7/1/ref.png", 7)).toBe(false);
    expect(isSceneImageReferenceKeyForUser("", 7)).toBe(false);
  });
});

describe("normalizeSceneImageReferenceKey", () => {
  it("normalises Windows separators and leading slashes", () => {
    expect(normalizeSceneImageReferenceKey("\\scene-image-assets\\7\\3\\a.png", 7))
      .toBe("scene-image-assets/7/3/a.png");
  });

  it("rejects a key that belongs to another account", () => {
    expect(() => normalizeSceneImageReferenceKey("scene-image-config/8/ref.png", 7))
      .toThrowError(/参考图必须是当前账户/);
    try {
      normalizeSceneImageReferenceKey("scene-image-config/8/ref.png", 7);
    } catch (error) {
      expect((error as { code?: string }).code).toBe("BAD_REQUEST");
    }
  });
});
