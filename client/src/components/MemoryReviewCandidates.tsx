import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CandidateFields, ReviewCandidate } from "../../../server/memory-review/core";

const KIND_LABELS = { user_fact: "现实事实", source_fact: "原文事实", story_event: "故事事件" };
const EVIDENCE_LABELS = { verified: "引用已核验", needs_confirmation: "需要人工确认", confirmed_by_user: "已由用户确认" };
type ReviewAction = "edit" | "accept" | "reject";
type SceneOption = { id: number; name: string };

function candidateFields(candidate: ReviewCandidate): CandidateFields {
  return {
    kind: candidate.kind, title: candidate.title, description: candidate.description,
    importance: candidate.importance, confidence: candidate.confidence, source: candidate.source,
    memoryType: candidate.memoryType, keywords: candidate.keywords, emotion: candidate.emotion,
    sceneId: candidate.sceneId, factKey: candidate.factKey, date: candidate.date, category: candidate.category,
    evidence: candidate.evidence.map(item => item.type === "message"
      ? { type: "message", messageId: item.messageId, ...(item.quote === undefined ? {} : { quote: item.quote }) }
      : { type: "source", documentId: item.documentId, chunkIndex: item.chunkIndex, ...(item.quote === undefined ? {} : { quote: item.quote }) }),
  };
}

function isConflict(error: unknown): boolean {
  const value = error as { data?: { code?: string }; shape?: { data?: { code?: string } }; code?: string };
  return value?.data?.code === "CONFLICT" || value?.shape?.data?.code === "CONFLICT" || value?.code === "CONFLICT";
}

