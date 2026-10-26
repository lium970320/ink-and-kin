/** 场景的统一描写范围；网页、QQ、文字、图片和反思使用同一条边界。 */
export const SCENE_INTERACTION_RULE = "场景统一描写规则：可以承接人物与用户双方已经发生的动作及即时反应；人物可以主动推动环境和互动，但用户说出口的台词、主动选择、新意愿与内心承诺由用户自己决定。用户已经明确写出的台词、动作和选择应作为既成事实承接，不替用户新增台词或作出未经给出的主动决定。";

/** 只根据当前场景背景与 QQ 场景开关判断。 */
export function resolveSceneImmersion(hasSceneBackground: boolean, qqSceneOn = false): boolean {
  return hasSceneBackground || qqSceneOn;
}
