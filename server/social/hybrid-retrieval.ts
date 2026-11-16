import {
  embedTexts, rerankDocuments, resolveEmbeddingConfig,
  type EmbeddingProviderConfig, type RerankProviderConfig,
} from "../llm/retrieval-providers";

const SPARSE_STOP_WORDS = new Set([
  "你", "我", "他", "她", "它", "我们", "你们", "他们", "咱们",
  "的", "了", "吗", "呢", "啊", "吧", "呀", "嘛", "哦", "嗯", "哈", "嘿",
  "是", "不是", "在", "有", "没有", "和", "与", "及", "或", "但", "但是", "所以", "因为",
  "这个", "那个", "这些", "那些", "什么", "怎么", "为什么", "为何", "哪里", "哪儿", "哪个",
  "是不是", "有没有", "对不对", "真的", "真的吗", "就是", "还是", "可以", "一下", "一点",
  "一个", "一些", "时候", "的时候", "现在", "刚才", "今天", "昨天", "之前", "以前", "后来",
  "当时", "那次", "这次", "那个时候", "那时候", "那会儿", "记得", "还记得", "想起", "回忆",
  "原文", "原著", "小说", "里面", "内容", "剧情", "细节", "感觉", "觉得", "知道",
]);

/**
 * 动态世界书触发词黑名单：日常高频城市、场所、动作、亲密词与泛称绝不能进入自动触发词表，
 * 防止用户日常一句「我在学校」「去北京出差」「好喜欢你」被误劫持进原著考据模式。
 */
export const DAILY_CHAT_WORLDBOOK_BLACKLIST = new Set([
  ...Array.from(SPARSE_STOP_WORDS),
  "北京", "上海", "广州", "深圳", "南京", "武汉", "杭州", "成都", "重庆", "西安", "苏州", "天津", "长沙",
  "学校", "大学", "学院", "宿舍", "教室", "家里", "房间", "公司", "办公室", "医院", "车站", "机场", "酒店",
  "上课", "下课", "上班", "下班", "出差", "见面", "吃饭", "睡觉", "洗澡", "休息", "工作", "读书", "考试",
  "喜欢", "好喜欢", "爱你", "想你", "抱着", "抱抱", "亲吻", "亲亲", "睡一块", "睡在一起", "表白", "结婚",
  "老师", "同学", "朋友", "同事", "家人", "爸爸", "妈妈", "哥哥", "姐姐", "弟弟", "妹妹", "叔叔", "阿姨",
  "男人", "女人", "男生", "女生", "孩子", "儿子", "女儿", "丈夫", "妻子", "老婆", "老公",
  "第一章", "第二章", "第三章", "第四章", "第五章", "番外", "序章", "尾声", "正文", "目录", "未分章",
]);

const zhWordSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;

function isSingleStopChar(token: string): boolean {
  return token.length < 2 || /^[吗呢啊吧呀嘛哦嗯的了过着和与及又还再就都很更挺真在有是人个上下里外前后]$/.test(token);
}

/**
 * 零外部依赖的中文混合分词器：
 * 1. 利用 Node.js 内置 Intl.Segmenter 提取中英文词元；
 * 2. 对长度 >= 3 的中文片段补充二元/三元字符滑窗，保证未登录专有名词（罕见人名/地名）也能稳定召回。
 */
export function tokenizeForSparseSearch(
  text: string,
  maxTokens = 96,
  options?: { includeCharacterNgrams?: boolean },
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const includeNgrams = options?.includeCharacterNgrams !== false;

  const tokens: string[] = [];
  const pushToken = (raw: string) => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || isSingleStopChar(normalized) || SPARSE_STOP_WORDS.has(normalized)) return;
    tokens.push(normalized.slice(0, 32));
  };

  if (zhWordSegmenter) {
    for (const seg of Array.from(zhWordSegmenter.segment(trimmed))) {
      if (!seg.isWordLike) continue;
      pushToken(seg.segment);
      if (tokens.length >= maxTokens) break;
    }
  }

  const chunks = trimmed.replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  for (const chunk of chunks) {
    if (/^[A-Za-z0-9_]+$/.test(chunk)) {
      if (chunk.length >= 2) pushToken(chunk);
      continue;
    }
    const chars = Array.from(chunk);
    if (chars.length >= 2 && chars.length <= 6) {
      pushToken(chunk);
    }
    if (includeNgrams) {
      for (const n of [3, 2]) {
        if (chars.length < n) continue;
        for (let i = 0; i <= chars.length - n; i += 1) {
          pushToken(chars.slice(i, i + n).join(""));
          if (tokens.length >= maxTokens * 2) break;
        }
      }
    }
    if (tokens.length >= maxTokens * 2) break;
  }

  return tokens.slice(0, maxTokens);
}

