import { describe, expect, it } from "vitest";
import { MemoryReviewService, type CurrentEvidence, type MemoryReviewRepository, type ReviewTransaction } from "./service";
import {
  filterRealityMemories, MemoryReviewError, validateFields,
  type CandidateFields, type EvidenceReference, type MemoryProvenance,
  type ReviewCandidate, type StoredReviewResult,
} from "./core";

const operationId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const fields = (overrides: Partial<CandidateFields> = {}): CandidateFields => ({
  kind: "user_fact", title: "工作", description: "用户从事设计工作。", confidence: 4,
  evidence: [{ type: "message", messageId: 1 }], ...overrides,
});
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function setup() {
  const state = {
    candidates: new Map<number, ReviewCandidate>(), memories: new Map<number, ReviewCandidate>(),
    provenance: [] as MemoryProvenance[], operations: new Map<string, { requestHash: string; result: StoredReviewResult }>(),
    nextCandidate: 1, nextMemory: 1,
  };
  const messages = new Map([
    [1, { userId: 1, personaId: 11, text: "我在故事里是一位设计师。", role: "user" }],
    [2, { userId: 1, personaId: 11, text: "我猜你的工作是设计师。", role: "assistant" }],
    [3, { userId: 2, personaId: 22, text: "其他账号的消息。", role: "user" }],
  ]);
  const sources = new Map([[1, { userId: 1, personaId: 11, text: "第一章：地图在灯塔。" }]]);
  const authorize = (userId: number, personaId: number) => {
    if (!((userId === 1 && [11, 12].includes(personaId)) || (userId === 2 && personaId === 22))) throw new MemoryReviewError("NOT_FOUND", "角色不存在。");
  };
  const resolve = async (userId: number, personaId: number, reference: EvidenceReference): Promise<CurrentEvidence | null> => {
    if (reference.type === "message") {
      const row = messages.get(reference.messageId);
      return row && row.userId === userId && row.personaId === personaId ? { text: row.text, role: row.role } : null;
    }
    const row = reference.chunkIndex === 0 ? sources.get(reference.documentId) : undefined;
    return row && row.userId === userId && row.personaId === personaId ? { text: row.text } : null;
  };
  let failProvenance = false;
  let queue = Promise.resolve();
  const repository: MemoryReviewRepository = {
    async transaction(userId, personaId, operation, work) {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(done => { release = done; });
      await previous;
      try {
        authorize(userId, personaId);
        const snapshot = {
          candidates: clone(Array.from(state.candidates.entries())), memories: clone(Array.from(state.memories.entries())),
          provenance: clone(state.provenance), operations: clone(Array.from(state.operations.entries())),
          nextCandidate: state.nextCandidate, nextMemory: state.nextMemory,
        };
        const owned = (row: { userId: number; personaId: number }) => row.userId === userId && row.personaId === personaId;
        const tx: ReviewTransaction = {
          getOperation: async () => clone(state.operations.get(`${userId}:${operation}`) ?? null),
          saveOperation: async (requestHash, result) => { state.operations.set(`${userId}:${operation}`, clone({ requestHash, result })); },
          getCandidate: async id => { const row = state.candidates.get(id); return row && owned(row) ? clone(row) : null; },
          insertCandidate: async value => {
            const row = { ...clone(value), id: state.nextCandidate++ };
            state.candidates.set(row.id, row);
            return clone(row);
          },
          updateCandidate: async (value, expectedRevision) => {
            const current = state.candidates.get(value.id);
            if (!current || !owned(current) || current.revision !== expectedRevision || current.status !== "pending") throw new MemoryReviewError("CONFLICT", "候选已变更。");
            state.candidates.set(value.id, clone(value));
            return clone(value);
          },
          ownsScene: async sceneId => userId === 1 && sceneId === 7,
          resolveEvidence: reference => resolve(userId, personaId, reference),
          findExistingMemory: async (candidate, fingerprint) => {
            const linked = state.provenance.find(row => owned(row) && row.fingerprint === fingerprint && row.memoryId != null && state.memories.has(row.memoryId));
            if (linked) return linked.memoryId;
            const existing = Array.from(state.memories.entries()).find(([, row]) => owned(row) && candidate.factKey && row.factKey === candidate.factKey);
            if (existing) {
              if (existing[1].description !== candidate.description || existing[1].date !== candidate.date) throw new MemoryReviewError("CONFLICT", "旧事实保持不变，新候选需要单独审阅。");
              return existing[0];
            }
            return null;
          },
          insertMemory: async value => { const id = state.nextMemory++; state.memories.set(id, clone(value)); return id; },
          insertProvenance: async value => {
            if (failProvenance) { failProvenance = false; throw new Error("合成的来源保存失败"); }
            state.provenance.push(clone(value));
          },
        };
        try { return await work(tx); }
        catch (error) {
          state.candidates = new Map(snapshot.candidates); state.memories = new Map(snapshot.memories);
          state.provenance = snapshot.provenance; state.operations = new Map(snapshot.operations);
          state.nextCandidate = snapshot.nextCandidate; state.nextMemory = snapshot.nextMemory;
          throw error;
        }
      } finally { release(); }
    },
    async list(userId, personaId, status) {
      authorize(userId, personaId);
      return clone(Array.from(state.candidates.values()).filter(row => row.userId === userId && row.personaId === personaId && (!status || row.status === status)));
    },
    async provenance(userId, personaId, ids) {
      authorize(userId, personaId);
      return clone(state.provenance.filter(row => row.userId === userId && row.personaId === personaId && row.memoryId != null && ids.includes(row.memoryId)));
    },
    async reviewedFacts(userId, personaId, kind, sceneId) {
      authorize(userId, personaId);
      return clone(Array.from(state.candidates.values()).filter(row => row.userId === userId && row.personaId === personaId
        && row.kind === kind && row.status === "accepted" && row.application === "reviewed_only" && (kind !== "story_event" || row.sceneId === sceneId)));
    },
    async resolveCurrentEvidence(userId, personaId, reference) { authorize(userId, personaId); return resolve(userId, personaId, reference); },
  };
  const service = new MemoryReviewService(repository);
  const create = (operation: number, input: CandidateFields = fields()) => service.perform(1, {
    action: "create", personaId: 11, operationId: operationId(operation), fields: input,
  });
  const accept = (operation: number, candidate: ReviewCandidate, confirmWithoutEvidence = false) => service.perform(1, {
    action: "accept", personaId: 11, candidateId: candidate.id, expectedRevision: candidate.revision,
    operationId: operationId(operation), confirmWithoutEvidence,
  });
  return { service, state, messages, sources, create, accept, failNextProvenance: () => { failProvenance = true; } };
}

