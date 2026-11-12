export type SceneImageProtocol = "auto" | "openai" | "google_gemini" | "comfyui";
export type ResolvedSceneImageProtocol = Exclude<SceneImageProtocol, "auto">;
export type SceneImageMimeType = "image/png" | "image/jpeg" | "image/webp";
export type SceneImageReferenceRole = "persona" | "user" | "env";
export type SceneImageReferenceMode = "no_reference" | "openai_edit" | "grok_single_image_edit" |
  "grok_multi_image_edit" | "gemini_inline" | "comfyui_workflow";

export interface SceneImageRelay {
  id?: number | null;
  relayName: string;
  baseUrl: string;
  protocol: SceneImageProtocol;
  model: string;
  size: string;
  timeoutMs: number;
  apiKey?: string | null;
  workflowJson?: string | null;
  formalReferenceEnabled: boolean;
  extraConfig?: Record<string, unknown> | null;
}

export interface SceneImageReference {
  role: SceneImageReferenceRole;
  buffer: Buffer;
  mimeType: SceneImageMimeType;
  key?: string;
}

export interface GenerateSceneImageInput {
  relay: SceneImageRelay;
  prompt: string;
  references: readonly SceneImageReference[];
  signal?: AbortSignal;
}

export interface GeneratedSceneImage {
  buffer: Buffer;
  mimeType: SceneImageMimeType;
  referenceMode: SceneImageReferenceMode;
  providerJobId?: string;
}

export interface SceneImageModel { id: string; label: string; }
export interface ListSceneImageModelsInput { relay: SceneImageRelay; signal?: AbortSignal; }

export type SceneImageProviderErrorCode = "invalid_config" | "unsupported_reference" | "timeout" | "cancelled" |
  "network_error" | "invalid_response" | "response_too_large" | "content_policy" | "http_4xx" | "unknown";

export class SceneImageProviderError extends Error {
  constructor(public readonly code: SceneImageProviderErrorCode, message: string,
    public readonly safeToSwitch = false, public readonly status?: number) {
    super(message);
    this.name = "SceneImageProviderError";
  }
}
