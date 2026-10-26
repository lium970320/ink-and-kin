import { describe, expect, it } from "vitest";
import {
  buildChannelRosterFixInstruction,
  countRecentIdentityBeats,
  extractChannelIdentitySections,
  extractIdentityTags,
  findChannelForeignNames,
  parseChannelPresenceAudit,
  formatRoleplayTranscript,
  invokeChannelTurnWithEmptyReplyRetry,
  normalizeNarrationReferences,
  ROLEPLAY_TRANSCRIPT_MAX_MESSAGES,
  looksLikeUnusableChannelReply,
  parseRoleplayTurnResponse,
  pickNextRoleplayMember,
  reflectedRoleplayTurnCandidates,
  roleplayTurnCandidates,
  sanitizeChannelGender,
} from "./roleplay-channel";
import { shouldDeactivateRoleplayChannelAfterMemberRemoval } from "./roleplay-channel-policy";

describe("可发送正文闸门（英文元回复 / 供应商拒绝）", () => {
  it("拦住实测落库的那条英文元回复", () => {
    expect(
      looksLikeUnusableChannelReply(
        "I'm 人物频道. I won't reproduce my setup text, but I'm glad to help with what you're working on."
      )
    ).toBe(true);
  });

  it("拦住中文安全拒绝（实测那条：我没办法继续写这段内容）", () => {
    const refusal =
      "我无法按这个要求继续，可以一起选择普通故事方向。";
    expect(looksLikeUnusableChannelReply(refusal)).toBe(true);
  });

  it("拦住其它中文拒绝措辞", () => {
    expect(looksLikeUnusableChannelReply("我无法继续写这个场景，请换个方向。")).toBe(true);
    expect(looksLikeUnusableChannelReply("这类内容我不能生成。")).toBe(true);
  });

  it("拦住纯英文拒绝与身份自述", () => {
    expect(looksLikeUnusableChannelReply("I'm sorry, but I can't help with this request.")).toBe(true);
    expect(looksLikeUnusableChannelReply("As an AI language model, I cannot continue this scene.")).toBe(true);
  });

  it("不误杀正常中文正文", () => {
    expect(looksLikeUnusableChannelReply("【陈远的指尖压住林舟的手腕。】别动。")).toBe(false);
  });

  it("不误杀极短回复与夹带英文词的正文", () => {
    expect(looksLikeUnusableChannelReply("蹲")).toBe(false);
    expect(looksLikeUnusableChannelReply("【陈远把 MP3 塞进兜里，又弯腰捡起那顶草帽。】")).toBe(false);
  });

  it("空正文判为不可用", () => {
    expect(looksLikeUnusableChannelReply("")).toBe(true);
    expect(looksLikeUnusableChannelReply("   ")).toBe(true);
  });
});

describe("转录窗口（长程剧情不再掉出上下文）", () => {
  const many = Array.from({ length: 130 }, (_, i) => ({
    personaId: 1,
    speakerName: "陈远",
    role: "persona" as const,
    content: `M${i}`,
  }));

  it("默认只带最近 100 条", () => {
    const text = formatRoleplayTranscript(many, 10_000_000);
    expect(text).toContain("M129");
    expect(text).toContain("M30");
    expect(text).not.toContain("M29");
    expect(ROLEPLAY_TRANSCRIPT_MAX_MESSAGES).toBe(100);
  });

  it("仍受字数上限约束，超出时保留最近的尾部", () => {
    const text = formatRoleplayTranscript(many, 40);
    expect(text.startsWith("...")).toBe(true);
    expect(text).toContain("M129");
  });

  it("消息不满窗口时原样全带", () => {
    const few = many.slice(0, 3);
    const text = formatRoleplayTranscript(few, 10_000_000);
    expect(text).toContain("M0");
    expect(text).toContain("M2");
  });
});

