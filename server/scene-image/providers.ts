import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { buildComfyWorkflow, object, parseSceneImageDimensions, referenceRoles, safeModelName, type ComfyReferencePaths } from "./workflow";
import { SceneImageProviderError, type GeneratedSceneImage, type GenerateSceneImageInput, type ListSceneImageModelsInput,
  type ResolvedSceneImageProtocol, type SceneImageMimeType, type SceneImageModel, type SceneImageReference, type SceneImageRelay } from "./provider-types";
export * from "./provider-types";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;
const ERROR_BYTES = 64 * 1024;
const IMAGE_JSON_BYTES = Math.ceil(MAX_BYTES / 3) * 4 + MAX_METADATA;
const MAX_PROMPT = 12_000;
const allowedMime = new Set<string>(["image/png", "image/jpeg", "image/webp"]);
const fileExtension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const roleLabels = { persona: "人物参考", user: "用户参考", env: "环境参考" } as const;
const jobIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

function configError(message = "图片服务配置无效。") { return new SceneImageProviderError("invalid_config", message, true); }
function invalidResponse() { return new SceneImageProviderError("invalid_response", "图片服务返回无效结果。"); }
function tooLarge() { return new SceneImageProviderError("response_too_large", "图片服务响应超过大小上限。"); }
function policyError() { return new SceneImageProviderError("content_policy", "图片服务拒绝了此内容。"); }

function relayUrl(raw: string): URL {
  try {
    if (typeof raw !== "string" || raw.length > 2048 || /[?#\s]/.test(raw) || raw.includes(String.fromCharCode(92))) throw configError();
    const value = new URL(raw);
    if (!["http:", "https:"].includes(value.protocol) || value.username || value.password || !value.hostname || !/^https?:\/\//i.test(raw)) throw configError();
    // URL normalisation may erase empty userinfo (`https://@host`).
    if (raw.slice(raw.indexOf("://") + 3).split("/", 1)[0].includes("@")) throw configError();
    return value;
  } catch { throw configError(); }
}

type ProtocolSettings = Pick<SceneImageRelay, "protocol" | "baseUrl" | "model" | "workflowJson">;
function resolveProtocol(relay: ProtocolSettings, url?: URL): ResolvedSceneImageProtocol {
  if (relay.protocol === "openai" || relay.protocol === "google_gemini" || relay.protocol === "comfyui") return relay.protocol;
  if (relay.protocol !== "auto") throw configError();
  if (relay.workflowJson || url?.port === "8188" || /(?:^|\/)comfyui(?:\/|$)/i.test(url?.pathname ?? "")) return "comfyui";
  if (url?.hostname === "generativelanguage.googleapis.com" || /:generateContent\/?$/i.test(url?.pathname ?? "") || /^gemini-/i.test(relay.model)) return "google_gemini";
  return "openai";
}

export function resolveSceneImageProtocol(relay: ProtocolSettings): ResolvedSceneImageProtocol {
  return resolveProtocol(relay, relay.baseUrl ? relayUrl(relay.baseUrl) : undefined);
}

function loopback(host: string) { return host === "localhost" || host === "127.0.0.1" || host === "[::1]"; }
function originAllowed(origin: string): boolean {
  return (process.env.MIRRAI_COMFYUI_ALLOWED_ORIGINS ?? "").split(/[,\s]+/).some(raw => {
    if (!raw) return false;
    try { const url = relayUrl(raw); return url.pathname === "/" && url.origin === origin; } catch { return false; }
  });
}

function relayContext(relay: SceneImageRelay) {
  const base = relayUrl(relay.baseUrl);
  const protocol = resolveProtocol(relay, base);
  const local = loopback(base.hostname);
  if ((base.protocol !== "https:" && !local) || (local && protocol !== "comfyui" && process.env.NODE_ENV !== "test")) throw configError("图片服务须使用 HTTPS。");
  if (protocol === "comfyui" && !originAllowed(base.origin)) throw configError("ComfyUI 服务未获管理员授权。");
  if (!Number.isInteger(relay.timeoutMs) || relay.timeoutMs < 1 || relay.timeoutMs > 600_000 ||
    (relay.apiKey != null && relay.apiKey !== "" && (typeof relay.apiKey !== "string" || !/^[!-~]{1,2048}$/.test(relay.apiKey)))) throw configError();
  const auth: Record<string, string> = relay.apiKey ? protocol === "google_gemini"
    ? { "x-goog-api-key": relay.apiKey } : { Authorization: `Bearer ${relay.apiKey}` } : {};
  return { base, protocol, auth };
}

type Context = ReturnType<typeof relayContext> & { signal: AbortSignal };
async function withContext<T>(relay: SceneImageRelay, caller: AbortSignal | undefined, work: (context: Context) => Promise<T>): Promise<T> {
  if (caller?.aborted) throw new SceneImageProviderError("cancelled", "图片请求已取消。");
  const info = relayContext(relay);
  const timeout = AbortSignal.timeout(relay.timeoutMs);
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  try { const result = await work({ ...info, signal }); signal.throwIfAborted(); return result; }
  catch (error) {
    if (caller?.aborted) throw new SceneImageProviderError("cancelled", "图片请求已取消。");
    if (timeout.aborted) throw new SceneImageProviderError("timeout", "图片服务请求超时。");
    if (error instanceof SceneImageProviderError) throw error;
    throw new SceneImageProviderError("network_error", "图片服务连接失败或结果未确认。");
  }
}

function endpoint(base: URL, suffix: string, basePath = base.pathname): URL {
  const url = new URL(base);
  url.pathname = `${basePath.replace(/\/+$/, "")}/${suffix}`;
  return url;
}
function openAiPath(base: URL) {
  const prefix = base.pathname.replace(/\/+$/, "").replace(/\/(?:images\/(?:edits|generations)|models)$/i, "");
  return /\/v[0-9]+$/i.test(prefix) ? prefix : `${prefix}/v1`;
}
function geminiPath(base: URL) {
  const prefix = base.pathname.replace(/\/+$/, "").replace(/\/models(?:\/[^/]+:generateContent)?$/i, "");
  return /\/v[0-9]+(?:beta[0-9]*|alpha[0-9]*)?$/i.test(prefix) ? prefix : `${prefix}/v1beta`;
}

async function bounded(response: Response, cap: number): Promise<Buffer> {
  const stated = response.headers.get("content-length");
  if (stated && Number(stated) > cap) { void response.body?.cancel().catch(() => undefined); throw tooLarge(); }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > cap) { void reader.cancel().catch(() => undefined); throw tooLarge(); }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, bytes);
  } finally { reader.releaseLock(); }
}

