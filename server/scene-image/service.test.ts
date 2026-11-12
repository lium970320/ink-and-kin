import { describe,expect,it,vi } from "vitest";
import { parseSceneImageRequest,orderSceneImageRelays,sceneImageIncludesUser,sceneImageVisualBaseline,createSceneImagePromptResolver } from "./service";
import type { Scene } from "../../drizzle/schema";
const relay={id:1,relayName:"合成站",priority:100,enabled:true,protocol:"auto" as const,baseUrl:"https://images.example.invalid",apiKey:null,model:"gpt-image-1",size:"1024x1024",timeoutMs:30000,formalReferenceEnabled:true,workflowJson:null,extraConfig:null};
describe("配图请求范围",()=>{
  it.each(["/p 灯塔","／Ｐ灯塔","/p灯塔","灯塔 /p"])("只移除显式标记 %s",text=>expect(parseSceneImageRequest(text)).toEqual({requested:true,message:"灯塔"}));
  it.each(["/profile","/photo","这段 /p 文本","平常聊天"])("普通文本不触发生图 %s",text=>expect(parseSceneImageRequest(text)).toEqual({requested:false,message:text}));
  it("只有标记时保留可用正文",()=>expect(parseSceneImageRequest("/p").message).toBe("请继续当前场景。"));
  it("auto 的工作流按实际 Comfy 协议进入本地策略",()=>{
    const local={...relay,id:2,workflowJson:"{}"};
    expect(orderSceneImageRelays({priorityStrategy:"comfyui_only",relays:[relay,local]}).map(item=>item.id)).toEqual([2]);
    expect(orderSceneImageRelays({priorityStrategy:"relay_only",relays:[relay,local]}).map(item=>item.id)).toEqual([1]);
  });
  it("日常单人不提交用户主图，明确双人或场景才包含",()=>{
    expect(sceneImageIncludesUser(null,"主角独自走在山路上","她走过石阶")).toBe(false);
    expect(sceneImageIncludesUser(null,"请画我们一起散步","她微笑")).toBe(true);
    expect(sceneImageIncludesUser({id:2} as Scene,"看看天空","她微笑")).toBe(true);
  });
  it("视觉基线只抽视觉字段，不保存对白全文",()=>{
    expect(sceneImageVisualBaseline("服装：蓝色外套\n场景：灯塔\n光线：黄昏\n用户描述：私人对白\n对话回应：长对话",{name:"原场景"} as Scene)).toBe("服装：蓝色外套\n场景：灯塔\n光线：黄昏");
    expect(sceneImageVisualBaseline("没有视觉字段的回应",{name:"图书室"} as Scene)).toBe("场景：图书室");
  });
});

describe("配图改写按实际候选惰性执行",()=>{
  const comfy={...relay,id:2,workflowJson:"{}"};
  const template="自定义结构：{{prompt}}";
  const base="原始画面：窗边的灯";
  it("云端不使用模板；进入 Comfy 候选时才改写，两个版本各缓存一次",async()=>{
    const rewrite=vi.fn<(messages:{role:"system"|"user";content:string}[])=>Promise<string>>()
      .mockResolvedValueOnce("云端画面").mockResolvedValueOnce("Comfy 画面");
    const resolveRewrite=vi.fn(async()=>rewrite);
    const prompt=createSceneImagePromptResolver({base,comfyPromptTemplate:template,resolveRewrite});
    expect(resolveRewrite).not.toHaveBeenCalled();
    await expect(prompt(relay)).resolves.toBe("云端画面");
    await expect(prompt({...relay,id:3})).resolves.toBe("云端画面");
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite.mock.calls[0][0][0].content).not.toContain(template);
    expect(rewrite.mock.calls[0][0][1]).toEqual({role:"user",content:base});
    await expect(prompt(comfy)).resolves.toBe("Comfy 画面");
    await expect(prompt({...comfy,id:4})).resolves.toBe("Comfy 画面");
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(rewrite.mock.calls[1][0][0].content).toContain(template);
    expect(rewrite.mock.calls[1][0][1]).toEqual({role:"user",content:base});
    expect(resolveRewrite).toHaveBeenCalledTimes(1);
  });
  it("没有改写站时，Comfy 和云端都直接使用基础画面文本",async()=>{
    const resolveRewrite=vi.fn(async()=>null);
    const prompt=createSceneImagePromptResolver({base,comfyPromptTemplate:template,resolveRewrite});
    await expect(prompt(comfy)).resolves.toBe(base);
    await expect(prompt(relay)).resolves.toBe(base);
    expect(resolveRewrite).toHaveBeenCalledTimes(1);
  });
  it("Comfy 没有自定义模板时与云端复用同一默认改写",async()=>{
    const rewrite=vi.fn(async()=>"默认画面");
    const prompt=createSceneImagePromptResolver({base,resolveRewrite:async()=>rewrite});
    await expect(prompt(comfy)).resolves.toBe("默认画面");
    await expect(prompt(relay)).resolves.toBe("默认画面");
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
});
