import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { mobileDevices, mobileSettings, users, type User } from "../../drizzle/schema";
import type { ProactiveTargetMode } from "../../shared/mobile";
import { ONE_YEAR_MS } from "../../shared/const";
import { getDb } from "../db";
import { ENV } from "../_core/env";

const CODE_TTL_SECONDS = 180;
const pairingCodes = new Map<string, { userId: number; expiresAt: number }>();
const codesByUser = new Map<number, string>();

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用。" });
  return db;
}

export function requireMobileEnabled() {
  if (!ENV.mobileEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此实例尚未启用手机直连。" });
}

export function createMobilePairingCode(userId: number) {
  const now = Date.now();
  for (const [code, entry] of Array.from(pairingCodes)) {
    if (entry.expiresAt > now) continue;
    pairingCodes.delete(code);
    codesByUser.delete(entry.userId);
  }

  const previous = codesByUser.get(userId);
  if (previous) pairingCodes.delete(previous);

  let code: string;
  do { code = String(randomInt(1_000_000)).padStart(6, "0"); } while (code === previous || pairingCodes.has(code));
  const expiresAt = now + CODE_TTL_SECONDS * 1000;
  pairingCodes.set(code, { userId, expiresAt });
  codesByUser.set(userId, code);
  return { code, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: CODE_TTL_SECONDS };
}

export function consumeMobilePairingCode(code: string) {
  const entry = pairingCodes.get(code);
  if (!entry) return null;
  pairingCodes.delete(code);
  codesByUser.delete(entry.userId);
  return entry.expiresAt > Date.now() ? entry.userId : null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMobileSession(user: User, deviceName: string | undefined) {
  const token = "ikm_" + randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const db = await database();
  await db.insert(mobileDevices).values({
    id: deviceId,
    userId: user.id,
    deviceName: deviceName?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) || "Android",
    tokenHash: hashToken(token),
    tokenVersion: user.tokenVersion,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS),
  });
  return { token, deviceId, user: { id: user.id, username: user.username, name: user.name || user.username } };
}

export async function readMobileSession(authorization: string | undefined, recordActivity = false) {
  const token = /^Bearer (ikm_[\w-]{43})$/i.exec(authorization ?? "")?.[1];
  if (!ENV.mobileEnabled || !token) return null;
  const db = await database();
  const [session] = await db.select({ user: users, deviceId: mobileDevices.id })
    .from(mobileDevices).innerJoin(users, eq(users.id, mobileDevices.userId))
    .where(and(
      eq(mobileDevices.tokenHash, hashToken(token)),
      eq(mobileDevices.tokenVersion, users.tokenVersion),
      isNull(mobileDevices.revokedAt),
      gt(mobileDevices.expiresAt, new Date()),
    )).limit(1);
  if (recordActivity && session) {
    const now = new Date();
    await db.update(mobileDevices).set({ lastSeenAt: now })
      .where(and(eq(mobileDevices.id, session.deviceId), lt(mobileDevices.lastSeenAt, new Date(+now - 60_000))));
  }
  return session ?? null;
}

export async function getMobileDevicesForUser(userId: number) {
  const db = await database();
  const devices = await db.select({
    id: mobileDevices.id,
    deviceName: mobileDevices.deviceName,
    createdAt: mobileDevices.createdAt,
    lastSeenAt: mobileDevices.lastSeenAt,
    revokedAt: mobileDevices.revokedAt,
  }).from(mobileDevices).innerJoin(users, eq(users.id, mobileDevices.userId))
    .where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.tokenVersion, users.tokenVersion),
      gt(mobileDevices.expiresAt, new Date())))
    .orderBy(mobileDevices.createdAt);
  return devices.map(device => ({
    ...device,
    createdAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeMobileDevice(userId: number, deviceId: string) {
  const db = await database();
  const rows = await db.update(mobileDevices).set({ revokedAt: new Date() })
    .where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.userId, userId), isNull(mobileDevices.revokedAt)))
    .returning({ id: mobileDevices.id });
  return rows.length > 0;
}

export async function getMobileSettings(userId: number) {
  const db = await database();
  const [settings] = await db.select().from(mobileSettings).where(eq(mobileSettings.userId, userId));
  return { proactiveTargetMode: settings?.proactiveTargetMode ?? "qq_first" as const };
}

export async function updateMobileSettings(userId: number, proactiveTargetMode: ProactiveTargetMode) {
  const db = await database();
  await db.insert(mobileSettings).values({ userId, proactiveTargetMode })
    .onConflictDoUpdate({ target: mobileSettings.userId, set: { proactiveTargetMode } });
  return { proactiveTargetMode };
}
