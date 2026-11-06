import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../drizzle/schema";
import * as db from "../db";
import { createProactiveRepository } from "../proactive/repository";
import { validateSettings } from "../proactive/policy";
import { createDatabaseReminderDeliveryStore, createReminderDelivery, type ReminderDeliveryInput } from "./reminder-delivery";

type Store = Parameters<typeof createReminderDelivery>[0];
const input: ReminderDeliveryInput = {
  userId: 17, now: new Date("2026-11-06T12:00:00Z"),
  reminder: { kind: "anniversary", personaId: 11, personaName: "青石", text: "今天是纪念日。", dedupeKey: "anniversary:8:2026-11-06" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture() {
  const store = {
    recordWeb: vi.fn<Store["recordWeb"]>().mockResolvedValue(true),
    reserve: vi.fn<Store["reserve"]>().mockResolvedValueOnce(3).mockResolvedValue(null),
    start: vi.fn<Store["start"]>().mockImplementation(async (_input, _route, _id, initiate) => ({ completion: initiate() })),
    settle: vi.fn<Store["settle"]>().mockResolvedValue(true),
  };
  const route = { channel: "wechat" as const, targetId: "wx-test", send: vi.fn<() => Promise<boolean>>().mockResolvedValue(true) };
  return { store, route, deliver: createReminderDelivery(store) };
}

describe("纪念提醒的投递边界", () => {
  it("预留完成后才启动网络，并发第二轮拿不到预留就不重复发送", async () => {
    const f = fixture();
    const reserved = deferred<number>();
    const inFlight = deferred<boolean>();
    const started = deferred<void>();
    f.store.reserve.mockReset().mockReturnValueOnce(reserved.promise).mockResolvedValue(null);
    f.route.send.mockImplementationOnce(() => {
      started.resolve(undefined);
      return inFlight.promise;
    });
    const first = f.deliver(input, f.route);
    expect(f.route.send).not.toHaveBeenCalled();
    reserved.resolve(3);
    await started.promise;
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(f.route.send).toHaveBeenCalledTimes(1);
    inFlight.resolve(true);
    expect(await first).toBe(true);
    expect(f.store.settle.mock.calls).toEqual([[input, 3, "confirmed", "adapter_confirmed"]]);
    expect(f.store.recordWeb).not.toHaveBeenCalled();
  });

  it.each([false, new Error("无外部响应")])("派发后无明确回执保留未知，且不重发：%s", async result => {
    const f = fixture();
    if (result instanceof Error) f.route.send.mockRejectedValueOnce(result);
    else f.route.send.mockResolvedValueOnce(result);
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(f.route.send).toHaveBeenCalledTimes(1);
    expect(f.store.settle.mock.calls).toEqual([[input, 3, "unknown", "dispatch_unconfirmed"]]);
    expect(f.store.recordWeb).not.toHaveBeenCalled();
  });

  it("数据库确认写入失败后，不尝试重新发送或站内回退", async () => {
    const f = fixture();
    f.store.settle.mockRejectedValueOnce(new Error("写入不可用"));
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(f.route.send).toHaveBeenCalledTimes(1);
    expect(f.store.recordWeb).not.toHaveBeenCalled();
  });

  it("已经开始派发而派发事务提交失败，结果保持未知", async () => {
    const f = fixture();
    f.route.send.mockRejectedValueOnce(new Error("连接已断开"));
    f.store.start.mockImplementationOnce(async (_input, _route, _id, initiate) => {
      void initiate();
      throw new Error("提交不可用");
    });
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(f.route.send).toHaveBeenCalledTimes(1);
    expect(f.store.settle.mock.calls).toEqual([[input, 3, "unknown", "dispatch_unconfirmed"]]);
  });

  it("最终校验发现解绑或取消时，标记派发前失败，未开始发送", async () => {
    const f = fixture();
    f.store.start.mockResolvedValueOnce(null);
    expect(await f.deliver(input, f.route)).toBe(false);
    expect(f.route.send).not.toHaveBeenCalled();
    expect(f.store.settle.mock.calls).toEqual([[input, 3, "failed", "preflight_rejected"]]);
  });

  it("派发过程中停止时，不等待忽略中断的适配器，也不改为站内发送", async () => {
    const f = fixture();
    const stop = new AbortController();
    const request = { ...input, signal: stop.signal };
    const entered = deferred<void>();
    f.route.send.mockImplementationOnce(() => {
      entered.resolve(undefined);
      return deferred<boolean>().promise;
    });
    const sending = f.deliver(request, f.route);
    await entered.promise;
    stop.abort();
    expect(await sending).toBe(false);
    expect(f.store.settle.mock.calls).toEqual([[request, 3, "unknown", "dispatch_unconfirmed"]]);
    expect(f.store.recordWeb).not.toHaveBeenCalled();
  });

  it("没有外部渠道时，站内持久化是唯一动作", async () => {
    const f = fixture();
    expect(await f.deliver(input)).toBe(true);
    expect(f.store.recordWeb.mock.calls).toEqual([[input]]);
    expect(f.store.reserve).not.toHaveBeenCalled();
  });
});

const testUrl = process.env.INK_AND_KIN_PROACTIVE_TEST_DATABASE_URL;
const isolatedDb = testUrl ? describe : describe.skip;
isolatedDb("纪念提醒：隔离 PostgreSQL 投递", () => {
  let database: NonNullable<Awaited<ReturnType<typeof db.getDb>>> | undefined;
  let previousUrl: string | undefined;
  let changedUrl = false;
  const accounts: number[] = [];
  const repository = createProactiveRepository();

  beforeAll(async () => {
    const url = new URL(testUrl!);
    const port = Number(url.port);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || !Number.isInteger(port) || port < 1 || port === 5434 || url.pathname !== "/ink_and_kin_batch7" || url.search || url.hash) {
      throw new Error("纪念提醒验收只接受本机非 5434 端口的 ink_and_kin_batch7 隔离库。");
    }
    previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testUrl!;
    changedUrl = true;
    database = (await db.getDb()) ?? undefined;
    if (!database) throw new Error("无法连接纪念提醒隔离库。");
    const actual = await database.execute(sql`SELECT current_database() AS name, inet_server_port() AS port`);
    expect(actual.rows[0]).toMatchObject({ name: "ink_and_kin_batch7", port });
  }, 30_000);

  afterEach(async () => {
    for (const id of accounts.splice(0)) await db.deleteUserAccount(id);
  }, 30_000);

  afterAll(async () => {
    try { await database?.$client.end(); }
    finally {
      if (changedUrl) {
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
      }
    }
  }, 30_000);

  async function account() {
    if (!database) throw new Error("缺少已核验的隔离库。");
    const [user] = await database.insert(users).values({ username: "reminder-test-" + randomUUID() }).returning({ id: users.id });
    const userId = user.id;
    accounts.push(userId);
    const personaId = await db.createPersona({ userId, name: "青石", analysisStatus: "ready", remindersEnabled: true });
    await repository.savePolicy(userId, personaId, 0, validateSettings({ timeZone: "UTC", quietHours: "00:00-00:00" }), null);
    const targetId = "wechat-test";
    await db.createChannelBinding({ userId, personaId, channel: "wechat", targetId });
    const request = { ...input, userId, reminder: { ...input.reminder, personaId } };
    const store = createDatabaseReminderDeliveryStore(() => request.now);
    return { store, request, route: { channel: "wechat" as const, targetId, send: vi.fn<() => Promise<boolean>>().mockResolvedValue(true) } };
  }

  it("持久未知后才外发，其他事务可在网络结果返回前去重并读取未知状态", async () => {
    const { store, request, route } = await account();
    const deliver = createReminderDelivery(store);
    const entered = deferred<void>();
    const completion = deferred<boolean>();
    route.send.mockImplementationOnce(() => { entered.resolve(undefined); return completion.promise; });
    const sending = deliver(request, route);
    try {
      await Promise.race([entered.promise, sending.then(() => { throw new Error("适配器未进入。"); })]);
      expect(await deliver(request, route)).toBe(false);
      expect(await db.getActiveReminders(request.userId)).toMatchObject([{
        status: "unknown", reason: "dispatch_started", channel: "wechat", deliveredAt: null,
      }]);
      expect(route.send).toHaveBeenCalledTimes(1);
    } finally { completion.resolve(false); }
    expect(await sending).toBe(false);
    expect(await db.getActiveReminders(request.userId)).toMatchObject([{ status: "unknown", reason: "dispatch_unconfirmed" }]);
  }, 15_000);

  it("预留后撤销提醒或更新免打扰，最终锁内校验均挡住外发", async () => {
    const { store, request, route } = await account();
    const canceled = createReminderDelivery({ ...store,
      start: async (...args) => {
        await db.dismissReminder(args[2], request.userId);
        return store.start(...args);
      },
    });
    expect(await canceled(request, route)).toBe(false);
    expect(await db.getActiveReminders(request.userId)).toEqual([]);
    const muted = { ...request, reminder: { ...request.reminder, dedupeKey: "anniversary:9:2026-11-06" } };
    const quiet = createReminderDelivery({ ...store,
      start: async (...args) => {
        await repository.savePolicy(request.userId, request.reminder.personaId, 1,
          validateSettings({ timeZone: "UTC", quietHours: "12:00-13:00" }), null);
        return store.start(...args);
      },
    });
    expect(await quiet(muted, route)).toBe(false);
    expect(route.send).not.toHaveBeenCalled();
    expect(await db.getActiveReminders(request.userId)).toMatchObject([{ status: "failed", reason: "preflight_rejected" }]);
  }, 15_000);
});