export function extractUniqueSearchTerms(
  query: string,
  maxTerms = 28,
  options?: { includeCharacterNgrams?: boolean },
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokenizeForSparseSearch(query, maxTerms * 3, options)) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= maxTerms) break;
  }
  return unique;
}

export type HybridCandidateInput<T> = {
  id: number | string;
  item: T;
  /** 主正文内容（权重 1.0）。 */
  content: string;
  /** 标题或章节名（稀疏检索权重 2.4）。 */
  title?: string | null;
  /** 结构化关键词列表（稀疏检索权重 2.0）。 */
  keywords?: string[];
  /** 由调用方按供应商配置筛过的持久化向量。 */
  embedding?: number[];
};

export type HybridRankedResult<T> = {
  id: number | string;
  item: T;
  fusedScore: number;
  sparseScore: number;
  denseScore: number;
  matchedTerms: string[];
};

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildTermFrequencyMap(tokens: string[], weight = 1, target = new Map<string, number>()) {
  for (const token of tokens) {
    target.set(token, (target.get(token) ?? 0) + weight);
  }
  return target;
}

/**
 * 标准多字段加权 Okapi BM25 稀疏检索评分器（零专名硬编码，依靠精确 IDF 自动凸显低频专名）。
 */
export function scoreCandidatesBm25<T>(
  query: string,
  candidates: Array<HybridCandidateInput<T>>,
  options: { k1?: number; b?: number } = {},
): Array<{ index: number; score: number; matchedTerms: string[] }> {
  if (candidates.length === 0) return [];
  const queryTerms = extractUniqueSearchTerms(query, 32);
  if (queryTerms.length === 0) {
    return candidates.map((_, index) => ({ index, score: 0, matchedTerms: [] }));
  }

  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;
  const docTermMaps: Array<Map<string, number>> = [];
  const docLengths: number[] = [];
  const docFreq = new Map<string, number>();

  for (const candidate of candidates) {
    const tf = new Map<string, number>();
    buildTermFrequencyMap(tokenizeForSparseSearch(candidate.content, 240), 1.0, tf);
    if (candidate.title) {
      buildTermFrequencyMap(tokenizeForSparseSearch(candidate.title, 48), 2.4, tf);
    }
    if (candidate.keywords?.length) {
      for (const kw of candidate.keywords) {
        const cleanKw = kw.trim().toLowerCase();
        if (cleanKw.length >= 2) {
          tf.set(cleanKw, (tf.get(cleanKw) ?? 0) + 2.2);
        }
        buildTermFrequencyMap(tokenizeForSparseSearch(cleanKw, 16), 1.6, tf);
      }
    }

    // 针对原文字面精确包含的长查询词补一次字面命中，防止生僻专名跨越空格或标点被漏计
    const haystackLower = `${candidate.title || ""}\n${candidate.content}`.toLowerCase();
    for (const qTerm of queryTerms) {
      if (qTerm.length >= 2 && !tf.has(qTerm) && haystackLower.includes(qTerm)) {
        const inTitle = (candidate.title || "").toLowerCase().includes(qTerm);
        tf.set(qTerm, inTitle ? 2.4 : 1.0);
      }
    }

    let length = 0;
    for (const count of Array.from(tf.values())) length += count;
    docTermMaps.push(tf);
    docLengths.push(Math.max(1, length));

    for (const qTerm of queryTerms) {
      if ((tf.get(qTerm) ?? 0) > 0) {
        docFreq.set(qTerm, (docFreq.get(qTerm) ?? 0) + 1);
      }
    }
  }

  const totalDocs = candidates.length;
  const avgDocLength =
    docLengths.reduce((sum, len) => sum + len, 0) / Math.max(1, totalDocs);

  return candidates.map((_, index) => {
    const tfMap = docTermMaps[index];
    const docLen = docLengths[index];
    let score = 0;
    const rawMatched: string[] = [];

    for (const qTerm of queryTerms) {
      const f = tfMap.get(qTerm) ?? 0;
      if (f <= 0) continue;
      rawMatched.push(qTerm);
      const df = docFreq.get(qTerm) ?? 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const lengthBoost = qTerm.length >= 4 ? 1.35 : qTerm.length === 3 ? 1.15 : 1.0;
      const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLen / avgDocLength)));
      score += idf * tfNorm * lengthBoost;
    }

    // 去除已被更长命中词完全包含的子串，使展示的命中词干净凝练
    const matchedTerms = rawMatched.filter(
      (term) => !rawMatched.some((other) => other !== term && other.length > term.length && other.includes(term)),
    );

    return { index, score, matchedTerms };
  });
}
export type WorldbookTriggerSource = {
  personaData?: unknown;
  sourceTitles?: string[];
  chapterTitles?: string[];
  chunkKeywords?: string[];
};

