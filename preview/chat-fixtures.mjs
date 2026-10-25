// 仅供隔离前端预览：全部内容均为合成数据，没有数据库、网络或写操作。
// 调用者仅对 GET 查询调用本模块；所有 POST 必须由预览服务明确拒绝。
const PERSONA_ID = 1;
const SCENE_ID = 1;
const DAYS = ["2026-10-22", "2026-10-23", "2026-10-24"];
const PAIRS = [
  ["星河图书馆今天开放哪一层？", "先去二层的地图阅览室吧。窗边留着一张空桌，适合摊开航路图。"],
  ["我在旧目录里找到了一张蓝色书签。", "书签上画着一盏小灯。我们可以先记下页码，再去查同一批入藏记录。"],
  ["星河这两个字会不会是地图的线索？", "在这个虚构故事里，它是旧街区的名字。先把它当作一个待核对的线索，不急着下结论。"],
  ["下午去看看钟楼旁边的展柜。", "好，我把要看的目录列成三项：地图、借阅卡和展品说明。一步一步找就不容易漏。"],
  ["把今天找到的故事线索整理成一张便签吧。", "便签：蓝色书签来自旧目录；地图上有一处铅笔标记；钟楼展柜的说明还需要继续核对。"],
  ["星河的灯亮起来了，今天先读到这里。", "那就把书放回原来的位置。下一次从地图边缘的注记继续，今晚的阅读先告一段落。"],
];

const MESSAGES = DAYS.flatMap((date, dayIndex) => PAIRS.flatMap((pair, pairIndex) => pair.map((text, roleIndex) => {
  const index = dayIndex * 12 + pairIndex * 2 + roleIndex;
  const hour = String(9 + Math.floor((pairIndex * 2 + roleIndex) / 2)).padStart(2, "0");
  const minute = roleIndex === 0 ? "05" : "12";
  return {
    id: 1001 + index, userId: 1, personaId: PERSONA_ID, sceneId: SCENE_ID,
    role: roleIndex === 0 ? "user" : "assistant", content: `${text}${dayIndex === 0 ? "" : `（第${dayIndex + 1}天的阅读记录）`}`,
    messageType: "text", mediaUrl: null, mediaDuration: null,
    channel: "web", emotionalState: ["warm", "playful", "happy"][dayIndex],
    createdAt: `${date}T${hour}:${minute}:00+08:00`,
  };
})));

const CONTEXT_MESSAGES = MESSAGES.map((message, index) => ({
  ...message,
  contextOverride: index === 8 || index === 19 ? false : index === 10 ? true : null,
  effectiveInContext: index >= 8 && index !== 8 && index !== 19,
}));

const SCENE = {
  id: SCENE_ID, userId: 1, personaId: PERSONA_ID, name: "星河图书馆的夜读", icon: "📚",
  description: "一场普通的虚构阅读冒险：在图书馆查找旧地图，整理书签与展柜里的线索。",
  contextSeed: "三天前，林舟和读者在旧目录中发现一张蓝色书签。现在两人准备核对地图边缘的注记。",
  personaIdentityOverride: "林舟是故事中的图书馆志愿者，熟悉目录与地图，会和读者一起核对证据。",
  userIdentityOverride: "你在故事中是一位来访读者，负责记录观察与提出问题。",
  createdAt: "2026-10-22T09:00:00+08:00", updatedAt: "2026-10-24T14:12:00+08:00",
};

const MEMORIES = [
  { id: 1, title: "蓝色书签", description: "虚构场景线索：在旧目录中发现蓝色书签，页码仍待核对。", date: DAYS[0], category: "memory", memoryType: "relationship_event", source: "manual", status: "active", importance: 3, confidence: 2, keywords: ["星河", "书签"], emotion: "好奇" },
  { id: 2, title: "下一次阅读起点", description: "虚构场景约定：下次从地图边缘的注记继续阅读。", date: DAYS[2], category: "milestone", memoryType: "promise", source: "manual", status: "active", importance: 4, confidence: 4, keywords: ["地图", "阅读"], emotion: "期待" },
  { id: 3, title: "早期目录草稿", description: "预览中的归档示例，用于检查筛选与展开布局。", date: DAYS[0], category: "memory", memoryType: "relationship_event", source: "manual", status: "archived", importance: 2, confidence: 3, keywords: ["目录"], emotion: "平静" },
].map(memory => ({ ...memory, userId: 1, personaId: PERSONA_ID, createdAt: `${memory.date}T14:15:00+08:00`, updatedAt: `${memory.date}T14:15:00+08:00` }));

