import { useRef, useState } from "react";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProactiveJob, ProactiveKind, ProactiveStatus } from "../../../server/proactive/types";

const KIND_LABELS: Record<ProactiveKind, string> = { scheduled: "定时问候", followup: "回访", ambient: "大厅存在感" };
const STATUS_LABELS: Record<ProactiveStatus, string> = {
  pending: "待处理", generating: "生成中", ready: "待派发", confirmed: "已确认",
  failed: "失败", unknown: "结果未知", cancelled: "已取消", expired: "已过期",
};
const REMINDER_LABELS: Record<string, string> = {
  anniversary: "纪念日", together_years: "相识周年", memory_trigger: "旧图提醒",
};
const REMINDER_CHANNELS: Record<string, string> = { web: "站内", wechat: "微信", feishu: "飞书", qq: "QQ（历史）" };

function reminderReceipt(reminder: { channel: string; status?: string | null }) {
  if (reminder.status === "confirmed") return reminder.channel === "web" ? "已保存" : "接口返回成功";
  if (reminder.status === "failed") return "交付失败";
  if (reminder.status === "unknown") return "结果未知，不会自动重发";
  return "历史提示";
}

function formatLocal(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function localInputDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return local === value ? date : null;
}

function mayCancel(job: Pick<ProactiveJob, "attemptedAt" | "status" | "unknownAcknowledgedAt" | "cancelRequestedAt">) {
  if (job.cancelRequestedAt) return false;
  if (job.status === "unknown") return !job.unknownAcknowledgedAt;
  return !job.attemptedAt && ["pending", "generating", "ready"].includes(job.status);
}

