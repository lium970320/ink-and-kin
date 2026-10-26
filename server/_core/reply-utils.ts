const LEADING_ASIDE_PATTERN =
  /^\s*(?:[（(【\[][^）)\]】]{1,80}[）)\]】]\s*)+/;
const INLINE_ASIDE_PATTERN =
  /[（(][^）)]{1,80}[）)]/g;
// 方括号【…】旁白：场景外（非沉浸）一律不允许，无论在开头还是句中（沉浸模式不走此清洗、保留）。
const BRACKET_ASIDE_PATTERN = /【[^】]*】/g;
const ASTERISK_ACTION_PATTERN =
  /\*[^*]{1,80}\*/g;
const LEADING_SPEAKER_LABEL_PATTERN =
  /^\s*(AI|助手|角色|机器人)\s*[：:]\s*/i;
const SENTENCE_PATTERN = /[^。！？!?…；;\n]+[。！？!?…；;]*/g;
const CLAUSE_PATTERN = /[^，,、\n]+[，,、]*/g;
const WRAPPING_QUOTE_PAIRS: Array<[string, string]> = [
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["\"", "\""],
  ["'", "'"],
];
const LEADING_DECORATIVE_QUOTES_PATTERN = /^["“”'‘’「」『』]+/;
const TRAILING_DECORATIVE_QUOTES_PATTERN = /["“”'‘’「」『』]+$/;
const FORCED_DIRECTNESS_TAIL_SENTENCE_PATTERNS = [
  /^(?:行了吧[，,、\s]*)?够不够(?:直接|清楚|明白|浓烈|直白|坦白|爱你|真|认真|诚恳)?[了呀啊呢嘛吗么]*$/,
  /^(?:行了吧[，,、\s]*)?够[^。！？!?；;\n]{0,8}(?:直接|清楚|明白|浓烈|直白|坦白|爱你|真|认真|诚恳)[了呀啊呢嘛吗么]*$/,
  /^不够(?:我|叔|明天|下次|以后|再|就)/,
  /^再(?:浓|直接|明白|说)/,
  /^你要是还嫌/,
  /^这样(?:够|还不够)/,
  /^行了吧$/,
  // 标榜真诚的自我了断尾巴："你心里知道就行""你懂就行"——说多了显假，清掉
  /^你(?:心里)?(?:知道|清楚|懂|有数|明白)(?:就行|就好|就成|就够了?)?$/,
];
const OVERUSED_LEADING_CATCHPHRASE_PATTERN =
  /^(?:你听好了|听好了)[，,。.!！：:\s]*/;
// 标榜真诚的开场套话："再说句实的""说句心里话""不瞒你说"——说多了显假，清掉（保守：要求其后带标点/空白，避免误删正文）
const OVERUSED_SINCERITY_LEADING_PATTERN =
  /^(?:再?说句?(?:实在?的话?|实的话?|实话|心里话|掏心(?:窝)?的?话?)|不瞒你说|说点实在的话?|实话(?:跟你)?说|跟你交个?底|说真的)[，,。.!！：:、\s]+/;
const OVERUSED_SLEEP_CLOSURE_TAIL_SENTENCE_PATTERNS = [
  /^(?:行了[，,、\s]*)?(?:别闹了?|不闹了)[，,、\s]*(?:快|早点|早些|赶紧)?睡(?:吧|了)?$/,
  /^行了[，,、\s]*(?:不早了[，,、\s]*)?(?:快|早点|早些|赶紧)?睡(?:吧|了)?$/,
  /^别闹了?[，,、\s]*早点休息$/,
];

/**
 * 少数兼容中转会把模型的英文“写作计划”误放进可见 content，再紧跟真正的中文回复。
 * 这里只剥离明确的内部元说明，不碰正常英文内容、术语或用户明确要求的英文翻译。
 */
const LEADING_ENGLISH_MODEL_META_PATTERN =
  /^(?:i(?:'m| am|’m)\s+(?:drafting|crafting|thinking(?:\s+about)?|considering|planning|preparing|writing|working\s+on)|the\s+user\s+(?:is|wants|asked|has)|i\s+(?:need|should|will|must)\s+(?:answer|respond|write|craft|draft|make|keep)|let(?:'s|\s+me)\s+(?:craft|draft|think|make|write)|we\s+(?:need|should|can)\s+(?:craft|draft|answer|respond|write))/i;
const CJK_CHARACTER_PATTERN = /[\u3400-\u9fff]/;

export function stripLeadingEnglishModelMeta(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !LEADING_ENGLISH_MODEL_META_PATTERN.test(trimmed)) return trimmed;

  const firstCjkIndex = trimmed.search(CJK_CHARACTER_PATTERN);
  // 纯英文的内部草稿没有用户可见正文，交给调用方走既有 fallback。
  if (firstCjkIndex < 0) return "";

  return trimmed.slice(firstCjkIndex).trimStart();
}

const DEFAULT_WECHAT_SOFT_LIMIT = 78;
const DEFAULT_WECHAT_HARD_LIMIT = 118;
const DEFAULT_WECHAT_MAX_MESSAGES = 3;
const DEFAULT_WECHAT_MAX_SENTENCES = 3;

export type ChatSplitOptions = {
  softLimit?: number;
  hardLimit?: number;
  maxMessages?: number;
  maxSentencesPerMessage?: number;
  /** 情景沉浸模式：按空行分段后，段落整条保留、不再按句子拆碎（除非超过 hardLimit） */
  keepParagraphs?: boolean;
  /** 场景模式：按【】旁白边界分条——每对【】单独成条、对话单独成条 */
  immersiveAside?: boolean;
};

export function stripLeadingAsides(text: string): string {
  let result = text.trimStart();

  for (let i = 0; i < 4; i++) {
    const next = result.replace(LEADING_ASIDE_PATTERN, "").trimStart();
    if (next === result) break;
    result = next;
  }

  return result.trim() || text.trim();
}

const NARRATION_VERB_HINT =
  /笑|叹|摸|拍|靠|抱|拉|推|碰|拂|揉|捏|牵|握|吻|亲|蹭|凑|贴|搂|挠|戳|扯|摁|按|咬|舔|哼|低头|抬头|转身|侧头|歪头|挑眉|皱眉|闭眼|睁眼|眯眼|嘟嘴|撇嘴|翻身|起身|坐下|站|躺|走|停|看|望|盯|瞥|瞄|听|说|声|语气|沉默|顿|无奈|温柔|轻声|认真|慢慢|缓缓|突然|默默|安静|发呆|愣|叹气|吸气|呼气|深呼吸|心想|内心|想着|觉得|感觉|暗自/;

function isNarrationAside(content: string): boolean {
  return NARRATION_VERB_HINT.test(content);
}

export function stripInlineAsides(text: string): string {
  const result = text
    .replace(INLINE_ASIDE_PATTERN, (match) => {
      const inner = match.slice(1, -1);
      return isNarrationAside(inner) ? "" : match;
    })
    .replace(ASTERISK_ACTION_PATTERN, (match) => {
      const inner = match.slice(1, -1);
      return isNarrationAside(inner) ? "" : match;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+/gm, "")
    .trim();
  return result || text.trim();
}

/**
 * 去掉所有【…】旁白（非沉浸模式专用）。场景外不允许任何方括号旁白：
 * stripLeadingAsides 只清开头、stripInlineAsides 只清圆括号，句中/句尾的【】会漏——
 * 一旦模型被对话历史带成小说腔，就会出现「旁白【】和说话混在一起」。这里整段清干净并折叠空行。
 * 不兜底返回原文：整条都是旁白时返回空串，交由 cleanAssistantReply 落到 fallback。
 */
export function stripBracketAsides(text: string): string {
  return text
    .replace(BRACKET_ASIDE_PATTERN, "")
    .split("\n")
    .map(line => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractBracketAsides(text: string | null | undefined): string[] {
  return (text ?? "")
    .match(BRACKET_ASIDE_PATTERN)
    ?.map(match => match.slice(1, -1).replace(/\s+/g, " ").trim())
    .filter(Boolean) ?? [];
}

const NARRATIVE_BA_ACTION =
  /把.{1,12}(?:带|拉|扯|推|按|摁|扒|褪|解|松|脱|掀|撩|剥|拽|提|放|搭|托|揉|摸|压|抱|搂|贴|勾|绕|环)/g;
const NARRATIVE_PHYSICAL_VERBS =
  /带了?[带一]|扯[了出开]?|推[了开]?|按[了住下]|摁[了住]|扒[了开下]|褪[了下]|脱[了下掉]|掀[了开起]|撩[了开起]|揉[了着]|捏[了着住]|摸[了着上]|亲了?亲|吻[了着上]|咬[了着住上]|舔[了着上]|蹭[了着]|磨[了着蹭]|贴[着了上近]|压[着了在上住]|搂[着了住]|抱[着了住紧]|环[着了住]|探[了进向入]|滑[了着向到]|顶[了着入]|挺[了着进]|沉了?沉/g;
const NARRATIVE_BODY_CLOTHING =
  /腰|手指|手掌|掌心|指尖|唇|嘴唇|后颈|脖子|肩膀?|胸口?|脊?背|大?腿|额头|耳[朵垂]|脸颊|下巴|锁骨|手腕|手臂|膝盖|衬衫|裤腰|裤子|扣子|领口|下摆|袖子|皮带|拉链/g;
const NARRATIVE_POSTURE_MARKERS =
  /低头|抬头|俯身|侧身|转身|弯腰|伸手|单手|双手|起身|屈膝/g;
const NARRATIVE_MANNER_ADVERBS =
  /慢慢|缓缓|轻轻|狠狠|猛地|一把|用力|使劲/g;

function isNarrativeActionProse(sentence: string): boolean {
  const s = sentence.replace(/\s+/g, "");
  if (s.length < 10) return false;
  if (/[？?]/.test(s)) return false;
  if (/["「『][^"」』]*["」』]/.test(s)) return false;

  const baCount = (s.match(NARRATIVE_BA_ACTION) || []).length;
  const verbCount = (s.match(NARRATIVE_PHYSICAL_VERBS) || []).length;
  const bodyCount = (s.match(NARRATIVE_BODY_CLOTHING) || []).length;
  const postureCount = (s.match(NARRATIVE_POSTURE_MARKERS) || []).length;
  const mannerCount = (s.match(NARRATIVE_MANNER_ADVERBS) || []).length;

  return baCount * 2 + verbCount + bodyCount + postureCount + mannerCount >= 4;
}

function stripNarrativeActionProse(text: string): string {
  const lines = text.split("\n");
  const processed = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    const sentences = trimmed.match(SENTENCE_PATTERN)?.map(s => s.trim()).filter(Boolean) ?? [];
    if (sentences.length === 0) return trimmed;

    const kept = sentences.filter(s => !isNarrativeActionProse(s));
    return kept.join("");
  });

  const result = processed.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || text.trim();
}

function stripWrappingQuotes(text: string): string {
  let result = text.trim();

  for (let i = 0; i < 4; i++) {
    const wrapped = WRAPPING_QUOTE_PAIRS.find(([open, close]) =>
      result.startsWith(open) && result.endsWith(close) && result.length >= open.length + close.length,
    );
    const hasBoundaryQuotes =
      LEADING_DECORATIVE_QUOTES_PATTERN.test(result)
      && TRAILING_DECORATIVE_QUOTES_PATTERN.test(result);
    const next = wrapped
      ? result.slice(wrapped[0].length, result.length - wrapped[1].length).trim()
      : hasBoundaryQuotes
        ? result
          .replace(LEADING_DECORATIVE_QUOTES_PATTERN, "")
          .replace(TRAILING_DECORATIVE_QUOTES_PATTERN, "")
          .trim()
        : result;
    if (!next || next === result) break;
    result = next;
  }

  return result;
}

export function stripReplyDecorativeQuotes(text: string): string {
  const stripped = stripWrappingQuotes(text);
  return stripped
    .split("\n")
    .map(line => stripWrappingQuotes(line))
    .join("\n")
    .trim();
}

function stripLeadingSpeakerLabel(text: string): string {
  let result = text.trimStart();
  for (let i = 0; i < 3; i++) {
    const match = result.match(LEADING_SPEAKER_LABEL_PATTERN);
    if (!match) break;
    const name = match[1];
    const rest = stripReplyDecorativeQuotes(result.slice(match[0].length).trimStart());
    if (!rest) return "";
    result = rest;
  }
  return result.trim();
}

function stripForcedDirectnessTail(text: string): string {
  const normalized = text.trim();
  const sentences = normalized.match(SENTENCE_PATTERN)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0) return normalized;

  let end = sentences.length;
  while (end > 0) {
    const compact = sentences[end - 1]
      .replace(/\s+/g, "")
      .replace(/[。！？!?…；;]+$/g, "");
    if (!FORCED_DIRECTNESS_TAIL_SENTENCE_PATTERNS.some(pattern => pattern.test(compact))) break;
    end -= 1;
  }

  if (end === sentences.length) return normalized;
  return sentences.slice(0, end).join("").trim();
}

function stripOverusedLeadingCatchphrase(text: string): string {
  let result = text.trimStart();
  // 循环：可能叠用多个开场套话（如「再说句实的，不瞒你说，……」）
  for (let i = 0; i < 4; i++) {
    const next = result
      .replace(OVERUSED_LEADING_CATCHPHRASE_PATTERN, "")
      .replace(OVERUSED_SINCERITY_LEADING_PATTERN, "")
      .trimStart();
    if (next === result) break;
    result = next;
  }
  return result || text.trimStart();
}

function stripOverusedSleepClosureTail(text: string): string {
  const normalized = text.trim();
  const sentences = normalized.match(SENTENCE_PATTERN)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0) return normalized;

  let end = sentences.length;
  while (end > 0) {
    const compact = sentences[end - 1]
      .replace(/\s+/g, "")
      .replace(/[。！？!?…；;]+$/g, "");
    if (!OVERUSED_SLEEP_CLOSURE_TAIL_SENTENCE_PATTERNS.some(pattern => pattern.test(compact))) break;
    end -= 1;
  }

  if (end === sentences.length) return normalized;
  return sentences.slice(0, end).join("").trim();
}

/**
 * 只做「格式剥离」，不做兜底：把一段回复里用户不该看到的部分（发言人前缀、装饰引号、
 * 旁白、套话收尾等）剥掉，返回可直接交付的正文。剥空时返回空字符串。
 */
function stripReplyForDelivery(raw: string, immersiveMode: boolean): string {
  if (immersiveMode) {
    // 情景沉浸模式：放行【】旁白与动作描写，只做最小清洗（发言人前缀、装饰引号、套话收尾）
    return stripReplyDecorativeQuotes(
      stripOverusedSleepClosureTail(
        stripForcedDirectnessTail(
          stripOverusedLeadingCatchphrase(
            stripLeadingSpeakerLabel(stripReplyDecorativeQuotes(raw)).trim(),
          ),
        ),
      ),
    ).trim();
  }

  const unquoted = stripReplyDecorativeQuotes(raw);
  // 非沉浸模式：先把所有【…】旁白清干净（开头/句中/句尾都清），避免场景外旁白与对话混在一起。
  const noBracketAsides = stripBracketAsides(unquoted);
  const noInlineAsides = stripInlineAsides(noBracketAsides);
  const noNarration = stripNarrativeActionProse(noInlineAsides);
  const stripped = stripReplyDecorativeQuotes(
    stripOverusedSleepClosureTail(
      stripForcedDirectnessTail(
        stripOverusedLeadingCatchphrase(
          stripLeadingSpeakerLabel(stripLeadingAsides(noNarration)).trim(),
        ),
      ),
    ),
  );
  const strippedAgain = stripReplyDecorativeQuotes(
    stripOverusedLeadingCatchphrase(
      stripLeadingSpeakerLabel(noNarration.replace(LEADING_ASIDE_PATTERN, "").trim()).trim(),
    ),
  );

  return strippedAgain && stripped ? stripped : "";
}

/**
 * 判断一段回复在格式剥离后是否什么都不剩（即整段由旁白/动作/套话构成）。
 * 供生成层在交付前发现「清洗塌陷」并重试，而不是把兜底句当成人物台词发出去。
 */
export function isCleanEmptyReply(
  text: string | null | undefined,
  options: { immersiveMode?: boolean } = {},
): boolean {
  const raw = stripLeadingEnglishModelMeta((text ?? "").trim());
  if (!raw) return true;
  return !stripReplyForDelivery(raw, options.immersiveMode === true);
}

export function cleanAssistantReply(
  text: string | null | undefined,
  fallback = "",
  options: { immersiveMode?: boolean } = {},
): string {
  const raw = stripLeadingEnglishModelMeta((text ?? "").trim());
  if (!raw) return fallback;

  const delivered = stripReplyForDelivery(raw, options.immersiveMode === true);
  if (delivered) return delivered;

  // 全部被剥空时退回模型的原始输出：宁可交付模型真实写下的旁白/动作，
  // 也不能把硬编码兜底句当成人物台词发出去——那会被误读成角色口头禅。
  return raw.trim() || fallback;
}

function normalizeReplyText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinMessageSegments(current: string, next: string): string {
  if (!current) return next;
  if (/[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(next)) {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function splitByLength(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    const chunk = chars.slice(i, i + limit).join("").trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function packSegments(segments: string[], softLimit: number, hardLimit: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    if (segment.length > hardLimit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitByLength(segment, hardLimit));
      continue;
    }

    const next = joinMessageSegments(current, segment);
    if (current && next.length > softLimit) {
      chunks.push(current);
      current = segment;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitSentenceForChat(sentence: string, softLimit: number, hardLimit: number): string[] {
  if (sentence.length <= hardLimit) return [sentence];

  const clauses = sentence.match(CLAUSE_PATTERN)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (clauses.length > 1) {
    return packSegments(clauses, softLimit, hardLimit).flatMap(chunk =>
      chunk.length > hardLimit ? splitByLength(chunk, hardLimit) : [chunk],
    );
  }

  return splitByLength(sentence, hardLimit);
}

function packSentencesForChat(
  sentences: string[],
  softLimit: number,
  hardLimit: number,
  maxSentencesPerMessage: number,
): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentSentenceCount = 0;

  const flush = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
    currentSentenceCount = 0;
  };

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    const sentenceParts = splitSentenceForChat(sentence, softLimit, hardLimit);
    for (const part of sentenceParts) {
      const next = joinMessageSegments(current, part);
      const nextSentenceCount = currentSentenceCount + 1;
      const shouldMerge =
        current &&
        next.length <= softLimit &&
        nextSentenceCount <= maxSentencesPerMessage;

      if (!current) {
        current = part;
        currentSentenceCount = 1;
      } else if (shouldMerge) {
        current = next;
        currentSentenceCount = nextSentenceCount;
      } else {
        flush();
        current = part;
        currentSentenceCount = 1;
      }
    }
  }

  flush();
  return chunks;
}

function compactTextLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function shouldSplitCompactParagraph(paragraph: string, sentences: string[], softLimit: number): boolean {
  if (sentences.length <= 1) return false;

  const length = compactTextLength(paragraph);
  if (sentences.length >= 4) return true;
  if (sentences.length >= 3 && length >= 38) return true;
  if (sentences.length >= 2 && length >= Math.min(softLimit, 40)) return true;
  return false;
}

function splitParagraphForChat(
  paragraph: string,
  softLimit: number,
  hardLimit: number,
  maxSentencesPerMessage: number,
  keepParagraphs = false,
): string[] {
  const sentences = paragraph.match(SENTENCE_PATTERN)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (paragraph.length <= hardLimit) {
    if (keepParagraphs) return [paragraph];
    if (!shouldSplitCompactParagraph(paragraph, sentences, softLimit)) return [paragraph];

    return packSentencesForChat(
      sentences,
      Math.min(softLimit, 62),
      hardLimit,
      1,
    );
  }

  if (sentences.length > 1) {
    return packSentencesForChat(sentences, softLimit, hardLimit, maxSentencesPerMessage);
  }

  return splitSentenceForChat(paragraph, softLimit, hardLimit);
}

function capChatMessages(chunks: string[], maxMessages: number): string[] {
  const cleanChunks = chunks.map(chunk => chunk.trim()).filter(Boolean);
  if (cleanChunks.length <= maxMessages) return cleanChunks;

  return [
    ...cleanChunks.slice(0, maxMessages - 1),
    cleanChunks.slice(maxMessages - 1).join("\n").trim(),
  ].filter(Boolean);
}

export function splitAssistantReplyForChat(
  text: string | null | undefined,
  options: ChatSplitOptions = {},
): string[] {
  const raw = normalizeReplyText(text ?? "");
  if (!raw) return [];

  if (options.immersiveAside) return splitImmersiveReplyForChat(text);

  const softLimit = options.softLimit ?? DEFAULT_WECHAT_SOFT_LIMIT;
  const hardLimit = options.hardLimit ?? DEFAULT_WECHAT_HARD_LIMIT;
  const maxMessages = options.maxMessages ?? DEFAULT_WECHAT_MAX_MESSAGES;
  const maxSentencesPerMessage = options.maxSentencesPerMessage ?? DEFAULT_WECHAT_MAX_SENTENCES;
  const keepParagraphs = options.keepParagraphs ?? false;
  const hasExplicitBreaks = /\n\s*\n/.test(raw);
  const singleParagraphText = raw.replace(/\n+/g, " ").trim();

  if (!hasExplicitBreaks && singleParagraphText.length <= hardLimit) {
    return splitParagraphForChat(
      singleParagraphText,
      softLimit,
      hardLimit,
      maxSentencesPerMessage,
      keepParagraphs,
    );
  }

  const paragraphs = raw
    .split(/\n{2,}/)
    .map(part => part.replace(/\n+/g, " ").trim())
    .filter(Boolean);

  const chunks = paragraphs.flatMap(paragraph =>
    splitParagraphForChat(paragraph, softLimit, hardLimit, maxSentencesPerMessage, keepParagraphs),
  );

  return capChatMessages(chunks, maxMessages);
}

function splitDialogueIntoChunks(text: string): string[] {
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 场景模式专用分条：把每对【…】旁白单独成一条（先把【】内部换行压平，避免被空行切散），
 * 【】之外说出口的话各自成条。无论模型把旁白和对话怎么挤在一起，都能规整成「一条旁白、一条对话」。
 */
export function splitImmersiveReplyForChat(text: string | null | undefined): string[] {
  const raw = normalizeReplyText(text ?? "");
  if (!raw) return [];

  // 1) 把每对【…】内部的换行与多余空白压平，使一段旁白成为不被拆散的一条
  const flattened = raw.replace(/【[\s\S]*?】/g, (m) => `【${m.slice(1, -1).replace(/\s+/g, "")}】`);

  // 2) 按【】边界切：每对【】单独成条；【】之外的对话按行成条
  const chunks: string[] = [];
  const asideRe = /【[^】]*】/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = asideRe.exec(flattened)) !== null) {
    chunks.push(...splitDialogueIntoChunks(flattened.slice(last, m.index)));
    chunks.push(m[0]);
    last = asideRe.lastIndex;
  }
  chunks.push(...splitDialogueIntoChunks(flattened.slice(last)));

  const clean = chunks.filter(Boolean);
  if (clean.length <= 40) return clean;
  return [...clean.slice(0, 39), clean.slice(39).join("\n")];
}

// ===== 跨轮重复检测（防复读兜底）=====
// cleanAssistantReply 只删硬编码口癖、不比对历史；这里补一层确定性的「这句我几轮前说过」检测，
// 用于发送前判断本轮回复是否与最近若干条 assistant 回复高度雷同。判定与具体禁词无关，是「类别兜底」。

// 归一化：去标点/空白/装饰引号/括号/星号、统一小写，便于识别「只差标点」的复读。
function normalizeForRepeatCompare(text: string): string {
  return text
    .replace(/[\s，。！？、,.!?…；;：:~～“”‘’"'「」『』（）()【】\[\]*—\-]+/g, "")
    .toLowerCase();
}

function charBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  if (text.length <= 1) {
    if (text) grams.add(text);
    return grams;
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function bigramJaccard(a: string, b: string): number {
  const ga = charBigrams(a);
  const gb = charBigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of Array.from(ga)) {
    if (gb.has(g)) inter += 1;
  }
  return inter / (ga.size + gb.size - inter);
}

/** 把一段回复切成可比对的「长句」集合：归一化后达到 minLen 才算，短句/语气词不参与去重。 */
export function comparableSentences(text: string, minLen = 8): string[] {
  const sentences = text.match(SENTENCE_PATTERN)?.map(s => normalizeForRepeatCompare(s)).filter(Boolean) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length >= minLen && !seen.has(sentence)) {
      seen.add(sentence);
      result.push(sentence);
    }
  }
  return result;
}

export type RepetitionCheckOptions = {
  /** 整体相似度阈值（字符 bigram Jaccard）。默认 0.82。 */
  wholeThreshold?: number;
  /** 单句相似度阈值。默认 0.9。 */
  sentenceThreshold?: number;
  /** 归一化后短于此长度的回复整体不判重（语气词/简短确认豁免）。默认 8。 */
  minLength?: number;
};

/**
 * 判断 candidate 是否与最近若干条 assistant 回复高度雷同（跨轮复读）。命中三选一：
 * ①整体归一化完全相同；②整体 bigram Jaccard ≥ wholeThreshold；③候选里某长句与历史某长句几乎相同。
 * 短回复（归一化后 < minLength）一律豁免，避免误杀「嗯 / 好 / 我在 / 晚安」等正常重复短句。
 * 与具体禁词无关，是结构性的类别兜底；普通聊天直接用，沉浸场景请用 isRepetitiveImmersiveReply。
 */
export function isRepetitiveReply(
  candidate: string | null | undefined,
  recentAssistantTexts: Array<string | null | undefined>,
  options: RepetitionCheckOptions = {},
): boolean {
  const wholeThreshold = options.wholeThreshold ?? 0.82;
  const sentenceThreshold = options.sentenceThreshold ?? 0.9;
  const minLength = options.minLength ?? 8;

  const candNorm = normalizeForRepeatCompare(candidate ?? "");
  if (candNorm.length < minLength) return false;
  const candSentences = comparableSentences(candidate ?? "", minLength);

  for (const prior of recentAssistantTexts) {
    const priorNorm = normalizeForRepeatCompare(prior ?? "");
    if (priorNorm.length < minLength) continue;
    if (candNorm === priorNorm) return true;
    if (bigramJaccard(candNorm, priorNorm) >= wholeThreshold) return true;

    const priorSentences = comparableSentences(prior ?? "", minLength);
    if (priorSentences.length === 0) continue;
    const priorSet = new Set(priorSentences);
    for (const cs of candSentences) {
      if (priorSet.has(cs)) return true;
      for (const ps of priorSentences) {
        if (Math.min(cs.length, ps.length) >= 10 && bigramJaccard(cs, ps) >= sentenceThreshold) {
          return true;
        }
      }
    }
  }
  return false;
}

export function isRepetitiveImmersiveReply(
  candidate: string | null | undefined,
  recentAssistantTexts: Array<string | null | undefined>,
  options: RepetitionCheckOptions = {},
): boolean {
  const longFormOptions: RepetitionCheckOptions = {
    wholeThreshold: options.wholeThreshold ?? 0.9,
    sentenceThreshold: options.sentenceThreshold ?? 0.94,
    minLength: options.minLength ?? 40,
  };

  if (isRepetitiveReply(candidate, recentAssistantTexts, longFormOptions)) return true;

  const candidateAsides = extractBracketAsides(candidate);
  if (candidateAsides.length === 0) return false;

  const priorAsides = recentAssistantTexts.flatMap(text => extractBracketAsides(text));
  if (priorAsides.length === 0) return false;

  return candidateAsides.some(aside =>
    isRepetitiveReply(aside, priorAsides, {
      wholeThreshold: options.wholeThreshold ?? 0.84,
      sentenceThreshold: options.sentenceThreshold ?? 0.9,
      minLength: options.minLength ?? 40,
    }),
  );
}
