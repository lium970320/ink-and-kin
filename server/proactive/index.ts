import { TRPCError } from "@trpc/server";
import { getPersonaById } from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { llmService } from "../llm";
import { getTextContent } from "../llm/types";
import { qqService } from "../channels/qq";
import { QqProactiveService } from "../channels/qq/proactive-service";
import { createProactiveRepository } from "./repository";
import { createProactiveService } from "./service";
import { createPersonaRuntimeService } from "./runtime";
import { localClock } from "./policy";
import type { ProactiveClaim } from "./types";

export const proactiveRepository = createProactiveRepository({ now: () => new Date() });
export const runtimeService = createPersonaRuntimeService({
  getPolicy: (userId, personaId) => proactiveRepository.getPolicy(userId, personaId),
  listProactiveJobs: (userId, personaId) => proactiveRepository.list(userId, personaId),
});
const transport = new QqProactiveService(qqService, proactiveRepository);

export async function generateProactiveText(claim: ProactiveClaim, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const persona = await getPersonaById(claim.job.personaId, claim.job.userId);
  if (!persona || persona.analysisStatus !== "ready" || persona.graduationStatus === "graduated") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "人物当前不可用。" });
  }
  const clock = localClock(new Date(), claim.policy.timeZone);
  const [year, month, day] = clock.day.split("-").map(Number);
  const [hour, minute] = clock.hhmm.split(":").map(Number);
  // A wall-clock view is used only for wording; all scheduling uses real UTC instants.
  const promptNow = new Date(year, month - 1, day, hour, minute);
  const task = claim.job.kind === "followup"
    ? "用户明确安排了关心回访。温和询问下面主题的近况，不假定事情已经发生、完成或得到结论。主题：" + (claim.job.topic ?? "")
    : claim.job.kind === "ambient"
      ? "写一条简短自然的关心或问候。这是虚构角色的表达，不陈述无法确认的现实活动；不要把网页氛围动画或推演当作真实事件。"
      : "在用户指定的时间写一条简短的主动问候或心路分享。不编造用户经历，不声称已经做过真实世界的事情。";
  const result = await llmService.invoke({
    messages: [
      { role: "system", content: buildSystemPrompt(persona, { now: promptNow }) +
        `\n\n这是系统生成的主动文字，不是用户发言或确认事实。当前用户日历时间：${clock.day} ${clock.hhmm}（${claim.policy.timeZone}）。只输出1至3句可发送正文，不输出推理、标签、图片或语音指令。` },
      { role: "user", content: task + (claim.policy.stylePrompt ? `\n表达风格：${claim.policy.stylePrompt}` : "") },
    ],
    options: { provider: persona.llmProvider ?? undefined, purpose: "proactive", signal,
      usageContext: { userId: claim.job.userId, personaId: persona.id, purpose: "proactive", route: "proactive." + claim.job.kind } },
  });
  signal.throwIfAborted();
  const text = getTextContent(result).trim();
  if (!text || text.length > 4000) throw new Error("主动消息正文无效。");
  return text;
}
function makeService() {
  return createProactiveService({ repo: proactiveRepository, generate: generateProactiveText,
    beforeGenerate: (claim, signal) => transport.beforeGenerate(claim, signal),
    deliverQq: (claim, signal, snapshot) => transport.deliver(claim, signal, snapshot) });
}
let service = makeService();
let stopped = false;
export function startProactiveTasks() { if (stopped) service = makeService(); stopped = false; }
export function stopProactiveTasks() { stopped = true; service.stop(); }
export async function runProactiveSweep() { if (!stopped) await service.sweep(); }
export function requestAmbient(userId: number, personaId: number) { return service.enqueueAmbient(userId, personaId); }
