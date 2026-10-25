import {
  assertReviewable, evidenceQualifies, factFingerprint, hashValue, validateFields, MemoryReviewError,
  type CandidateFields, type EvidenceReference, type MemoryProvenance, type ReviewCandidate,
  type ReviewCommand, type ReviewEvidence, type ReviewResult, type ReviewBatchResult, type StoredReviewResult,
} from "./core";

export type CurrentEvidence = { text: string; role?: string };

/** Transaction signatures match the frozen review implementation. */
export interface ReviewTransaction {
  getOperation(): Promise<{ requestHash: string; result: StoredReviewResult } | null>;
  saveOperation(requestHash: string, result: StoredReviewResult): Promise<void>;
  getCandidate(id: number): Promise<ReviewCandidate | null>;
  insertCandidate(candidate: Omit<ReviewCandidate, "id">): Promise<ReviewCandidate>;
  updateCandidate(candidate: ReviewCandidate, expectedRevision: number): Promise<ReviewCandidate>;
  ownsScene(sceneId: number): Promise<boolean>;
  resolveEvidence(reference: EvidenceReference): Promise<CurrentEvidence | null>;
  findExistingMemory(candidate: ReviewCandidate, fingerprint: string): Promise<number | null>;
  insertMemory(candidate: ReviewCandidate): Promise<number>;
  insertProvenance(provenance: MemoryProvenance): Promise<void>;
}

export interface MemoryReviewRepository {
  transaction<T>(userId: number, personaId: number, operationId: string, work: (transaction: ReviewTransaction) => Promise<T>): Promise<T>;
  list(userId: number, personaId: number, status?: ReviewCandidate["status"]): Promise<ReviewCandidate[]>;
  provenance(userId: number, personaId: number, memoryIds: number[]): Promise<MemoryProvenance[]>;
  reviewedFacts(userId: number, personaId: number, kind: "source_fact" | "story_event", sceneId?: number): Promise<ReviewCandidate[]>;
  resolveCurrentEvidence(userId: number, personaId: number, reference: EvidenceReference): Promise<CurrentEvidence | null>;
}

function referenceOnly(reference: EvidenceReference): EvidenceReference {
  const quote = reference.quote?.trim() || undefined;
  return reference.type === "message" ? { type: "message", messageId: reference.messageId, quote }
    : { type: "source", documentId: reference.documentId, chunkIndex: reference.chunkIndex, quote };
}

