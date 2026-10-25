export const RELAY_REQUEST_TIMEOUT_MS = 120_000;

export type RelayFailoverPolicy = {
  maxAttemptsPerCandidate: number;
  attemptTimeoutMs: number;
};

/** Single station: one retry. Multiple stations or a backup: one call per station. */
export function getRelayFailoverPolicy(params: {
  candidateCount: number;
  hasFallback: boolean;
}): RelayFailoverPolicy {
  return {
    maxAttemptsPerCandidate: params.candidateCount === 1 && !params.hasFallback ? 2 : 1,
    attemptTimeoutMs: RELAY_REQUEST_TIMEOUT_MS,
  };
}