export default function ProactivePanel({ personaId }: { personaId: number }) {
  const utils = trpc.useUtils();
  const jobs = trpc.proactive.list.useQuery({ personaId });
  const reminders = trpc.reminder.list.useQuery();
  const create = trpc.proactive.createFollowup.useMutation({ retry: false });
  const cancel = trpc.proactive.cancel.useMutation({ retry: false });
  const markRead = trpc.proactive.markRead.useMutation({ retry: false });
  const acknowledge = trpc.proactive.acknowledgeUnknown.useMutation({ retry: false });
  const dismiss = trpc.reminder.dismiss.useMutation({ retry: false });
  const [topic, setTopic] = useState("");
  const [localTime, setLocalTime] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reminderFeedback, setReminderFeedback] = useState("");
  const inFlight = useRef(false);
  const followup = useRef<{ signature: string; operationId: string } | null>(null);
  const dismissing = useRef(false);
  const busy = create.isPending || cancel.isPending || markRead.isPending || acknowledge.isPending;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "浏览器本地时间";
  const personaReminders = (reminders.data ?? []).filter(reminder => reminder.personaId === personaId);

  async function createFollowup() {
    if (inFlight.current || !topic.trim()) return;
    const due = localInputDate(localTime);
    if (!due || due.getTime() <= Date.now()) {
      setFeedback("请选择有效且晚于当前时间的浏览器本地日期与时间。");
      return;
    }
    const dueAt = due.toISOString();
    const expiresAt = new Date(due.getTime() + 15 * 60_000).toISOString();
    const signature = JSON.stringify([personaId, topic.trim(), dueAt, expiresAt]);
    if (followup.current?.signature !== signature) followup.current = { signature, operationId: crypto.randomUUID() };
    inFlight.current = true;
    setFeedback("");
    try {
      await create.mutateAsync({ personaId, topic: topic.trim(), dueAt, expiresAt, operationId: followup.current.operationId });
      followup.current = null;
      setTopic("");
      setLocalTime("");
      setFeedback("回访已排程，尚未发送。");
      void utils.proactive.list.invalidate({ personaId });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "未能创建回访。");
    } finally {
      inFlight.current = false;
    }
  }

  async function updateJob(jobId: number, action: "cancel" | "read" | "acknowledge") {
    if (inFlight.current) return;
    const job = jobs.data?.find(item => item.id === jobId);
    const unknown = job?.status === "unknown";
    if (action === "cancel") {
      if (!job || !mayCancel(job)) return;
      if (unknown && !window.confirm("尚未开始的发送会被拦住；已开始或结果不明的请求不能撤回。确定请求停止派发？")) return;
    }
    if (action === "acknowledge" && !window.confirm("请先自行到 QQ 核对是否收到这条消息。确认后只允许后续任务继续，不会重发本条，也不会改变本条的未知状态。确定已核对？")) return;
    inFlight.current = true;
    setFeedback("");
    try {
      if (action === "cancel") {
        const result = await cancel.mutateAsync({ personaId, jobId });
        setFeedback(result.cancelled ? "取消请求已记录。"
          : unknown ? "该记录已无法请求停止；若仍为结果未知，请使用核对功能。"
          : "任务状态已变化，不能再取消。");
      } else if (action === "read") {
        await markRead.mutateAsync({ personaId, jobId });
        setFeedback("已标为已读。");
      } else {
        const result = await acknowledge.mutateAsync({ personaId, jobId });
        setFeedback(result.acknowledged ? "已记录核对，允许后续任务继续；本条仍为结果未知。" : "记录状态已变化，请刷新后检查。");
      }
      void utils.proactive.list.invalidate({ personaId });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "未能更新任务。");
    } finally {
      inFlight.current = false;
    }
  }

  async function dismissReminder(id: number) {
    if (dismissing.current || !personaReminders.some(reminder => reminder.id === id)) return;
    dismissing.current = true;
    setReminderFeedback("");
    try {
      await dismiss.mutateAsync({ id });
      utils.reminder.list.setData(undefined, rows => rows?.filter(reminder => reminder.id !== id));
      setReminderFeedback("已隐藏该条提醒。");
      void utils.reminder.list.invalidate();
    } catch (error) {
      setReminderFeedback(error instanceof Error ? error.message : "无法隐藏该条提醒。");
    } finally {
      dismissing.current = false;
    }
  }

  return (
    <section className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 font-bold text-foreground"><Bell className="h-3.5 w-3.5 text-primary/80" />主动消息与回访</h4>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={jobs.isFetching} onClick={() => void jobs.refetch()}>刷新任务</Button>
      </div>
      <form className="space-y-2 rounded-lg border border-border/70 bg-background/40 p-3"
        onSubmit={event => { event.preventDefault(); void createFollowup(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-muted-foreground">
            <span>回访主题</span>
            <Input value={topic} onChange={event => setTopic(event.target.value)} disabled={busy} required placeholder="例如：问问地图是否整理好了" />
          </label>
          <label className="space-y-1 text-muted-foreground">
            <span>回访时间（浏览器本地）</span>
            <Input type="datetime-local" value={localTime} onChange={event => setLocalTime(event.target.value)} disabled={busy} required />
          </label>
        </div>
        <p className="text-muted-foreground">按浏览器时区 {browserZone} 换算，预定时间后 15 分钟未派发则过期。</p>
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !topic.trim() || !localTime}>
          {create.isPending ? "正在排程…" : "创建回访"}
        </Button>
      </form>
      {feedback && <p role="status" className="text-muted-foreground">{feedback}</p>}
      {jobs.isPending ? <p className="text-muted-foreground">正在读取任务…</p>
        : jobs.isError ? <p role="alert" className="text-destructive">无法读取任务，刷新后重试。</p>
        : !jobs.data?.length ? <p className="text-muted-foreground">暂无主动消息或回访记录。</p>
        : (
          <ul aria-label="最近主动消息与回访" className="max-h-72 space-y-2 overflow-y-auto">
            {jobs.data.map(job => (
              <li key={job.id} className="space-y-1.5 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  <strong>{KIND_LABELS[job.kind]}</strong>
                  <span className={job.status === "unknown" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
                    {STATUS_LABELS[job.status]}{job.status === "unknown" && job.unknownAcknowledgedAt ? " · 已人工核对" : ""}
                  </span>
                  <span className="text-muted-foreground">{job.readAt ? "已读" : "未读"}</span>
                </div>
                {job.cancelRequestedAt && <p className="text-muted-foreground">已请求停止，已开始交付仍以实际回执为准。</p>}
                <p className="text-muted-foreground">预定 {formatLocal(job.dueAt)} · 过期 {formatLocal(job.expiresAt)}</p>
                {job.topic && <p className="break-words">主题：{job.topic}</p>}
                {job.text && <p className="whitespace-pre-wrap break-words text-foreground/85">{job.text}</p>}
                <div className="flex flex-wrap gap-2">
                  {mayCancel(job) && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                    onClick={() => void updateJob(job.id, "cancel")}>{job.status === "unknown" ? "请求停止派发" : "取消待派发"}</Button>}
                  {!job.readAt && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
                    onClick={() => void updateJob(job.id, "read")}>标为已读</Button>}
                  {job.status === "unknown" && !job.unknownAcknowledgedAt && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                      onClick={() => void updateJob(job.id, "acknowledge")}>我已到 QQ 核对，允许后续任务</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-foreground">纪念日与旧图提醒</h4>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={reminders.isFetching}
            onClick={() => void reminders.refetch()}>刷新提醒</Button>
        </div>
        <p className="text-muted-foreground">只显示账号最近提醒中属于当前角色的记录。此类提醒现在不会通过 QQ 外发。</p>
        {reminderFeedback && <p className="text-muted-foreground" role="status">{reminderFeedback}</p>}
        {reminders.isPending ? <p className="text-muted-foreground">正在读取提醒…</p>
          : reminders.isError ? <p className="text-destructive" role="alert">无法读取提醒，刷新后重试。</p>
          : !personaReminders.length ? <p className="text-muted-foreground">当前角色暂无最近提醒。</p>
          : (
            <ul aria-label="当前角色最近提醒" className="max-h-48 space-y-2 overflow-y-auto">
              {personaReminders.map(reminder => (
                <li key={reminder.id} className="space-y-1.5 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong>{REMINDER_LABELS[reminder.kind] ?? "提醒"}</strong>
                    <span className="text-muted-foreground">{REMINDER_CHANNELS[reminder.channel] ?? "外部渠道"}</span>
                    <span className="text-muted-foreground">{reminderReceipt(reminder)}</span>
                    <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={dismiss.isPending}
                      onClick={() => void dismissReminder(reminder.id)}>隐藏</Button>
                  </div>
                  <p className="text-muted-foreground">预定 {formatLocal(reminder.scheduledFor)}
                    {reminder.deliveredAt && ` · 记录时间 ${formatLocal(reminder.deliveredAt)}`}</p>
                  {reminder.text && <p className="whitespace-pre-wrap break-words text-foreground/85">{reminder.text}</p>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
