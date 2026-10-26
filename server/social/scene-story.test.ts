import { describe, expect, it } from "vitest";
import {
  buildSceneIdentityOverrideInstruction,
  buildSceneStorySystemInstruction,
  buildSceneStoryUserDirectionInstruction,
  formatScenePromptOverlay,
  getSceneAppearanceOverride,
  getSceneStoryBeat,
  isSceneStoryStartMarker,
} from "./scene-story";

describe("scene story", () => {
  it("includes the scene name, background and custom direction", () => {
    expect(formatScenePromptOverlay({
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      systemPromptOverlay: "钟楼不可随意进入。",
    })).toContain("场景名称：山寺夜宿");
    expect(formatScenePromptOverlay({
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      systemPromptOverlay: "钟楼不可随意进入。",
    })).toContain("场景背景：两人傍晚避雨来到山寺。");
    expect(formatScenePromptOverlay({
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      systemPromptOverlay: "钟楼不可随意进入。",
    })).toContain("钟楼不可随意进入");
    expect(formatScenePromptOverlay({
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      contextSeed: "上次已经见过主持，他说后山明早可以去看日出。",
    })).toContain("场景前情提要/当前上下文");
    expect(formatScenePromptOverlay({
      name: "山寺夜宿",
      description: "两人傍晚避雨来到山寺。",
      contextSeed: "上次已经见过主持，他说后山明早可以去看日出。",
    })).toContain("上次已经见过主持");
  });

  it("starts with a short opening and then cycles through story beats", () => {
    expect(getSceneStoryBeat(0)).toBe("opening");
    expect(getSceneStoryBeat(3)).toBe("world_event");
    expect(getSceneStoryBeat(4)).toBe("consequence");
    expect(getSceneStoryBeat(7)).toBe("world_event");

    const opening = buildSceneStorySystemInstruction({ turn: 0 });
    expect(opening).toContain("1-2 段简短【】旁白");
    expect(opening).toContain("不要写长序章");
    expect(opening).toContain("每轮至少推进一项");
  });

  it("场景统一承接双方动作并尊重用户台词和主动选择", () => {
    const instruction = buildSceneStoryUserDirectionInstruction({
      text: "【门外忽然传来脚步声】我示意你先别出声。",
      turn: 4,
    });
    expect(instruction).toContain("承接明确提供的事实");
    expect(instruction).toContain("不补造其他参与者的意愿");
    expect(instruction).toContain("继续推进");
    expect(instruction).toContain("承接上一轮的具体位置与未完成动作");
    expect(instruction).toContain("这不是重新开场");

    const dualInstruction = buildSceneStorySystemInstruction({
      turn: 2,
    });
    expect(dualInstruction).toContain("可以承接人物与用户双方已经发生的动作及即时反应");
    expect(dualInstruction).toContain("主动选择、新意愿与内心承诺由用户自己决定");
    expect(dualInstruction).toContain("用户创作方向");
    expect(dualInstruction).toContain("不代替其他参与者决定意愿或行动");
  });


  it("recognizes explicit scene start markers without treating them as dialogue", () => {
    expect(isSceneStoryStartMarker("【开始】")).toBe(true);
    expect(isSceneStoryStartMarker("【开场：两人刚走进山门】接着写")).toBe(true);
    expect(isSceneStoryStartMarker("叔，我们开始吧")).toBe(false);
    expect(buildSceneStoryUserDirectionInstruction({
      text: "【开始】",
      turn: 0,
    })).toContain("不把标记当作角色台词");
  });




});
