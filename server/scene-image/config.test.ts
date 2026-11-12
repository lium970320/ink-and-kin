import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "../_core/crypto";
import * as db from "../db";
import { deleteSceneImageRelay, getSceneImageConfig, getSceneImageRuntimeConfig, normalizeSceneImageBaseUrl, projectSceneImageExtraConfig,
  resolveSceneImageRelayDraft, resolveSceneImageSecretEdit, saveSceneImageRelay, saveSceneImageSettings, withSceneImageConfigRevision,
  type SceneImageRelayInput, type StoredSceneImageRelay } from "./config";

const relay = {
  relayName: "合成图片中转站", priority: 100, enabled: true, baseUrl: "https://example.invalid/images", model: "synthetic-image",
  protocol: "openai", size: "1024x1024", timeoutMs: 180000, formalReferenceEnabled: false, workflowJson: null, extraConfig: null,
} satisfies SceneImageRelayInput;

const prior: StoredSceneImageRelay = { ...relay, id: 1, apiKeyEnc: "fixture-only-encrypted-envelope" };

describe("配图配置边界", () => {
  it("按规范化地址比较；拒绝 URL 凭据和明文外站", () => {
    expect(normalizeSceneImageBaseUrl(" https://EXAMPLE.invalid:443/images/ ")).toBe(relay.baseUrl);
    expect(normalizeSceneImageBaseUrl("http://127.0.0.1:8188/")).toBe("http://127.0.0.1:8188");
    for (const input of ["http://example.invalid/images", "https://user:secret@example.invalid/", "https://example.invalid/?key=example", "https://example.invalid/#fragment"]) {
      expect(() => normalizeSceneImageBaseUrl(input)).toThrow();
    }
  });

  it("空字符串只在同地址同协议保留旧密钥；换地址或协议需要替换或清除", () => {
    expect(resolveSceneImageSecretEdit(relay, " ", prior)).toBeUndefined();
    const moved = { ...relay, baseUrl: "https://another.invalid/images" };
    expect(() => resolveSceneImageSecretEdit(moved, undefined, prior)).toThrow();
    expect(() => resolveSceneImageSecretEdit({ ...relay, protocol: "auto" }, "", prior)).toThrow();
    expect(resolveSceneImageSecretEdit(moved, null, prior)).toBeNull();
    expect(resolveSceneImageSecretEdit(moved, "new-synthetic-secret", prior)).toBe("new-synthetic-secret");
  });

  it("自动识别协议切换时不能把旧密钥交给新协议", () => {
    const auto = { ...prior, protocol: "auto", model: "gpt-image-1" } satisfies StoredSceneImageRelay;
    const gemini = { ...auto, model: "gemini-2.0-flash" };
    const comfy = { ...auto, workflowJson: "{}" };
    expect(() => resolveSceneImageSecretEdit(gemini, undefined, auto)).toThrow();
    expect(() => resolveSceneImageSecretEdit(comfy, "", auto)).toThrow();
    expect(resolveSceneImageSecretEdit({ ...auto, model: "gpt-image-2" }, undefined, auto)).toBeUndefined();
    expect(resolveSceneImageSecretEdit(gemini, null, auto)).toBeNull();
  });

  it("密钥长度上限与图片协议执行器一致", () => {
    const maxKey = "x".repeat(2048);
    expect(resolveSceneImageSecretEdit(relay, maxKey)).toBe(maxKey);
    expect(() => resolveSceneImageSecretEdit(relay, maxKey + "x")).toThrow();
  });

  it("扩展配置仅保留工作流节点映射，未知字段和秘密不会反射", () => {
    expect(projectSceneImageExtraConfig({ token: "fixture-token", url: "https://example.invalid", nodeMapping: {
      positivePromptNodeId: 3, userLoadImageNodeId: "user_4", modelNodeId: "../../bad", password: "fixture-password",
    }, referenceNodes: { persona: "node-8", env: "https://example.invalid", other: "fixture-secret" } })).toEqual({
      nodeMapping: { positivePromptNodeId: "3", userLoadImageNodeId: "user_4" }, referenceNodes: { persona: "node-8" },
    });
  });
});

const testUrl = process.env.INK_AND_KIN_SCENE_IMAGE_TEST_DATABASE_URL;
const isolated = testUrl ? describe : describe.skip;
const owners: Array<{ id: number; username: string }> = [];
let pool: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
let priorUrl: string | undefined;
let validated = false;

