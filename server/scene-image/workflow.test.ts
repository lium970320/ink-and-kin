import { afterEach, describe, expect, it, vi } from "vitest";
import { buildComfyWorkflow, type ComfyReferencePaths } from "./workflow";
import type { SceneImageRelay } from "./provider-types";

const relay: SceneImageRelay = { relayName: "测试", baseUrl: "http://127.0.0.1:8188", protocol: "comfyui",
  model: "model.safetensors", size: "768x512", timeoutMs: 2000, formalReferenceEnabled: true };
const id = "1".repeat(32), outputPrefix = `mirrai_${id}`;
const build = (config = relay, uploads: ComfyReferencePaths = {}) => buildComfyWorkflow({ relay: config, prompt: "灯塔", uploads, outputPrefix });

afterEach(() => vi.unstubAllEnvs());

describe("ComfyUI API 工作流", () => {
  it("默认模板只出单张图，并控制正向提示、模型、尺寸及输出路径", () => {
    const { workflow, outputIds } = build();
    expect(workflow["1"].inputs.ckpt_name).toBe(relay.model);
    expect(workflow["2"].inputs.text).toBe("灯塔");
    expect(workflow["4"].inputs).toMatchObject({ width: 768, height: 512, batch_size: 1 });
    expect(outputIds).toEqual(["7"]);
    expect(workflow["7"].inputs.filename_prefix).toBe(outputPrefix);
  });

  it("按角色保留带空位的绑定，不把环境图移到用户槽位", () => {
    const draft = build().workflow;
    draft["2"].inputs.text = "{{prompt}}";
    draft["10"] = { class_type: "LoadImage", inputs: { image: "{{persona}}" } };
    draft["12"] = { class_type: "LoadImage", inputs: { image: "{{env}}" } };
    draft["11"] = { class_type: "ImageBatch", inputs: { image1: ["6", 0], image2: ["10", 0] } };
    draft["13"] = { class_type: "ImageBatch", inputs: { image1: ["11", 0], image2: ["12", 0] } };
    draft["7"].inputs.images = ["13", 0];
    const config = { ...relay, workflowJson: JSON.stringify(draft) };
    const uploads = { persona: `mirrai/${id}-persona.png`, env: `mirrai/${id}-env.jpg` };
    const { workflow } = build(config, uploads);
    expect(workflow["10"].inputs.image).toBe(uploads.persona);
    expect(workflow["12"].inputs.image).toBe(uploads.env);
    expect(() => build(config, { env: uploads.env })).toThrow(/角色/);
    expect(() => build(config, { ...uploads, user: `mirrai/${id}-user.png` })).toThrow(/角色/);
  });

  it("拒绝路径逃逸、任意读取、未知节点和过量节点", () => {
    expect(() => build({ ...relay, model: "../elsewhere/model.safetensors" })).toThrow();
    expect(() => build({ ...relay, model: "C:/model.safetensors" })).toThrow();
    const slash = String.fromCharCode(92);
    expect(() => build({ ...relay, model: `folder${slash}..${slash}model.safetensors` })).toThrow();
    expect(() => build({ ...relay, model: `${slash}${slash}server${slash}model.safetensors` })).toThrow();
    const graph = build().workflow;
    graph["8"] = { class_type: "ReadFile", inputs: { filename: "private.txt" } };
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_NODE_TYPES", "ReadFile");
    expect(() => build({ ...relay, workflowJson: JSON.stringify(graph) })).toThrow();
    delete graph["8"];
    expect(() => build({ ...relay, workflowJson: JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), graph["1"]]))) })).toThrow();
  });

  it("原始尺寸链接有循环或指向不存在节点时，不能靠尺寸覆盖掩盖", () => {
    const graph = build().workflow;
    graph["4"].inputs.width = ["5", 0];
    expect(() => build({ ...relay, workflowJson: JSON.stringify(graph) })).toThrow();
    graph["4"].inputs.width = ["missing", 0];
    expect(() => build({ ...relay, workflowJson: JSON.stringify(graph) })).toThrow();
    graph["4"].inputs.width = 1024;
    expect(build({ ...relay, workflowJson: JSON.stringify(graph) }).workflow["4"].inputs.width).toBe(768);
  });

  it("自定义节点只接受管理员允许的类型，且允许的节点也不能传网络地址", () => {
    const graph = build().workflow;
    graph["8"] = { class_type: "CustomBlend", inputs: { image: ["6", 0], strength: 0.5 } };
    graph["7"].inputs.images = ["8", 0];
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_NODE_TYPES", "");
    expect(() => build({ ...relay, workflowJson: JSON.stringify(graph), extraConfig: { allowedNodeTypes: ["CustomBlend"] } })).toThrow();
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_NODE_TYPES", "CustomBlend");
    expect(build({ ...relay, workflowJson: JSON.stringify(graph) }).workflow["8"].class_type).toBe("CustomBlend");
    graph["8"].inputs.endpoint = "https://example.invalid/";
    expect(() => build({ ...relay, workflowJson: JSON.stringify(graph) })).toThrow();
  });
});