function json(bytes: Buffer): Record<string, unknown> {
  try { const result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); if (result) return result; }
  catch { /* do not echo server responses */ }
  throw invalidResponse();
}
function values(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function isPolicy(value: unknown): boolean {
  return typeof value === "string" && /^(?:content_policy_violation|content_policy|safety|image_safety|blocked_by_safety|blocklist|prohibited_content|image_prohibited_content|moderation_blocked)$/i.test(value);
}

function policyMessage(value: unknown): boolean {
  return typeof value === "string" && /(?:content[-_ ]policy|safety policy|blocked by (?:content|safety|moderation)|moderation blocked|内容政策|安全策略)/i.test(value);
}

function clearlyRejected(status: number, fields: unknown[]): boolean {
  const reasons = fields.filter((value): value is string => typeof value === "string").map(value => value.toLowerCase());
  const explicit = status === 401 ? ["invalid_api_key", "authentication_error", "unauthenticated"]
    : status === 404 ? ["model_not_found", "invalid_model"]
    : status === 429 ? ["rate_limit_exceeded", "quota_exceeded", "insufficient_quota", "resource_exhausted"] : [];
  return reasons.some(reason => explicit.includes(reason));
}

async function request(context: Context, url: URL, init: RequestInit = {}, canSwitch = false): Promise<Response> {
  if (url.origin !== context.base.origin || url.username || url.password || url.hash) throw invalidResponse();
  context.signal.throwIfAborted();
  const response = await fetch(url, { ...init, headers: { ...context.auth, ...init.headers }, redirect: "manual", signal: context.signal });
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => undefined);
    throw invalidResponse();
  }
  if (response.ok) return response;
  let body: Record<string, unknown> | undefined;
  try { body = json(await bounded(response, ERROR_BYTES)); } catch { /* retain only HTTP status */ }
  const error = object(body?.error);
  const reasonFields = [error?.code, error?.type, error?.status, body?.code];
  if (reasonFields.some(isPolicy) || [error?.message, body?.message].some(policyMessage)) throw policyError();
  const status = response.status;
  if (status >= 400 && status < 500) {
    throw new SceneImageProviderError("http_4xx", "图片服务拒绝请求。", canSwitch && clearlyRejected(status, reasonFields), status);
  }
  throw new SceneImageProviderError("unknown", "图片服务未确认处理结果。", false, status);
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
async function requestJson(context: Context, url: URL, cap: number, init?: RequestInit, canSwitch = false) {
  return json(await bounded(await request(context, url, init, canSwitch), cap));
}

