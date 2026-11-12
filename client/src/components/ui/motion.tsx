import { cn } from "@/lib/utils";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import * as React from "react";
import { createPortal } from "react-dom";

/**
 * 全站统一的物理弹簧与缓动参数
 * 阻尼比控制在 0.86 ~ 0.96，兼具敏捷响应与静奢克制的落定感，无廉价果冻回弹。
 */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 440,
  damping: 34,
  mass: 0.75,
};

export const SPRING_SILKY: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 32,
  mass: 0.88,
};

export const SPRING_GENTLE: Transition = {
  type: "spring",
  stiffness: 250,
  damping: 28,
  mass: 0.95,
};

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// ─── 引用计数滚动锁定 & 顶层栈式 ESC 关闭（防多层弹窗误关 & 中文输入法保护） ───

let scrollLockCount = 0;
let savedBodyOverflow = "";

export function useBodyScrollLock(locked: boolean) {
  React.useEffect(() => {
    if (!locked || typeof document === "undefined") return;
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [locked]);
}

const escapeStack: Array<() => void> = [];
let escapeListenerBound = false;

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (e.defaultPrevented) return;
  if (e.isComposing || e.keyCode === 229) return;
  const topHandler = escapeStack[escapeStack.length - 1];
  if (topHandler) {
    e.stopPropagation();
    topHandler();
  }
}

export function useEscapeClose(enabled: boolean, onClose: () => void) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const callback = () => onCloseRef.current();
    escapeStack.push(callback);
    if (!escapeListenerBound) {
      window.addEventListener("keydown", handleGlobalKeyDown);
      escapeListenerBound = true;
    }
    return () => {
      const idx = escapeStack.lastIndexOf(callback);
      if (idx !== -1) escapeStack.splice(idx, 1);
      if (escapeStack.length === 0 && escapeListenerBound) {
        window.removeEventListener("keydown", handleGlobalKeyDown);
        escapeListenerBound = false;
      }
    };
  }, [enabled]);
}

