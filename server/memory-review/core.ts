import { createHash } from "node:crypto";

export type FactKind = "user_fact" | "source_fact" | "story_event";
export type EvidenceReference =
  | { type: "message"; messageId: number; quote?: string }
  | { type: "source"; documentId: number; chunkIndex: number; quote?: string };
export type ReviewEvidence = EvidenceReference & {
  verified: boolean; fingerprint: string | null; excerpt: string; role?: string;
};
export type EvidenceStatus = "verified" | "needs_confirmation" | "confirmed_by_user";
export type MemoryCategory = "memory" | "anchor" | "milestone" | "anniversary";

export type CandidateFields = {
  kind: FactKind; title: string; description: string; confidence: number;
  importance?: number; source?: string; memoryType?: string; keywords?: string[]; emotion?: string;
  sceneId?: number | null; factKey?: string | null; date?: string | null; category?: MemoryCategory;
  evidence?: EvidenceReference[];
};
export type ReviewCandidate = {
  id: number; userId: number; personaId: number; kind: FactKind; title: string; description: string;
  confidence: number; importance: number; source: string; memoryType: string; keywords: string[]; emotion: string;
  sceneId: number | null; factKey: string | null; date: string | null; category: MemoryCategory;
  evidence: ReviewEvidence[]; evidenceStatus: EvidenceStatus; status: "pending" | "accepted" | "rejected";
  revision: number; memoryId: number | null; application: "pending" | "memory" | "reviewed_only" | "rejected";
  createdAt: string; updatedAt: string;
};
export type ReviewResult = { candidate: ReviewCandidate; memoryId: number | null; reusedMemory: boolean };
export type ReviewBatchResult = { candidates: ReviewCandidate[] };
export type StoredReviewResult = ReviewResult | ReviewBatchResult;
export type ReviewCommand = {
  action: "create" | "edit" | "accept" | "reject"; personaId: number; operationId: string;
  candidateId?: number; expectedRevision?: number; fields?: CandidateFields; confirmWithoutEvidence?: boolean;
};
export type MemoryProvenance = {
  candidateId: number; userId: number; personaId: number; kind: FactKind; memoryId: number | null;
  fingerprint: string; evidenceStatus: EvidenceStatus; evidence: ReviewEvidence[]; application: "memory" | "reviewed_only";
};

export class MemoryReviewError extends Error {
  constructor(public readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED", message: string) {
    super(message);
    this.name = "MemoryReviewError";
  }
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
}

/** A fact identity excludes subjective confidence and importance metadata. */
export function factFingerprint(candidate: Pick<ReviewCandidate, "kind" | "title" | "description" | "factKey" | "date" | "category">): string {
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  return hashValue([candidate.kind, normalize(candidate.title), normalize(candidate.description), candidate.factKey ?? "", candidate.date, candidate.category]);
}

function text(value: unknown, maximum: number, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new MemoryReviewError("BAD_REQUEST", `${label}格式无效。`);
  const result = value.trim();
  if (result.length > maximum || result.includes("\0")) throw new MemoryReviewError("BAD_REQUEST", `${label}过长或含无效字符。`);
  return result || fallback || "";
}

export function validateFields(fields: CandidateFields) {
  if (!fields || !["user_fact", "source_fact", "story_event"].includes(fields.kind)) throw new MemoryReviewError("BAD_REQUEST", "事实类型无效。");
  const title = text(fields.title, 200, "候选标题");
  const description = text(fields.description, 2000, "候选描述");
  if (!title || !description) throw new MemoryReviewError("BAD_REQUEST", "请填写候选标题和描述。");
  if (!Number.isInteger(fields.confidence) || fields.confidence < 1 || fields.confidence > 5) throw new MemoryReviewError("BAD_REQUEST", "可信度应为 1 至 5 的整数。");
  const importance = fields.importance ?? 3;
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new MemoryReviewError("BAD_REQUEST", "重要性应为 1 至 5 的整数。");
  const source = text(fields.source, 24, "来源", "chat");
  const memoryType = text(fields.memoryType, 40, "记忆类型", "relationship_event");
  const emotion = text(fields.emotion, 120, "情绪", "");
  const rawKeywords = fields.keywords ?? [];
  if (!Array.isArray(rawKeywords) || rawKeywords.length > 12) throw new MemoryReviewError("BAD_REQUEST", "关键词最多 12 个。");
  const keywords = Array.from(new Set(rawKeywords.map(word => text(word, 24, "关键词")).filter(Boolean)));
  if (fields.kind === "story_event" && (!Number.isSafeInteger(fields.sceneId) || Number(fields.sceneId) < 1)) throw new MemoryReviewError("BAD_REQUEST", "故事事件必须指定有效情境。");
  const category = fields.category ?? "memory";
  if (!["memory", "anchor", "milestone", "anniversary"].includes(category)) throw new MemoryReviewError("BAD_REQUEST", "记忆分类无效。");
  const factKey = fields.factKey == null ? null : text(fields.factKey, 120, "事实键") || null;
  const date = fields.date == null ? null : text(fields.date, 50, "日期") || null;
  const evidence = fields.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > 8) throw new MemoryReviewError("BAD_REQUEST", "证据引用最多 8 条。");
  for (const reference of evidence) {
    if (!reference || (reference.quote !== undefined && (typeof reference.quote !== "string" || reference.quote.length > 800))) throw new MemoryReviewError("BAD_REQUEST", "证据引文格式无效或超过 800 字符。");
    if (reference.type === "message") {
      if (!Number.isSafeInteger(reference.messageId) || reference.messageId < 1) throw new MemoryReviewError("BAD_REQUEST", "消息引用无效。");
    } else if (reference.type === "source") {
      if (!Number.isSafeInteger(reference.documentId) || reference.documentId < 1 || !Number.isSafeInteger(reference.chunkIndex) || reference.chunkIndex < 0) throw new MemoryReviewError("BAD_REQUEST", "原文引用无效。");
    } else throw new MemoryReviewError("BAD_REQUEST", "证据类型无效。");
  }
  return {
    kind: fields.kind, title, description, confidence: fields.confidence, importance, source, memoryType, keywords, emotion,
    category, factKey, date, sceneId: fields.kind === "story_event" ? fields.sceneId! : null, evidence,
  };
}

/** Message existence cannot establish real-world context, even when its role is user. */
export function evidenceQualifies(kind: FactKind, evidence: ReviewEvidence[]): boolean {
  if (kind === "user_fact") return false;
  return evidence.some(item => item.verified && (kind === "source_fact" ? item.type === "source" : true));
}

export function assertReviewable(candidate: ReviewCandidate, expectedRevision: number | undefined): void {
  if (candidate.revision !== expectedRevision) throw new MemoryReviewError("CONFLICT", "候选已更新，请刷新后再审阅。");
  if (candidate.status !== "pending") throw new MemoryReviewError("CONFLICT", "该候选已完成审阅。");
}

/** Keep existing memories eligible, while preventing source/story provenance from becoming reality facts. */
export function filterRealityMemories<T extends { id: number; userId: number; personaId: number; category?: string }>(
  memories: T[], provenance: MemoryProvenance[], owner: { userId: number; personaId: number; sceneId?: number | null },
): T[] {
  return memories.filter(memory => {
    if (memory.userId !== owner.userId || memory.personaId !== owner.personaId) return false;
    const records = provenance.filter(row => row.memoryId === memory.id);
    return !records.length ? owner.sceneId == null || memory.category === "anchor"
      : records.every(row => row.userId === owner.userId && row.personaId === owner.personaId && row.kind === "user_fact" && row.application === "memory");
  });
}
