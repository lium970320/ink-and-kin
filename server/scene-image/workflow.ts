import { randomInt } from "node:crypto";
import { SceneImageProviderError, type SceneImageReferenceRole, type SceneImageRelay } from "./provider-types";

export type ComfyLink = [string, number];
type Value = string | number | boolean | ComfyLink;
export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, Value> }>;
export type ComfyReferencePaths = Partial<Record<SceneImageReferenceRole, string>>;
export const referenceRoles = ["persona", "user", "env"] as const;

const MAX_WORKFLOW_BYTES = 128 * 1024;
const NODE_LIMIT = 64;
const modelInputs: Record<string, readonly string[]> = {
  CheckpointLoaderSimple: ["ckpt_name"], LoraLoader: ["lora_name"], LoraLoaderModelOnly: ["lora_name"],
  VAELoader: ["vae_name"], UNETLoader: ["unet_name"], CLIPLoader: ["clip_name"],
  DualCLIPLoader: ["clip_name1", "clip_name2"], TripleCLIPLoader: ["clip_name1", "clip_name2", "clip_name3"],
  ControlNetLoader: ["control_net_name"],
};
const builtins = new Set([...Object.keys(modelInputs), "KSampler", "KSamplerAdvanced", "EmptyLatentImage", "EmptySD3LatentImage",
  "CLIPTextEncode", "CLIPTextEncodeFlux", "VAEDecode", "VAEEncode", "LoadImage", "SaveImage", "ImageScale", "ImageScaleBy",
  "ImageBatch", "CLIPSetLastLayer", "FluxGuidance", "ConditioningCombine", "ConditioningConcat", "ConditioningSetArea",
  "ControlNetApplyAdvanced", "BasicGuider", "CFGGuider", "KSamplerSelect", "BasicScheduler", "RandomNoise", "SamplerCustomAdvanced"]);
const unsafeClass = /(?:http|network|webhook|download|upload|python|script|shell|command|exec|terminal|socket|folder|directory|filesystem|file|path|video|audio|save|loadimage)/i;
const externalKey = /(?:file|directory|folder|path|url|uri|endpoint|script|command|token|secret|header|credential)/i;
const mediaKey = /^(?:image|mask|video|audio)$/i;
const nodeId = /^[A-Za-z0-9_-]{1,64}$/;
const inputId = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const specialKeys = new Set(["__proto__", "prototype", "constructor"]);

function invalid(): never { throw new SceneImageProviderError("invalid_config", "工作流结构或输入不在允许范围内。", true); }
function badReference(): never { throw new SceneImageProviderError("unsupported_reference", "工作流的参考图角色与本次输入不匹配。", true); }
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function safeModelName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    /\.(?:safetensors|ckpt|pt|pth|bin|gguf)$/i.test(value) &&
    value.replaceAll(String.fromCharCode(92), "/").split("/").every(part => part.length > 0 && part !== "." && part !== ".." &&
      part.trim() === part && !part.endsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(part) && !/[:*?"<>|\u0000-\u001f]/.test(part));
}

export function parseSceneImageDimensions(size: string): { width: number; height: number } | undefined {
  const m = /^([0-9]{2,4})x([0-9]{2,4})$/i.exec(size);
  if (!m) return undefined;
  const [width, height] = m.slice(1).map(Number);
  return width >= 64 && width <= 2048 && height >= 64 && height <= 2048 ? { width, height } : undefined;
}

function defaultWorkflow(model: string): ComfyWorkflow {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
      seed: 0, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1 } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "" } },
  };
}

function parseWorkflow(json: string | null | undefined, model: string): Record<string, unknown> {
  if (json === null || json === undefined || json === "") return defaultWorkflow(model);
  if (typeof json !== "string" || Buffer.byteLength(json) > MAX_WORKFLOW_BYTES) return invalid();
  try {
    const parsed = object(JSON.parse(json));
    if (parsed) return parsed;
  } catch { /* errors never echo raw workflow */ }
  return invalid();
}

