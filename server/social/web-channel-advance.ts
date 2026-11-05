/** 网页推进的任务身份；进程重启后旧请求自然失效，不保存到剧情数据库。 */
export type WebChannelAdvanceTask = {
  channelId: number;
  userId: number;
  taskId: string;
  clientId: string;
  sequence: number;
  requestOrder: number;
  generationRevision: number;
  signal: AbortSignal;
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
export type WebChannelAdvanceSave = <T>(write: () => Promise<T>) => Promise<T>;
type SaveLease = { task: WebChannelAdvanceTask; promise: Promise<unknown> };
type Operation = { fingerprint: string; result: Promise<unknown> };
const activeTasks = new Map<string, WebChannelAdvanceTask>();
const clientRuns = new Map<string, ClientRun>();
const inFlightTurns = new Map<string, TurnLease>();
const inFlightSaves = new Set<SaveLease>();
const operationsByTask = new WeakMap<WebChannelAdvanceTask, Map<string, Operation>>();
const abortControllers = new WeakMap<WebChannelAdvanceTask, AbortController>();
// 页面一次最多推进 50 拍；不能淘汰旧操作后让同一编号再次生成。
const MAX_OPERATIONS_PER_TASK = 100;
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
  abortControllers.get(task)?.abort();
}

export function startWebChannelAdvance(params: {
  channelId: number; userId: number; taskId: string; generationRevision: number;
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
  const controller = new AbortController();
  const task: WebChannelAdvanceTask = { ...params, clientId, sequence, requestOrder, signal: controller.signal, stopped: false };
  abortControllers.set(task, controller);
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

/** 同步终止旧任务，然后只等待该任务已进入的短写入；模型请求不参与等待。 */
export async function stopWebChannelAdvanceAndWait(params: {
  channelId: number; userId: number; taskId?: string;
}): Promise<boolean> {
  const stopped = stopWebChannelAdvance(params);
  const writes = Array.from(inFlightSaves).filter(({ task }) =>
    task.channelId === params.channelId && task.userId === params.userId
    && (!params.taskId || task.taskId === params.taskId));
  await Promise.allSettled(writes.map(({ promise }) => promise));
  return stopped;
}

export function finishWebChannelAdvanceAndWait(params: {
  channelId: number; userId: number; taskId: string;
}): Promise<boolean> {
  return stopWebChannelAdvanceAndWait(params);
}

/** 同一次逻辑拍共享进行中或已结束的结果，失败也不能用原编号重发模型。 */
export async function runWebChannelAdvanceTurn<T>(
  task: WebChannelAdvanceTask,
  operationId: string,
  fingerprint: string,
  run: (shouldAbort: () => boolean, save: WebChannelAdvanceSave) => Promise<T>,
): Promise<T> {
  if (!isCurrentWebChannelAdvanceTask(task)) throw new WebChannelAdvanceCancelledError();
  let operations = operationsByTask.get(task);
  if (!operations) {
    operations = new Map();
    operationsByTask.set(task, operations);
  }
  const previous = operations.get(operationId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error("推进操作编号已用于不同参数");
    return previous.result as Promise<T>;
  }
  if (operations.size >= MAX_OPERATIONS_PER_TASK) throw new Error("本次推进已达拍数上限，请重新开始");
  const result = Promise.resolve().then(() => runWithTurnLease(task, run));
  operations.set(operationId, { fingerprint, result });
  return result;
}

/**
 * 旧模型请求只能在返回后丢弃结果；新网页任务等待它释放生成锁，避免停止后立即重开被误报繁忙。
 * 等待和 finally 都按实际调用持有的租约处理，旧任务不能释放新调用的锁。
 */
async function runWithTurnLease<T>(
  task: WebChannelAdvanceTask,
  run: (shouldAbort: () => boolean, save: WebChannelAdvanceSave) => Promise<T>,
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
    const save: WebChannelAdvanceSave = async write => {
      assertCurrent();
      const promise = Promise.resolve().then(() => {
        assertCurrent();
        return write();
      });
      const saveLease = { task, promise };
      inFlightSaves.add(saveLease);
      try {
        return await promise;
      } finally {
        inFlightSaves.delete(saveLease);
      }
    };
    const result = await run(() => !isCurrentWebChannelAdvanceTask(task), save);
    assertCurrent();
    return result;
  } finally {
    if (inFlightTurns.get(key) === lease) inFlightTurns.delete(key);
    lease.release();
  }
}