function isSafeWorldbookTerm(raw: string): boolean {
  const term = raw.trim();
  if (term.length < 2 || term.length > 16) return false;
  if (DAILY_CHAT_WORLDBOOK_BLACKLIST.has(term) || DAILY_CHAT_WORLDBOOK_BLACKLIST.has(term.toLowerCase())) {
    return false;
  }
  if (/^\d+$/.test(term)) return false;
  if (/^第[一二三四五六七八九十百零\d]+[章节回卷集篇部]$/.test(term)) return false;
  if (/(喜欢|亲吻|抱着|睡觉|学校|上课|工作|出差|见面)$/.test(term)) return false;
  return true;
}

/**
 * 从角色档案与已导入的原著元数据动态提取安全的「世界书专名触发词」，
 * 完全替代过去在 source-recall.ts 中硬编码某一部小说人名/地名的做法。
 */
export function extractDynamicWorldbookTriggers(source: WorldbookTriggerSource, maxTerms = 48): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (value: unknown) => {
    if (typeof value !== "string") return;
    const cleaned = value.replace(/[《》「」『』【】()（）"'“”‘’]/g, "").trim();
    if (!isSafeWorldbookTerm(cleaned) || seen.has(cleaned)) return;
    seen.add(cleaned);
    collected.push(cleaned);
  };

  // 1. 仅读取角色档案中「显式配置」的 sourceTerms（避免未配置新角色被默认示例词污染）
  if (source.personaData && typeof source.personaData === "object") {
    const pd = source.personaData as { profileSections?: { life?: { sourceTerms?: unknown } } };
    const explicitSourceTerms = pd?.profileSections?.life?.sourceTerms;
    if (Array.isArray(explicitSourceTerms)) {
      explicitSourceTerms.forEach(addCandidate);
    }
  }

  // 2. 原著书名（去掉书名号后通常是核心作品名）
  if (Array.isArray(source.sourceTitles)) {
    source.sourceTitles.forEach(addCandidate);
  }

  // 3. 原著分块中出现的高频结构化关键词
  if (Array.isArray(source.chunkKeywords)) {
    source.chunkKeywords.filter(term => !/^[\u3400-\u9fff]{2}$/.test(term)).forEach(addCandidate);
  }

  // 4. 章节标题中的特定专名短词（剔除「第X章」前缀后的 2~6 字词组）
  if (Array.isArray(source.chapterTitles)) {
    for (const rawTitle of source.chapterTitles) {
      if (typeof rawTitle !== "string") continue;
      const stripped = rawTitle
        .replace(/^第[一二三四五六七八九十百零\d]+[章节回卷集篇部][\s：:·—-]*/g, "")
        .replace(/^\d+[\s.、：:-]*/g, "")
        .trim();
      if (stripped.length >= 2 && stripped.length <= 6) {
        addCandidate(stripped);
      }
    }
  }

  return collected.slice(0, maxTerms);
}

type SourceVectorUpdate = { id: number | string; embedding: number[] };

export async function hybridRankCandidates<T>(
  query: string,
  candidates: HybridCandidateInput<T>[],
  options: {
    limit: number;
    embeddingConfig?: EmbeddingProviderConfig;
    rerankConfig?: RerankProviderConfig;
    onVectors?: (updates: SourceVectorUpdate[], fingerprint: string) => Promise<void>;
  },
): Promise<HybridRankedResult<T>[]> {
  if (!query.trim() || !candidates.length) return [];
  const sparse = scoreCandidatesBm25(query, candidates);
  const sparseOrder = sparse.filter(row => row.score > 0).sort((a, b) => b.score - a.score);
  const sparseRanks = new Map(sparseOrder.map(({ index }, rank) => [index, rank + 1]));
  const denseScores = new Map<number, number>();
  const cfg = resolveEmbeddingConfig(options.embeddingConfig);
  const candidateText = ({ title, content }: HybridCandidateInput<T>) => [title, content].filter(Boolean).join("\n");

  if (cfg.enabled) {
    const missing = sparseOrder.filter(row => !candidates[row.index].embedding).slice(0, 12);
    const vectors = await embedTexts([query, ...missing.map(row => candidateText(candidates[row.index]))], cfg);
    const queryVector = vectors?.[0];
    if (queryVector && vectors) {
      const fresh = new Map<number, number[]>();
      missing.forEach(({ index }, offset) => {
        const vector = vectors[offset + 1];
        if (vector?.length === queryVector.length) fresh.set(index, vector);
      });
      if (fresh.size && options.onVectors) {
        // 写入应失败可重试；本轮排序仍可使用已得到的向量。
        try {
          await options.onVectors(Array.from(fresh, ([index, embedding]) => ({
            id: candidates[index].id, embedding,
          })), cfg.fingerprint);
        } catch {
          console.warn("[Retrieval] 资料向量缓存写入失败");
        }
      }
      candidates.forEach(({ embedding }, index) => {
        const vector = fresh.get(index) ?? embedding;
        if (!vector) return;
        const score = cosineSimilarity(queryVector, vector);
        if (score > 0.18) denseScores.set(index, score);
      });
    }
  }

  const denseRanks = new Map(Array.from(denseScores)
    .sort((a, b) => b[1] - a[1]).map(([index], rank) => [index, rank + 1]));
  const ranked = candidates.flatMap((candidate, index) => {
    const sparseRank = sparseRanks.get(index);
    const denseRank = denseRanks.get(index);
    if (!sparseRank && !denseRank) return [];
    return [{
      index, id: candidate.id, item: candidate.item,
      fusedScore: (sparseRank ? 1 / (60 + sparseRank) : 0) + (denseRank ? 1 / (60 + denseRank) : 0),
      sparseScore: sparse[index].score,
      denseScore: denseScores.get(index) ?? 0,
      matchedTerms: sparse[index].matchedTerms,
    }];
  }).sort((a, b) => b.fusedScore - a.fusedScore || b.sparseScore - a.sparseScore);

  // 限定精排池，外部服务失败时保留 RRF 顺序。
  const pool = ranked.slice(0, 16);
  const reranked = await rerankDocuments(query, pool.map(row => candidateText(candidates[row.index])), options.rerankConfig);
  if (reranked) {
    pool.sort((a, b) => {
      const left = reranked.get(ranked.indexOf(a));
      const right = reranked.get(ranked.indexOf(b));
      return (right ?? -Infinity) - (left ?? -Infinity) || b.fusedScore - a.fusedScore;
    });
  }
  return [...pool, ...ranked.slice(pool.length)].slice(0, options.limit)
    .map(({ index: _index, ...row }) => row);
}
