import { useEffect, useId, useState, type FormEvent } from "react";
import { Mic, RotateCcw, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

type VoiceSettingsView = {
  asrEnabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  ttsEnabled: boolean;
  revision: number;
  apiKeyConfigured: boolean;
  maxDurationSeconds: number;
};

const fromSaved = (saved: VoiceSettingsView) => ({
  saved,
  asrEnabled: saved.asrEnabled,
  baseUrl: saved.baseUrl,
  model: saved.model,
  timeoutMs: String(saved.timeoutMs),
  ttsEnabled: saved.ttsEnabled,
  apiKey: "",
  clearKey: false,
});

function compareBaseUrl(value: string) {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    if (!url.username && !url.password && !url.search && !url.hash) {
      return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/audio\/transcriptions$/, "").replace(/\/+$/, "");
    }
  } catch { /* Keep invalid draft text distinct from the saved URL. */ }
  return input;
}

export function VoiceSettingsCard() {
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.voiceConfig.get.useQuery();
  const save = trpc.voiceConfig.save.useMutation({ retry: false });
  const [draft, setDraft] = useState<ReturnType<typeof fromSaved> | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(current => current ?? fromSaved(query.data!));
  }, [query.data]);

  const stale = Boolean(draft && query.data && query.data.revision > draft.saved.revision) || conflict;
  const urlChanged = Boolean(draft && compareBaseUrl(draft.baseUrl) !== draft.saved.baseUrl);

  const reload = async () => {
    setReloading(true);
    setError("");
    try {
      const result = await query.refetch({ throwOnError: true });
      if (!result.data) throw new Error("无法读取已保存的语音设置。");
      setDraft(fromSaved(result.data));
      setConflict(false);
    } catch {
      setError("读取最新语音设置失败，当前草稿已保留。");
    } finally {
      setReloading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || stale || save.isPending || reloading) return;
    setError("");
    const timeoutMs = Number(draft.timeoutMs);
    const key = draft.apiKey.trim();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
      setError("转写超时须为 1000 至 120000 毫秒。");
      return;
    }
    if (urlChanged && draft.saved.apiKeyConfigured && !key && !draft.clearKey) {
      setError("更换服务地址时，请重新输入密钥或明确清除已保存的密钥。");
      return;
    }
    if (draft.asrEnabled && (!draft.baseUrl.trim() || !draft.model.trim()
      || draft.clearKey || (!key && !draft.saved.apiKeyConfigured))) {
      setError("启用语音转写前，请填写服务地址、模型和密钥。");
      return;
    }
    try {
      const saved = await save.mutateAsync({
        expectedRevision: draft.saved.revision,
        settings: {
          asrEnabled: draft.asrEnabled, baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(), timeoutMs, ttsEnabled: draft.ttsEnabled,
        },
        ...(draft.clearKey ? { apiKey: null } : key ? { apiKey: key } : {}),
      });
      utils.voiceConfig.get.setData(undefined, saved);
      setDraft(fromSaved(saved));
      toast.success("语音设置已保存。");
    } catch (failure) {
      if ((failure as { data?: { code?: string } } | null)?.data?.code === "CONFLICT") {
        setConflict(true);
      } else {
        setError(failure instanceof Error ? failure.message : "无法保存语音设置。");
      }
    } finally {
      save.reset();
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Mic className="h-4 w-4 text-primary" /> 聊天语音
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          发送录音会把音频提交到你配置的转写服务。每段最多 {draft?.saved.maxDurationSeconds ?? 30} 秒、8 MiB，转写成功后才会用于对话。
        </p>
      </div>
      {!draft && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{query.isError ? "暂时无法读取语音设置。" : "正在读取语音设置…"}</span>
          {query.isError && <Button type="button" size="sm" variant="outline" disabled={reloading} onClick={() => void reload()}>重新读取</Button>}
        </div>
      )}
      {draft && (
        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          <fieldset disabled={save.isPending || reloading} className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/35 p-3">
              <Label htmlFor={id + "-asr"}>启用录音转写</Label>
              <Switch id={id + "-asr"} checked={draft.asrEnabled}
                onCheckedChange={asrEnabled => setDraft({ ...draft, asrEnabled })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={id + "-url"}>转写服务地址</Label>
                <Input id={id + "-url"} inputMode="url" value={draft.baseUrl} maxLength={2000}
                  onChange={event => setDraft({ ...draft, baseUrl: event.target.value })}
                  placeholder="https://你的服务地址/v1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id + "-model"}>转写模型</Label>
                <Input id={id + "-model"} value={draft.model} maxLength={160}
                  onChange={event => setDraft({ ...draft, model: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id + "-key"}>转写密钥</Label>
                <Input id={id + "-key"} type="password" autoComplete="new-password" maxLength={512}
                  value={draft.apiKey} disabled={draft.clearKey}
                  onChange={event => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder={draft.saved.apiKeyConfigured ? "密钥已保存" : "未配置密钥"} />
                {draft.saved.apiKeyConfigured && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={draft.clearKey}
                      onChange={event => setDraft({ ...draft, clearKey: event.target.checked, apiKey: "" })} />
                    保存时清除已保存的密钥
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  {urlChanged && draft.saved.apiKeyConfigured
                    ? "服务地址已变更，请重填密钥；若要清除原密钥，需同时关闭转写。"
                    : "密钥加密保存。留空会保留已保存的密钥。"}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id + "-timeout"}>转写超时（毫秒）</Label>
                <Input id={id + "-timeout"} type="number" min={1000} max={120000} step={1}
                  value={draft.timeoutMs} onChange={event => setDraft({ ...draft, timeoutMs: event.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/35 p-3">
              <div className="space-y-1">
                <Label htmlFor={id + "-tts"} className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-primary" /> 允许手动朗读
                </Label>
                <p className="text-xs text-muted-foreground">点击聊天消息的朗读按钮时才会生成音频。此开关不会启用 QQ 自动播报。</p>
              </div>
              <Switch id={id + "-tts"} checked={draft.ttsEnabled}
                onCheckedChange={ttsEnabled => setDraft({ ...draft, ttsEnabled })} />
            </div>
          </fieldset>
          {stale && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>已保存的设置有变更。当前草稿已保留，请核对后重载。</span>
              <Button type="button" variant="outline" size="sm" disabled={reloading || save.isPending}
                onClick={() => { if (window.confirm("重载已保存的设置会丢弃当前草稿，是否继续？")) void reload(); }}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重载已保存的设置
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending || reloading || stale}>
              {save.isPending ? "正在保存…" : "保存语音设置"}
            </Button>
            <span className="text-xs text-muted-foreground">保存设置时不会连接转写服务。</span>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

export default VoiceSettingsCard;
