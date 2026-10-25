// 隔离前端预览专用：全为虚构合成数据，不访问数据库、模型或消息服务。
// 仅由预览服务在 GET 查询中调用；所有 POST 仍应统一返回 412。
const NAMES = { 1: "虚构旅人", 2: "岚舟" };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayStart = Date.parse(`${today}T00:00:00+08:00`);
function dayKey(offset) { return new Date(dayStart + offset * 86400000 + 8 * 3600000).toISOString().slice(0, 10); }
const DAYS = [-2, -1, 0].map(dayKey);
const copy = value => JSON.parse(JSON.stringify(value));
const queryInput = input => input && typeof input === "object" && Object.hasOwn(input, "json") ? input.json ?? {} : input ?? {};

const DIARIES = [1, 2].flatMap(personaId => DAYS.map((date, index) => ({
  id: personaId * 100 + index + 1, personaId, personaName: NAMES[personaId], date,
  summary: `【虚构预览日记】${NAMES[personaId]}在星河驿站整理地图、核对书签与行程笔记。这是第${index + 1}天的合成故事记录。`,
  messageCount: 12, emotionalArc: ["warm", "playful", "happy"],
  highlights: ["在旧目录中找到蓝色书签", "把待核对的路线与已确认信息分开记录"],
  quotes: ["先核对线索，再决定下一段行程。"],
  reflection: "这篇日记只用于前端布局预览，人物、事件与记录均为虚构；没有生成、保存或读取真实日记。",
  createdAt: `${date}T20:00:00+08:00`, updatedAt: `${date}T20:00:00+08:00`,
})));

const MEMBERS = [1, 2].map((personaId, index) => ({
  id: index + 1, personaId, personaName: NAMES[personaId], avatarUrl: null,
  emotionalState: index === 0 ? "warm" : "playful", analysisStatus: "ready", order: index,
}));
const CHANNELS = [
  {
    id: 1, userId: 1, name: "星河驿站·虚构频道", icon: "🌲", channelKind: "duet",
    description: "虚构旅人与向导岚舟在山间驿站核对地图，讨论下一段行程。仅合成只读预览。",
    scenePrompt: "【场景】傍晚的星河驿站，桌上放着地图与蓝色书签。\n【行为偏好】尊重不同意见，核对证据后再行动。\n【左位角色身份】虚构旅人，记录路线与观察。\n【右位角色身份】向导岚舟，提供普通地形与天气信息。\n【前情提要】两人找到一处未核对的地图注记。\n【开场白】先清点物资，还是核对地图？",
    members: MEMBERS, isActive: true, continuationEnabled: true, runtimeDiagnostics: null,
    createdAt: `${DAYS[0]}T09:00:00+08:00`, updatedAt: `${DAYS[2]}T19:00:00+08:00`,
  },
  {
    id: 2, userId: 1, name: "海边观测·虚构频道", icon: "🌊", channelKind: "duet",
    description: "两位虚构同行者在海边观测站记录潮汐，整理自然观察笔记。仅合成只读预览。",
    scenePrompt: "【场景】海边观测站，窗外有潮声与候鸟。\n【行为偏好】区分观察与推测。\n【左位角色身份】虚构旅人，记录时间与潮线。\n【右位角色身份】岚舟，协助核对速写和风向。\n【前情提要】今天的潮线与昨日不同，需要复核。",
    members: MEMBERS.map(member => ({ ...member, id: member.id + 2 })), isActive: true,
    continuationEnabled: false, runtimeDiagnostics: null,
    createdAt: `${DAYS[0]}T09:00:00+08:00`, updatedAt: `${DAYS[2]}T17:00:00+08:00`,
  },
];

const BEATS = [
  { role: "user", content: "【虚构旁白】星河驿站的灯亮起来了，两位同行者把地图摊在桌上。" },
  { role: "assistant", speakerId: 1, content: "【虚构旅人翻开路线笔记，指向地图上的蓝色标记。】\n这处注记还没有核对，我们先找对应的目录。", thought: "合成角色备注：先核对资料，保留不确定性。" },
  { role: "assistant", speakerId: 2, content: "【岚舟把书签放到地图旁边，留出标注的位置。】\n我来查看目录。等找到来源，再决定明天走哪条路。", thought: "合成角色备注：提出可复核的下一步。" },
  { role: "user", content: "【虚构旁白】窗外开始下雨，桌上还有一份尚未整理的物资清单。" },
  { role: "assistant", speakerId: 1, content: "【虚构旅人将已确认的路线圈出，另记一栏待查事项。】\n星河山口的天气还要再看，先把物资数量记清楚。", thought: "合成角色备注：把事实和计划分别记录。" },
  { role: "assistant", speakerId: 2, content: "【岚舟清点背包，将两份清单并排摆好。】\n数量已经核对好了。我们可以保留两条路线，等天气明确再选择。", thought: "合成角色备注：保留人物自主选择。" },
];