describe("旁白代词归一（幻觉人名的上游治理）", () => {
  const names = ["林舟", "陈远"];

  it("把【】里的“对方”回填成在场对方的真名", () => {
    expect(normalizeNarrationReferences("【陈远扣住对方的手腕，对方一缩。】别躲。", "陈远", names))
      .toBe("【陈远扣住林舟的手腕，林舟一缩。】别躲。");
  });

  it("“那人/那个人”不再回填——它们天然可能指第三方", () => {
    // 实测事故：旧实现把指第三人的"那人"改写成在场成员名，角色就崩了。
    expect(normalizeNarrationReferences("【陈远看向那人。】", "陈远", names))
      .toBe("【陈远看向那人。】");
  });

  it("正文里出现第三人迹象时整段跳过归一化（连“对方”也不动）", () => {
    const withThirdParty = "【陈远扣住对方的手腕。】【坡下上来一个年轻人，身影在草脊后头晃了一下。】";
    expect(normalizeNarrationReferences(withThirdParty, "陈远", names)).toBe(withThirdParty);
  });

  it("只是无名的动静（脚步声/人声）不算第三人，照常回填“对方”", () => {
    expect(normalizeNarrationReferences("【陈远扣住对方的手腕，坡下传来一阵脚步声。】", "陈远", names))
      .toBe("【陈远扣住林舟的手腕，坡下传来一阵脚步声。】");
  });

  it("只处理【】内部，台词保持自然口吻", () => {
    expect(normalizeNarrationReferences("【陈远低头。】你别躲。对方没说话。", "陈远", names))
      .toBe("【陈远低头。】你别躲。对方没说话。");
  });

  it("没有在场对方时原样返回", () => {
    expect(normalizeNarrationReferences("【对方站着。】", "陈远", ["陈远"])).toBe("【对方站着。】");
  });
});

describe("身份落点由反思层判断时机（不每拍硬塞）", () => {
  const messages = [
    { personaId: 1, speakerName: "林舟", role: "persona", content: "【他把速写本夹回腋下。】" },
    { personaId: 2, speakerName: "陈远", role: "persona", content: "【风把草帽掀了一下。】" },
    { personaId: 1, speakerName: "林舟", role: "persona", content: "【他低下头，耳朵根烧起来。】" },
    { personaId: 2, speakerName: "陈远", role: "persona", content: "【两个人贴得更近。】" },
  ];

  it("统计最近几拍的身份密度", () => {
    const stat = countRecentIdentityBeats(messages, 4);
    expect(stat.beats).toBe(4);
    expect(stat.withIdentity).toBe(1);   // 只有"速写本"那拍带身份
    expect(stat.gap).toBe(3);
  });

  it("用户侧最近几拍没有身份时，gap 达到 3（触发反思层补一处）", () => {
    const noIdentity = messages.slice(1);
    expect(countRecentIdentityBeats(noIdentity, 4).gap).toBe(3);
  });

  it("给了身份落点就注入，并明确“自然带出、不要硬塞”", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
      identityCue: "陈远喊他一声学长，林舟的速写本还夹在腋下",
    });
    expect(prompt).toContain("【本拍身份落点（自然带出，不要硬塞）】");
    expect(prompt).toContain("学长");
    expect(prompt).toContain("速写本");
  });

  it("没给身份落点时完全不出现该段（不每拍硬塞身份）", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    // 注意：输出要求第 6 条本身会提到"【本拍身份落点】"这个说法，
    // 所以这里用完整的段落标题来判断"这一拍到底有没有真的给出落点"。
    expect(prompt).not.toContain("【本拍身份落点（自然带出，不要硬塞）】");
  });

  it("输出要求里的身份条文改成“按落点执行”，不再是每拍配额", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    expect(prompt).toContain("当本轮给出【本拍身份落点】时");
    expect(prompt).toContain("不要为了凑身份硬塞");
    expect(prompt).not.toContain("硬性验收");
  });
});