function link(value: unknown): value is ComfyLink {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && nodeId.test(value[0]) &&
    Number.isInteger(value[1]) && value[1] >= 0 && value[1] < 64;
}

function ensureAcyclic(graph: Record<string, unknown>): void {
  const visiting = new Set<string>(), done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id) || !Object.hasOwn(graph, id)) return invalid();
    if (done.has(id)) return;
    const inputs = object(object(graph[id])?.inputs);
    if (!inputs) return invalid();
    visiting.add(id);
    for (const value of Object.values(inputs)) {
      if (link(value)) visit(value[0]);
      else if (typeof value !== "string" && typeof value !== "boolean" &&
        (typeof value !== "number" || !Number.isFinite(value))) return invalid();
    }
    visiting.delete(id);
    done.add(id);
  }
  for (const id of Object.keys(graph)) visit(id);
}

export function buildComfyWorkflow(input: {
  relay: SceneImageRelay; prompt: string; uploads: ComfyReferencePaths; outputPrefix: string;
}): { workflow: ComfyWorkflow; outputIds: string[] } {
  const { relay, prompt, uploads, outputPrefix } = input;
  if (!/^mirrai_[a-f0-9]{32}$/.test(outputPrefix) || !safeModelName(relay.model)) return invalid();
  const source = parseWorkflow(relay.workflowJson, relay.model);
  const entries = Object.entries(source);
  if (!entries.length || entries.length > NODE_LIMIT) return invalid();
  // Check submitted links before any trusted overrides can remove them.
  ensureAcyclic(source);
  const custom = new Set((process.env.MIRRAI_COMFYUI_ALLOWED_NODE_TYPES ?? "").split(/[,\s]+/).filter(Boolean));
  const extra = object(relay.extraConfig);
  const mapping = object(extra?.nodeMapping);
  const explicitRefs = object(extra?.referenceNodes);
  const legacyRoleKeys = { persona: "loadImageNodeId", user: "userLoadImageNodeId", env: "envLoadImageNodeId" } as const;
  const bindings = new Map<string, SceneImageReferenceRole>();
  const bind = (id: string, role: SceneImageReferenceRole) => {
    if (bindings.has(id) && bindings.get(id) !== role) return badReference();
    bindings.set(id, role);
  };
  for (const role of referenceRoles) {
    const ids = [explicitRefs?.[role], mapping?.[legacyRoleKeys[role]]].filter(value => value !== undefined);
    if (ids.some(id => typeof id !== "string" || !nodeId.test(id)) || new Set(ids).size > 1) return badReference();
    for (const id of ids) bind(id as string, role);
    if (uploads[role] && !new RegExp(`^mirrai/[a-f0-9]{32}-${role}[.](?:png|jpg|webp)$`).test(uploads[role])) return badReference();
  }
  const workflow: ComfyWorkflow = Object.create(null);
  const outputs: string[] = [], promptIds = new Set<string>(), modelIds: string[] = [];
  const dimensions = parseSceneImageDimensions(relay.size);
  for (const [id, raw] of entries) {
    const node = object(raw), type = node?.class_type, sourceInputs = object(node?.inputs);
    if (!nodeId.test(id) || specialKeys.has(id) || typeof type !== "string" || !sourceInputs ||
      (!builtins.has(type) && (!custom.has(type) || unsafeClass.test(type)))) return invalid();
    const inputs: Record<string, Value> = Object.create(null);
    for (const [key, value] of Object.entries(sourceInputs)) {
      if (!inputId.test(key) || specialKeys.has(key)) return invalid();
      if (type === "LoadImage" && key === "image") {
        if (typeof value !== "string") return badReference();
        const role = referenceRoles.find(candidate => value === `{{${candidate}}}`);
        if (role) bind(id, role);
        else if (value && !/^[A-Za-z0-9_.-]{1,180}$/.test(value)) return badReference();
        continue;
      }
      if (type === "SaveImage" && key === "filename_prefix") continue;
      const modelInput = Object.hasOwn(modelInputs, type) && modelInputs[type].includes(key);
      if (modelInput) {
        if (!safeModelName(value)) return invalid();
      } else if (externalKey.test(key) || key === "filename_prefix") return invalid();
      else if (link(value)) {
        inputs[key] = value;
        continue;
      } else if (mediaKey.test(key)) return invalid();
      if (typeof value === "string") {
        const textInput = /^(?:text|prompt|instruction|clip_l|t5xxl)$/i.test(key);
        if (value.length > 12_000 || (!textInput && !modelInput && (/[\/:]/.test(value) || value.includes(String.fromCharCode(92))))) return invalid();
        if (textInput && (value === "{{prompt}}" || mapping?.positivePromptNodeId === id)) {
          inputs[key] = prompt;
          promptIds.add(id);
        } else inputs[key] = value;
      } else if (typeof value === "boolean") inputs[key] = value;
      else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
        if ((key === "steps" && (!Number.isInteger(value) || value < 1 || value > 100)) ||
          ((key === "width" || key === "height") && (!Number.isInteger(value) || value < 64 || value > 2048)) ||
          (key === "batch_size" && value !== 1)) return invalid();
        inputs[key] = value;
      } else return invalid();
    }
    if (type === "CheckpointLoaderSimple" || type === "UNETLoader") modelIds.push(id);
    if (type === "KSampler" || type === "KSamplerAdvanced" || type === "RandomNoise") {
      const key = type === "RandomNoise" ? "noise_seed" : Object.hasOwn(inputs, "noise_seed") ? "noise_seed" : "seed";
      inputs[key] = randomInt(0x1_0000_0000);
    }
    if (type === "EmptyLatentImage" || type === "EmptySD3LatentImage") {
      if (dimensions) { inputs.width = dimensions.width; inputs.height = dimensions.height; }
      inputs.batch_size = 1;
    }
    if (type === "SaveImage") {
      if (!link(inputs.images)) return invalid();
      inputs.filename_prefix = outputPrefix;
      outputs.push(id);
    }
    workflow[id] = { class_type: type, inputs };
  }
  const used = new Set<SceneImageReferenceRole>();
  for (const [id, node] of Object.entries(workflow)) {
    if (node.class_type !== "LoadImage") { if (bindings.has(id)) return badReference(); continue; }
    const role = bindings.get(id), path = role && uploads[role];
    if (!role || !path || used.has(role)) return badReference();
    used.add(role);
    node.inputs.image = path;
  }
  if (bindings.size !== used.size || referenceRoles.some(role => Boolean(uploads[role]) !== used.has(role))) return badReference();
  const modelId = mapping?.modelNodeId ?? (modelIds.length === 1 ? modelIds[0] : undefined);
  if (typeof modelId !== "string" || !modelIds.includes(modelId)) return invalid();
  const model = workflow[modelId];
  model.inputs[model.class_type === "UNETLoader" ? "unet_name" : "ckpt_name"] = relay.model;
  if (!promptIds.size) {
    const positiveLinks = Object.values(workflow).map(node => node.inputs.positive).filter(link);
    const ids = new Set(positiveLinks.map(value => value[0]));
    if (ids.size === 1) {
      const positive = workflow[Array.from(ids)[0]];
      if (positive?.class_type === "CLIPTextEncode" && typeof positive.inputs.text === "string") {
        positive.inputs.text = prompt;
        promptIds.add(Array.from(ids)[0]);
      }
    }
  }
  if (!promptIds.size || (mapping?.positivePromptNodeId !== undefined && !promptIds.has(String(mapping.positivePromptNodeId))) || !outputs.length) return invalid();
  ensureAcyclic(workflow);
  const reachable = new Set<string>();
  function trace(id: string) {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const value of Object.values(workflow[id].inputs)) if (link(value)) trace(value[0]);
  }
  for (const id of outputs) trace(id);
  if (!reachable.has(modelId) || !Array.from(promptIds).some(id => reachable.has(id))) return invalid();
  if (Array.from(bindings.keys()).some(id => !reachable.has(id))) return badReference();
  return { workflow, outputIds: outputs };
}
