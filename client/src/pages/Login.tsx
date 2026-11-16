import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, CheckCircle2, Leaf, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CollapseSection,
  EASE_OUT_EXPO,
  SPRING_SILKY,
  SegmentedControl,
} from "@/components/ui/motion";
import { trpc } from "@/lib/trpc";

type AuthMode = "login" | "register";

export default function Login() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/auth/config", { credentials: "include" })
      .then(async response => {
        if (!response.ok) return null;
        return response.json() as Promise<{ registrationEnabled?: unknown }>;
      })
      .then(config => {
        if (cancelled || typeof config?.registrationEnabled !== "boolean") return;
        setRegistrationEnabled(config.registrationEnabled);
        if (!config.registrationEnabled) setIsRegister(false);
      })
      .catch(() => {
        // 未取得配置时只显示登录入口。
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function switchMode(mode: AuthMode) {
    setIsRegister(mode === "register");
    setError("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (isRegister && confirmPassword.length > 0 && confirmPassword !== password) {
      setError("两次输入的密码不一致，请核对后重试");
      return;
    }

    setLoading(true);

    try {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }

      await utils.auth.me.invalidate();
      navigate("/");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  const usernameValid = username.trim().length >= 2;
  const passwordValid = password.length >= 6;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* 温润静奢双层柔和环境光晕 */}
      <div className="gradient-mesh-bg opacity-70" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[38rem] h-[38rem] rounded-full bg-primary/[0.07] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-36 right-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/[0.05] blur-3xl"
      />

      {/* 顶部左上角安静返回入口 */}
      <div className="fixed top-4 left-4 sm:top-6 sm:left-6 z-20">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="app-nav-back inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border/60 hover:bg-card/70 backdrop-blur-md transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回首页</span>
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_SILKY}
        className="w-full max-w-[24.5rem] relative z-10"
      >
        {/* 品牌抬头 */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-card/90 border border-border/70 shadow-sm backdrop-blur-md mb-4">
            <Leaf className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">书中人</h1>
          <div className="h-5 mt-1.5 flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={isRegister ? "reg-sub" : "login-sub"}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                className="text-muted-foreground text-sm"
              >
                {isRegister ? "创建专属账号，安放珍贵记忆" : "欢迎回来，继续未完的对话"}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* 静奢居中认证卡片 */}
        <div className="warm-card warm-card-static rounded-3xl border border-border/70 bg-card/90 p-6 sm:p-7 shadow-xl backdrop-blur-xl">
          {registrationEnabled && (
            <div className="mb-5">
              <SegmentedControl<AuthMode>
                fullWidth
                size="md"
                layoutId="login-auth-mode-pill"
                ariaLabel="登录或注册模式切换"
                value={isRegister ? "register" : "login"}
                onChange={switchMode}
                options={[
                  { value: "login", label: "账号登录" },
                  { value: "register", label: "注册新账号" },
                ]}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium text-foreground/80">
                用户名
              </Label>
              <Input
                id="username"
                value={username}
                onChange={e => {
                  setUsername(e.target.value);
                  if (error) setError("");
                }}
                placeholder="输入用户名（至少 2 个字符）"
                autoComplete="username"
                className="h-10 rounded-xl bg-muted/45 border-border/70 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-primary/30"
                required
                minLength={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-foreground/80">
                密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="输入密码（至少 6 位）"
                autoComplete={isRegister ? "new-password" : "current-password"}
                className="h-10 rounded-xl bg-muted/45 border-border/70 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-primary/30"
                required
                minLength={6}
              />
            </div>

            {/* 注册附加字段与密码规范提示：丝滑高度展开 */}
            <CollapseSection open={isRegister} id="register-extra-fields">
              <div className="pt-1 pb-0.5 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs font-medium text-foreground/80">
                    确认密码 <span className="text-muted-foreground/60 font-normal">（可选核对）</span>
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={e => {
                      setConfirmPassword(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="再次输入密码以防误输"
                    autoComplete="new-password"
                    tabIndex={isRegister ? 0 : -1}
                    className="h-10 rounded-xl bg-muted/45 border-border/70 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-primary/30"
                  />
                </div>

                <div className="rounded-xl bg-muted/40 border border-border/55 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-3 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 transition-colors ${
                        usernameValid ? "text-primary font-medium" : "text-muted-foreground"
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      用户名 ≥ <span className="font-mono tabular-nums">2</span> 位
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 transition-colors ${
                        passwordValid ? "text-primary font-medium" : "text-muted-foreground"
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      密码 ≥ <span className="font-mono tabular-nums">6</span> 位
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary/75 shrink-0" />
                    记忆资料按账号隔离，请妥善保管登录凭据
                  </p>
                </div>
              </div>
            </CollapseSection>

            {/* 错误提示条：丝滑高度展开与淡入 */}
            <CollapseSection open={Boolean(error)} id="auth-error-banner">
              <div className="pt-0.5">
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.08] px-3.5 py-2.5 text-xs text-destructive"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              </div>
            </CollapseSection>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium shadow-xs transition-all"
            >
              <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                  <motion.span
                    key="submitting"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    className="inline-flex items-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isRegister ? "正在创建账号..." : "正在验证身份..."}</span>
                  </motion.span>
                ) : (
                  <motion.span
                    key={isRegister ? "submit-register" : "submit-login"}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                  >
                    {isRegister ? "创建账号并进入" : "进入空间"}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </form>
        </div>

        {registrationEnabled && (
          <p className="text-center text-muted-foreground text-xs mt-5">
            {isRegister ? "已经拥有账号？" : "还没有专属账号？"}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? "login" : "register")}
              className="text-primary hover:text-primary/80 ml-1 font-medium transition-colors"
            >
              {isRegister ? "切换至登录" : "立即注册"}
            </button>
          </p>
        )}
      </motion.div>
    </div>
  );
}
