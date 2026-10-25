import { describe, expect, it } from "vitest";
import { getRelayFailoverPolicy, RELAY_REQUEST_TIMEOUT_MS } from "./relay-failover-policy";

describe("站点重试策略", () => {
  it("单主站无备用最多两次，每次两分钟", () => {
    expect(getRelayFailoverPolicy({ candidateCount: 1, hasFallback: false })).toEqual({ maxAttemptsPerCandidate: 2, attemptTimeoutMs: 120000 });
    expect(RELAY_REQUEST_TIMEOUT_MS).toBe(120000);
  });

  it.each([[2, false], [3, true], [1, true], [0, false]] as const)("%i个候选/备用%s时每站一次", (candidateCount, hasFallback) => {
    expect(getRelayFailoverPolicy({ candidateCount, hasFallback })).toEqual({ maxAttemptsPerCandidate: 1, attemptTimeoutMs: 120000 });
  });
});
