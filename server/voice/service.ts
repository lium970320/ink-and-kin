import { TRPCError } from "@trpc/server";
import { getVoiceSecretConfig, isVoiceConfigCurrent, VoiceConfigError } from "./config";
import { normalizeAudio, AudioNormalizationError } from "./audio-normalizer";
import { transcribeAudio, VoiceTranscriptionError, MAX_VOICE_UPLOAD_BYTES } from "./asr";

export function decodeVoiceBase64(value: string): Buffer {
  if (!value || value.length > Math.ceil(MAX_VOICE_UPLOAD_BYTES / 3) * 4 || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "录音数据无效或超过 8 MiB。" });
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length || buffer.length > MAX_VOICE_UPLOAD_BYTES || buffer.toString("base64") !== value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "录音数据无效或超过 8 MiB。" });
  }
  return buffer;
}
export async function transcribeForUser(userId: number, buffer: Buffer, signal?: AbortSignal, expectedConfigRevision?: number) {
  signal?.throwIfAborted();
  const config = await getVoiceSecretConfig(userId);
  if (expectedConfigRevision !== undefined && config.revision !== expectedConfigRevision) throw new TRPCError({ code: "CONFLICT", message: "语音设置已变化，请重新录音。" });
  if (!config.asrEnabled || !config.apiKey) throw new VoiceTranscriptionError("INVALID_CONFIG");
  const audio = await normalizeAudio({ buffer, signal });
  signal?.throwIfAborted();
  if (!await isVoiceConfigCurrent(userId, config.revision)) throw new TRPCError({ code: "CONFLICT", message: "语音设置已变化，请重新录音。" });
  const transcription = await transcribeAudio({ config, audio, signal });
  signal?.throwIfAborted();
  if (!await isVoiceConfigCurrent(userId, config.revision)) throw new TRPCError({ code: "CONFLICT", message: "语音设置已变化，请重新录音。" });
  return { transcription, audio, configRevision: config.revision };
}
export function voiceFailure(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "语音操作已取消。" });
  if (error instanceof TRPCError) throw error;
  if (error instanceof VoiceConfigError) throw new TRPCError({ code: error.code, message: error.message });
  if (error instanceof VoiceTranscriptionError || error instanceof AudioNormalizationError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "语音处理失败，请稍后重试或改发文字。" });
}
