import { useCallback, useEffect, useRef } from "react";

/**
 * 3D 卡片微倾跟随鼠标：把返回的 ref/事件绑到带 .tilt-card 类的元素上。
 * - 触屏设备（hover: none）与 prefers-reduced-motion 自动旁路；
 * - 使用 requestAnimationFrame 合帧与尺寸缓存，避免每次 mousemove 触发同步布局重排；
 * - 同时输出柔和光泽坐标 --glare-x / --glare-y，离开时平滑回弹归零。
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(maxDeg = 3.5) {
  const ref = useRef<T | null>(null);
  const rafRef = useRef<number | null>(null);
  const rectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const canHoverRef = useRef<boolean | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<T>) => {
      const el = ref.current;
      if (!el) return;

      if (canHoverRef.current === null && typeof window !== "undefined") {
        const hoverOk = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        const motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        canHoverRef.current = hoverOk && !motionReduced;
      }
      if (!canHoverRef.current) return;

      if (!rectRef.current) {
        const r = el.getBoundingClientRect();
        rectRef.current = { left: r.left, top: r.top, width: r.width || 1, height: r.height || 1 };
      }

      const clientX = e.clientX;
      const clientY = e.clientY;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rect = rectRef.current;
        const node = ref.current;
        if (!rect || !node) return;
        const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        const px = rx - 0.5;
        const py = ry - 0.5;
        node.style.setProperty("--tilt-y", `${(px * maxDeg).toFixed(2)}deg`);
        node.style.setProperty("--tilt-x", `${(-py * maxDeg).toFixed(2)}deg`);
        node.style.setProperty("--glare-x", `${(rx * 100).toFixed(1)}%`);
        node.style.setProperty("--glare-y", `${(ry * 100).toFixed(1)}%`);
      });
    },
    [maxDeg]
  );

  const onMouseLeave = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    rectRef.current = null;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glare-x", "50%");
    el.style.setProperty("--glare-y", "50%");
  }, []);

  return { ref, onMouseMove, onMouseLeave };
}