describe("身份与关系锚（旁白不许只剩身体）", () => {
  const studioScene = [
    "夜深，书房里只剩一盏台灯。",
    "【行为偏好】慢一点，写足细节。",
    "【左位角色身份】林舟的年龄为18岁，职业为山村高中的高三学生，害羞憨厚。",
    "【右位角色身份】陈远的年龄为19岁，职业为刚考上大学的大一新生，暑假回山村老家，比他年长的同乡。",
    "【前情提要/上下文】九十年代夏日午后，山坡上，草帽被风吹走。",
  ].join("\n");

  it("从频道情境里抽出身份与前情分段", () => {
    const sections = extractChannelIdentitySections(studioScene);
    expect(sections.left).toContain("高三学生");
    expect(sections.right).toContain("大一新生");
    expect(sections.context).toContain("九十年代");
  });

  it("没有工坊分段时返回空（不硬编造身份）", () => {
    expect(extractChannelIdentitySections("夜深，教室里只剩一盏灯。")).toEqual({ left: "", right: "", context: "" });
  });

  it("分段标题换了写法也能抽到（前缀兜底，实测踩过一次）", () => {
    // 真实事故：用户把【左位角色身份】改成【左位角色底料：林舟（本频道唯一的身份与背景来源）】，
    // 只认死标题的实现直接抽成空，身份锚整段消失、只剩前情。
    const renamed = [
      "【左位角色底料：林舟（本频道唯一的身份与背景来源）】林舟，18 岁，山村高中高三学生。",
      "【右位角色底料：陈远（本频道唯一的身份与背景来源）】陈远，19 岁，刚考上城里的大学。",
      "【前情提要/上下文】九十年代夏日午后山坡。",
    ].join("\n");
    const sections = extractChannelIdentitySections(renamed);
    expect(sections.left).toContain("高三学生");
    expect(sections.right).toContain("刚考上城里的大学");
    expect(sections.context).toContain("九十年代");
  });

  it("身份段较长时不会被截断到丢掉关键设定", () => {
    const longLeft = "林舟，18 岁，山村高中高三学生。" + "他随身一个卷了边的速写本。".repeat(30);
    const prompt = buildRoleplayUserPrompt({
      channel: { ...migrationChannel, scenePrompt: "【左位角色身份】" + longLeft } as any,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    expect(prompt).toContain("山村高中高三学生");
    expect(prompt).toContain("速写本");
  });

  it("仅提取用户显式提供的普通身份标签", () => {
    expect(extractIdentityTags("身份标签：侦探、向导")).toEqual(["侦探", "向导"]);
    expect(extractIdentityTags("他是一位年长的同乡")).toEqual([]);
  });

  it("用户提示词里带上身份锚素材，并显式给出关系标签", () => {
    const taggedScene = studioScene.replace("害羞憨厚。", "害羞憨厚。身份标签：侦探").replace("比他年长的同乡。", "比他年长的同乡。身份标签：向导");
    const prompt = buildRoleplayUserPrompt({
      channel: { ...migrationChannel, scenePrompt: taggedScene } as any,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    expect(prompt).toContain("【身份与关系锚·素材，时机由节奏导演决定】");
    expect(prompt).toContain("高三学生");
    expect(prompt).toContain("大一新生");
    // 标签必须单独成行给出，并说明它是有效设定而不是装饰
    expect(prompt).toContain("身份/关系标签（有效设定，不是装饰）：侦探、向导");
    expect(prompt).toContain("★标签仅表示用户明确给出的身份或任务");
    // 时机判断交给反思层，不再写死"每拍必须带一处"
    expect(prompt).toContain("以【本拍身份落点】为准");
    expect(prompt).not.toContain("必须**至少自然带出一处**");
    // 身份锚必须紧挨输出要求（靠近生成位置）
    expect(prompt.indexOf("【身份与关系锚·素材，时机由节奏导演决定】")).toBeLessThan(prompt.indexOf("【输出要求与篇幅标准】"));
  });

  it("频道情境里没有身份分段时不注入空锚", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    expect(prompt).not.toContain("【身份与关系锚");
  });
});

describe("在场审计：外来人名 + 无名第三人", () => {
  it("解析新形状（对象）", () => {
    expect(parseChannelPresenceAudit('{"names":["阿莲"],"otherOnScene":true}'))
      .toEqual({ foreignNames: ["阿莲"], otherOnScene: true });
  });

  it("解析旧形状（纯数组）按只有名字处理", () => {
    expect(parseChannelPresenceAudit('["桂英"]')).toEqual({ foreignNames: ["桂英"], otherOnScene: false });
  });

  it("坏输出一律按没问题处理（绝不阻断生成）", () => {
    expect(parseChannelPresenceAudit("我不知道")).toEqual({ foreignNames: [], otherOnScene: false });
    expect(parseChannelPresenceAudit("")).toEqual({ foreignNames: [], otherOnScene: false });
  });

  it("无名第三人的纠偏指令：删掉出场、改回无名动静，且不许挂到在场成员身上", () => {
    const instruction = buildChannelRosterFixInstruction([], ["林舟", "陈远"], { otherOnScene: true });
    expect(instruction).toContain("出现了一个不在本频道的人");
    expect(instruction).toContain("画面里不得再有第三个人在场");
    expect(instruction).toContain("绝不要");
    expect(instruction).toContain("把这个人写成在场成员之一");
    expect(instruction).toContain("无名的动静");
  });

  it("外来人名的纠偏指令保持原样", () => {
    const instruction = buildChannelRosterFixInstruction(["阿莲"], ["林舟", "陈远"]);
    expect(instruction).toContain("「阿莲」");
    expect(instruction).toContain("不得出现任何其他人名");
  });
});

describe("频道外来人名检测（防止凭空第三人进入设定）", () => {
  const allowed = ["林舟", "陈远"];

  it("抓出凭空出现的阿X 人名", () => {
    expect(findChannelForeignNames("陈远把那缸刚汲上来的井水往阿莲跟前递。", allowed)).toEqual(["阿莲"]);
    expect(findChannelForeignNames("阿强蹲在井台边抽烟。阿莲没抬头。", allowed)).toEqual(["阿强", "阿莲"]);
  });

  it("亲属称谓不是外来人名", () => {
    expect(findChannelForeignNames("阿姨把门带上，阿婆在屋里坐着。", allowed)).toEqual([]);
  });

  it("频道成员自己的名字不是外来人名", () => {
    expect(findChannelForeignNames("林舟和陈远在坡上坐着。", allowed)).toEqual([]);
  });

  it("没有阿X 形状时返回空", () => {
    expect(findChannelForeignNames("【风从坡上过来，草叶一齐压下去。】", allowed)).toEqual([]);
    expect(findChannelForeignNames("", allowed)).toEqual([]);
  });
});

describe("roleplay channel turn helpers", () => {
  it("picks the next enabled persona after the last speaker", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];
    const picked = pickNextRoleplayMember(members, [
      { personaId: 1, speakerName: "甲", role: "persona", content: "先坐一会儿。" },
    ]);

    expect(picked?.personaId).toBe(2);
  });

  it("honors an explicit persona request when that member can speak", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];

    expect(pickNextRoleplayMember(members, [], 2)?.personaId).toBe(2);
    expect(pickNextRoleplayMember(members, [], 3)).toBeNull();
  });

  it("rotates turn candidates after the last speaker so a silent member yields to the next", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 3, displayOrder: 2, speakingEnabled: true, analysisStatus: "ready" },
    ];
    const order = roleplayTurnCandidates(members, [
      { personaId: 1, speakerName: "甲", role: "persona", content: "我先说。" },
    ]).map(member => member.personaId);
    expect(order).toEqual([2, 3, 1]);

    expect(roleplayTurnCandidates(members, [], 3).map(member => member.personaId)).toEqual([3]);
  });

  it("formats transcript with speaker names without leaking inner thoughts", () => {
    const transcript = formatRoleplayTranscript([
      { personaId: null, speakerName: "用户", role: "user", content: "你们今晚在客厅。" },
      { personaId: 1, speakerName: "甲", role: "persona", content: "我去倒杯水。" },
      { personaId: 2, speakerName: "乙", role: "persona", content: "我把灯调暗一点。" },
    ]);

    expect(transcript).toContain("用户: 你们今晚在客厅。");
    expect(transcript).toContain("甲: 我去倒杯水。");
    expect(transcript).toContain("乙: 我把灯调暗一点。");
  });

  it("parses JSON roleplay output and strips speaker prefixes", () => {
    const parsed = parseRoleplayTurnResponse(
      '{"shouldSpeak":true,"innerThought":"有点想靠近，但先别吓着他。","mood":"playful","reply":"甲：你别站门口，进来坐。"}',
      "甲",
      "warm",
    );

    expect(parsed.shouldSpeak).toBe(true);
    expect(parsed.innerThought).toContain("靠近");
    expect(parsed.mood).toBe("playful");
    expect(parsed.reply).toBe("你别站门口，进来坐。");
  });

  it("parses allowed silence without leaking inner thoughts into a reply", () => {
    const parsed = parseRoleplayTurnResponse(
      '{"shouldSpeak":false,"innerThought":"这会儿先听他们说。","mood":"nostalgic","reply":""}',
      "甲",
      "warm",
    );

    expect(parsed.shouldSpeak).toBe(false);
    expect(parsed.innerThought).toBe("这会儿先听他们说。");
    expect(parsed.mood).toBe("nostalgic");
    // 静默回合不再被硬编码兜底台词顶成「我在。」（修「角色一直说我在」）
    expect(parsed.reply).toBe("");
  });

  it("handles broken/malformed LLM JSON without leaking raw code block", () => {
    const brokenRaw = '```json\n{\n"shouldSpeak": false,\n"innerThought": "脑子里一片空白……",\n"mood": "overwhelmed",\nreply": "\\n\\n\\n啊……嗯……\\n\\n\n}\n```';
    const parsed = parseRoleplayTurnResponse(brokenRaw, "陈远", "warm");
    expect(parsed.shouldSpeak).toBe(false);
    expect(parsed.innerThought).toBe("脑子里一片空白……");
    expect(parsed.reply).not.toContain("```json");
    expect(parsed.reply).not.toContain('"shouldSpeak"');
  });

  it("prefers the last speaker when reflection says same (连说)", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];
    const order = reflectedRoleplayTurnCandidates(members, [
      { personaId: 1, speakerName: "林舟", role: "persona", content: "你先坐。" },
    ], { nextSpeakerHint: "same", innerThought: "", mood: "warm", replyStrategy: "", replyLength: "medium", preferredSpeaker: null });

    expect(order.map(m => m.personaId)).toEqual([1, 2]);
  });

  it("falls back to normal rotation when reflection says other", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];
    const order = reflectedRoleplayTurnCandidates(members, [
      { personaId: 1, speakerName: "林舟", role: "persona", content: "你又说这个。" },
    ], { nextSpeakerHint: "other", innerThought: "", mood: "warm", replyStrategy: "", replyLength: "short", preferredSpeaker: null });

    expect(order.map(m => m.personaId)).toEqual([2, 1]);
  });

  it("honors preferredSpeaker when provided", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready", personaName: "林舟" as any },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready", personaName: "陈远" as any },
    ];
    const order = reflectedRoleplayTurnCandidates(members, [], {
      nextSpeakerHint: null,
      innerThought: "",
      mood: "warm",
      replyStrategy: "",
      replyLength: "medium",
      preferredSpeaker: "陈远",
    });
    expect(order[0]?.personaId).toBe(2);
  });

  it("deactivates roleplay channels that cannot continue after member removal", () => {
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(2)).toBe(false);
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(1)).toBe(true);
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(0)).toBe(true);
  });

  describe("sanitizeChannelGender", () => {
    it("replaces every 她 with 他 (channel has only male members)", () => {
      expect(sanitizeChannelGender("她转过身来。她们都在看着她。")).toBe("他转过身来。他们都在看着他。");
    });

    it("keeps 他 as-is", () => {
      expect(sanitizeChannelGender("他垂下眼，目光落在对方身上。")).toBe("他垂下眼，目光落在对方身上。");
    });

    it("handles empty input", () => {
      expect(sanitizeChannelGender("")).toBe("");
    });
  });
});

