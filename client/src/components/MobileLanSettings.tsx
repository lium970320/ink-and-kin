import { useEffect, useMemo, useState } from "react";
import { Copy, Download, QrCode, Smartphone, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBeijingDateTime } from "@/lib/beijing-time";
import { encodeQrMatrix } from "@/lib/qr-svg";
import { trpc } from "@/lib/trpc";

const DELIVERY_MODES = [
  { value: "mobile_first", label: "手机优先", description: "手机直连可用时发给手机，否则尝试人物已授权的 QQ 渠道。" },
  { value: "both", label: "手机与 QQ", description: "投递到当前在线的手机与人物已授权且可用的 QQ 渠道。" },
  { value: "qq_first", label: "QQ 优先", description: "人物已授权的 QQ 渠道可用时发往 QQ，否则尝试手机直连。" },
  { value: "mobile_only", label: "仅手机", description: "主动消息只发给已配对的手机。" },
  { value: "qq_only", label: "仅 QQ", description: "主动消息只使用人物已授权的 QQ 渠道。手机仍可手动对话。" },
] as const;

const cardClass = "warm-card warm-card-static space-y-4 rounded-2xl p-5 sm:p-6";
const selectClass = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring";

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") ||
        host === "[::1]" || host === "0.0.0.0" || host === "[::]") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function LocalQrCode({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQrMatrix(value);
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return <p role="status" className="text-sm text-muted-foreground">无法生成二维码，请使用下方地址或配对码。</p>;
  const length = qr.size + 8;
  return (
    <svg
      viewBox={`-4 -4 ${length} ${length}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="size-44 max-w-full rounded-xl border border-border bg-white"
    >
      <rect x={-4} y={-4} width={length} height={length} fill="white" />
      <path d={qr.svgPath} fill="#161412" />
    </svg>
  );
}

async function copyText(value: string) {
  if (!navigator.clipboard) {
    toast.info("当前浏览器环境不能自动复制，请选中文字手动复制。");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success("已复制");
  } catch {
    toast.info("复制失败，请选中文字手动复制。");
  }
}

type PairingCode = { code: string; expiresAt: number; origin: string };

export default function MobileLanSettings() {
  const overview = trpc.mobile.getOverview.useQuery(undefined, {
    refetchInterval: query => query.state.data?.enabled ? 5000 : false,
  });
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const data = overview.data;
  const origins = Array.from(new Set(
    (data?.lanUrls ?? []).map(normalizeOrigin).filter((origin): origin is string => origin !== null)
  ));
  const primaryOrigin = normalizeOrigin(data?.primaryLanUrl);
  const origin = origins.find(item => item === selectedOrigin) ??
    origins.find(item => item === primaryOrigin) ?? origins[0];
  const canPair = data?.enabled === true && data.isLanListening && Boolean(origin);

  const createPairing = trpc.mobile.createPairingCode.useMutation({
    onSuccess: (result, input) => {
      const requestOrigin = normalizeOrigin(input?.baseUrl);
      const expiresAt = Date.parse(result.expiresAt);
      if (!requestOrigin || !/^\d{6}$/.test(result.code) || !(expiresAt > Date.now())) {
        toast.error("服务器返回的配对码无效或已过期。");
        return;
      }
      setPairing({ code: result.code, expiresAt, origin: requestOrigin });
    },
    onError: error => toast.error(error.message),
  });
  const updateSettings = trpc.mobile.updateSettings.useMutation({
    onSuccess: async result => {
      if (result.ok) toast.success("投递方式已更新");
      await overview.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.mobile.revokeDevice.useMutation({
    onSuccess: async result => {
      setRevokeTarget(null);
      if (result.revoked) toast.success("已解除配对");
      else toast.info("该设备已解除配对或无法撤销。");
      await overview.refetch();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!pairing) return;
    const timeout = window.setTimeout(() => setPairing(null), Math.max(0, pairing.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [pairing]);

  if (overview.isPending) return <p role="status" className={cardClass}>正在读取手机直连状态…</p>;
  if (overview.isError || !data) {
    return (
      <section className={cardClass}>
        <p role="alert">无法读取手机直连状态。</p>
        <Button variant="outline" onClick={() => void overview.refetch()}>重新读取</Button>
      </section>
    );
  }
  if (!data.enabled) {
    return (
      <section className={cardClass}>
        <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-primary" />手机直连尚未启用</h2>
        <p className="text-sm text-muted-foreground">
          在服务运行环境设置 <code>APP_MOBILE_ENABLED=true</code> 后重启服务。使用局域网时还需要将 <code>APP_HOST</code> 设置为可从同一 Wi-Fi 访问的本机地址。
        </p>
      </section>
    );
  }

  const activePairing = canPair && pairing && pairing.origin === origin && pairing.expiresAt > Date.now() ? pairing : null;
  const downloadUrl = origin ? new URL("/api/mobile/download/apk", origin).href : "";
  const pairingUrl = activePairing
    ? new URL(`/api/mobile/pair/landing?code=${activePairing.code}`, activePairing.origin).href : "";
  const devices = (data.devices ?? []).filter(device => !device.revokedAt);

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <h2 className="flex items-center gap-2 font-semibold"><Wifi className="size-4 text-primary" />局域网连接</h2>
        <p className="text-sm text-muted-foreground">
          {data.isLanListening ? `已启用局域网监听，${data.onlineCount} 台已配对设备在线。` :
            "当前仅监听本机。设置 APP_HOST 为可从同一 Wi-Fi 访问的本机地址后重启服务。"}
          {" "}自动发现使用 UDP {data.discoveryPort ?? 30003}。
        </p>
        {canPair && (
          <label className="block space-y-1 text-sm">
            <span>手机连接地址</span>
            <select className={selectClass} value={origin} disabled={createPairing.isPending} onChange={event => {
              setSelectedOrigin(event.target.value);
              setPairing(null);
            }}>
              {origins.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        )}
        {data.isLanListening && !origin && <p role="status" className="text-sm text-muted-foreground">暂时没有可用于配对的地址。</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 font-semibold"><Download className="size-4 text-primary" />安装安卓客户端</h2>
          {canPair && downloadUrl && data.apk?.available ? (
            <div className="space-y-3">
              {data.apk.versionName && <p className="text-sm text-muted-foreground">版本 {data.apk.versionName}</p>}
              <LocalQrCode value={downloadUrl} label="书中人安卓安装包下载二维码" />
              <a className="block break-all text-xs text-primary underline" href={downloadUrl}>{downloadUrl}</a>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyText(downloadUrl)}>
                <Copy className="size-3.5" />复制下载地址
              </Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">{data.apk?.available ? "局域网可用后显示下载二维码。" : "当前实例尚未提供安卓安装包。已安装客户端可在局域网可用时配对。"}</p>}
        </section>
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 font-semibold"><QrCode className="size-4 text-primary" />配对手机</h2>
          {activePairing ? (
            <div className="space-y-3">
              <LocalQrCode value={pairingUrl} label="手机一次性配对二维码" />
              <p className="text-sm text-muted-foreground">也可在客户端输入一次性配对码：</p>
              <p className="select-all font-mono text-2xl font-bold tabular-nums tracking-widest">{activePairing.code}</p>
              <p className="text-xs text-muted-foreground">有效期至 {formatBeijingDateTime(activePairing.expiresAt)}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyText(activePairing.code)}>复制配对码</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">用手机扫描二维码，或在客户端输入一次性配对码。请只把配对码交给你要授权的设备。</p>}
          <Button type="button" size="sm" disabled={!canPair || !origin || createPairing.isPending}
            onClick={() => {
              if (canPair && origin) createPairing.mutate({ baseUrl: origin });
            }}>
            {createPairing.isPending ? "正在生成…" : activePairing ? "生成新配对码" : "生成配对码"}
          </Button>
        </section>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold">主动消息投递</h2>
        <label className="block space-y-1 text-sm">
          <span>当前账号的投递方式</span>
          <select
            className={selectClass}
            value={data.proactiveTargetMode}
            disabled={updateSettings.isPending}
            onChange={event => {
              const mode = DELIVERY_MODES.find(option => option.value === event.target.value);
              if (mode && mode.value !== data.proactiveTargetMode) updateSettings.mutate({ proactiveTargetMode: mode.value });
            }}
          >
            {DELIVERY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {DELIVERY_MODES.find(mode => mode.value === data.proactiveTargetMode)?.description}
        </p>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-primary" />已配对设备</h2>
        {devices.length === 0 && <p className="text-sm text-muted-foreground">暂无已配对设备。</p>}
        <ul className="space-y-2">
          {devices.map(device => (
            <li key={device.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/25 p-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{device.deviceName} · {device.online ? "在线" : "离线"}</p>
                <p className="text-xs text-muted-foreground">
                  配对 {formatBeijingDateTime(device.createdAt)} · 最近活跃 {formatBeijingDateTime(device.lastSeenAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={revokeTarget === device.id ? "destructive" : "outline"}
                  disabled={revoke.isPending} onClick={() => {
                    if (revokeTarget === device.id) revoke.mutate({ deviceId: device.id });
                    else setRevokeTarget(device.id);
                  }}>
                  {revokeTarget === device.id ? "确认解除配对" : "解除配对"}
                </Button>
                {revokeTarget === device.id && <Button type="button" size="sm" variant="ghost"
                  disabled={revoke.isPending} onClick={() => setRevokeTarget(null)}>取消</Button>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
