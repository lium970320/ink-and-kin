export function requestScope(external?: AbortSignal, timeoutMs = 180000) {
  const controller = new AbortController();
  const forward = () => controller.abort(external?.reason);
  if (external?.aborted) forward(); else external?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Model request timed out", "TimeoutError")), Number.isFinite(timeoutMs) ? Math.min(180000, Math.max(1000, Math.floor(timeoutMs))) : 180000);
  timer.unref?.();
  return { signal: controller.signal, check() { if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException("Cancelled", "AbortError"); }, close() { clearTimeout(timer); external?.removeEventListener("abort", forward); controller.abort(); } };
}
