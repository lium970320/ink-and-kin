import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { personaRuntimeStates } from "../../drizzle/runtime-state-schema";
import * as db from "../db";
import { createPersonaRuntimeService } from "./runtime";

const testUrl = process.env.INK_AND_KIN_RUNTIME_TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;
const databaseName = "ink_and_kin_batch7";
const tag = randomUUID().replace(/-/g, "").slice(0, 12);
let priorUrl: string | undefined;
let client: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
let validatedDatabase = false;
const owners: Array<{ id: number; username: string }> = [];

function scopedPort(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("临时态测试库地址格式无效。"); }
  const port = Number(url.port);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !Number.isInteger(port) || port <= 0 || port === 5434 || port > 65535 || url.pathname !== `/${databaseName}`
    || value.includes("?") || value.includes("#")) {
    throw new Error("临时态测试只接受显式非 5434 端口的本机 ink_and_kin_batch7 隔离库。");
  }
  return port;
}

async function createOwner(label: string) {
  const username = `runtime-${tag}-${label}`;
  const id = await db.createUser({ username, name: "合成临时态验收", passwordHash: "synthetic-not-a-login-hash" });
  owners.push({ id, username });
  return id;
}

integration("人物临时态隔离 PostgreSQL", () => {
  beforeAll(async () => {
    priorUrl = process.env.DATABASE_URL;
    const port = scopedPort(testUrl!);
    process.env.DATABASE_URL = testUrl;
    client = (await db.getDb()) ?? undefined;
    if (!client) throw new Error("未能连接临时态隔离库。");
    const identity = await client.execute(sql`SELECT current_database() AS name, inet_server_port() AS port`);
    expect(identity.rows[0]).toEqual({ name: databaseName, port });
    validatedDatabase = true;
  });

  afterAll(async () => {
    try {
      if (validatedDatabase) {
        for (const owner of owners) {
          const row = await db.getUserById(owner.id);
          if (!row) continue;
          expect(row.username).toBe(owner.username);
          await db.deleteUserAccount(owner.id);
        }
      }
    } finally {
      await client?.$client.end();
      if (priorUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorUrl;
    }
  });

  it("只允许属主修改；并发首写一胜一冲突，过期和清空保留版本，删除人物级联", async () => {
    const userId = await createOwner("owner");
    const otherId = await createOwner("other");
    const id = await db.createPersona({ userId, name: "合成旅人" });
    const initialNow = new Date("2026-11-06T14:30:00.000Z");
    const expiresAt = "2026-11-06T15:30:00.000Z";
    let now = initialNow;
    const runtime = createPersonaRuntimeService({ now: () => now });
    const scope = and(eq(personaRuntimeStates.userId, userId), eq(personaRuntimeStates.personaId, id));
    const original = { id, status: "休息", expiresAt, expectedRevision: 0 };
    await expect(runtime.getRuntimeStateForChat(otherId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runtime.setRuntimeState(otherId, original)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runtime.clearRuntimeState(otherId, { id, expectedRevision: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runtime.probe(otherId, { personaId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const results = await Promise.allSettled([runtime.setRuntimeState(userId, original), runtime.setRuntimeState(userId, { ...original, status: "读书" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await runtime.getRuntimeStateForChat(userId, id)).toMatchObject({ runtimeStateRevision: 1, runtimeLifeState: { expiresAt, source: "user" } });

    // 外键自身也拒绝跨账号，不能只依赖当前路由调用顺序。
    await expect(client!.insert(personaRuntimeStates).values({ userId: otherId, personaId: id, revision: 1 }))
      .rejects.toMatchObject({ cause: { code: "23503" } });
    now = new Date(expiresAt);
    await expect(runtime.getRuntimeStateForChat(userId, id)).resolves.toEqual({ runtimeStateRevision: 1, runtimeLifeState: null });
    await expect(runtime.clearRuntimeState(userId, { id, expectedRevision: 1 })).resolves.toEqual({ runtimeStateRevision: 2, runtimeLifeState: null });
    await expect(runtime.setRuntimeState(userId, { ...original, expiresAt: "2026-11-06T16:30:00Z", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(runtime.probe(userId, { personaId: id, inputText: "只用于这一次试算" }))
      .resolves.toMatchObject({ simulated: true, persisted: false, scheduleState: { stateId: "unknown" } });
    expect(await client!.select({ status: personaRuntimeStates.status, revision: personaRuntimeStates.revision }).from(personaRuntimeStates).where(scope))
      .toEqual([{ status: null, revision: 2 }]);
    await db.deletePersona(id, userId);
    expect(await client!.select().from(personaRuntimeStates).where(scope)).toEqual([]);
  });
});
