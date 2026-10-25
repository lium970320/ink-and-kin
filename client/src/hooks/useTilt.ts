import { useCallback, useRef } from "react";

/**
 * 3D 卡片倾斜跟随鼠标：把返回的 ref/事件绑到带 .tilt-card 类的元素上。
 * 通过 CSS 变量驱动 transform，离开时回弹归零。
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(maxDeg = 5) {
  const ref = useRef<T | null>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--tilt-y", `${(px * maxDeg).toFixed(2)}deg`);
    el.style.setProperty("--tilt-x", `${(-py * maxDeg).toFixed(2)}deg`);
  }, [maxDeg]);

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  }, []);

  return { ref, onMouseMove, onMouseLeave };
}
