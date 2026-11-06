import { isQuiet, localClock } from "./policy";
import type { ProactiveClaim, ProactiveEnqueue, ProactiveJob, ProactivePolicy, ProactiveRepository, ProactiveDispatchSnapshot } from "./types";

const MINUTE = 60_000;
const WINDOW = 15 * MINUTE;
type SchedulerRepository = Pick<ProactiveRepository,
  "getPolicy" | "listEnabled" | "enqueue" | "pending" | "claim" | "saveText" | "deliverWeb" | "failBeforeDispatch">;

interface SchedulerDependencies {
  repo: SchedulerRepository;
  beforeGenerate?: (claim: ProactiveClaim, signal: AbortSignal) => Promise<ProactiveDispatchSnapshot | void>;
  generate: (claim: ProactiveClaim, signal: AbortSignal) => Promise<string>;
  /** Owns the dispatch guard and all outcome recording from the moment it is called. */
  deliverQq: (claim: ProactiveClaim, signal: AbortSignal, snapshot?: ProactiveDispatchSnapshot) => Promise<void>;
  now?: () => Date;
}

function minuteStart(time: number): number {
  return Math.floor(time / MINUTE) * MINUTE;
}

function expiresOnSameLocalDay(start: number, day: string, timeZone: string): Date {
  const end = start + WINDOW;
  for (let time = minuteStart(start) + MINUTE; time < end; time += MINUTE) {
    if (localClock(new Date(time), timeZone).day !== day) return new Date(time);
  }
  return new Date(end);
}

function scheduledJobs(policy: ProactivePolicy, now: Date): ProactiveEnqueue[] {
  if (!policy.times.length) return [];
  const clock = localClock(now, policy.timeZone);
  const current = minuteStart(+now);
  const seen = new Set<string>();
  const jobs: ProactiveEnqueue[] = [];
  // Walk real instants: skipped clock times have no match, and repeated times share one key.
  for (let time = current - WINDOW; time <= current; time += MINUTE) {
    if (time + WINDOW <= +now) continue;
    const { day, hhmm } = localClock(new Date(time), policy.timeZone);
    if (day !== clock.day || !policy.times.includes(hhmm) || seen.has(hhmm)) continue;
    const expiresAt = expiresOnSameLocalDay(time, day, policy.timeZone);
    if (+expiresAt <= +now) continue;
    seen.add(hhmm);
    jobs.push({
      kind: "scheduled", policyRevision: policy.revision, triggerKey: `scheduled:${day}:${hhmm}`,
      dueAt: new Date(time), expiresAt,
    });
  }
  return jobs;
}

export function createProactiveService({ repo, beforeGenerate, generate, deliverQq, now = () => new Date() }: SchedulerDependencies) {
  const controller = new AbortController();
  const { signal } = controller;
  let running: Promise<void> | null = null;
  let scanCursor = 0;

  async function processJob(job: ProactiveJob) {
    const claimTime = now();
    if (signal.aborted || +job.expiresAt <= +claimTime) return;
    const claim = await repo.claim(job, claimTime);
    if (!claim) return;
    const fail = (reason: string) => repo.failBeforeDispatch(claim, signal.aborted ? "scheduler_stopped" : reason);
    const interrupted = () => signal.aborted || +claim.job.expiresAt <= +now();
    if (interrupted()) return fail("generation_expired");

    let dispatchSnapshot: ProactiveDispatchSnapshot | void = undefined;
    if (beforeGenerate) {
      try {
        dispatchSnapshot = await beforeGenerate(claim, signal);
      } catch {
        return fail("preflight_rejected");
      }
      if (interrupted()) return fail("generation_expired");
    }

    let message: string;
    try {
      message = (await generate(claim, signal)).trim();
    } catch {
      return fail("model_failed");
    }
    if (interrupted()) return fail("generation_expired");
    if (!message) return fail("empty_generation");

    let saved: boolean;
    try {
      saved = await repo.saveText(claim, message, now(), signal);
    } catch (error) {
      await fail("text_rejected");
      if (!signal.aborted) throw error;
      return;
    }
    if (!saved) return fail("text_rejected");
    if (interrupted()) return fail("generation_expired");
    if (claim.policy.delivery === "qq") {
      // An I/O failure can be ambiguous. Only the transport knows whether it began dispatch.
      await deliverQq({ ...claim, job: { ...claim.job, status: "ready", text: message } }, signal, dispatchSnapshot || undefined);
      return;
    }

    let delivered: boolean;
    try {
      delivered = await repo.deliverWeb(claim, now(), signal);
    } catch (error) {
      await fail("web_delivery_rejected");
      if (!signal.aborted) throw error;
      return;
    }
    if (!delivered) await fail("web_delivery_rejected");
  }

  async function runSweep() {
    if (signal.aborted) return;
    for (const policy of await repo.listEnabled()) {
      if (signal.aborted) return;
      if (!policy.enabled) continue;
      for (const job of scheduledJobs(policy, now())) {
        if (signal.aborted) return;
        if (+job.expiresAt > +now()) await repo.enqueue(policy.userId, policy.personaId, job);
      }
    }
    if (signal.aborted) return;
    // Continue beyond skipped candidates. Retain the cursor if a bounded sweep fills up.
    for (let page = 0; page < 100; page++) {
      const jobs = await repo.pending(now(), 50, scanCursor);
      if (!jobs.length) { scanCursor = 0; break; }
      for (const job of jobs) {
        if (signal.aborted) return;
        if (job.id <= scanCursor) continue;
        scanCursor = job.id;
        await processJob(job);
      }
      if (jobs.length < 50) { scanCursor = 0; break; }
    }
  }

  function sweep(): Promise<void> {
    if (running) return running;
    if (signal.aborted) return Promise.resolve();
    running = Promise.resolve().then(runSweep).finally(() => { running = null; });
    return running;
  }

  async function enqueueAmbient(userId: number, personaId: number): Promise<{ queued: boolean; reason?: string }> {
    if (signal.aborted) return { queued: false, reason: "scheduler_stopped" };
    const policy = await repo.getPolicy(userId, personaId);
    if (signal.aborted) return { queued: false, reason: "scheduler_stopped" };
    if (!policy.enabled || !policy.ambientEnabled) return { queued: false, reason: "disabled" };
    const time = now();
    if (isQuiet(time, policy)) return { queued: false, reason: "quiet_hours" };
    const clock = localClock(time, policy.timeZone);
    const job = await repo.enqueue(userId, personaId, {
      kind: "ambient", policyRevision: policy.revision,
      triggerKey: `ambient:${clock.day}:${Math.floor(clock.minuteOfDay / 60)}`,
      dueAt: time, expiresAt: expiresOnSameLocalDay(+time, clock.day, policy.timeZone),
    });
    return job ? { queued: true } : { queued: false, reason: "not_queued" };
  }

  return { sweep, enqueueAmbient, stop: () => controller.abort() };
}
