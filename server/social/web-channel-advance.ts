/** 网页推进的任务身份；进程重启后旧请求自然失效，不保存到剧情数据库。 */
export type WebChannelAdvanceTask = {
  channelId: number;
  userId: number;
  taskId: string;
  clientId: string;
  sequence: number;
  requestOrder: number;
  stopped: boolean;
};

export const WEB_ADVANCE_TASK_ID_PATTERN = /^([A-Za-z0-9_-]{8,80}):([1-9][0-9]{0,9})$/;

export class WebChannelAdvanceCancelledError extends Error {
  constructor() {
    super("网页推进任务已停止");
    this.name = "WebChannelAdvanceCancelledError";
  }
}

type ClientRun = { sequence: number; taskId: string; ended: boolean; touchedAt: number };
type TurnLease = { task: WebChannelAdvanceTask; settled: Promise<void>; release: () => void };
const activeTasks = new Map<string, WebChannelAdvanceTask>();
const clientRuns = new Map<string, ClientRun>();
const inFlightTurns = new Map<string, TurnLease>();
const lastStartOrders = new Map<string, { order: number; touchedAt: number }>();
let nextRequestOrder = 0;
// 留下已结束编号，防止迟到的 start 请求复活旧任务；闲置页面的记录按需回收。
const ENDED_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

function channelKey(channelId: number, userId: number): string {
  return `${userId}:${channelId}`;
}

function parseTaskId(taskId: string): { clientId: string; sequence: number } {
  const match = WEB_ADVANCE_TASK_ID_PATTERN.exec(taskId);
  if (!match) throw new Error("网页推进任务编号无效");
  return { clientId: match[1], sequence: Number(match[2]) };
}

function clientKey(channelId: number, userId: number, clientId: string): string {
  return `${channelKey(channelId, userId)}:${clientId}`;
}

function pruneEndedRuns(): void {
  const oldest = Date.now() - ENDED_RUN_RETENTION_MS;
  for (const [key, run] of Array.from(clientRuns)) {
    if (run.ended && run.touchedAt < oldest) clientRuns.delete(key);
  }
  for (const [key, start] of Array.from(lastStartOrders)) {
    if (start.touchedAt < oldest && !activeTasks.has(key) && !inFlightTurns.has(key)) lastStartOrders.delete(key);
  }
}

/** 在权限查询之前取得到达顺序，跨页面的慢旧请求也不能覆盖后来开始的任务。 */
export function reserveWebChannelAdvanceOrder(): number {
  return ++nextRequestOrder;
}

function endTask(task: WebChannelAdvanceTask): void {
  task.stopped = true;
  const key = channelKey(task.channelId, task.userId);
  if (activeTasks.get(key) === task) activeTasks.delete(key);
  const run = clientRuns.get(clientKey(task.channelId, task.userId, task.clientId));
  if (run?.taskId === task.taskId) {
    run.ended = true;
    run.touchedAt = Date.now();
  }
}

export function startWebChannelAdvance(params: {
  channelId: number; userId: number; taskId: string;
}, requestOrder = reserveWebChannelAdvanceOrder()): WebChannelAdvanceTask | null {
  pruneEndedRuns();
  const { clientId, sequence } = parseTaskId(params.taskId);
  const key = channelKey(params.channelId, params.userId);
  const runKey = clientKey(params.channelId, params.userId, clientId);
  const previousRun = clientRuns.get(runKey);
  if (requestOrder < (lastStartOrders.get(key)?.order ?? 0)) return null;
  // 同一页面只承认最新序号；停止先到、旧 start 后到也不能抢占新任务。
  if (previousRun && sequence <= previousRun.sequence) {
    if (sequence < previousRun.sequence || previousRun.ended) return null;
    const current = activeTasks.get(key);
    return current?.taskId === params.taskId ? current : null;
  }
  const previousTask = activeTasks.get(key);
  if (previousTask) endTask(previousTask);
  const task: WebChannelAdvanceTask = { ...params, clientId, sequence, requestOrder, stopped: false };
  lastStartOrders.set(key, { order: requestOrder, touchedAt: Date.now() });
  clientRuns.set(runKey, { sequence, taskId: params.taskId, ended: false, touchedAt: Date.now() });
  activeTasks.set(key, task);
  return task;
}

export function getCurrentWebChannelAdvanceTask(channelId: number, userId: number): WebChannelAdvanceTask | null {
  return activeTasks.get(channelKey(channelId, userId)) ?? null;
}

export function getWebChannelAdvanceTask(params: {
  channelId: number; userId: number; taskId: string;
}): WebChannelAdvanceTask | null {
  const task = activeTasks.get(channelKey(params.channelId, params.userId));
  return task?.taskId === params.taskId && !task.stopped ? task : null;
}

export function isCurrentWebChannelAdvanceTask(task: WebChannelAdvanceTask): boolean {
  return !task.stopped && activeTasks.get(channelKey(task.channelId, task.userId)) === task;
}

export function stopWebChannelAdvance(params: {
  channelId: number; userId: number; taskId?: string;
}): boolean {
  const key = channelKey(params.channelId, params.userId);
  const current = activeTasks.get(key);
  if (!params.taskId) {
    // 旧单轮接口尚在权限查询时也能停止，拒绝此前已到达但还未登记的请求。
    lastStartOrders.set(key, { order: reserveWebChannelAdvanceOrder(), touchedAt: Date.now() });
    if (!current) return false;
    endTask(current);
    return true;
  }
  const { clientId, sequence } = parseTaskId(params.taskId);
  const runKey = clientKey(params.channelId, params.userId, clientId);
  const previousRun = clientRuns.get(runKey);
  // 即使 start 还在等待权限查询，停止也先留下该编号已结束的事实。
  if (!previousRun || sequence > previousRun.sequence) {
    clientRuns.set(runKey, { sequence, taskId: params.taskId, ended: true, touchedAt: Date.now() });
  } else if (sequence === previousRun.sequence) {
    previousRun.ended = true;
    previousRun.touchedAt = Date.now();
  }
  if (current?.taskId !== params.taskId) return false;
  endTask(current);
  return true;
}

export function finishWebChannelAdvance(params: {
  channelId: number; userId: number; taskId: string;
}): boolean {
  return stopWebChannelAdvance(params);
}

/**
 * 旧模型请求只能在返回后丢弃结果；新网页任务等待它释放生成锁，避免停止后立即重开被误报繁忙。
 * 等待和 finally 都按实际调用持有的租约处理，旧任务不能释放新调用的锁。
 */
export async function runWebChannelAdvanceTurn<T>(
  task: WebChannelAdvanceTask,
  run: (shouldAbort: () => boolean) => Promise<T>,
): Promise<T> {
  const key = channelKey(task.channelId, task.userId);
  const assertCurrent = () => {
    if (!isCurrentWebChannelAdvanceTask(task)) throw new WebChannelAdvanceCancelledError();
  };
  assertCurrent();
  while (inFlightTurns.has(key)) {
    const previous = inFlightTurns.get(key)!;
    await previous.settled;
    assertCurrent();
  }
  let release!: () => void;
  const settled = new Promise<void>(resolve => { release = resolve; });
  const lease: TurnLease = { task, settled, release };
  inFlightTurns.set(key, lease);
  try {
    assertCurrent();
    const result = await run(() => !isCurrentWebChannelAdvanceTask(task));
    assertCurrent();
    return result;
  } finally {
    if (inFlightTurns.get(key) === lease) inFlightTurns.delete(key);
    lease.release();
  }
}
