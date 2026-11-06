import type { DbTransaction } from "../../db";
import type { QqConfig } from "./core";

export const QQ_RECORD_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export function readQqRecording(body: unknown): Buffer {
  const response = body as { status?: unknown; retcode?: unknown; data?: { base64?: unknown } } | null;
  const encoded = response?.status === "ok" && response.retcode === 0 ? response.data?.base64 : null;
  if (typeof encoded !== "string" || encoded.length > 4 * Math.ceil(MAX_AUDIO_BYTES / 3)
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("invalid_record_response");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES || buffer.toString("base64") !== encoded) {
    throw new Error("invalid_record_response");
  }
  return buffer;
}

export type QqVoiceReplyGuard = (tx: DbTransaction) => Promise<void>;

export type QqVoiceInbound = (input: {
  config: QqConfig;
  messageId: string;
  signal: AbortSignal;
  isCurrent(): Promise<boolean>;
  loadAudio(): Promise<Buffer>;
  reply(text: string, guard?: QqVoiceReplyGuard): Promise<void>;
}) => Promise<boolean>;

type VoiceDependencies<Context extends { revision: number }> = {
  handleChannel(input: Parameters<QqVoiceInbound>[0]): Promise<boolean>;
  checkRoute(config: QqConfig, expectedRevision?: number): Promise<number>;
  guardReply(tx: DbTransaction, config: QqConfig, routeRevision: number): Promise<void>;
  readContext(config: QqConfig, expectedRevision?: number): Promise<Context>;
  readVoiceConfig(userId: number): Promise<{ asrEnabled: boolean; apiKeyConfigured: boolean; revision: number }>;
  checkVoiceConfig(userId: number, revision: number): Promise<boolean>;
  transcribe(userId: number, audio: Buffer, signal: AbortSignal, revision: number): Promise<{ transcription: string; configRevision: number }>;
  chat(config: QqConfig, context: Context, transcription: string, signal: AbortSignal): Promise<string | null>;
};

export function createQqVoiceInbound<Context extends { revision: number }>(deps: VoiceDependencies<Context>): QqVoiceInbound {
  return async input => {
    const { config, signal } = input;
    if (signal.aborted || !await input.isCurrent()) return false;
    if (await deps.handleChannel(input)) return true;

    const routeRevision = await deps.checkRoute(config);
    const context = await deps.readContext(config);
    const voice = await deps.readVoiceConfig(config.userId);
    async function stillCurrent() {
      if (signal.aborted || !await input.isCurrent()) return false;
      try {
        await deps.checkRoute(config, routeRevision);
        await deps.readContext(config, context.revision);
        return await deps.checkVoiceConfig(config.userId, voice.revision) && !signal.aborted && await input.isCurrent();
      } catch { return false; }
    }
    async function reply(text: string) {
      if (!await stillCurrent()) return false;
      await input.reply(text, async tx => {
        signal.throwIfAborted();
        await deps.guardReply(tx, config, routeRevision);
      });
      return true;
    }

    if (!voice.asrEnabled || !voice.apiKeyConfigured) {
      return reply("当前未启用语音识别，请先在设置中配置，或改发文字。");
    }
    let transcription: string;
    try {
      if (!await stillCurrent()) return false;
      const audio = await input.loadAudio();
      if (!await stillCurrent()) return false;
      const result = await deps.transcribe(config.userId, audio, signal, voice.revision);
      if (result.configRevision !== voice.revision) return false;
      transcription = result.transcription.trim();
      if (!transcription || transcription.length > 8000 || transcription.includes("\x00")) throw new Error("invalid_transcription");
    } catch {
      return reply("这条语音未能识别，请重新发送语音或改发文字。");
    }

    if (!await stillCurrent()) return false;
    // Only the successful transcript goes straight to the chat pipeline, never to QQ command routing.
    const text = await deps.chat(config, context, transcription, signal);
    return text ? reply(text) : false;
  };
}