function imageMime(bytes: Buffer): SceneImageMimeType | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && /^VP8[ LX]$/.test(bytes.toString("ascii", 12, 16))) return "image/webp";
  return undefined;
}
function checkedImage(buffer: Buffer, advertised?: unknown) {
  if (buffer.length > MAX_BYTES) throw tooLarge();
  const mimeType = imageMime(buffer);
  if (!mimeType || (typeof advertised === "string" && allowedMime.has(advertised) && advertised !== mimeType)) throw invalidResponse();
  return { buffer, mimeType };
}
function decodeImage(base64: string, advertised?: unknown) {
  if (base64.length > Math.ceil(MAX_BYTES / 3) * 4) throw tooLarge();
  if (base64.length % 4 === 1 || /\s/.test(base64) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || (base64.endsWith("=") && base64.length % 4)) throw invalidResponse();
  return checkedImage(Buffer.from(base64, "base64"), advertised);
}

function sortedReferences(input: GenerateSceneImageInput): SceneImageReference[] {
  const { references, relay } = input;
  if (!Array.isArray(references) || references.length > referenceRoles.length) throw configError("参考图参数无效。");
  if (references.length && !relay.formalReferenceEnabled) throw new SceneImageProviderError("unsupported_reference", "本图片服务未开启正式参考图。", true);
  const seen = new Set<string>();
  for (const ref of references) {
    if (!ref || !referenceRoles.includes(ref.role) || seen.has(ref.role) || !Buffer.isBuffer(ref.buffer) || ref.buffer.length > MAX_BYTES ||
      !allowedMime.has(ref.mimeType) || imageMime(ref.buffer) !== ref.mimeType) throw configError("参考图格式、大小或角色无效。");
    seen.add(ref.role);
  }
  return referenceRoles.flatMap(role => references.filter(ref => ref.role === role));
}
function withRoles(prompt: string, refs: readonly SceneImageReference[]) {
  return refs.length ? `${prompt}\n参考图按以下顺序提供：${refs.map((ref, index) => `${index + 1}. ${roleLabels[ref.role]}`).join("；")}。` : prompt;
}
function blob(reference: SceneImageReference) { return new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }); }
function dataUri(reference: SceneImageReference) { return `data:${reference.mimeType};base64,${reference.buffer.toString("base64")}`; }