import { buildChannelPersonaSystemPrompt } from "./channel-persona-prompt";
import { buildRoleplayUserPrompt, buildChannelWorldOverlay } from "./roleplay-channel";

const migrationChannel = {
  id: 1,
  name: "深夜书房",
  description: "两人独处",
  scenePrompt: "夜深，书房里只剩一盏台灯。",
  members: [
    { personaName: "林舟", speakingEnabled: true, analysisStatus: "ready" },
    { personaName: "陈远", speakingEnabled: true, analysisStatus: "ready" },
  ],
} as any;

const miniPersona = {
  id: 1,
  name: "林舟",
  relationshipDesc: "故事伙伴",
  togetherFrom: "2020",
  togetherTo: "至今",
  emotionalState: "warm",
  personaData: {},
} as any;

describe("频道专用人物提示词边界", () => {
  it("只注入频道自己的连续性和承接规则，不调用场景模式双人提示词", () => {
    const prompt = buildChannelPersonaSystemPrompt(miniPersona, {
      channelName: "深夜书房",
      channelDescription: "两人独处",
      channelScenePrompt: "夜深，书房里只剩一盏台灯。",
      speakerName: "林舟",
      otherMemberNames: ["陈远"],
      reflection: {
        acknowledgement: "今晚两人已经在书房坐下",
        innerThought: "他想先把茶杯递过去",
        replyStrategy: "先写递茶动作，再接一句短台词",
        nextBeat: "窗外雨声变大",
      },
    });
    expect(prompt).toContain("频道连续性");
    expect(prompt).toContain("当前频道明确提供的地点");
    expect(prompt).toContain("本轮创作提示");
    expect(prompt).toContain("陈远");
    expect(prompt).not.toContain("双人模式（重要");
    expect(prompt).not.toContain("activeSceneId");
  });
});

