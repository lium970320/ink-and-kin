import { runReminderSweep } from "./reminders";
import { runProactiveSweep, startProactiveTasks, stopProactiveTasks } from "../proactive";
const TICK_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let running: Promise<void> | null = null;
async function sweep(signal: AbortSignal): Promise<void> {
  if (signal.aborted || running) return;
  const task = (async () => {
    try {
      await runReminderSweep(new Date(), signal);
      if (!signal.aborted) await runProactiveSweep();
    } catch { if (!signal.aborted) console.warn("[Scheduler] 本轮调度未完成。"); }
  })();
  running = task;
  try { await task; } finally { if (running === task) running = null; }
}
export function startScheduler(): void {
  if (timer) return;
  startProactiveTasks();
  const active = new AbortController(); controller = active;
  timer = setInterval(() => { void sweep(active.signal); }, TICK_INTERVAL_MS); timer.unref?.();
  first = setTimeout(() => { first = null; void sweep(active.signal); }, 10_000); first.unref?.();
  console.log("[Scheduler] Started");
}
export function stopScheduler(): void {
  controller?.abort(); controller = null;
  if (timer) clearInterval(timer); timer = null;
  if (first) clearTimeout(first); first = null;
  stopProactiveTasks();
}
