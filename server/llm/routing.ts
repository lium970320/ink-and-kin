import { LLMRequestError, mayRetryLLM, safeLLMError } from "./errors";
import { getRelayFailoverPolicy } from "./relay-failover-policy";
import { isRelayCoolingDown, markRelaySuccess, markRelayTransientFailure, selectAvailableCandidates } from "./relay-health";
import type { LLMMessage, LLMOptions, LLMProvider, LLMStreamChunk } from "./types";

export type RoutedCandidate = {
  provider: LLMProvider;
  providerName: string;
  relayId?: number;
  priority?: number;
};

export type RoutedProviderOptions = {
  userId: number;
  requestedProvider?: string;
  hasFallback: boolean;
};

/** Races the actual work against both timeout and cancellation, even if a
 * provider ignores its AbortSignal. The original work retains a rejection
 * handler; a late failure cannot become an unhandled rejection or start a retry.
 */
class AttemptScope {
  readonly controller = new AbortController();
  private timedOut = false;
  private readonly failure: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  constructor(timeoutMs: number, private external?: AbortSignal, consumer?: AbortSignal) {
    let rejectFailure!: (error: unknown) => void;
    this.failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
    void this.failure.catch(() => {});
    for (const signal of [external, consumer]) {
      if (!signal) continue;
      const listener = () => {
        this.controller.abort();
        rejectFailure(new LLMRequestError("cancelled"));
      };
      this.listeners.push({ signal, listener });
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
    }
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort();
      rejectFailure(new LLMRequestError("network"));
    }, timeoutMs);
  }

  async run<T>(work: () => PromiseLike<T> | T): Promise<T> {
    if (this.external?.aborted) throw new LLMRequestError("cancelled");
    if (this.timedOut) throw new LLMRequestError("network");
    if (this.controller.signal.aborted) throw new LLMRequestError("cancelled");
    return Promise.race([Promise.resolve().then(() => {
      if (this.controller.signal.aborted) throw this.error(new LLMRequestError("cancelled"));
      return work();
    }), this.failure]);
  }

  error(error: unknown): LLMRequestError {
    if (this.external?.aborted) return new LLMRequestError("cancelled");
    if (this.timedOut) return new LLMRequestError("network");
    return safeLLMError(error);
  }

  close(): void {
    clearTimeout(this.timer);
    for (const { signal, listener } of this.listeners) signal.removeEventListener("abort", listener);
    this.controller.abort();
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LLMRequestError("cancelled");
}

function closeIterator(iterator: AsyncIterator<LLMStreamChunk> | undefined): void {
  // A generator stuck in a provider's pending next() must not block cancellation.
  // AbortSignal closes cooperative HTTP readers; return() also closes custom streams.
  if (!iterator?.return) return;
  try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Best-effort cleanup only. */ }
}

/** Candidates are already ordered by the resolver; this layer never reorders
 * priorities, resolves credentials, edits configuration or recursively expands a backup.
 */
export function createRoutedProvider(candidates: readonly RoutedCandidate[], settings: RoutedProviderOptions): LLMProvider {
  return new RoutedProvider(candidates.map(candidate => ({ ...candidate })), { ...settings });
}

class RoutedProvider implements LLMProvider {
  readonly maxAttempts = 1;
  readonly reportsAttempts = true;
  readonly name: string;
  readonly capabilities;
  readonly supportsReasoningEffort;

  constructor(private readonly candidates: RoutedCandidate[], private readonly settings: RoutedProviderOptions) {
    const first = candidates[0];
    this.name = settings.requestedProvider ?? first?.providerName ?? "Routed";
    this.capabilities = first ? { ...first.provider.capabilities } : { streaming: false, vision: false, tools: false, jsonMode: false };
    this.supportsReasoningEffort = first?.provider.supportsReasoningEffort;
  }

  isConfigured(): boolean { return this.candidates.some(candidate => candidate.provider.isConfigured()); }
  getRelayId(): number | undefined { return this.candidates[0]?.relayId; }
  getProviderName(options?: LLMOptions): string {
    const first = this.candidates[0];
    return first?.provider.getProviderName?.(options) ?? first?.providerName ?? this.name;
  }
  getModel(options?: LLMOptions): string { return this.candidates[0]?.provider.getModel?.(options) ?? this.getConfigSummary(options).model ?? ""; }
  getConfigSummary(options?: LLMOptions): { model?: string; reasoningEffort?: string } {
    const summary = this.candidates[0]?.provider.getConfigSummary?.(options);
    return { model: summary?.model, reasoningEffort: summary?.reasoningEffort };
  }

  private available(options?: LLMOptions): RoutedCandidate[] {
    assertActive(options?.signal);
    if (!this.candidates.length) throw new LLMRequestError("invalid_request");
    const available = selectAvailableCandidates(this.candidates, this.settings.userId);
    if (!available.length) throw new LLMRequestError("transient");
    return available;
  }