isolated("配图配置隔离 PostgreSQL", () => {
  beforeAll(async () => {
    priorUrl = process.env.DATABASE_URL;
    const url = new URL(testUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !url.port || url.port === "5434"
      || url.pathname !== "/ink_and_kin_batch8b" || testUrl!.includes("?") || testUrl!.includes("#")) throw new Error("配图回归只允许本批本机隔离库。");
    process.env.DATABASE_URL = testUrl;
    pool = (await db.getDb()) ?? undefined;
    if (!pool) throw new Error("本批隔离库不可用。");
    const identity = await pool.$client.query("SELECT current_database() AS name, inet_server_port() AS port");
    expect(identity.rows[0]).toEqual({ name: "ink_and_kin_batch8b", port: Number(url.port) });
    validated = true;
  });
  afterAll(async () => {
    try {
      if (validated) for (const { id, username } of owners) {
        expect((await db.getUserById(id))?.username).toBe(username);
        await db.deleteUserAccount(id);
      }
    } finally {
      try { await pool?.$client.end(); }
      finally { if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl; }
    }
  });

  async function owner() {
    const username = `scene-image-${randomUUID()}`;
    const id = await db.createUser({ username, passwordHash: "synthetic-not-for-login", name: "合成配图账号" });
    owners.push({ id, username });
    return id;
  }

  it("首写并发 CAS、密文、独立序号、选站归属和最终发布版本", async () => {
    const user = await owner(), outsider = await owner();
    const key = "synthetic-secret-only-in-fixture";
    expect(await getSceneImageConfig(user)).toMatchObject({ enabled: false, source: "none", revision: 0, referenceAvailable: false, cooldownMinutes: 0, maxPerHour: 0, relays: [] });
    const initial = await Promise.allSettled([
      saveSceneImageRelay(user, 0, { ...relay, apiKey: key }),
      saveSceneImageRelay(user, 0, { ...relay, apiKey: key }),
    ]);
    expect(initial.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(initial.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const dto = await getSceneImageConfig(user);
    expect(dto).toMatchObject({ revision: 1, relays: [{ id: 1, apiKeyConfigured: true }] });
    expect(JSON.stringify(dto)).not.toContain(key);
    const raw = await pool!.$client.query<{ relays: Array<{ apiKeyEnc: string }> }>(
      `SELECT relays FROM scene_image_configs WHERE "userId"=$1`, [user],
    );
    expect(raw.rows[0].relays[0].apiKeyEnc).toMatch(/^v1:/);
    expect(JSON.stringify(raw.rows[0])).not.toContain(key);
    expect((await getSceneImageRuntimeConfig(user)).relays[0].apiKey).toBe(key);
    await expect(resolveSceneImageRelayDraft(outsider, 0, { ...relay, id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolveSceneImageRelayDraft(user, 1, { ...relay, id: 1, baseUrl: relay.baseUrl + "/" })).resolves.toMatchObject({ apiKey: key });
    await expect(resolveSceneImageRelayDraft(user, 1, { ...relay, id: 1, protocol: "google_gemini" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const cleared = await saveSceneImageRelay(user, 1, { ...relay, id: 1, apiKey: null, protocol: "google_gemini" });
    expect(cleared.relays[0].apiKeyConfigured).toBe(false);
    await expect(withSceneImageConfigRevision(user, 1, async () => "不应发布")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(withSceneImageConfigRevision(user, 2, async () => "允许发布")).resolves.toBe("允许发布");
    const removed = await deleteSceneImageRelay(user, 2, 1);
    expect(removed.relays).toEqual([]);
    expect((await saveSceneImageRelay(user, removed.revision, relay)).savedRelayId).toBe(2);
    const llm = { providerName: "OpenAI", relayName: "合成文字站", priority: 10, enabled: true,
      apiKey: await encryptSecret("synthetic-text-token"), baseUrl: "https://text.invalid/v1", model: "gpt-4o-mini" };
    const foreign = await db.saveLlmRelayConfig(outsider, llm);
    await expect(saveSceneImageSettings(user, 4, { promptRewriteRelayId: foreign })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const image = await db.saveLlmRelayConfig(user, { ...llm, model: "gpt-image-1" });
    await expect(saveSceneImageSettings(user, 4, { promptRewriteRelayId: image })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const text = await db.saveLlmRelayConfig(user, llm);
    expect(await saveSceneImageSettings(user, 4, { promptRewriteRelayId: text })).toMatchObject({ revision: 5, promptRewriteRelayId: text });
  });
});