describe("导演指令迁移（buildRoleplayUserPrompt）", () => {
  it("用户创作方向注入并保留参与边界", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "场景引导/用户: 今晚别睡，按我说的来。",
      allowSilence: false,
      latestUserGuidance: "今晚别睡，按我说的来。",
    });
    expect(prompt).toContain("用户本轮创作方向");
    expect(prompt).toContain("今晚别睡");
    expect(prompt).toContain("遵守参与边界与服务商内容政策");
  });

  it("无用户消息时不注入导演指示段", () => {
    const prompt = buildRoleplayUserPrompt({
      channel: migrationChannel,
      speakerName: "林舟",
      transcript: "",
      allowSilence: false,
    });
    expect(prompt).not.toContain("用户本轮创作方向");
  });
});

describe("世界锚通用化（不硬编码某对角色）", () => {
  it("scene overlay 的互动对象动态取自频道成员", () => {
    const overlay = buildChannelWorldOverlay(migrationChannel, "林舟");
    expect(overlay).toContain("互动对象：陈远");
    expect(overlay).toContain("当前世界锚");
  });

  it("从另一位成员视角生成时互动对象相应变化", () => {
    const overlay = buildChannelWorldOverlay(migrationChannel, "陈远");
    expect(overlay).toContain("互动对象：林舟");
  });
});