function CandidateCard({ candidate, scenes, refresh }: {
  candidate: ReviewCandidate; scenes: SceneOption[]; refresh: () => Promise<void>;
}) {
  const [base, setBase] = useState(candidate);
  const [fields, setFields] = useState(() => candidateFields(candidate));
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const inFlight = useRef(false);
  const operations = useRef<Partial<Record<ReviewAction, { signature: string; id: string }>>>({});
  const edit = trpc.memoryReview.edit.useMutation();
  const accept = trpc.memoryReview.accept.useMutation();
  const reject = trpc.memoryReview.reject.useMutation();
  const dirty = JSON.stringify(fields) !== JSON.stringify(candidateFields(base));
  const validScene = fields.kind !== "story_event" || scenes.some(scene => scene.id === fields.sceneId);
  const evidence = candidate.revision === base.revision ? candidate.evidence : base.evidence;
  const evidenceStatus = candidate.revision === base.revision ? candidate.evidenceStatus : base.evidenceStatus;
  const evidenceSignature = JSON.stringify(evidence.map(item => [item.type, item.verified, item.fingerprint, item.excerpt]));
  const needsConfirmation = base.kind === "user_fact" || !evidence.some(item =>
    item.verified && (base.kind !== "source_fact" || item.type === "source"));
  const blocked = busy !== null || conflict;

  useEffect(() => {
    if (candidate.revision > base.revision) {
      setConflict(true);
      setConfirmed(false);
      setFeedback("候选已有新版本。当前编辑已保留，请载入最新版本后重新审阅。");
    }
  }, [candidate.revision, base.revision]);

  useEffect(() => { setConfirmed(false); }, [evidenceSignature]);

  function change(patch: Partial<CandidateFields>) {
    setFields(current => ({ ...current, ...patch }));
    setConfirmed(false);
    if (!conflict) setFeedback("");
  }

  async function act(action: ReviewAction) {
    if (inFlight.current || conflict) return;
    if (action === "edit" && (!fields.title.trim() || !fields.description.trim() || !validScene)) return;
    if (action !== "edit" && dirty) return;
    if (action === "accept" && ((!validScene) || (needsConfirmation && !confirmed))) return;
    const scope = { personaId: base.personaId, candidateId: base.id, expectedRevision: base.revision };
    const payload = action === "edit" ? { ...scope, fields }
      : action === "accept" ? { ...scope, confirmWithoutEvidence: confirmed } : scope;
    const signature = JSON.stringify(payload);
    if (operations.current[action]?.signature !== signature) {
      operations.current[action] = { signature, id: crypto.randomUUID() };
    }
    const operationId = operations.current[action]!.id;
    inFlight.current = true;
    setBusy(action);
    setFeedback("");
    try {
      if (action === "edit") {
        const result = await edit.mutateAsync({ ...scope, operationId, fields });
        setBase(result.candidate);
        setFields(candidateFields(result.candidate));
        setConfirmed(false);
        setFeedback("候选编辑已保存，仍待审阅，尚未应用。");
        toast.success("候选编辑已保存，尚未应用");
      } else if (action === "accept") {
        await accept.mutateAsync({ ...scope, operationId, confirmWithoutEvidence: confirmed });
        toast.success(base.kind === "user_fact" ? "候选已接受并应用到记忆" : "已接受为审阅资料，未写入现实记忆");
      } else {
        await reject.mutateAsync({ ...scope, operationId });
        toast.success("候选已拒绝，未应用");
      }
      delete operations.current[action];
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败，请重试。";
      if (isConflict(error)) {
        setConflict(true);
        setConfirmed(false);
        setFeedback("候选版本冲突，当前编辑已保留。请载入最新版本后重新审阅。");
        toast.error("候选已变化，请重新审阅");
        await refresh();
      } else {
        setFeedback(message);
        toast.error(message);
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const inputClass = "w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 disabled:opacity-60";
  const buttonClass = "rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50";
  return (
    <article className="rounded-2xl border border-primary/20 bg-card p-4 space-y-3 shadow-2xs">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-semibold text-primary">待审阅 · {KIND_LABELS[base.kind]}</span>
        <span>来源：{base.source}</span>
        <span>可信度 {base.confidence}/5</span>
        <span>重要度 {base.importance}/5</span>
        <span>{EVIDENCE_LABELS[evidenceStatus]}</span>
        <span>版本 {base.revision}</span>
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>候选标题</span>
        <input aria-label="候选标题" className={inputClass} value={fields.title} maxLength={200} disabled={busy !== null} onChange={event => change({ title: event.target.value })} />
      </label>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>候选描述</span>
        <textarea aria-label="候选描述" className={`${inputClass} resize-y leading-relaxed`} rows={3} value={fields.description} maxLength={2000} disabled={busy !== null} onChange={event => change({ description: event.target.value })} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>事实分类</span>
          <select className={inputClass} value={fields.kind} disabled={busy !== null} onChange={event => change({ kind: event.target.value as CandidateFields["kind"] })}>
            {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>重要度 {fields.importance ?? 3}/5</span>
          <input aria-label="候选重要度" className="w-full accent-primary" type="range" min={1} max={5} value={fields.importance ?? 3} disabled={busy !== null} onChange={event => change({ importance: Number(event.target.value) })} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>可信度 {fields.confidence}/5</span>
          <input aria-label="候选可信度" className="w-full accent-primary" type="range" min={1} max={5} value={fields.confidence} disabled={busy !== null} onChange={event => change({ confidence: Number(event.target.value) })} />
        </label>
      </div>
      {fields.kind === "story_event" && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>已有故事场景</span>
          <select className={inputClass} value={fields.sceneId ?? ""} disabled={busy !== null} onChange={event => change({ sceneId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">请选择已有场景</option>
            {scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </select>
          {!validScene && <span className="block text-amber-600 dark:text-amber-400">需要选择可用的已有场景，不能自动创建或推定场景。</span>}
        </label>
      )}
      <div className="rounded-xl border border-border/40 bg-muted/20 p-3 space-y-2 text-xs">
        <p className="font-semibold text-foreground/80">证据引用与摘录</p>
        {evidence.length === 0 && <p className="text-muted-foreground">没有可核验的证据引用。</p>}
        {evidence.map((item, index) => (
          <div key={index} className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              {item.type === "message" ? `对话消息 #${item.messageId}` : `原文资料 #${item.documentId} · 片段 ${item.chunkIndex}`}
              {item.role ? ` · ${item.role}` : ""} · {item.verified ? "引用已核验" : "引用未核验或已失效"}
            </p>
            <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/85">{item.excerpt || item.quote || "没有可显示的摘录"}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {fields.kind === "user_fact"
          ? "对话中的陈述不能证明现实语境。接受现实事实前，请人工核对并明确确认。"
          : "原文事实和故事事件仅作为已审阅资料，不写入现实记忆。失效的原文引用不会自动注入原文上下文。"}
      </p>
      {needsConfirmation && (
        <label className="flex items-start gap-2 text-xs leading-relaxed text-foreground/85">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={confirmed} disabled={blocked || dirty} onChange={event => setConfirmed(event.target.checked)} />
          <span>{base.kind === "user_fact" ? "我已人工核对，确认在缺乏充分现实证据的情况下接受此现实事实。" : "当前缺少充分有效的同类证据，我已人工审阅，确认仅将其作为审阅资料接受。"}</span>
        </label>
      )}
      {feedback && <p role="status" className={`text-xs leading-relaxed ${conflict ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{feedback}</p>}
      {conflict && <button className={`${buttonClass} bg-amber-500/10 text-amber-700 dark:text-amber-300`} disabled={busy !== null || candidate.revision <= base.revision} onClick={() => {
        setBase(candidate); setFields(candidateFields(candidate)); setConfirmed(false); setConflict(false);
        setFeedback("已载入最新版本，请重新核对后操作。"); operations.current = {};
      }}>载入最新版本并重新审阅（放弃当前编辑）</button>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border/40 pt-3">
        {dirty && <span className="mr-auto self-center text-[11px] text-muted-foreground">编辑尚未保存，请先保存候选。</span>}
        <button className={`${buttonClass} bg-muted/60 text-foreground hover:bg-muted`} disabled={blocked || !dirty || !fields.title.trim() || !fields.description.trim() || !validScene} onClick={() => void act("edit")}>{busy === "edit" ? "保存中…" : "保存候选编辑"}</button>
        <button className={`${buttonClass} bg-rose-500/10 text-rose-600 hover:bg-rose-500/20`} disabled={blocked || dirty} onClick={() => void act("reject")}>{busy === "reject" ? "拒绝中…" : "拒绝候选"}</button>
        <button className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={blocked || dirty || !validScene || (needsConfirmation && !confirmed)} onClick={() => void act("accept")}>{busy === "accept" ? "接受中…" : "接受候选"}</button>
      </div>
    </article>
  );
}

export default function MemoryReviewCandidates({ personaId }: { personaId: number }) {
  const utils = trpc.useUtils();
  const candidates = trpc.memoryReview.list.useQuery({ personaId, status: "pending" });
  const scenes = trpc.scene.list.useQuery();
  const refresh = async () => {
    await Promise.all([candidates.refetch(), utils.memory.list.invalidate({ personaId })]);
  };
  return (
    <section className="space-y-3 rounded-3xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-foreground">待审阅候选 {candidates.data ? `(${candidates.data.length})` : ""}</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">AI 提取结果尚未应用，逐条核对后再接受或拒绝。</p>
        </div>
        <button className="rounded-xl bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50" disabled={candidates.isFetching} onClick={() => void candidates.refetch()}>刷新候选</button>
      </div>
      {candidates.isLoading && <p className="text-xs text-muted-foreground">正在加载候选…</p>}
      {candidates.error && <p role="alert" className="text-xs text-rose-600">候选加载失败：{candidates.error.message}</p>}
      {scenes.error && <p role="alert" className="text-xs text-amber-600">场景列表加载失败，故事事件暂不可提交。<button className="ml-2 underline" onClick={() => void scenes.refetch()}>重试</button></p>}
      {candidates.data?.length === 0 && <p className="py-2 text-xs text-muted-foreground">暂无待审阅候选。</p>}
      {candidates.data?.map(candidate => <CandidateCard key={`${personaId}:${candidate.id}`} candidate={candidate} scenes={scenes.error ? [] : scenes.data ?? []} refresh={refresh} />)}
    </section>
  );
}
