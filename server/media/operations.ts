import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";

const LIFETIME_MS = 5 * 60_000;
type Entry = { controller: AbortController; expires: number; active: boolean };
export class MediaOperations {
  private users = new Map<number, Map<string, Entry>>();
  private bucket(userId: number) {
    const now = Date.now();
    for (const [id, entries] of Array.from(this.users)) {
      for (const [key, entry] of Array.from(entries)) if (!entry.active && entry.expires <= now) entries.delete(key);
      if (!entries.size) this.users.delete(id);
    }
    let entries = this.users.get(userId);
    if (!entries) { entries = new Map(); this.users.set(userId, entries); }
    return entries;
  }
  begin(userId: number, operationId: string, ctx?: Pick<TrpcContext, "req" | "res">) {
    const entries = this.bucket(userId);
    if (entries.has(operationId)) throw new TRPCError({ code: "CONFLICT", message: "该语音请求已取消或已处理，请重新操作。" });
    if (Array.from(entries.values()).filter(e => e.active).length >= 4 || entries.size >= 128) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "语音请求较多，请稍后再试。" });
    }
    const entry: Entry = { controller: new AbortController(), expires: Date.now() + LIFETIME_MS, active: true };
    entries.set(operationId, entry);
    const abort = () => entry.controller.abort();
    const closed = () => { if (!ctx?.res.writableEnded) abort(); };
    const timeout = setTimeout(abort, LIFETIME_MS); timeout.unref?.();
    ctx?.req.once?.("aborted", abort); ctx?.res.once?.("close", closed);
    if (ctx?.req.aborted) abort();
    return { signal: entry.controller.signal, finish: () => {
      clearTimeout(timeout); entry.active = false; entry.expires = Date.now() + LIFETIME_MS;
      ctx?.req.removeListener?.("aborted", abort); ctx?.res.removeListener?.("close", closed);
    } };
  }
  cancel(userId: number, operationId: string) {
    const entries = this.bucket(userId); const entry = entries.get(operationId);
    if (entry) entry.controller.abort();
    else if (entries.size < 128) {
      const controller = new AbortController(); controller.abort();
      entries.set(operationId, { controller, active: false, expires: Date.now() + LIFETIME_MS });
    }
  }
  cancelUser(userId: number) { for (const entry of Array.from(this.users.get(userId)?.values() ?? [])) entry.controller.abort(); }
}
export const voiceOperations = new MediaOperations();
