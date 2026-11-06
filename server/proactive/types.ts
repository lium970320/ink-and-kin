import type { DbTransaction } from "../db";

export type ProactiveKind = "scheduled" | "followup" | "ambient";
export type ProactiveStatus = "pending" | "generating" | "ready" | "confirmed" | "failed" | "unknown" | "cancelled" | "expired";
export type ProactiveDelivery = "web" | "qq";
export interface ProactiveSettings {
  enabled: boolean;
  times: string[];
  stylePrompt: string;
  timeZone: string;
  quietHours: string;
  maxPerLocalDay: number;
  minIntervalMinutes: number;
  delivery: ProactiveDelivery;
  ambientEnabled: boolean;
}
export interface ProactiveQqConsent { configId: number; generation: number; targetId: string; }
export interface ProactivePolicy extends ProactiveSettings {
  userId: number; personaId: number; revision: number;
  qqConsent: ProactiveQqConsent | null;
}
export interface ProactiveJob {
  id: number; userId: number; personaId: number; policyRevision: number;
  kind: ProactiveKind; triggerKey: string; topic: string | null;
  dueAt: Date; expiresAt: Date; status: ProactiveStatus; text: string | null;
  claimToken: string | null; attemptedAt: Date | null; localDay: string | null;
  reason: string | null; remoteMessageId: string | null; readAt: Date | null; unknownAcknowledgedAt: Date | null; cancelRequestedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
export interface ProactiveClaim { job: ProactiveJob; policy: ProactivePolicy; token: string; }
export interface ProactiveDispatchSnapshot { configId: number; generation: number; routeRevision: number; }
export interface ProactiveEnqueue {
  policyRevision: number; kind: ProactiveKind; triggerKey: string; topic?: string | null;
  dueAt: Date; expiresAt: Date;
}
export interface ProactiveRepository {
  getPolicy(userId: number, personaId: number): Promise<ProactivePolicy>;
  savePolicy(userId: number, personaId: number, expectedRevision: number, settings: ProactiveSettings, qqConsent: ProactiveQqConsent | null): Promise<ProactivePolicy>;
  listEnabled(): Promise<ProactivePolicy[]>;
  enqueue(userId: number, personaId: number, input: ProactiveEnqueue): Promise<ProactiveJob | null>;
  pending(now: Date, limit?: number, afterId?: number): Promise<ProactiveJob[]>;
  claim(job: ProactiveJob, now: Date): Promise<ProactiveClaim | null>;
  saveText(claim: ProactiveClaim, text: string, now: Date, signal?: AbortSignal): Promise<boolean>;
  reserveDispatch(claim: ProactiveClaim, now: Date, signal?: AbortSignal): Promise<boolean>;
  /** Existing transaction must use the common QQ -> persona -> policy -> job lock order. Marks attempt unknown before I/O. */
  guardDispatch(tx: DbTransaction, claim: ProactiveClaim, now: Date, signal?: AbortSignal): Promise<void>;
  deliverWeb(claim: ProactiveClaim, now: Date, signal?: AbortSignal): Promise<boolean>;
  finish(claim: ProactiveClaim, result: {status: "confirmed" | "failed" | "unknown"; remoteMessageId: string | null; reason: string}): Promise<void>;
  failBeforeDispatch(claim: ProactiveClaim, reason: string): Promise<void>;
  list(userId: number, personaId: number): Promise<ProactiveJob[]>;
  cancel(userId: number, personaId: number, jobId: number): Promise<boolean>;
  acknowledgeUnknown(userId: number, personaId: number, jobId: number): Promise<boolean>;
  markRead(userId: number, personaId: number, jobId: number): Promise<void>;
}
