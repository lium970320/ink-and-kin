const INITIAL_COOLDOWN_MS = 5 * 60_000;
const MAX_COOLDOWN_MS = 30 * 60_000;
const PROBE_LEASE_MS = 120_000;

type RelayState = {
  failures: number;
  unavailableUntil: number;
  probeUntil: number;
};

// Process-local metadata only. Configuration and credentials never enter this map.
const states = new Map<string, RelayState>();
const keyFor = (userId: number, relayId: number) => `${userId}:${relayId}`;

export function clearRelayHealth(userId?: number): void {
  if (userId === undefined) {
    states.clear();
    return;
  }
  for (const key of Array.from(states.keys())) {
    if (key.startsWith(`${userId}:`)) states.delete(key);
  }
}

/** Call only for a failure that mayRetryLLM classified as transient. */
export function markRelayTransientFailure(userId: number, relayId: number, now = Date.now()): number {
  const key = keyFor(userId, relayId);
  const previous = states.get(key);
  const failures = Math.min((previous?.failures ?? 0) + 1, 4);
  const cooldown = Math.min(MAX_COOLDOWN_MS, INITIAL_COOLDOWN_MS * 2 ** (failures - 1));
  states.set(key, { failures, unavailableUntil: now + cooldown, probeUntil: previous?.probeUntil ?? 0 });
  return cooldown;
}

export function markRelaySuccess(userId: number, relayId: number): void {
  states.delete(keyFor(userId, relayId));
}

export function isRelayCoolingDown(userId: number, relayId: number, now = Date.now()): boolean {
  return (states.get(keyFor(userId, relayId))?.unavailableUntil ?? 0) > now;
}

/** Preserve caller ordering. If every station is cooling down, lease one probe.
 * The two-minute lease prevents concurrent requests from probing all failed sites.
 * It expires independently of the cooldown, so no station can stay locked forever.
 */
export function selectAvailableCandidates<T extends { relayId?: number }>(
  candidates: readonly T[], userId: number, now = Date.now(),
): T[] {
  const available = candidates.filter(candidate => candidate.relayId === undefined || !isRelayCoolingDown(userId, candidate.relayId, now));
  if (available.length || candidates.length === 0) return available;
  if (candidates.some(candidate => (states.get(keyFor(userId, candidate.relayId!))?.probeUntil ?? 0) > now)) return [];

  let selected: T | undefined;
  let earliest = Infinity;
  for (const candidate of candidates) {
    const state = states.get(keyFor(userId, candidate.relayId!));
    if (state && state.probeUntil <= now && state.unavailableUntil < earliest) {
      earliest = state.unavailableUntil;
      selected = candidate;
    }
  }
  if (!selected) return [];
  const state = states.get(keyFor(userId, selected.relayId!))!;
  state.probeUntil = now + PROBE_LEASE_MS;
  return [selected];
}
