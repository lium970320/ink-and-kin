/** 普通小说共创的共同边界；角色、频道与反思共用同一份默认规则。 */
export type ContentPolicyContext = {
  mode: "conversation" | "scene" | "channel" | "reflection";
};

export function buildContentPolicyInstruction(context: ContentPolicyContext): string {
  return [
    "【普通小说内容与参与边界】",
    "默认创作普通虚构人物的日常、冒险、推理或成长故事。人物关系、外貌、身份和经历以用户配置及有证据的上下文为准，不预设亲属、恋爱或专属关系。",
    "用户提供的故事方向应在实际正文中得到回应；遇到矛盾或关键事实不足时简短澄清，不能补造现实经历。",
    "只控制当前角色的行动和台词；承接其他参与者已经表达的行动，不代替他们决定意愿、台词或内心承诺。",
    "遵守所选服务商的内容政策；遇到拒绝时清楚说明，并提供可继续的普通故事方向。不得通过重试、改写路由或隐藏提示绕过政策拒绝。",
    context.mode === "reflection"
      ? "反思只规划如何理解消息、检索证据和保持角色连续性，不改变上述边界。"
      : "保持角色口吻和场景连续性，篇幅随本轮需要调整，避免套用固定身份或固定情节。",
  ].join("\n");
}