async function imageFromOpenAi(context: Context, response: Record<string, unknown>) {
  const row = object(values(response.data)[0]);
  if (!row) throw invalidResponse();
  if (typeof row.b64_json === "string" && row.b64_json) return decodeImage(row.b64_json, row.mime_type);
  if (typeof row.url !== "string" || row.url.length > 2048 || /[?#\s]/.test(row.url) || row.url.includes(String.fromCharCode(92))) throw invalidResponse();
  let url: URL;
  try { url = new URL(row.url, context.base); } catch { throw invalidResponse(); }
  if (url.origin !== context.base.origin || url.username || url.password || /^\w+:\/\/[^/]*@/.test(row.url) || row.url.startsWith("//")) throw invalidResponse();
  const result = await request(context, url);
  return checkedImage(await bounded(result, MAX_BYTES), result.headers.get("content-type")?.split(";", 1)[0]);
}

function aspectRatio(size: string): string | undefined {
  if (/^(?:1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|9:19\.5|19\.5:9|20:9|21:9|9:21|5:2|2:5)$/.test(size)) return size;
  const pixels = parseSceneImageDimensions(size);
  if (!pixels) return undefined;
  const { width, height } = pixels;
  if (width === height) return "1:1";
  if (width * 3 === height * 2) return "2:3";
  if (height * 3 === width * 2) return "3:2";
  return undefined;
}

async function generateOpenAi(context: Context, relay: SceneImageRelay, prompt: string, refs: SceneImageReference[]): Promise<GeneratedSceneImage> {
  const grok = /^grok-imagine-image(?:[-.]|$)/i.test(relay.model);
  const edit = refs.length > 0;
  const url = endpoint(context.base, edit ? "images/edits" : "images/generations", openAiPath(context.base));
  const text = withRoles(prompt, refs);
  let init: RequestInit;
  let referenceMode: GeneratedSceneImage["referenceMode"] = "no_reference";
  if (grok) {
    const images = refs.map(ref => ({ type: "image_url", url: dataUri(ref) }));
    const aspect = aspectRatio(relay.size);
    init = postJson({ model: relay.model, prompt: text, n: 1, response_format: "b64_json",
      ...(aspect ? { aspect_ratio: aspect } : {}), ...(images.length === 1 ? { image: images[0] } : images.length > 1 ? { images } : {}) });
    if (edit) referenceMode = refs.length === 1 ? "grok_single_image_edit" : "grok_multi_image_edit";
  } else {
    const size = parseSceneImageDimensions(relay.size) || relay.size === "auto" ? relay.size : undefined;
    const responseFormat = /^dall-e-[23]$/i.test(relay.model) ? "b64_json" : undefined;
    if (edit) {
      referenceMode = "openai_edit";
      const form = new FormData();
      form.set("model", relay.model);
      form.set("prompt", text);
      form.set("n", "1");
      if (size) form.set("size", size);
      if (responseFormat) form.set("response_format", responseFormat);
      for (const ref of refs) form.append(refs.length === 1 ? "image" : "image[]", blob(ref), `${ref.role}.${fileExtension[ref.mimeType]}`);
      init = { method: "POST", body: form };
    } else init = postJson({ model: relay.model, prompt: text, n: 1, ...(size ? { size } : {}), ...(responseFormat ? { response_format: responseFormat } : {}) });
  }
  const response = await requestJson(context, url, IMAGE_JSON_BYTES, init, true);
  if (isPolicy(object(response.error)?.code) || policyMessage(object(response.error)?.message)) throw policyError();
  const result = await imageFromOpenAi(context, response);
  const providerJobId = typeof response.id === "string" && jobIdPattern.test(response.id) ? response.id : undefined;
  return { ...result, referenceMode, ...(providerJobId ? { providerJobId } : {}) };
}

async function generateGemini(context: Context, relay: SceneImageRelay, prompt: string, refs: SceneImageReference[]): Promise<GeneratedSceneImage> {
  const model = relay.model.replace(/^models\//, "");
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(model) || model === "." || model === "..") throw configError();
  const url = endpoint(context.base, `models/${encodeURIComponent(model)}:generateContent`, geminiPath(context.base));
  const parts: unknown[] = [{ text: prompt }];
  for (const ref of refs) parts.push({ text: `${roleLabels[ref.role]}：` }, { inlineData: { mimeType: ref.mimeType, data: ref.buffer.toString("base64") } });
  const aspect = aspectRatio(relay.size);
  const response = await requestJson(context, url, IMAGE_JSON_BYTES, postJson({ contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}) } }), true);
  if (isPolicy(object(response.promptFeedback ?? response.prompt_feedback)?.blockReason) || isPolicy(object(response.error)?.code) || policyMessage(object(response.error)?.message)) throw policyError();
  for (const raw of values(response.candidates)) {
    const candidate = object(raw);
    if (isPolicy(candidate?.finishReason ?? candidate?.finish_reason)) throw policyError();
    for (const rawPart of values(object(candidate?.content)?.parts)) {
      const part = object(rawPart);
      if (part?.thought === true) continue;
      const image = object(part?.inlineData ?? part?.inline_data);
      const mime = image?.mimeType ?? image?.mime_type;
      if (typeof mime === "string" && allowedMime.has(mime) && typeof image?.data === "string") {
        return { ...decodeImage(image.data, mime), referenceMode: refs.length ? "gemini_inline" : "no_reference" };
      }
    }
  }
  throw invalidResponse();
}

