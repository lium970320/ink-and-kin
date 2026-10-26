/**
 * 供应商政策拒绝检测（从净化同源 `server/social/persona-text-generation.ts` 提取）。
 *
 * 第 5 批只迁角色频道需要的最小部分：频道正文出现「I can't help with this request」
 * 「我没办法继续写这段内容」这类元回复/安全拒绝时，必须在落库前拦下（见 roleplay-channel.ts
 * 的 looksLikeUnusableChannelReply）。不迁 persona-text-generation 的其余私有生成链路。
 */
export const PROVIDER_POLICY_REFUSAL =
  /\bI(?:'m| am|’m)?(?: going to)? (?:decline|refuse)|\bI (?:won't|will not|don't|do not|can't|cannot) (?:write|produce|provide|continue|help with|assist with)|\bI (?:am unable|'m unable) to (?:assist|help|write|produce|continue)|(?:policy|safety guidelines?|fixed limit)[\s\S]{0,120}(?:don't|won't|can't|cannot|decline|refuse)|\b(?:as an ai|as an ai language model|as a helpful assistant|i cannot fulfill this request|i can't help with this request)\b|我(?:不能|无法|不会)(?:按(?:这个|该)?(?:要求|请求|方向))?(?:继续|编写|生成|提供|协助)|(?:这段|这个(?:内容|方向))?我没法(?:再)?(?:往下写|继续写|写下去|处理|协助)|(?:内容策略|内容政策|安全政策|安全准则)[^。！？\n]{0,80}(?:不能|无法|拒绝|不符合)|作为一个(?:人工智能|语言模型)，我(?:不能|无法)|我不能按这个方向继续|不能按这个方向继续|这(?:超出|超过了)我能协助生成的范围|我是\s*(?:Claude Code|Claude|Anthropic|编程助手|AI助手|AI 助手)|(?:我)?不会假装成别的身份|Anthropic\s*(?:做的|的)编程助手|(?:如果是|如果你在?做)角色扮演|写作类项目|\bI (?:won't|will not|can't|cannot) (?:reproduce|repeat|share|restate|echo)\b|\bsetup text\b|\bsystem prompt\b|\bmy instructions\b|\bI'?m glad to help with\b|\bwhat you'?re working on\b|\bI'?m\s*[一-龥]|\bI'?ll (?:help|assist) (?:you )?with (?:that|this|your)\b|我(?:没|没有)办法(?:再)?(?:继续|接着)(?:写|生成|创作)|我(?:不能|无法|不会)(?:再)?(?:接着|继续)(?:写|生成|创作)|(?:这种|这类|这个)[^。！？\n]{0,14}我(?:不能|无法|不会)(?:生成|写)/i;

export function hasProviderPolicyRefusal(candidate: string): boolean {
  return PROVIDER_POLICY_REFUSAL.test(candidate);
}
