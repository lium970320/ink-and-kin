import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSceneImage, listSceneImageModels, type SceneImageReference, type SceneImageRelay } from "./providers";
import { buildComfyWorkflow } from "./workflow";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xKkAAAAASUVORK5CYII=", "base64");
const b64 = png.toString("base64");
const relay: SceneImageRelay = { relayName: "假站", baseUrl: "https://relay.example.invalid/proxy", protocol: "openai", model: "gpt-image-1",
  size: "1024x1024", timeoutMs: 4000, apiKey: "synthetic-token", formalReferenceEnabled: true };
const ref = (role: SceneImageReference["role"]): SceneImageReference => ({ role, mimeType: "image/png", buffer: png });
const generate = (config = relay, references: SceneImageReference[] = [], signal?: AbortSignal) => generateSceneImage({ relay: config, prompt: "画灯塔", references, signal });
const image = () => Response.json({ data: [{ b64_json: b64 }] });
function stub() { const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher); return fetcher; }
function pathOf(input: unknown) { return new URL(String(input)).pathname; }
const comfy: SceneImageRelay = { ...relay, protocol: "comfyui", baseUrl: "http://127.0.0.1:8188/api", model: "base.safetensors" };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("场景图片协议", () => {
  it("OpenAI 生成与 multipart 编辑使用固定端点、同一凭据及稳定角色顺序", async () => {
    const fetcher = stub().mockImplementation(async () => image());
    expect(await generate()).toMatchObject({ buffer: png, mimeType: "image/png", referenceMode: "no_reference" });
    expect(await generate(relay, [ref("env"), ref("persona")])).toMatchObject({ referenceMode: "openai_edit" });
    const [first, second] = fetcher.mock.calls;
    expect(pathOf(first[0])).toBe("/proxy/v1/images/generations");
    expect(first[1]).toMatchObject({ method: "POST", redirect: "manual", headers: { Authorization: "Bearer synthetic-token" } });
    expect(JSON.parse(String(first[1]?.body))).toEqual({ model: relay.model, prompt: "画灯塔", n: 1, size: "1024x1024" });
    expect(pathOf(second[0])).toBe("/proxy/v1/images/edits");
    const form = second[1]?.body as FormData;
    expect(form.getAll("image[]").map(file => (file as File).name)).toEqual(["persona.png", "env.png"]);
    expect(form.get("prompt")).toContain("1. 人物参考；2. 环境参考");
  });

  it("Grok 用官方 JSON 多图编辑和内联输出，不发 multipart 或生成兜底", async () => {
    const fetcher = stub().mockImplementation(async () => image());
    const grok = { ...relay, model: "grok-imagine-image-2.0", size: "16:9" };
    expect(await generate(grok, [ref("user"), ref("persona")])).toMatchObject({ referenceMode: "grok_multi_image_edit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(pathOf(fetcher.mock.calls[0][0])).toContain("/images/edits");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ aspect_ratio: "16:9", response_format: "b64_json", images: [
      { type: "image_url", url: `data:image/png;base64,${b64}` }, { type: "image_url", url: `data:image/png;base64,${b64}` },
    ] });
  });

  it("Gemini inlineData 与图片回包及凭据匹配", async () => {
    const fetcher = stub().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [
      { text: "完成" }, { inline_data: { mime_type: "image/png", data: b64 } },
    ] } }] }));
    const gemini: SceneImageRelay = { ...relay, protocol: "google_gemini", model: "models/gemini-image", baseUrl: "https://relay.example.invalid/v1beta/models/old:generateContent" };
    expect(await generate(gemini, [ref("env")])).toMatchObject({ referenceMode: "gemini_inline", buffer: png });
    const [url, init] = fetcher.mock.calls[0];
    expect(pathOf(url)).toBe("/v1beta/models/gemini-image:generateContent");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "synthetic-token" });
    expect(JSON.parse(String(init?.body)).contents[0].parts).toEqual([{ text: "画灯塔" }, { text: "环境参考：" }, { inlineData: { mimeType: "image/png", data: b64 } }]);
  });

  it("只下载同源图片且不跟随重定向，远端内容不进入错误详情", async () => {
    const fetcher = stub().mockResolvedValueOnce(Response.json({ data: [{ url: "https://other.example.invalid/image" }] }));
    await expect(generate()).rejects.toMatchObject({ code: "invalid_response", safeToSwitch: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ data: [{ url: "/result.png" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://other.example.invalid/image" } }));
    await expect(generate()).rejects.toMatchObject({ code: "invalid_response", safeToSwitch: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][1]?.redirect).toBe("manual");
    fetcher.mockResolvedValueOnce(Response.json({ data: [{ url: "/result.png" }] })).mockResolvedValueOnce(new Response(new Uint8Array(png)));
    await expect(generate()).resolves.toMatchObject({ buffer: png });
    expect(pathOf(fetcher.mock.calls[4][0])).toBe("/result.png");
  });

  it("地址、未授权参考和重复角色均在发请求前拒绝", async () => {
    const fetcher = stub();
    for (const baseUrl of ["http://relay.example.invalid", "https://user@relay.example.invalid", "https://relay.example.invalid?secret=1", "https://relay.example.invalid/#", "file:///tmp/test"]) {
      await expect(generate({ ...relay, baseUrl })).rejects.toMatchObject({ code: "invalid_config" });
    }
    await expect(generate({ ...relay, formalReferenceEnabled: false }, [ref("user")])).rejects.toMatchObject({ code: "unsupported_reference" });
    await expect(generate(relay, [ref("env"), ref("env")])).rejects.toMatchObject({ code: "invalid_config" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("为 10 MiB 的图片保留 base64 信封空间，解码后仍拒绝超过上限的字节", async () => {
    const limit = 10 * 1024 * 1024;
    const payload = Buffer.alloc(limit + 1);
    png.copy(payload);
    const fetcher = stub().mockImplementationOnce(async () => Response.json({ data: [{ b64_json: payload.subarray(0, limit).toString("base64") }] }))
      .mockImplementationOnce(async () => Response.json({ data: [{ b64_json: payload.toString("base64") }] }));
    expect((await generate()).buffer.length).toBe(limit);
    await expect(generate()).rejects.toMatchObject({ code: "response_too_large" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("没有声明长度的响应仍按流限制；超时结果不明确时不换站", async () => {
    const fetcher = stub().mockResolvedValueOnce(new Response(new ReadableStream({
      start(stream) { stream.enqueue(new Uint8Array(15 * 1024 * 1024 + 1)); stream.close(); },
    }))).mockImplementationOnce(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    await expect(generate()).rejects.toMatchObject({ code: "response_too_large", safeToSwitch: false });
    await expect(generate({ ...relay, timeoutMs: 25 })).rejects.toMatchObject({ code: "timeout", safeToSwitch: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("区分内容限制、明确拒绝、结果不明与过大，不自动重试 POST", async () => {
    const fetcher = stub().mockResolvedValueOnce(Response.json({ error: { code: "content_policy_violation", message: "private server message" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "rate_limit_exceeded", message: "blocked by content policy" } }, { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { headers: { "content-length": String(15 * 1024 * 1024 + 1) } }));
    await expect(generate()).rejects.toMatchObject({ code: "content_policy", safeToSwitch: false, message: "图片服务拒绝了此内容。" });
    await expect(generate()).rejects.toMatchObject({ code: "http_4xx", safeToSwitch: true, status: 401 });
    await expect(generate()).rejects.toMatchObject({ code: "content_policy", safeToSwitch: false });
    await expect(generate()).rejects.toMatchObject({ code: "http_4xx", safeToSwitch: false, status: 429 });
    await expect(generate()).rejects.toMatchObject({ code: "unknown", safeToSwitch: false, status: 502 });
    await expect(generate()).rejects.toMatchObject({ code: "response_too_large" });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});

function comfyWithReferences(): SceneImageRelay {
  const { workflow } = buildComfyWorkflow({ relay: comfy, prompt: "灯塔", uploads: {}, outputPrefix: `mirrai_${"1".repeat(32)}` });
  workflow["2"].inputs.text = "{{prompt}}";
  workflow["10"] = { class_type: "LoadImage", inputs: { image: "{{persona}}" } };
  workflow["12"] = { class_type: "LoadImage", inputs: { image: "{{env}}" } };
  workflow["11"] = { class_type: "ImageBatch", inputs: { image1: ["6", 0], image2: ["10", 0] } };
  workflow["13"] = { class_type: "ImageBatch", inputs: { image1: ["11", 0], image2: ["12", 0] } };
  workflow["7"].inputs.images = ["13", 0];
  return { ...comfy, workflowJson: JSON.stringify(workflow) };
}

describe("共享 ComfyUI 边界", () => {
  it("只有管理员允许地址才提交，模型列表也不绕过地址限制", async () => {
    const fetcher = stub();
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_ORIGINS", "");
    await expect(generate(comfy)).rejects.toMatchObject({ code: "invalid_config" });
    await expect(listSceneImageModels({ relay: { ...comfy, extraConfig: { allowedOrigins: ["http://127.0.0.1:8188"] } } })).rejects.toMatchObject({ code: "invalid_config" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("参考上传失败不压缩角色列表，也不提交工作流", async () => {
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_ORIGINS", "http://127.0.0.1:8188");
    const fetcher = stub().mockImplementationOnce(async (_url, init) => {
      const file = (init?.body as FormData).get("image") as File;
      expect(file.name).toMatch(/-persona\.png$/);
      return Response.json({ name: file.name, subfolder: "mirrai", type: "input" });
    }).mockResolvedValueOnce(new Response(null, { status: 502 }));
    const config = comfyWithReferences();
    await expect(generate(config, [ref("env")])).rejects.toMatchObject({ code: "unsupported_reference" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(generate(config, [ref("env"), ref("persona")])).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher.mock.calls.map(([url]) => pathOf(url))).toEqual(["/api/upload/image", "/api/upload/image"]);
  });

  it("上传按角色验证回执、只读本任务历史和随机前缀输出", async () => {
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_ORIGINS", "http://127.0.0.1:8188");
    let prefix = "";
    const fetcher = stub().mockImplementation(async (url, init) => {
      switch (pathOf(url)) {
        case "/api/upload/image": {
          const body = init?.body as FormData;
          expect(body.get("overwrite")).toBe("false");
          return Response.json({ name: (body.get("image") as File).name, subfolder: "mirrai", type: "input" });
        }
        case "/api/prompt": {
          const { prompt } = JSON.parse(String(init?.body));
          expect(prompt["10"].inputs.image).toMatch(/^mirrai\/[a-f0-9]{32}-persona\.png$/);
          expect(prompt["12"].inputs.image).toMatch(/^mirrai\/[a-f0-9]{32}-env\.png$/);
          prefix = prompt["7"].inputs.filename_prefix;
          expect(prefix).toMatch(/^mirrai_[a-f0-9]{32}$/);
          return Response.json({ prompt_id: "job1" });
        }
        case "/api/history/job1": return Response.json({ job1: { outputs: { "7": { images: [
          { filename: `${prefix}_00001_.png`, subfolder: "", type: "output" },
        ] } } } });
        case "/api/view": {
          expect(new URL(String(url)).searchParams.get("filename")).toBe(`${prefix}_00001_.png`);
          return new Response(new Uint8Array(png));
        }
        default: throw new Error("意外请求");
      }
    });
    await expect(generate(comfyWithReferences(), [ref("env"), ref("persona")])).resolves.toMatchObject({ referenceMode: "comfyui_workflow", providerJobId: "job1", buffer: png });
    expect(fetcher.mock.calls.map(([url]) => pathOf(url))).toEqual(["/api/upload/image", "/api/upload/image", "/api/prompt", "/api/history/job1", "/api/view"]);
  });

  it("取消只结束本端等待，不发全局中断或重投", async () => {
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_ORIGINS", "http://127.0.0.1:8188");
    const caller = new AbortController();
    const fetcher = stub().mockResolvedValueOnce(Response.json({ prompt_id: "job1" })).mockImplementationOnce(async () => {
      caller.abort();
      return Response.json({});
    });
    await expect(generate(comfy, [], caller.signal)).rejects.toMatchObject({ code: "cancelled", safeToSwitch: false });
    expect(fetcher.mock.calls.map(([url]) => pathOf(url))).toEqual(["/api/prompt", "/api/history/job1"]);
  });

  it("模型发现按协议取列表，只收可用的受限项", async () => {
    vi.stubEnv("MIRRAI_COMFYUI_ALLOWED_ORIGINS", "http://127.0.0.1:8188");
    const fetcher = stub().mockResolvedValueOnce(Response.json({ data: [{ id: "gpt-image-1" }, { id: "gpt-image-1" }] }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-image", displayName: "图像", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-text" }] }))
      .mockResolvedValueOnce(Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["model.safetensors", "../private.safetensors"]] } } } }));
    expect(await listSceneImageModels({ relay })).toEqual([{ id: "gpt-image-1", label: "gpt-image-1" }]);
    expect(await listSceneImageModels({ relay: { ...relay, protocol: "google_gemini" } })).toEqual([{ id: "gemini-image", label: "图像" }]);
    expect(await listSceneImageModels({ relay: comfy })).toEqual([{ id: "model.safetensors", label: "model.safetensors" }]);
    expect(fetcher.mock.calls.map(([url]) => pathOf(url))).toEqual(["/proxy/v1/models", "/proxy/v1beta/models", "/api/object_info/CheckpointLoaderSimple"]);
  });
});