async function generateComfy(context: Context, relay: SceneImageRelay, prompt: string, refs: SceneImageReference[]): Promise<GeneratedSceneImage> {
  const id = randomUUID().replace(/-/g, "");
  const outputPrefix = `mirrai_${id}`;
  const uploads: ComfyReferencePaths = {};
  for (const ref of refs) uploads[ref.role] = `mirrai/${id}-${ref.role}.${fileExtension[ref.mimeType]}`;
  // Validate the complete graph and all role slots before sending any input.
  const { workflow, outputIds } = buildComfyWorkflow({ relay, prompt, uploads, outputPrefix });
  for (const ref of refs) {
    const name = uploads[ref.role]!.slice("mirrai/".length);
    const form = new FormData();
    form.set("image", blob(ref), name);
    form.set("type", "input");
    form.set("subfolder", "mirrai");
    form.set("overwrite", "false");
    const uploaded = await requestJson(context, endpoint(context.base, "upload/image"), MAX_METADATA, { method: "POST", body: form });
    if (uploaded.name !== name || uploaded.subfolder !== "mirrai" || uploaded.type !== "input") throw invalidResponse();
  }
  const submitted = await requestJson(context, endpoint(context.base, "prompt"), MAX_METADATA, postJson({ prompt: workflow, client_id: id }), true);
  const promptId = submitted.prompt_id;
  if (typeof promptId !== "string" || !jobIdPattern.test(promptId) || promptId.trim() !== promptId) throw invalidResponse();
  const historyUrl = endpoint(context.base, `history/${encodeURIComponent(promptId)}`);
  const filenamePattern = new RegExp(`^${outputPrefix}_[A-Za-z0-9_-]{1,40}[.](?:png|jpeg|jpg|webp)$`, "i");
  for (;;) {
    const history = await requestJson(context, historyUrl, MAX_METADATA);
    const job = object(history[promptId]);
    const status = object(job?.status);
    if (status?.status_str === "error") throw new SceneImageProviderError("unknown", "ComfyUI 未完成图片任务。");
    const outputs = object(job?.outputs);
    for (const node of outputIds) {
      const images = values(object(outputs?.[node])?.images);
      if (!images.length) continue;
      const image = images.map(object).find(item => item?.type === "output" && item.subfolder === "" &&
        typeof item.filename === "string" && filenamePattern.test(item.filename));
      if (!image || typeof image.filename !== "string") throw invalidResponse();
      const view = endpoint(context.base, "view");
      view.searchParams.set("filename", image.filename);
      view.searchParams.set("type", "output");
      const result = await request(context, view);
      return { ...checkedImage(await bounded(result, MAX_BYTES), result.headers.get("content-type")?.split(";", 1)[0]),
        referenceMode: refs.length ? "comfyui_workflow" : "no_reference", providerJobId: promptId };
    }
    if (status?.completed === true || status?.status_str === "success") throw invalidResponse();
    // Cancellation only stops this caller's poll. The remote job can continue.
    await delay(500, undefined, { signal: context.signal });
  }
}

export async function generateSceneImage(input: GenerateSceneImageInput): Promise<GeneratedSceneImage> {
  const { relay, prompt } = input;
  return withContext(relay, input.signal, async context => {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT ||
      typeof relay.model !== "string" || !relay.model.trim() || relay.model.length > 180 || typeof relay.size !== "string" || relay.size.length > 32) throw configError();
    const references = sortedReferences(input);
    if (context.protocol === "comfyui") return generateComfy(context, relay, prompt, references);
    if (context.protocol === "google_gemini") return generateGemini(context, relay, prompt, references);
    return generateOpenAi(context, relay, prompt, references);
  });
}

function modelOptions(rows: unknown[], convert: (value: unknown) => SceneImageModel | undefined): SceneImageModel[] {
  const models = new Map<string, SceneImageModel>();
  for (const raw of rows) {
    const model = convert(raw);
    if (!model || model.id.length > 180 || /[\u0000-\u001f]/.test(model.id) || models.has(model.id)) continue;
    models.set(model.id, { id: model.id, label: model.label.replace(/[\u0000-\u001f]/g, "").slice(0, 180) || model.id });
    if (models.size >= 512) break;
  }
  return Array.from(models.values());
}

export async function listSceneImageModels(input: ListSceneImageModelsInput): Promise<SceneImageModel[]> {
  return withContext(input.relay, input.signal, async context => {
    const base = context.base;
    if (context.protocol === "comfyui") {
      const response = await requestJson(context, endpoint(base, "object_info/CheckpointLoaderSimple"), MAX_METADATA);
      const required = object(object(object(response.CheckpointLoaderSimple)?.input)?.required);
      const row = values(required?.ckpt_name);
      const names = values(row[0]);
      if (!Array.isArray(row[0])) throw invalidResponse();
      return modelOptions(names, name => safeModelName(name) ? { id: name, label: name } : undefined);
    }
    if (context.protocol === "google_gemini") {
      const response = await requestJson(context, endpoint(base, "models", geminiPath(base)), MAX_METADATA);
      if (!Array.isArray(response.models)) throw invalidResponse();
      return modelOptions(response.models, raw => {
        const item = object(raw);
        if (typeof item?.name !== "string") return undefined;
        const id = item.name.replace(/^models\//, "");
        const methods = values(item.supportedGenerationMethods ?? item.supported_generation_methods);
        if (!/^[A-Za-z0-9._-]+$/.test(id) || !/image/i.test(id) || (methods.length && !methods.includes("generateContent"))) return undefined;
        return { id, label: typeof item.displayName === "string" ? item.displayName : id };
      });
    }
    const response = await requestJson(context, endpoint(base, "models", openAiPath(base)), MAX_METADATA);
    if (!Array.isArray(response.data)) throw invalidResponse();
    return modelOptions(response.data, raw => {
      const item = object(raw);
      return typeof item?.id === "string" && item.id.trim() === item.id && item.id ? { id: item.id, label: item.id } : undefined;
    });
  });
}
