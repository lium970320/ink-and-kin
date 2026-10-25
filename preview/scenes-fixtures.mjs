// 仅供隔离界面预览：合成GET数据，没有数据库、网络、凭据或写操作。
// 共享场景一与消息来源沿用现有聊天预览，所有POST仍由预览入口统一拒绝。
import { chatFixture } from "./chat-fixtures.mjs";
const PERSONA_ID = 1;
const sceneOne = chatFixture("scene.list", {})?.find(scene => scene.id === 1);
const SCENES = [
  { ...sceneOne, id: 1, userId: 1, personaId: PERSONA_ID, isBuiltin: false, previewOnly: true,
    systemPromptOverlay: "这是合成的虚构图书馆故事。围绕目录、地图与书签展开对话；区分观察和推测，通过提问推进线索。",
    starters: ["先去二层的地图阅览室吧。", "蓝色书签上的页码还需要核对。"], continuationEnabled: true,
    scenePersonaRefKey: null, sceneUserRefKey: null, sceneEnvRefKey: null,
    sceneVisualBaseline: "合成场景：图书馆阅览桌、旧地图、目录卡与窗边的阅读灯。", },
  { id: 2, userId: null, personaId: PERSONA_ID, name: "山间驿站的路线讨论", icon: "🌲", isBuiltin: true, previewOnly: true,
    description: "合成内置剧本：旅人与路线规划搭档在驿站对照新旧地图，选择下一段行程。",
    contextSeed: "两份地图对北侧山口的标记不同。旅人与搭档准备先核对天气和路标，再决定路线。",
    personaIdentityOverride: "故事中的虚构旅人，沿河谷记录路线与地理风物，尊重同伴的选择。",
    userIdentityOverride: "故事中的路线规划搭档，负责比较地图与整理待核实问题。",
    systemPromptOverlay: "保持地图、天气与物资记录前后一致。提供具体选择，让人物通过讨论推进情节，不把推测写成已经确认的事实。",
    starters: ["两份地图的山口标记不太一样。", "先看看天气记录，再清点物资吧。"], continuationEnabled: true,
    scenePersonaRefKey: null, sceneUserRefKey: null, sceneEnvRefKey: null,
    sceneVisualBaseline: "合成场景：木桌上的两份地图、旅行笔记和窗外的山路。",
    createdAt: "2026-10-21T09:00:00+08:00", updatedAt: "2026-10-23T16:00:00+08:00", },
];
const MEMORY = {
  1: { storyState: { turn: 18, updatedAt: "2026-10-24 14:12（合成记录）" },
    cache: { summary: "合成剧本前情：三天的阅读中，两人在星河图书馆核对旧目录与地图，发现蓝色书签和地图边缘的铅笔注记。钟楼展柜的说明仍待核对，下一次将从注记继续。",
      pinnedFacts: [
        { id: "scene-1-fact-1", fact: "合成剧本事实：旧目录中夹着一张蓝色书签，页码尚未完全辨认。", source: "user" },
        { id: "scene-1-fact-2", fact: "合成提炼示例：地图边缘有一处铅笔注记，两人约定下一次继续核对。", source: "llm" },
      ],
      openThreads: [
        { id: "scene-1-thread-1", summary: "蓝色书签与地图注记之间是否有关联，仍待查证。", status: "open" },
        { id: "scene-1-thread-2", summary: "二层地图阅览室的位置已经在合成故事中确认。", status: "resolved" },
      ], }, },
  2: { storyState: { turn: 0, updatedAt: "尚未开始（合成预览）" }, cache: { summary: "", pinnedFacts: [], openThreads: [] } },
};
const STATS = [
  { sceneId: 1, turn: 18, updatedAt: "2026-10-24T14:12:00+08:00", factCount: 2, openThreadCount: 1 },
  { sceneId: 2, turn: 0, updatedAt: null, factCount: 0, openThreadCount: 0 },
];
const READ_PATHS = new Set(["scene.list", "scene.detail", "scene.getMemoryStats", "scene.getChatHistory"]);
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function queryInput(input) { return input && typeof input === "object" && Object.hasOwn(input, "json") ? input.json ?? {} : input ?? {}; }
/** 返回查询data，HTTP/tRPC包装由预览入口处理。未知路径、未知对象和所有写操作均不接管。 */
export function scenesFixture(path, input) {
  if (!READ_PATHS.has(path)) return undefined;
  const query = queryInput(input);
  if (path === "scene.list") return copy(SCENES);
  if (Number(query.personaId ?? PERSONA_ID) !== PERSONA_ID) return undefined;
  if (path === "scene.getMemoryStats") {
    const selected = Array.isArray(query.sceneIds) ? query.sceneIds.map(Number) : [1, 2];
    return copy(STATS.filter(item => selected.includes(item.sceneId)));
  }
  const id = Number(path === "scene.detail" ? query.id : query.sceneId);
  const scene = SCENES.find(item => item.id === id);
  if (!scene) return undefined;
  if (path === "scene.detail") return copy({ scene, memory: MEMORY[id] });
  if (path === "scene.getChatHistory") return id === 1 ? chatFixture(path, { personaId: PERSONA_ID, sceneId: 1, limit: query.limit }) : { startAfterMessageId: null, messages: [] };
  return undefined;
}