async function resolveReferences(
  resolve: (reference: EvidenceReference) => Promise<CurrentEvidence | null>,
  references: EvidenceReference[], previous?: ReviewEvidence[],
): Promise<ReviewEvidence[]> {
  const result: ReviewEvidence[] = [];
  const seen = new Set<string>();
  for (const raw of references) {
    const reference = referenceOnly(raw);
    const key = hashValue(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    const actual = await resolve(reference);
    const fingerprint = actual ? hashValue(actual.text) : null;
    const saved = previous?.find(item => hashValue(referenceOnly(item)) === key);
    // A read never silently adopts a changed or previously unresolved reference.
    const baseline = saved ? saved.fingerprint : fingerprint;
    const verified = Boolean(actual && baseline && baseline === fingerprint && (!reference.quote || actual.text.includes(reference.quote)));
    result.push({
      ...reference, verified, fingerprint: baseline,
      excerpt: verified ? reference.quote || actual!.text.slice(0, 400) : saved?.excerpt || "",
      role: actual?.role,
    });
  }
  return result;
}

/** Revalidation is a read projection; it never rewrites the operation log or original fingerprint. */
export async function resolveEvidenceState(
  candidate: ReviewCandidate, resolve: (reference: EvidenceReference) => Promise<CurrentEvidence | null>,
): Promise<ReviewCandidate> {
  const evidence = await resolveReferences(resolve, candidate.evidence, candidate.evidence);
  const evidenceStatus = candidate.evidenceStatus === "confirmed_by_user" ? "confirmed_by_user"
    : evidenceQualifies(candidate.kind, evidence) ? "verified" : "needs_confirmation";
  return { ...candidate, evidence, evidenceStatus };
}

function assertOperation(userId: number, personaId: number, operationId: string): void {
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(personaId) || personaId < 1) throw new MemoryReviewError("BAD_REQUEST", "账号或角色标识无效。");
  if (typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new MemoryReviewError("BAD_REQUEST", "请提供稳定的操作 UUID，同一次请求重试应保持不变。");
}

function candidateValues(fields: ReturnType<typeof validateFields>) {
  return {
    kind: fields.kind, title: fields.title, description: fields.description, confidence: fields.confidence,
    importance: fields.importance, source: fields.source, memoryType: fields.memoryType,
    keywords: fields.keywords, emotion: fields.emotion, sceneId: fields.sceneId,
    factKey: fields.factKey, date: fields.date, category: fields.category,
  };
}

export class MemoryReviewService {
  constructor(readonly repository: MemoryReviewRepository) {}

  async list(userId: number, personaId: number, status?: ReviewCandidate["status"]): Promise<ReviewCandidate[]> {
    const rows = await this.repository.list(userId, personaId, status);
    return Promise.all(rows.map(candidate => resolveEvidenceState(candidate, reference => this.repository.resolveCurrentEvidence(userId, personaId, reference))));
  }

  /** Source facts require live source evidence even after an explicit human acceptance. */
  async reviewedFacts(userId: number, personaId: number, kind: "source_fact" | "story_event", sceneId?: number): Promise<ReviewCandidate[]> {
    const rows = await this.repository.reviewedFacts(userId, personaId, kind, sceneId);
    const result: ReviewCandidate[] = [];
    for (const row of rows) {
      if (row.userId !== userId || row.personaId !== personaId || row.kind !== kind || row.status !== "accepted" || row.application !== "reviewed_only") continue;
      if (kind === "story_event" && (sceneId == null || row.sceneId !== sceneId)) continue;
      const current = await resolveEvidenceState(row, reference => this.repository.resolveCurrentEvidence(userId, personaId, reference));
      if (kind === "source_fact" && !evidenceQualifies(kind, current.evidence)) continue;
      result.push(current);
    }
    return result;
  }

  private async insertPending(tx: ReviewTransaction, userId: number, personaId: number, fields: ReturnType<typeof validateFields>): Promise<ReviewCandidate> {
    if (fields.sceneId && !await tx.ownsScene(fields.sceneId)) throw new MemoryReviewError("NOT_FOUND", "情境不存在或不可访问。");
    const evidence = await resolveReferences(reference => tx.resolveEvidence(reference), fields.evidence);
    const now = new Date().toISOString();
    return tx.insertCandidate({
      ...candidateValues(fields), userId, personaId, evidence,
      evidenceStatus: evidenceQualifies(fields.kind, evidence) ? "verified" : "needs_confirmation",
      status: "pending", revision: 1, memoryId: null, application: "pending", createdAt: now, updatedAt: now,
    });
  }

  async createBatch(userId: number, input: {
    personaId: number; operationId: string; candidates: Array<CandidateFields & { sourceMessageIds?: number[] }>;
  }): Promise<ReviewBatchResult> {
    assertOperation(userId, input.personaId, input.operationId);
    if (!Array.isArray(input.candidates) || input.candidates.length > 5) throw new MemoryReviewError("BAD_REQUEST", "每批最多创建 5 条候选，也可以保存空结果。");
    const fields = input.candidates.map(candidate => {
      if (candidate.sourceMessageIds !== undefined && (!Array.isArray(candidate.sourceMessageIds) || candidate.sourceMessageIds.length > 8)) throw new MemoryReviewError("BAD_REQUEST", "来源消息引用最多 8 条。");
      return validateFields({ ...candidate, evidence: [...(candidate.evidence ?? []), ...(candidate.sourceMessageIds ?? []).map(messageId => ({ type: "message" as const, messageId }))] });
    });
    const requestHash = hashValue({ action: "create_batch", personaId: input.personaId, fields });
    return this.repository.transaction(userId, input.personaId, input.operationId.toLowerCase(), async tx => {
      const replay = await tx.getOperation();
      if (replay) {
        if (replay.requestHash !== requestHash || !("candidates" in replay.result)) throw new MemoryReviewError("CONFLICT", "该操作 UUID 已用于其他请求，请刷新后重新操作。");
        return replay.result;
      }
      const candidates: ReviewCandidate[] = [];
      for (const candidate of fields) candidates.push(await this.insertPending(tx, userId, input.personaId, candidate));
      const result = { candidates };
      await tx.saveOperation(requestHash, result);
      return result;
    });
  }

  /** The lock covers generation; a completed extraction replays without invoking generation again. */
  async generateBatch(
    userId: number, input: { personaId: number; operationId: string }, generate: () => Promise<CandidateFields[]>,
  ): Promise<ReviewBatchResult> {
    assertOperation(userId, input.personaId, input.operationId);
    const requestHash = hashValue({ action: "extract", personaId: input.personaId });
    return this.repository.transaction(userId, input.personaId, input.operationId.toLowerCase(), async tx => {
      const replay = await tx.getOperation();
      if (replay) {
        if (replay.requestHash !== requestHash || !("candidates" in replay.result)) throw new MemoryReviewError("CONFLICT", "该操作 UUID 已用于其他请求，请刷新后重新操作。");
        return replay.result;
      }
      const generated = await generate();
      if (!Array.isArray(generated) || generated.length > 5) throw new MemoryReviewError("BAD_REQUEST", "每次提取最多返回 5 条候选，也可以返回空结果。");
      const fields = generated.map(candidate => validateFields(candidate));
      const candidates: ReviewCandidate[] = [];
      for (const candidate of fields) candidates.push(await this.insertPending(tx, userId, input.personaId, candidate));
      const result = { candidates };
      await tx.saveOperation(requestHash, result);
      return result;
    });
  }

  async perform(userId: number, command: ReviewCommand): Promise<ReviewResult> {
    assertOperation(userId, command.personaId, command.operationId);
    if (!["create", "edit", "accept", "reject"].includes(command.action)) throw new MemoryReviewError("BAD_REQUEST", "审阅操作无效。");
    const fields = command.fields ? validateFields(command.fields) : undefined;
    const requestHash = hashValue({
      action: command.action, personaId: command.personaId, candidateId: command.candidateId,
      expectedRevision: command.expectedRevision, fields, confirmWithoutEvidence: command.confirmWithoutEvidence === true,
    });
    return this.repository.transaction(userId, command.personaId, command.operationId.toLowerCase(), async tx => {
      const replay = await tx.getOperation();
      if (replay) {
        if (replay.requestHash !== requestHash || !("candidate" in replay.result)) throw new MemoryReviewError("CONFLICT", "该操作 UUID 已用于其他请求，请刷新后重新操作。");
        return replay.result;
      }
      const now = new Date().toISOString();
      let candidate: ReviewCandidate;
      let reusedMemory = false;
      if (command.action === "create") {
        if (!fields) throw new MemoryReviewError("BAD_REQUEST", "请提供候选内容。");
        candidate = await this.insertPending(tx, userId, command.personaId, fields);
      } else {
        const current = command.candidateId == null ? null : await tx.getCandidate(command.candidateId);
        if (!current) throw new MemoryReviewError("NOT_FOUND", "候选不存在或不属于当前角色。");
        assertReviewable(current, command.expectedRevision);
        if (command.action === "edit") {
          if (!fields) throw new MemoryReviewError("BAD_REQUEST", "请提供编辑后的候选内容。");
          if (fields.sceneId && !await tx.ownsScene(fields.sceneId)) throw new MemoryReviewError("NOT_FOUND", "情境不存在或不可访问。");
          const evidence = await resolveReferences(reference => tx.resolveEvidence(reference), fields.evidence);
          candidate = await tx.updateCandidate({
            ...current, ...candidateValues(fields), evidence,
            evidenceStatus: evidenceQualifies(fields.kind, evidence) ? "verified" : "needs_confirmation",
            revision: current.revision + 1, updatedAt: now,
          }, current.revision);
        } else if (command.action === "reject") {
          candidate = await tx.updateCandidate({ ...current, status: "rejected", application: "rejected", revision: current.revision + 1, updatedAt: now }, current.revision);
        } else {
          if (current.sceneId && !await tx.ownsScene(current.sceneId)) throw new MemoryReviewError("NOT_FOUND", "情境不存在或不可访问。");
          const evidence = await resolveReferences(reference => tx.resolveEvidence(reference), current.evidence, current.evidence);
          const verified = evidenceQualifies(current.kind, evidence);
          if (!verified && command.confirmWithoutEvidence !== true) throw new MemoryReviewError("PRECONDITION_FAILED", current.kind === "user_fact"
            ? "消息引用不能证明现实语境，请明确人工确认后再接受现实事实。"
            : "证据缺失或已变更，请审阅后明确人工确认；无来源确认仅保留审阅记录。");
          const reviewed: ReviewCandidate = { ...current, evidence, evidenceStatus: verified ? "verified" : "confirmed_by_user", updatedAt: now };
          const fingerprint = factFingerprint(reviewed);
          let memoryId: number | null = null;
          if (reviewed.kind === "user_fact") {
            memoryId = await tx.findExistingMemory(reviewed, fingerprint);
            reusedMemory = memoryId != null;
            if (memoryId == null) memoryId = await tx.insertMemory(reviewed);
          }
          candidate = await tx.updateCandidate({
            ...reviewed, memoryId, status: "accepted", application: reviewed.kind === "user_fact" ? "memory" : "reviewed_only", revision: current.revision + 1,
          }, current.revision);
          await tx.insertProvenance({
            candidateId: candidate.id, userId, personaId: command.personaId, kind: candidate.kind, memoryId,
            fingerprint, evidenceStatus: candidate.evidenceStatus, evidence: candidate.evidence,
            application: candidate.application === "memory" ? "memory" : "reviewed_only",
          });
        }
      }
      const result = { candidate, memoryId: candidate.memoryId, reusedMemory };
      await tx.saveOperation(requestHash, result);
      return result;
    });
  }
}
