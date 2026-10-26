import { buildContentPolicyInstruction } from "./content-policy";
import {
  buildPersonaProfilePromptSections,
  normalizePersonaProfileSections,
} from "../_core/persona-profile";

type ChannelPersonaLike = {
  name?: string | null;
  relationshipDesc?: string | null;
  togetherFrom?: string | null;
  togetherTo?: string | null;
  personaData?: unknown;
};

export type ChannelPersonaPromptContext = {
  channelName: string;
  channelDescription?: string | null;
  channelScenePrompt?: string | null;
  speakerName: string;
  otherMemberNames: string[];
  reflection?: {
    innerThought?: string | null;
    replyStrategy?: string | null;
    nextBeat?: string | null;
    acknowledgement?: string | null;
  } | null;
};

export function channelYouthToneRequested(scenePrompt?: string | null): boolean {
  return /【表现层基调】[^\S\n]*青涩/.test(scenePrompt || "");
}

export function buildChannelPersonaSystemPrompt(
  persona: ChannelPersonaLike,
  context: ChannelPersonaPromptContext,
): string {
  const speakerName = persona.name?.trim() || context.speakerName.trim() || "角色";
  const profile = normalizePersonaProfileSections(persona.personaData, {
    name: speakerName,
    relationshipDesc: persona.relationshipDesc,
    togetherFrom: persona.togetherFrom,
    togetherTo: persona.togetherTo,
  });
  return [
    `你是虚构人物频道「${context.channelName}」中的 ${speakerName}。本轮只处理当前频道的记录和情境。`,
    buildContentPolicyInstruction({ mode: "channel" }),
    ...buildPersonaProfilePromptSections(profile, { longBackgroundMode: "compact", sceneScoped: true }),
    context.channelDescription ? `【频道简介】${context.channelDescription}` : "",
    context.channelScenePrompt ? `【频道当前情境】${context.channelScenePrompt}` : "",
    `【在场人物】${[speakerName, ...context.otherMemberNames].filter(Boolean).join("、")}`,
    "【频道连续性】以当前频道明确提供的地点、身份、时代和已发生事件为准；不读取其他频道的私人情节，不把原著经历当作用户的现实经历。",
    "【回复格式】当前角色的动作和环境放在【】中，台词单独成段。保持当前角色的口吻，推进一小步，给其他参与者留出回应空间。",
    context.reflection?.replyStrategy ? `【本轮创作提示】${context.reflection.replyStrategy}` : "",
    context.reflection?.nextBeat ? `【下一步候选】${context.reflection.nextBeat}` : "",
  ].filter(Boolean).join("\n\n");
}