  private startRoute(candidate: RoutedCandidate, options: LLMOptions, scope: AttemptScope, timeoutMs: number): LLMOptions {
    assertActive(options.signal);
    const summary = candidate.provider.getConfigSummary?.(options);
    options.onRoute?.({
      provider: candidate.provider.getProviderName?.(options) ?? candidate.providerName,
      model: summary?.model ?? candidate.provider.getModel?.(options),
      relayId: candidate.relayId,
      reasoningEffort: summary?.reasoningEffort,
    });
    assertActive(options.signal);
    return { ...options, signal: scope.controller.signal, requestTimeoutMs: timeoutMs };
  }

  private recordFailure(candidate: RoutedCandidate, error: LLMRequestError): void {
    if (candidate.relayId !== undefined && mayRetryLLM(error)) markRelayTransientFailure(this.settings.userId, candidate.relayId);
  }
  private recordSuccess(candidate: RoutedCandidate): void {
    if (candidate.relayId !== undefined) markRelaySuccess(this.settings.userId, candidate.relayId);
  }

  async invoke(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const available = this.available(options);
    const policy = getRelayFailoverPolicy({ candidateCount: this.candidates.length, hasFallback: this.settings.hasFallback });
    let lastError: LLMRequestError = new LLMRequestError("transient");
    for (const candidate of available) {
      const probing = candidate.relayId !== undefined && isRelayCoolingDown(this.settings.userId, candidate.relayId);
      const attempts = probing ? 1 : policy.maxAttemptsPerCandidate;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const scope = new AttemptScope(policy.attemptTimeoutMs, options.signal);
        try {
          const result = await scope.run(() => {
            const requestOptions = this.startRoute(candidate, options, scope, policy.attemptTimeoutMs);
            if (!candidate.provider.reportsAttempts) options.onAttempt?.();
            return candidate.provider.invoke(messages, requestOptions);
          });
          assertActive(options.signal);
          this.recordSuccess(candidate);
          return result;
        } catch (error) {
          lastError = scope.error(error);
          this.recordFailure(candidate, lastError);
          if (!mayRetryLLM(lastError, options.signal)) throw lastError;
        } finally { scope.close(); }
      }
    }
    throw lastError;
  }

  stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<LLMStreamChunk> {
    const consumer = new AbortController();
    const iterator = this.streamCandidates(messages, options, consumer.signal);
    // return() aborts a pending next() before the async generator queues its return.
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => iterator.next(),
          return: async () => { consumer.abort(); return iterator.return(undefined); },
          throw: async (error?: unknown) => { consumer.abort(); return iterator.throw(error); },
        };
      },
    };
  }

  private async *streamCandidates(messages: LLMMessage[], options: LLMOptions, consumer: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const available = this.available(options);
    const policy = getRelayFailoverPolicy({ candidateCount: this.candidates.length, hasFallback: this.settings.hasFallback });
    let lastError: LLMRequestError = new LLMRequestError("transient");
    let emittedBody = false;
    for (const candidate of available) {
      const probing = candidate.relayId !== undefined && isRelayCoolingDown(this.settings.userId, candidate.relayId);
      const attempts = probing ? 1 : policy.maxAttemptsPerCandidate;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (consumer.aborted) return;
        const scope = new AttemptScope(policy.attemptTimeoutMs, options.signal, consumer);
        let iterator: AsyncIterator<LLMStreamChunk> | undefined;
        try {
          const requestOptions = this.startRoute(candidate, options, scope, policy.attemptTimeoutMs);
          if (candidate.provider.stream) {
            iterator = candidate.provider.stream(messages, requestOptions)[Symbol.asyncIterator]();
            let firstNext = true;
            while (true) {
              const next = await scope.run(() => {
                if (firstNext && !candidate.provider.reportsAttempts) options.onAttempt?.();
                firstNext = false;
                return iterator!.next();
              });
              assertActive(options.signal);
              if (consumer.aborted) return;
              if (next.done) break;
              if (next.value.text.length > 0) emittedBody = true;
              yield next.value;
            }
          } else {
            const text = await scope.run(() => {
              if (!candidate.provider.reportsAttempts) options.onAttempt?.();
              return candidate.provider.invoke(messages, requestOptions);
            });
            assertActive(options.signal);
            if (consumer.aborted) return;
            if (text.length > 0) emittedBody = true;
            yield { text };
          }
          this.recordSuccess(candidate);
          return;
        } catch (error) {
          if (consumer.aborted) return;
          lastError = scope.error(error);
          this.recordFailure(candidate, lastError);
          if (emittedBody || !mayRetryLLM(lastError, options.signal)) throw lastError;
        } finally {
          scope.close();
          closeIterator(iterator);
        }
      }
    }
    throw lastError;
  }
}