const SOURCE_CHUNKS = [
  { id: 1, sourceId: 1, sourceTitle: "星河图书馆·合成设定稿", chapterTitle: "第一章 旧目录", chunkIndex: 0, content: "星河图书馆二层设有地图阅览室。旧目录夹着一张蓝色书签，旁边的页码已经模糊。", score: 8, matchedTerms: ["星河", "图书馆"] },
  { id: 2, sourceId: 1, sourceTitle: "星河图书馆·合成设定稿", chapterTitle: "第二章 钟楼展柜", chunkIndex: 1, content: "钟楼旁边的展柜陈列着旧地图与借阅卡。地图边缘有一处铅笔注记，读者决定下次继续核对。", score: 6, matchedTerms: ["地图", "钟楼"] },
];
const SOURCE = {
  id: 1, title: "星河图书馆·合成设定稿", sourceType: "txt", originalName: "合成预览设定.txt",
  chunkCount: 2, chapterCount: 2, tokenEstimate: 180, topKeywords: ["星河", "地图", "书签"],
  chapters: [{ title: "第一章 旧目录", chunkCount: 1 }, { title: "第二章 钟楼展柜", chunkCount: 1 }],
};
const DIARY = DAYS.map((date, index) => ({
  id: index + 1, personaId: PERSONA_ID, date, messageCount: 12,
  summary: "合成预览日记：今天在星河图书馆阅读地图，整理了书签与目录的故事线索。",
  highlights: ["找到蓝色书签", "约定继续核对地图注记"],
  quotes: ["先核对线索，再写下结论。"], reflection: "这是虚构场景的合成记录，没有调用模型或保存真实日记。",
  createdAt: `${date}T20:00:00+08:00`,
}));

const RUNTIME = {
  id: PERSONA_ID, name: "林舟（合成预览）", personaDataKeys: [], personaRuntime: {},
  runtimeDiagnostics: null, runtimeLifeState: null,
  scheduleState: { stateId: "scene_awake", start: "09:00", end: "21:00" },
  memoryStats: { active: 2, highImportance: 1, lowConfidence: 1, recentlyAccessed: 0 },
  recentlyAccessedMemories: [], sourceLibrary: { sourceCount: 1, chunkCount: 2 },
  llmUsage: { today: { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, averageDurationMs: 0 }, byProvider: [], byPurpose: [], recent: [] },
  architecture: { preview: "仅前端合成数据；未接模型、真实消息、计划任务或任何运行服务。" },
};

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function queryInput(input) { return input && typeof input === "object" && Object.hasOwn(input, "json") ? input.json ?? {} : input ?? {}; }

/** 返回查询的原始JSON数据；由预览服务包装tRPC响应。未知路径不接管。
 * 本函数不会为任何写操作返回成功；不要把undefined转换成通用成功响应。
 */
export function chatFixture(path, input) {
  const query = queryInput(input);
  const ownsPersona = Number(query.personaId ?? query.id ?? PERSONA_ID) === PERSONA_ID;
  switch (path) {
    case "persona.getIntimacy": return ownsPersona ? { score: 24, level: "熟悉的书友", icon: "📖" } : null;
    case "chat.getHistory": return copy(ownsPersona ? MESSAGES : []);
    case "chat.search": {
      const term = String(query.query ?? "").trim().toLocaleLowerCase("zh-CN");
      return copy(ownsPersona && term ? MESSAGES.filter(message => message.content.toLocaleLowerCase("zh-CN").includes(term)) : []);
    }
    case "chat.getContextState": return { startAfterMessageId: 1008, messages: copy(ownsPersona ? CONTEXT_MESSAGES : []) };
    case "scene.list": return copy([SCENE]);
    case "scene.getChatHistory": return { startAfterMessageId: 1008, messages: copy(ownsPersona && Number(query.sceneId) === SCENE_ID ? CONTEXT_MESSAGES : []) };
    case "persona.getRuntimeState": return ownsPersona ? copy(RUNTIME) : null;
    case "memory.list": return copy(ownsPersona ? MEMORIES : []);
    case "sourceLibrary.overview": {
      const term = String(query.query ?? "").trim().toLocaleLowerCase("zh-CN");
      const sources = ownsPersona ? [SOURCE] : [];
      return {
        sources: copy(sources), stats: { sourceCount: sources.length, chunkCount: sources.length * 2, chapterCount: sources.length * 2, tokenEstimate: sources.length * 180 },
        topKeywords: ownsPersona ? ["星河", "地图", "书签"] : [],
        search: { query: term, results: copy(ownsPersona && term ? SOURCE_CHUNKS.filter(chunk => `${chunk.sourceTitle} ${chunk.chapterTitle} ${chunk.content}`.toLocaleLowerCase("zh-CN").includes(term)) : []) },
      };
    }
    case "emotion.getReport": return {
      totalDays: ownsPersona ? 3 : 0, totalMessages: ownsPersona ? 36 : 0,
      snapshots: ownsPersona ? DAYS.map((date, index) => ({ date, emotionalState: ["warm", "playful", "happy"][index], messageCount: 12 })) : [],
      distribution: ownsPersona ? ["warm", "playful", "happy"].map(emotionalState => ({ emotionalState, count: 12 })) : [],
    };
    case "diary.getDates": return ownsPersona ? DAYS.map(date => ({ date })) : [];
    case "diary.getMissingDates": return [];
    case "diary.list": return copy(ownsPersona ? DIARY : []);
    case "diary.getByDate": return ownsPersona ? copy(DIARY.find(entry => entry.date === query.date) ?? null) : null;
    default: return undefined;
  }
}