describe("审阅字段与事实种类边界", () => {
  it("重要性与可信度独立，保留主观评分和通用记忆字段", async () => {
    const f = setup();
    const pending = (await f.create(1, fields({ confidence: 5, importance: 1, source: "manual", memoryType: "preference", keywords: ["设计", "工作"], emotion: "平静" }))).candidate;
    expect(pending).toMatchObject({ confidence: 5, importance: 1, source: "manual", memoryType: "preference", keywords: ["设计", "工作"], emotion: "平静", evidenceStatus: "needs_confirmation" });
    const accepted = await f.accept(2, pending, true);
    expect(f.state.memories.get(accepted.memoryId!)).toMatchObject({ confidence: 5, importance: 1, source: "manual", memoryType: "preference", emotion: "平静" });
    expect(validateFields(fields({ evidence: [] }))).toMatchObject({ importance: 3, source: "chat", memoryType: "relationship_event", keywords: [], emotion: "" });
    for (const invalid of [{ importance: 0 }, { importance: 6 }, { source: "x".repeat(25) }, { memoryType: "x".repeat(41) }, { emotion: "情".repeat(121) }, { keywords: Array(13).fill("词") }, { keywords: ["长".repeat(25)] }]) {
      expect(() => validateFields(fields(invalid))).toThrow(MemoryReviewError);
    }
  });

  it("用户和助手消息引用都不证明现实，接受 user_fact 必须明确人工确认", async () => {
    const f = setup();
    for (const [index, messageId] of Array.from([1, 2].entries())) {
      const pending = (await f.create(index * 3 + 1, fields({ evidence: [{ type: "message", messageId }] }))).candidate;
      expect(pending.evidence[0].verified).toBe(true);
      expect(pending.evidenceStatus).toBe("needs_confirmation");
      await expect(f.accept(index * 3 + 2, pending)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect((await f.accept(index * 3 + 3, pending, true)).candidate.evidenceStatus).toBe("confirmed_by_user");
    }
  });

  it("原文和故事候选只记审阅结果，不创建现实记忆，故事必须使用可访问情境", async () => {
    const f = setup();
    const source = (await f.create(1, fields({ kind: "source_fact", evidence: [{ type: "source", documentId: 1, chunkIndex: 0 }] }))).candidate;
    const story = (await f.create(2, fields({ kind: "story_event", sceneId: 7 }))).candidate;
    for (const [operation, candidate] of [[3, source], [4, story]] as const) expect((await f.accept(operation, candidate)).candidate).toMatchObject({ application: "reviewed_only", memoryId: null });
    expect(f.state.memories.size).toBe(0);
    expect(await f.service.reviewedFacts(1, 11, "story_event", 7)).toHaveLength(1);
    expect(await f.service.reviewedFacts(1, 11, "story_event", 8)).toEqual([]);
    await expect(f.create(5, fields({ kind: "story_event" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(f.create(6, fields({ kind: "story_event", sceneId: 8 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("拒绝跨账号或跨角色操作，引用必须归属当前角色且引文精确存在", async () => {
    const f = setup();
    await expect(f.service.list(2, 11)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const candidate = (await f.create(1, fields({ evidence: [{ type: "message", messageId: 3 }, { type: "message", messageId: 1, quote: "原消息没有这句话" }] }))).candidate;
    expect(candidate.evidence.every(reference => !reference.verified)).toBe(true);
    await expect(f.service.perform(1, { action: "accept", personaId: 12, candidateId: candidate.id, expectedRevision: 1, operationId: operationId(2), confirmWithoutEvidence: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("动态证据复验", () => {
  it("来源内容变化后列表和接受都失效，原指纹与操作记录保持不变", async () => {
    const f = setup();
    const pending = (await f.create(1, fields({ kind: "source_fact", evidence: [{ type: "source", documentId: 1, chunkIndex: 0, quote: "地图在灯塔" }] }))).candidate;
    const fingerprint = pending.evidence[0].fingerprint;
    f.sources.get(1)!.text += "新增的后文。";
    const listed = (await f.service.list(1, 11))[0];
    expect(listed).toMatchObject({ revision: 1, evidenceStatus: "needs_confirmation" });
    expect(listed.evidence[0]).toMatchObject({ verified: false, fingerprint });
    expect(f.state.candidates.get(pending.id)?.evidence[0].verified).toBe(true);
    expect(f.state.operations.size).toBe(1);
    await expect(f.accept(2, pending)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await f.accept(3, pending, true)).candidate).toMatchObject({ application: "reviewed_only", evidenceStatus: "confirmed_by_user" });
    expect(await f.service.reviewedFacts(1, 11, "source_fact")).toEqual([]);
  });

  it("接受后的原文来源删除即退出自动取证，人工无来源确认也不能补造证据", async () => {
    const f = setup();
    const source = (await f.create(1, fields({ kind: "source_fact", evidence: [{ type: "source", documentId: 1, chunkIndex: 0 }] }))).candidate;
    await f.accept(2, source);
    expect(await f.service.reviewedFacts(1, 11, "source_fact")).toHaveLength(1);
    f.sources.delete(1);
    expect(await f.service.reviewedFacts(1, 11, "source_fact")).toEqual([]);
    expect((await f.service.list(1, 11, "accepted"))[0].evidence[0].verified).toBe(false);
    const unsupported = (await f.create(3, fields({ kind: "source_fact", evidence: [] }))).candidate;
    await f.accept(4, unsupported, true);
    expect(await f.service.reviewedFacts(1, 11, "source_fact")).toEqual([]);
  });

  it("人工确认保留为人工标记，失效消息不再标 verified；新出现的引用也不自动换基线", async () => {
    const f = setup();
    const user = (await f.create(1)).candidate;
    await f.accept(2, user, true);
    f.messages.delete(1);
    expect((await f.service.list(1, 11))[0]).toMatchObject({ evidenceStatus: "confirmed_by_user", evidence: [expect.objectContaining({ verified: false })] });
    const source = (await f.create(3, fields({ kind: "source_fact", evidence: [{ type: "source", documentId: 2, chunkIndex: 0 }] }))).candidate;
    f.sources.set(2, { userId: 1, personaId: 11, text: "新出现的资料。" });
    expect((await f.service.list(1, 11)).find(row => row.id === source.id)?.evidence[0]).toMatchObject({ verified: false, fingerprint: null });
    await expect(f.accept(4, source)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("修订、幂等与事务结果", () => {
  it("编辑增加 revision，旧修订不能接受，拒绝后的候选也不能再编辑", async () => {
    const f = setup();
    const pending = (await f.create(1)).candidate;
    const edited = await f.service.perform(1, { action: "edit", personaId: 11, candidateId: pending.id, expectedRevision: 1, operationId: operationId(2), fields: fields({ importance: 5, confidence: 1, emotion: "期待" }) });
    expect(edited.candidate).toMatchObject({ revision: 2, importance: 5, confidence: 1, emotion: "期待" });
    await expect(f.accept(3, pending, true)).rejects.toMatchObject({ code: "CONFLICT" });
    const rejected = await f.service.perform(1, { action: "reject", personaId: 11, candidateId: pending.id, expectedRevision: 2, operationId: operationId(4) });
    expect(rejected.candidate).toMatchObject({ revision: 3, status: "rejected", application: "rejected" });
    await expect(f.service.perform(1, { action: "edit", personaId: 11, candidateId: pending.id, expectedRevision: 3, operationId: operationId(5), fields: fields() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.memories.size).toBe(0);
  });

  it("相同 UUID 重放同一结果，不重复写记忆；不同请求不能复用 UUID", async () => {
    const f = setup();
    const pending = (await f.create(1)).candidate;
    const first = await f.accept(2, pending, true);
    expect(await f.accept(2, pending, true)).toEqual(first);
    expect(f.state.memories.size).toBe(1);
    expect(f.state.provenance).toHaveLength(1);
    await expect(f.create(1, fields({ importance: 5 }))).rejects.toMatchObject({ code: "CONFLICT" });
    const concurrent = (await f.create(3, fields({ title: "另一个事实" }))).candidate;
    const outcomes = await Promise.allSettled([f.accept(4, concurrent, true), f.accept(5, concurrent, true)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
  });

  it("批量候选和零候选空结果都能幂等重放，半批失败全部回滚", async () => {
    const f = setup();
    const empty = { personaId: 11, operationId: operationId(1), candidates: [] };
    expect(await f.service.createBatch(1, empty)).toEqual({ candidates: [] });
    expect(await f.service.createBatch(1, empty)).toEqual({ candidates: [] });
    const input = { personaId: 11, operationId: operationId(2), candidates: [{ ...fields({ evidence: [] }), sourceMessageIds: [1] }] };
    const first = await f.service.createBatch(1, input);
    expect(await f.service.createBatch(1, input)).toEqual(first);
    expect(first.candidates[0]).toMatchObject({ status: "pending", confidence: 4, importance: 3 });
    await expect(f.service.createBatch(1, { personaId: 11, operationId: operationId(3), candidates: [fields(), fields({ kind: "story_event", sceneId: 8 })] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.state.candidates.size).toBe(1);
    expect(f.state.operations.size).toBe(2);
    await expect(f.service.createBatch(1, { personaId: 11, operationId: operationId(4), candidates: Array.from({ length: 6 }, () => fields()) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("提取锁覆盖模型回调，并发同 UUID 只生成一次，空结果也可重放", async () => {
    const f = setup();
    let generationCalls = 0;
    const generate = async () => { generationCalls++; return [fields()]; };
    const input = { personaId: 11, operationId: operationId(1) };
    const [first, replay] = await Promise.all([
      f.service.generateBatch(1, input, generate), f.service.generateBatch(1, input, generate),
    ]);
    expect(generationCalls).toBe(1);
    expect(replay).toEqual(first);
    expect(f.state.candidates.size).toBe(1);
    const emptyInput = { personaId: 11, operationId: operationId(2) };
    let emptyCalls = 0;
    const empty = async () => { emptyCalls++; return []; };
    expect(await f.service.generateBatch(1, emptyInput, empty)).toEqual({ candidates: [] });
    expect(await f.service.generateBatch(1, emptyInput, empty)).toEqual({ candidates: [] });
    expect(emptyCalls).toBe(1);
  });

  it("提取 UUID 不能复用手动操作，生成失败不保存结果且允许同 UUID 重试", async () => {
    const f = setup();
    await f.create(1);
    let generationCalls = 0;
    const generate = async () => { generationCalls++; return [fields()]; };
    await expect(f.service.generateBatch(1, { personaId: 11, operationId: operationId(1) }, generate)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(generationCalls).toBe(0);
    const retry = { personaId: 11, operationId: operationId(2) };
    await expect(f.service.generateBatch(1, retry, async () => { throw new Error("合成的模型请求失败"); })).rejects.toThrow("合成的模型请求失败");
    expect(f.state.operations.size).toBe(1);
    expect(f.state.candidates.size).toBe(1);
    expect((await f.service.generateBatch(1, retry, generate)).candidates).toHaveLength(1);
    expect(generationCalls).toBe(1);
    await expect(f.service.generateBatch(1, { personaId: 11, operationId: operationId(3) }, async () => Array.from({ length: 6 }, () => fields()))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.state.operations.size).toBe(2);
  });

  it("同一事实复用记忆，事实键冲突保留旧事实并让新候选保持 pending", async () => {
    const f = setup();
    const first = (await f.create(1, fields({ factKey: "occupation" }))).candidate;
    await f.accept(2, first, true);
    const duplicate = (await f.create(3, fields({ factKey: "occupation" }))).candidate;
    expect((await f.accept(4, duplicate, true)).reusedMemory).toBe(true);
    const conflict = (await f.create(5, fields({ factKey: "occupation", description: "用户从事摄影工作。" }))).candidate;
    await expect(f.accept(6, conflict, true)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state.memories.size).toBe(1);
    expect(f.state.memories.get(1)?.description).toBe(first.description);
    expect(f.state.candidates.get(conflict.id)?.status).toBe("pending");
  });

  it("来源记录保存失败时记忆和审阅同时回滚，同一操作可以安全重试", async () => {
    const f = setup();
    const pending = (await f.create(1)).candidate;
    f.failNextProvenance();
    await expect(f.accept(2, pending, true)).rejects.toThrow("合成的来源保存失败");
    expect(f.state.memories.size).toBe(0);
    expect(f.state.provenance).toEqual([]);
    expect(f.state.candidates.get(pending.id)?.status).toBe("pending");
    expect(f.state.operations.size).toBe(1);
    await f.accept(2, pending, true);
    expect(f.state.memories.size).toBe(1);
  });

  it("现实记忆过滤保留旧锚点并排除作品、故事和其他用户归属", () => {
    const memories = [{ id: 1, userId: 1, personaId: 11, category: "anchor" }, { id: 2, userId: 1, personaId: 11, category: "memory" }, { id: 3, userId: 2, personaId: 22, category: "anchor" }];
    const provenance = [{ memoryId: 2, userId: 1, personaId: 11, kind: "source_fact", application: "reviewed_only" }] as MemoryProvenance[];
    expect(filterRealityMemories(memories, provenance, { userId: 1, personaId: 11, sceneId: 7 }).map(row => row.id)).toEqual([1]);
  });
});
