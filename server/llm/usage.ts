import type { LLMMessage, LLMTokenUsage, LLMRouteInfo } from "./types";
import type { UserUsageContext } from "./usage-context";
export type TokenSource = "provider" | "estimated" | "mixed";
export type LlmUsageRecord = {
  id: number; startedAt: string; durationMs: number; provider: string; requestedProvider?: string; model?: string; reasoningEffort?: string;
  relayId?: number; purpose?: string; userId?: number; personaId?: number; route?: string; streaming: boolean; success: boolean;
  status: "success" | "failed" | "cancelled"; attemptedProviders: string[]; attemptedRelayIds: number[]; attempts: number; inputTokens: number; outputTokens: number; totalTokens: number;
  inputChars: number; outputChars: number; usageSource: TokenSource; inputSource: TokenSource; outputSource: TokenSource; totalSource: TokenSource;
  error?: "provider_error" | "cancelled" | "consumer_closed";
};
export type UsageRecord = LlmUsageRecord;
export type UsageSink = (record: LlmUsageRecord) => Promise<void> | void;
export type LlmUsageDetailFilters = { from?: string; to?: string; userId?: number | null; personaId?: number | null; route?: string; provider?: string; purpose?: string; success?: boolean; limit?: number };
const records: LlmUsageRecord[] = []; let nextId = 1;
let persistentRecorder: UsageSink | null = async record => { const { createLlmUsageRecord } = await import("../db"); await createLlmUsageRecord(record); };
export function setLlmUsagePersistentRecorder(recorder: UsageSink | null) { persistentRecorder = recorder; }
export async function recordLlmUsage(record: LlmUsageRecord): Promise<void> {
  const value = { ...record, id: nextId++ }; records.unshift(value); if (records.length > 1000) records.length = 1000;
  if (persistentRecorder) { try { await persistentRecorder(value); } catch { console.warn("[LLM usage] Could not persist usage metadata"); } }
}
export async function safeRecordUsage(sink: UsageSink, record: LlmUsageRecord) { try { await sink(record); } catch { console.warn("[LLM usage] Could not persist usage metadata"); } }
export function resetLlmUsageForTests() { records.length = 0; nextId = 1; persistentRecorder = null; }
function metadata(value: string | undefined, fallback?: string) { return value && value.length <= 128 && !/[\x00-\x1f<>"'=?&#@]/.test(value) && !/:\/\/|sk-|bearer|token=|key=/i.test(value) ? value : fallback; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647; }
const estimate = (chars: number) => Math.ceil(chars / 1.7);
export function estimateInputTokens(messages: LLMMessage[]) { return messages.reduce((sum, message) => sum + (typeof message.content === "string" ? estimate(Array.from(message.content).length) : message.content.reduce((total, part) => total + (part.type === "text" ? estimate(Array.from(part.text).length) : 1000), 0)), 0); }
function inputChars(messages: LLMMessage[]) { return messages.reduce((sum, message) => sum + (typeof message.content === "string" ? Array.from(message.content).length : message.content.reduce((total, part) => total + (part.type === "text" ? Array.from(part.text).length : 420), 0)), 0); }
type Attempt = { usage: LLMTokenUsage; chars: number; provider: string; relayId?: number };
export class UsageMeter {
  private readonly started = new Date();
  private readonly attempts: Attempt[] = [];
  private readonly estimatedInput: number;
  private readonly chars: number;
  private currentRoute: LLMRouteInfo;
  private pendingRoute: LLMRouteInfo;

  constructor(
    private context: UserUsageContext,
    messages: LLMMessage[],
    provider: string,
    model: string | undefined,
    private streaming: boolean,
    private requestedProvider?: string,
    reasoningEffort?: string,
    relayId?: number,
  ) {
    this.estimatedInput = estimateInputTokens(messages);
    this.chars = inputChars(messages);
    this.currentRoute = { provider, model, reasoningEffort, relayId };
    this.pendingRoute = { ...this.currentRoute };
  }

  observeRoute = (route: LLMRouteInfo) => { this.pendingRoute = { ...route }; };
  observeModel = (model: string) => {
    if (this.attempts.length) this.currentRoute.model = model;
  };
  startAttempt = () => {
    this.currentRoute = { ...this.pendingRoute };
    this.attempts.push({ usage: {}, chars: 0, provider: this.currentRoute.provider, relayId: this.currentRoute.relayId });
  };
  observeUsage = (usage: LLMTokenUsage) => {
    const attempt = this.attempts[this.attempts.length - 1];
    if (!attempt) return;
    for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
      if (count(usage[key])) attempt.usage[key] = usage[key];
    }
  };
  observeText(text: string) {
    const attempt = this.attempts[this.attempts.length - 1];
    if (attempt) attempt.chars += Array.from(text).length;
  }

  finish(status: LlmUsageRecord["status"], error?: LlmUsageRecord["error"]): LlmUsageRecord {
    const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const reported = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const attempt of this.attempts) {
      const input = attempt.usage.inputTokens ?? this.estimatedInput;
      const output = attempt.usage.outputTokens ?? estimate(attempt.chars);
      totals.inputTokens += input;
      totals.outputTokens += output;
      totals.totalTokens += attempt.usage.totalTokens ?? input + output;
      reported.inputTokens += Number(attempt.usage.inputTokens !== undefined);
      reported.outputTokens += Number(attempt.usage.outputTokens !== undefined);
      reported.totalTokens += Number(attempt.usage.totalTokens !== undefined || (attempt.usage.inputTokens !== undefined && attempt.usage.outputTokens !== undefined));
    }
    const source = (key: keyof typeof reported): TokenSource => reported[key] > 0
      ? reported[key] === this.attempts.length ? "provider" : "mixed" : "estimated";
    const inputSource = source("inputTokens");
    const outputSource = source("outputTokens");
    const totalSource = source("totalTokens");
    const allSources = [inputSource, outputSource, totalSource];
    const current = this.currentRoute;
    return {
      id: 0, startedAt: this.started.toISOString(),
      durationMs: Math.min(2147483647, Math.max(0, Date.now() - this.started.getTime())),
      provider: metadata(current.provider, "unknown")!, requestedProvider: metadata(this.requestedProvider),
      model: metadata(current.model), reasoningEffort: metadata(current.reasoningEffort), relayId: current.relayId,
      userId: this.context.userId, personaId: this.context.personaId,
      route: metadata(this.context.route), purpose: metadata(this.context.purpose), streaming: this.streaming,
      success: status === "success", status, attempts: this.attempts.length,
      attemptedProviders: this.attempts.map(attempt => metadata(attempt.provider, "unknown")!),
      attemptedRelayIds: this.attempts.flatMap(attempt => attempt.relayId === undefined ? [] : [attempt.relayId]),
      inputTokens: Math.min(2147483647, totals.inputTokens), outputTokens: Math.min(2147483647, totals.outputTokens), totalTokens: Math.min(2147483647, totals.totalTokens),
      inputChars: Math.min(2147483647, this.chars * this.attempts.length), outputChars: Math.min(2147483647, this.attempts.reduce((sum, attempt) => sum + attempt.chars, 0)),
      inputSource, outputSource, totalSource,
      usageSource: allSources.every(value => value === "provider") ? "provider" : allSources.every(value => value === "estimated") ? "estimated" : "mixed",
      error,
    };
  }
}
export function isCancelled(error: unknown, signal?: AbortSignal) { return signal?.aborted === true || (error instanceof Error && error.name === "AbortError"); }
function filteredRecords(filters: LlmUsageDetailFilters) {
  const from = filters.from ? Date.parse(filters.from) : NaN, to = filters.to ? Date.parse(filters.to) : NaN;
  return records.filter(record => {
    const time = Date.parse(record.startedAt); if (Number.isFinite(from) && time < from || Number.isFinite(to) && time > to) return false;
    if (filters.userId !== undefined && (filters.userId === null ? record.userId !== undefined : record.userId !== filters.userId)) return false;
    if (filters.personaId !== undefined && (filters.personaId === null ? record.personaId !== undefined : record.personaId !== filters.personaId)) return false;
    if (filters.success !== undefined && record.success !== filters.success) return false;
    return (["route", "provider", "purpose"] as const).every(key => !filters[key] || (record[key] ?? "").toLowerCase().includes(filters[key]!.toLowerCase()));
  });
}
export function summarizeUsage(items: readonly LlmUsageRecord[]) {
  return { calls: items.length, successfulCalls: items.filter(record => record.success).length, failedCalls: items.filter(record => !record.success).length, cancelledCalls: items.filter(record => record.status === "cancelled").length,
    inputTokens: items.reduce((sum, record) => sum + record.inputTokens, 0), outputTokens: items.reduce((sum, record) => sum + record.outputTokens, 0), totalTokens: items.reduce((sum, record) => sum + record.totalTokens, 0), averageDurationMs: items.length ? Math.round(items.reduce((sum, record) => sum + record.durationMs, 0) / items.length) : 0,
    providerReportedCalls: items.filter(record => record.usageSource === "provider").length, estimatedCalls: items.filter(record => record.usageSource === "estimated").length, mixedCalls: items.filter(record => record.usageSource === "mixed").length };
}
export function getLlmUsageDetails(filters: LlmUsageDetailFilters = {}) { const items = filteredRecords(filters); const limit = Math.min(200, Math.max(1, Math.floor(filters.limit ?? 50))); return { source: "in-memory-runtime" as const, filters: { ...filters, limit }, summary: summarizeUsage(items), records: items.slice(0, limit).map(item => ({ ...item })) }; }
export function getLlmUsageSnapshot(now = new Date(), filters: LlmUsageDetailFilters = {}) {
  const items = filteredRecords(filters); const day = now.toISOString().slice(0, 10); const today = items.filter(record => record.startedAt.startsWith(day) && Date.parse(record.startedAt) <= now.getTime());
  function buckets(key: "provider" | "purpose" | "userId" | "personaId" | "route") { const groups = new Map<string | number | null, LlmUsageRecord[]>(); for (const item of today) { const value = item[key] ?? null; groups.set(value, [...(groups.get(value) ?? []), item]); } return Array.from(groups.entries()).map(([value, rows]) => ({ [key]: value, ...summarizeUsage(rows) })).sort((a, b) => b.calls - a.calls); }
  return { source: "in-memory-runtime" as const, today: summarizeUsage(today), week: summarizeUsage(items.filter(item => Date.parse(item.startedAt) >= Date.parse(day + "T00:00:00Z") - 6 * 86400000 && Date.parse(item.startedAt) <= now.getTime())), month: summarizeUsage(items.filter(item => Date.parse(item.startedAt) >= Date.parse(day + "T00:00:00Z") - 29 * 86400000 && Date.parse(item.startedAt) <= now.getTime())), byProvider: buckets("provider"), byPurpose: buckets("purpose"), byUser: buckets("userId"), byPersona: buckets("personaId"), byRoute: buckets("route"), recent: items.slice(0, 20).map(item => ({ ...item })) };
}

export type LlmUsageDetails = ReturnType<typeof getLlmUsageDetails>;
export type LlmUsageSnapshot = ReturnType<typeof getLlmUsageSnapshot>;