// 模态层进入后约束键盘焦点，关闭时回到触发控件；嵌套层仅处理最上层。
const focusLayers: HTMLElement[] = [];
function useModalFocus(open: boolean, ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    if (!open || !ref.current) return;
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusLayers.push(root);
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'));
    const focusFirst = () => (items()[0] ?? root).focus({ preventScroll: true });
    focusFirst();
    const onKey = (event: KeyboardEvent) => {
      if (focusLayers.at(-1) !== root || event.key !== 'Tab') return;
      const list = items();
      const first = list[0], last = list.at(-1);
      if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (focusLayers.at(-1) === root && !root.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      const wasTop = focusLayers.at(-1) === root;
      const index = focusLayers.indexOf(root);
      if (index >= 0) focusLayers.splice(index, 1);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (wasTop && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
}

// ─── MotionModal（居中弹簧模态框，Portal 直挂 body，避开任何包含块污染） ───

export interface MotionModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  lockScroll?: boolean;
  zIndexClassName?: string;
  ariaLabel?: string;
}

export function MotionModal({
  open,
  onClose,
  children,
  className,
  containerClassName,
  overlayClassName,
  closeOnBackdrop = true,
  closeOnEsc = true,
  lockScroll = true,
  zIndexClassName = "z-50",
  ariaLabel,
}: MotionModalProps) {
  const focusRef = React.useRef<HTMLDivElement>(null);
  useModalFocus(open, focusRef);
  useBodyScrollLock(open && lockScroll);
  useEscapeClose(open && closeOnEsc, onClose);
  const mouseDownOnBackdrop = React.useRef(false);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 flex items-center justify-center p-4 sm:p-6",
            zIndexClassName,
            containerClassName
          )}
          ref={focusRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onMouseDown={e => {
            mouseDownOnBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={e => {
            if (closeOnBackdrop && mouseDownOnBackdrop.current && e.target === e.currentTarget) {
              onClose();
            }
            mouseDownOnBackdrop.current = false;
          }}
        >
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "fixed inset-0 bg-black/45 backdrop-blur-md pointer-events-none",
              overlayClassName
            )}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={SPRING_SILKY}
            onClick={e => e.stopPropagation()}
            className={cn(
              "relative z-10 w-full max-w-lg rounded-3xl border border-border/75 bg-card/96 text-card-foreground shadow-2xl backdrop-blur-2xl",
              className
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ─── MotionDrawer（侧滑 / 底滑弹簧抽屉，支持丝滑退场） ───

export interface MotionDrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "right" | "left" | "bottom";
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  lockScroll?: boolean;
  zIndexClassName?: string;
  ariaLabel?: string;
}

export function MotionDrawer({
  open,
  onClose,
  side = "right",
  children,
  className,
  overlayClassName,
  closeOnBackdrop = true,
  closeOnEsc = true,
  lockScroll = true,
  zIndexClassName = "z-50",
  ariaLabel,
}: MotionDrawerProps) {
  const focusRef = React.useRef<HTMLDivElement>(null);
  useModalFocus(open, focusRef);
  useBodyScrollLock(open && lockScroll);
  useEscapeClose(open && closeOnEsc, onClose);
  const mouseDownOnBackdrop = React.useRef(false);

  if (typeof document === "undefined") return null;

  const variants =
    side === "bottom"
      ? {
          initial: { y: "100%", opacity: 0.85 },
          animate: { y: 0, opacity: 1 },
          exit: { y: "100%", opacity: 0.85 },
        }
      : side === "left"
        ? {
            initial: { x: "-100%", opacity: 0.85 },
            animate: { x: 0, opacity: 1 },
            exit: { x: "-100%", opacity: 0.85 },
          }
        : {
            initial: { x: "100%", opacity: 0.85 },
            animate: { x: 0, opacity: 1 },
            exit: { x: "100%", opacity: 0.85 },
          };

  const placementClass =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[88vh] w-full rounded-t-3xl border-t"
      : side === "left"
        ? "inset-y-0 left-0 h-full w-full max-w-md border-r"
        : "inset-y-0 right-0 h-full w-full max-w-md border-l";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn("fixed inset-0", zIndexClassName)}
          ref={focusRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onMouseDown={e => {
            mouseDownOnBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={e => {
            if (closeOnBackdrop && mouseDownOnBackdrop.current && e.target === e.currentTarget) {
              onClose();
            }
            mouseDownOnBackdrop.current = false;
          }}
        >
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={cn(
              "fixed inset-0 bg-black/40 backdrop-blur-sm pointer-events-none",
              overlayClassName
            )}
          />
          <motion.div
            initial={variants.initial}
            animate={variants.animate}
            exit={variants.exit}
            transition={SPRING_SILKY}
            onClick={e => e.stopPropagation()}
            className={cn(
              "fixed z-10 flex flex-col border-border/75 bg-card/96 text-card-foreground shadow-2xl backdrop-blur-2xl",
              placementClass,
              className
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ─── MotionPopover（锚点弹出小菜单/气泡浮层动画） ───

export interface MotionPopoverProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  direction?: "up" | "down";
}

export function MotionPopover({
  open,
  children,
  className,
  direction = "down",
}: MotionPopoverProps) {
  const offset = direction === "up" ? 8 : -8;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: offset }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: offset * 0.6 }}
          transition={SPRING_SNAPPY}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── SegmentedControl（带共享 layoutId 物理弹簧滑块的分段胶囊选择器） ───

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  layoutId?: string;
  size?: "xs" | "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  pillClassName?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  layoutId,
  size = "sm",
  fullWidth = false,
  className,
  pillClassName,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const autoId = React.useId();
  const resolvedLayoutId = layoutId ?? `seg-pill-${autoId}`;

  const sizeStyles =
    size === "xs"
      ? "h-7 px-2.5 text-[11px] rounded-lg gap-1"
      : size === "md"
        ? "h-9 px-4 text-sm rounded-xl gap-1.5"
        : "h-8 px-3 text-xs rounded-lg gap-1.5";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border border-border/60 bg-muted/65 p-1 backdrop-blur-sm",
        fullWidth && "flex w-full",
        className
      )}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            title={option.title}
            aria-pressed={active}
            onClick={() => {
              if (!option.disabled && option.value !== value) {
                onChange(option.value);
              }
            }}
            className={cn(
              "relative inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-45",
              sizeStyles,
              fullWidth && "flex-1",
              active
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground/85"
            )}
          >
            {active && (
              <motion.span
                layoutId={resolvedLayoutId}
                transition={SPRING_SNAPPY}
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-[inherit] border border-border/60 bg-card shadow-xs dark:border-border/50 dark:bg-card/95",
                  pillClassName
                )}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {option.icon}
              <span>{option.label}</span>
              {option.badge !== undefined && option.badge !== null && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] leading-tight font-medium tabular-nums transition-colors",
                    active
                      ? "bg-primary/12 text-primary"
                      : "bg-foreground/6 text-muted-foreground"
                  )}
                >
                  {option.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── CollapseSection（基于 CSS Grid 0fr -> 1fr 的真实高度丝滑折叠容器） ───

export interface CollapseSectionProps {
  open: boolean;
  id?: string;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function CollapseSection({
  open,
  id,
  children,
  className,
  innerClassName,
}: CollapseSectionProps) {
  return (
    <div
      id={id}
      className={cn("collapse-grid", className)}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={cn(!open && "pointer-events-none", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
