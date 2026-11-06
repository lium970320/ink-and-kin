import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { users } from "../../drizzle/schema";
import { voiceConfigs } from "../../drizzle/voice-schema";
import * as db from "../db";
import {
  getVoiceConfig, getVoiceSecretConfig, isVoiceConfigCurrent, normalizeVoiceBaseUrl,
  saveVoiceConfig, voiceTranscriptionUrl, type VoiceSettings,
} from "./config";

describe("语音服务地址", () => {
  it("规范化端点且只拼接一次转写路径", () => {
    expect(normalizeVoiceBaseUrl(" HTTPS://Audio.Example:443/v1/audio/transcriptions/ ")).toBe("https://audio.example/v1");
    expect(voiceTranscriptionUrl("http://127.0.0.1:8150/v1/")).toBe("http://127.0.0.1:8150/v1/audio/transcriptions");
    expect(voiceTranscriptionUrl("http://[::1]:8150")).toBe("http://[::1]:8150/audio/transcriptions");
  });

  it.each([
    "http://audio.example/v1",
    "http://localhost.evil.example/v1",
    "https://user:secret@audio.example/v1",
    "https://@audio.example/v1",
    "https://audio.example/v1?token=synthetic",
    "https://audio.example/v1?",
    "https://audio.example/v1#section",
    "https://audio.example\\v1",
  ])("拒绝不安全或混淆的端点 %s", value => {
    expect(() => normalizeVoiceBaseUrl(value)).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });
});

const url = process.env.INK_AND_KIN_VOICE_TEST_DATABASE_URL;
const databaseSuite = url ? describe : describe.skip;
let connection: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
let previous: string | undefined;
let switched = false;
const created: number[] = [];

function database() {
  if (!connection) throw new Error("未初始化语音验收隔离数据库。");
  return connection;
}

async function account() {
  const [row] = await database().insert(users).values({ username: "voice-acceptance-" + randomUUID(), name: "合成语音验收账号" })
    .returning({ id: users.id });
  created.push(row.id);
  return row.id;
}

const enabled: VoiceSettings = {
  asrEnabled: true, baseUrl: "https://speech.example/v1", model: "synthetic-asr",
  timeoutMs: 60_000, ttsEnabled: true,
};

databaseSuite("语音配置隔离 PostgreSQL 验收", () => {
  beforeAll(async () => {
    let parsed: URL;
    try { parsed = new URL(url!); } catch { throw new Error("隔离库连接地址无效。"); }
    const port = Number(parsed.port);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || !Number.isInteger(port) || port < 1 || port === 5434 || parsed.pathname !== "/ink_and_kin_batch8" || parsed.search || parsed.hash) {
      throw new Error("语音验收只接受本机非 5434 端口的 ink_and_kin_batch8 隔离库。");
    }
    previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url!;
    switched = true;
    connection = await db.getDb() ?? undefined;
    const result = await database().execute(sql`
      SELECT current_database() AS name, inet_server_port() AS port, to_regclass('public.voice_configs') IS NOT NULL AS ready`);
    expect(result.rows[0]).toMatchObject({ name: "ink_and_kin_batch8", port, ready: true });
  }, 30_000);

  afterEach(async () => {
    for (const userId of created.splice(0)) await db.deleteUserAccount(userId);
  }, 30_000);

  afterAll(async () => {
    try { await connection?.$client.end(); }
    finally {
      if (switched) {
        if (previous === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previous;
      }
    }
  }, 30_000);

  it("默认只保留手动朗读；隔离密钥、版本及删除范围", async () => {
    const owner = await account();
    const other = await account();
    expect(await getVoiceConfig(owner)).toEqual({
      asrEnabled: false, baseUrl: "", model: "", timeoutMs: 60_000, ttsEnabled: true,
      revision: 0, apiKeyConfigured: false, maxDurationSeconds: 30,
    });
    await expect(saveVoiceConfig(owner, 0, enabled)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const first = await saveVoiceConfig(owner, 0, enabled, "synthetic-owner-secret");
    expect(first).toMatchObject({ revision: 1, apiKeyConfigured: true });
    expect(first).not.toHaveProperty("apiKey");
    expect(first).not.toHaveProperty("apiKeyEnc");
    const [stored] = await database().select().from(voiceConfigs).where(eq(voiceConfigs.userId, owner));
    expect(stored.apiKeyEnc).toMatch(/^v1:/);
    expect(stored.apiKeyEnc).not.toContain("synthetic-owner-secret");
    expect((await getVoiceSecretConfig(owner)).apiKey).toBe("synthetic-owner-secret");
    expect((await getVoiceSecretConfig(other)).apiKey).toBeNull();
    expect(await isVoiceConfigCurrent(owner, 1)).toBe(true);

    await db.deleteUserAccount(owner);
    created.splice(created.indexOf(owner), 1);
    expect(await database().select().from(voiceConfigs).where(eq(voiceConfigs.userId, owner))).toEqual([]);
    expect(await isVoiceConfigCurrent(owner, 1)).toBe(false);
    expect(await getVoiceConfig(other)).toMatchObject({ revision: 0, apiKeyConfigured: false });
  }, 30_000);

  it("并发首次保存只成功一次；同端点省略密钥保留，换端点必须明确处理", async () => {
    const owner = await account();
    const concurrent = await Promise.allSettled([
      saveVoiceConfig(owner, 0, enabled, "synthetic-first"),
      saveVoiceConfig(owner, 0, enabled, "synthetic-second"),
    ]);
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = concurrent.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(loser?.reason).toMatchObject({ code: "CONFLICT" });
    const original = (await getVoiceSecretConfig(owner)).apiKey;
    const retained = await saveVoiceConfig(owner, 1, { ...enabled, baseUrl: enabled.baseUrl + "/", ttsEnabled: false });
    expect(retained).toMatchObject({ revision: 2, apiKeyConfigured: true, ttsEnabled: false });
    expect((await getVoiceSecretConfig(owner)).apiKey).toBe(original);
    expect(await isVoiceConfigCurrent(owner, 1)).toBe(false);

    const moved = { ...enabled, baseUrl: "https://other-speech.example/v1" };
    await expect(saveVoiceConfig(owner, 2, moved)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(saveVoiceConfig(owner, 2, moved, null)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const replaced = await saveVoiceConfig(owner, 2, moved, "synthetic-replacement");
    expect(replaced).toMatchObject({ revision: 3, baseUrl: moved.baseUrl });
    expect((await getVoiceSecretConfig(owner)).apiKey).toBe("synthetic-replacement");
    const cleared = await saveVoiceConfig(owner, 3, { ...moved, asrEnabled: false }, null);
    expect(cleared).toMatchObject({ revision: 4, asrEnabled: false, apiKeyConfigured: false });
    expect((await getVoiceSecretConfig(owner)).apiKey).toBeNull();
  }, 30_000);
});