describe("空正文重试策略（隐藏推理吃满输出预算的兜底）", () => {
  it("首轮就有正文：只调一次，且不带关闭思考标记", async () => {
    const calls: boolean[] = [];
    const result = await invokeChannelTurnWithEmptyReplyRetry({
      allowRetry: true,
      invoke: async (retryWithoutThinking) => {
        calls.push(retryWithoutThinking);
        return "【雨声敲在窗上，林舟把窗推开一条缝。】";
      },
    });
    expect(calls).toEqual([false]);
    expect(result).toContain("雨声敲在窗上");
  });

  it("首轮空正文：第二次调用必须关闭隐藏思考，并用第二次的结果", async () => {
    const calls: boolean[] = [];
    let warned = 0;
    const result = await invokeChannelTurnWithEmptyReplyRetry({
      allowRetry: true,
      invoke: async (retryWithoutThinking) => {
        calls.push(retryWithoutThinking);
        // 关键：第二次（关闭思考）才拿到正文，模拟实测行为
        return retryWithoutThinking ? '{"reply":"【陈远把草帽扣回头上。】"}' : "";
      },
      onEmptyReply: () => {
        warned += 1;
      },
    });
    expect(calls).toEqual([false, true]);
    expect(warned).toBe(1);
    expect(result).toContain("草帽");
  });

  it("全空白也算空正文，同样触发关闭思考重试", async () => {
    const calls: boolean[] = [];
    const result = await invokeChannelTurnWithEmptyReplyRetry({
      allowRetry: true,
      invoke: async (retryWithoutThinking) => {
        calls.push(retryWithoutThinking);
        return retryWithoutThinking ? "【有内容】" : "   \n  ";
      },
    });
    expect(calls).toEqual([false, true]);
    expect(result).toContain("有内容");
  });

  it("strict 省额度档位不重试（与其他兜底一致）", async () => {
    const calls: boolean[] = [];
    let warned = 0;
    const result = await invokeChannelTurnWithEmptyReplyRetry({
      allowRetry: false,
      invoke: async (retryWithoutThinking) => {
        calls.push(retryWithoutThinking);
        return "";
      },
      onEmptyReply: () => {
        warned += 1;
      },
    });
    expect(calls).toEqual([false]);
    expect(warned).toBe(0);
    expect(result).toBe("");
  });

  it("第二次仍然空：返回空串，交给上层按空正文跳过（不落库）", async () => {
    const result = await invokeChannelTurnWithEmptyReplyRetry({
      allowRetry: true,
      invoke: async () => "",
    });
    expect(result).toBe("");
  });
});