const MESSAGES = CHANNELS.flatMap(channel => DAYS.flatMap((date, dayIndex) => BEATS.map((beat, index) => {
  const messageIndex = dayIndex * BEATS.length + index;
  const speakerId = beat.speakerId ?? null;
  return {
    id: channel.id * 1000 + messageIndex + 1, channelId: channel.id,
    role: beat.role, speakerId, speakerName: speakerId ? NAMES[speakerId] : "虚构旁白",
    content: channel.id === 1 ? beat.content : beat.content.replaceAll("星河驿站", "海边观测站").replaceAll("地图", "观测记录").replaceAll("星河山口的天气", "海边的风向"),
    innerThought: beat.thought ?? null,
    moodState: speakerId ? { emotionalState: ["warm", "playful", "happy"][dayIndex] } : null,
    messageType: "text", contextOverride: index === 0 && dayIndex === 0 ? false : null,
    effectiveInContext: messageIndex > 0,
    createdAt: `${date}T${String(9 + index).padStart(2, "0")}:${String(dayIndex * 10 + index).padStart(2, "0")}:00+08:00`,
  };
})));

function forChannel(channelId) { return MESSAGES.filter(message => message.channelId === channelId); }
function diaryFor(personaId) { return DIARIES.filter(entry => entry.personaId === personaId); }
function memoriesFor(personaId) {
  if (!NAMES[personaId]) return [];
  return [
    { id: personaId * 10 + 1, title: "虚构故事线索：蓝色书签", description: "合成场景记录：书签对应的目录页码仍待核对。", memoryType: "relationship_event", category: "memory", status: "active", confidence: 2, importance: 3, keywords: ["星河", "书签"] },
    { id: personaId * 10 + 2, title: "虚构故事约定：核对后再选路线", description: "合成场景记录：两位同行者保留不同路线，待天气明确后再选择。", memoryType: "promise", category: "milestone", status: "active", confidence: 4, importance: 4, keywords: ["路线", "约定"] },
    { id: personaId * 10 + 3, title: "虚构故事旧笔记", description: "归档示例：前一版清单只用于展示筛选与展开交互。", memoryType: "relationship_event", category: "memory", status: "archived", confidence: 3, importance: 2, keywords: ["清单"] },
  ].map(memory => ({ ...memory, personaId, source: "manual", emotion: "平静", date: DAYS[1], createdAt: `${DAYS[1]}T18:00:00+08:00` }));
}

function sourceOverview(personaId, query) {
  const exists = Boolean(NAMES[personaId]);
  const source = { id: personaId, title: "星河旅途·虚构设定稿", sourceType: "txt", originalName: "合成设定稿.txt", chunkCount: 2, chapterCount: 2, tokenEstimate: 160, topKeywords: ["星河", "地图", "书签"], chapters: [{ title: "第一章 驿站", chunkCount: 1 }, { title: "第二章 路线", chunkCount: 1 }] };
  const chunks = [
    { id: personaId * 10 + 1, sourceTitle: source.title, chapterTitle: "第一章 驿站", chunkIndex: 0, content: "【虚构合成设定】星河驿站位于山路交汇处，旅人可在这里查阅地图、核对目录。", score: 8, matchedTerms: ["星河", "地图"] },
    { id: personaId * 10 + 2, sourceTitle: source.title, chapterTitle: "第二章 路线", chunkIndex: 1, content: "【虚构合成设定】蓝色书签夹在旧目录中，前方有两条路线，人物可以自行讨论选择。", score: 6, matchedTerms: ["书签", "路线"] },
  ];
  const term = String(query ?? "").trim().toLowerCase();
  return { sources: exists ? [source] : [], topKeywords: exists ? source.topKeywords : [], stats: { sourceCount: exists ? 1 : 0, chunkCount: exists ? 2 : 0, chapterCount: exists ? 2 : 0, tokenEstimate: exists ? 160 : 0 }, search: { query: term, results: exists && term ? chunks.filter(chunk => `${chunk.sourceTitle} ${chunk.content}`.toLowerCase().includes(term)) : [] } };
}

