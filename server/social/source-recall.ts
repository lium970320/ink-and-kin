import { extractDynamicWorldbookTriggers, type WorldbookTriggerSource } from "./hybrid-retrieval";

const EXPLICIT_SOURCE = /原文|原著|书中|小说|作品(?:里|中|的|资料)|(?:导入|上传)的?(?:资料|原文)|哪一?章|第.{1,5}章/;
const FOLLOW_UP = /^(?:那|这)?(?:后来|然后|当时|具体|之前|再说|还有|怎么|哪|谁|什么|为什么)/;
const ROUTINE_CHAT = /^(?:嗯|哦|好|行|可以|哈哈|嘿嘿|早|晚安|睡了|吃了吗|在吗|你在干嘛|想你|没事)[。！？!?,，、\s]*$/;

function directlyReferencesSource(query: string, terms: string[]) {
  return EXPLICIT_SOURCE.test(query) || terms.some(term => query.toLowerCase().includes(term.toLowerCase()));
}

/** 只承接最近两条用户问题中有明确作品依据的追问。 */
export function resolveSourceRecallQuery(
  currentQuery: string,
  previousUserQueries: string[],
  worldbook: WorldbookTriggerSource,
): string | null {
  const query = currentQuery.trim();
  if (!query || ROUTINE_CHAT.test(query)) return null;
  const terms = extractDynamicWorldbookTriggers(worldbook);
  if (directlyReferencesSource(query, terms)) return query;
  if (Array.from(query).length > 24 || !FOLLOW_UP.test(query)) return null;
  const previousWithSource = previousUserQueries.slice(-2).reverse()
    .find(previous => directlyReferencesSource(previous, terms));
  // 把本轮问题放在前面，避免长的旧问题耗尽检索字数。
  return previousWithSource ? `${query} ${previousWithSource}` : null;
}
