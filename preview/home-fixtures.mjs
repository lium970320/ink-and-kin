import { personaFixture } from "./persona-fixtures.mjs";
import { chatFixture } from "./chat-fixtures.mjs";

function snapshot() {
  const personas = personaFixture("persona.list", {}) ?? [];
  const messages = personas.flatMap(persona => chatFixture("chat.getHistory", { personaId: persona.id }) ?? []);
  const counts = new Map();
  for (const message of messages) {
    const date = String(message.createdAt).slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const dailyActivity = Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  return { personas, messages, dailyActivity };
}

/** Only synthetic reads. Mutations and unknown routes are left to the preview guard. */
export function homeFixture(path, input) {
  if (path === "/api/auth/config") return { registrationEnabled: true };
  const route = String(path).replace(/^\/api\/trpc\//, "");
  if (!["persona.stats", "persona.dailyActivity", "persona.recentActivity", "persona.getAnalysisStatus", "file.list"].includes(route)) return undefined;
  const args = input?.json ?? input ?? {};
  const { personas, messages, dailyActivity } = snapshot();

  if (route === "persona.stats") {
    const today = new Date().toISOString().slice(0, 10);
    const memberSince = personas.map(persona => persona.createdAt).filter(Boolean).sort()[0] ?? "2026-01-01T00:00:00.000Z";
    return {
      totalPersonas: personas.length,
      totalChats: messages.length,
      todayChats: dailyActivity.find(day => day.date === today)?.count ?? 0,
      memberSince,
    };
  }
  if (route === "persona.dailyActivity") return dailyActivity;
  if (route === "persona.recentActivity") {
    return messages.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6).map(message => ({
      id: message.id,
      personaId: message.personaId,
      personaName: personas.find(persona => persona.id === message.personaId)?.name ?? "虚构角色",
      role: message.role,
      content: message.content,
      emotionalState: message.emotionalState,
      createdAt: message.createdAt,
    }));
  }

  const personaId = Number(args.personaId ?? args.id ?? 0);
  const persona = personas.find(value => value.id === personaId);
  if (route === "persona.getAnalysisStatus") {
    return persona ? {
      status: persona.analysisStatus,
      progress: persona.analysisProgress ?? 100,
      message: "合成预览状态，未启动后台解析任务。",
      error: null,
    } : null;
  }
  if (!persona) return [];
  const syntheticText = `${persona.name}的合成背景资料：在虚构故事中整理地图、书签与路线线索。仅用于展示文件列表，没有上传实体文件。`;
  return [{
    id: 100 + persona.id,
    personaId: persona.id,
    userId: persona.userId,
    fileType: "chat_txt",
    originalName: `${persona.name}·合成背景资料.txt`,
    fileKey: "",
    fileUrl: "",
    fileSize: new TextEncoder().encode(syntheticText).length,
    extractedMemory: syntheticText,
    processStatus: "done",
    createdAt: persona.createdAt ?? "2026-01-01T00:00:00.000Z",
  }];
}