function analytics(days) {
  const length = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const rows = Array.from({ length }, (_, index) => ({ date: dayKey(index - length + 1), count: [8, 12, 16, 10, 14, 18, 12][index % 7] }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    preview: true, stats: { totalMessages: total, activeDays: length, longestStreak: length, avgPerDay: Math.round(total / length * 10) / 10 },
    messageVolume: rows,
    emotionTimeline: rows.flatMap(row => ["warm", "playful", "happy"].map((emotionalState,index)=>({date:row.date,emotionalState,count:Math.floor(row.count/3)+(index<row.count%3?1:0)}))),
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour >= 8 && hour <= 21 ? Math.floor(total / 14) + (hour - 8 < total % 14 ? 1 : 0) : 0 })),
    personaEngagement: [{ personaId: 1, name: "虚构旅人", messageCount: Math.ceil(total * 0.6) }, { personaId: 2, name: "岚舟（虚构）", messageCount: total - Math.ceil(total * 0.6) }],
  };
}

/** 返回原始查询JSON；未知路径及所有写操作返回undefined，不产生成功假象。 */
export function socialFixture(path, input) {
  const query = queryInput(input);
  const personaId = Number(query.personaId ?? query.id ?? 1);
  const channelId = Number(query.channelId ?? 0);
  const channel = CHANNELS.find(channel => channel.id === channelId);
  switch (path) {
    case "analytics.overview": return copy(analytics(query.days));
    case "diary.getDates": return diaryFor(personaId).map(entry => ({ date: entry.date }));
    case "diary.getMissingDates": return NAMES[personaId] ? [dayKey(-3)] : [];
    case "diary.list": return copy(diaryFor(personaId).slice().reverse());
    case "diary.getByDate": return copy(diaryFor(personaId).find(entry => entry.date === query.date) ?? null);
    case "roleplay.list": return copy(CHANNELS);
    case "roleplay.get": return { channel: copy(channel ?? null), messages: copy(channel ? forChannel(channelId).slice(-Math.max(1, Math.min(Number(query.limit) || 120, 500))) : []) };
    case "roleplay.advanceStatus": return { channelId, running: false, taskId: null, completedTurns: 0, preview: true };
    case "roleplay.stats": {
      const rows = channel ? forChannel(channelId) : [];
      return { channelId, preview: true, memory: { scenePromptChars: channel?.scenePrompt.length ?? 0, includedCount: rows.filter(row => row.effectiveInContext).length, excludedCount: rows.filter(row => !row.effectiveInContext).length, currentEstimatedTokens: Math.ceil(rows.reduce((sum, row) => sum + row.content.length, 0) / 1.5) }, llm: { todayCalls: 0, todayTokens: 0, todayInputTokens: 0, todayOutputTokens: 0, totalCalls: 0, totalTokens: 0, avgDurationMs: 0, routes: [] } };
    }
    case "roleplay.qqDeliveries": return {
      channelId, batches: channel ? [{
        id: `preview-draft-${channelId}`, channelId, userId: 1, contactId: "preview:private:0000", source: "web",
        createdAt: `${DAYS[2]}T14:00:00+08:00`, updatedAt: `${DAYS[2]}T14:00:00+08:00`,
        parts: [{ id: `preview-part-${channelId}`, beatIndex: 0, partIndex: 0, text: "【虚构未发送草稿】仅用于展开投递卡片；没有连接QQ，点击重发将被只读预览拒绝。", status: "pending", attempts: 0 }],
        summary: { total: 1, sent: 0, failed: 0, unknown: 0, pending: 1, cancelled: 0, sending: 0 },
      }] : [],
    };
    case "memory.list": return copy(memoriesFor(personaId));
    case "sourceLibrary.overview": return copy(sourceOverview(personaId, query.query));
    case "emotion.getReport": return {
      personaId, totalDays: NAMES[personaId] ? 3 : 0, totalMessages: NAMES[personaId] ? 36 : 0,
      snapshots: NAMES[personaId] ? DAYS.map((date, index) => ({ date, emotionalState: ["warm", "playful", "happy"][index], messageCount: 12 })) : [],
      distribution: NAMES[personaId] ? ["warm", "playful", "happy"].map(emotionalState => ({ emotionalState, count: 12 })) : [],
    };
    case "persona.getRuntimeState": return NAMES[personaId] ? {
      id: personaId, name: `${NAMES[personaId]}（虚构合成预览）`, personaDataKeys: [], personaRuntime: {}, runtimeDiagnostics: null, runtimeLifeState: null,
      scheduleState: { stateId: "scene_awake", start: "09:00", end: "21:00" }, memoryStats: { active: 2, highImportance: 1, lowConfidence: 1, recentlyAccessed: 0 }, recentlyAccessedMemories: [],
      sourceLibrary: { sourceCount: 1, chunkCount: 2 }, llmUsage: { today: { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, averageDurationMs: 0 }, byProvider: [], byPurpose: [], recent: [] },
      architecture: { preview: "仅虚构合成数据；未连接模型、真实频道、QQ或计划任务。" },
    } : null;
    default: return undefined;
  }
}
