export type PollingInterval = "off" | 2000 | 5000 | 10000 | 30000 | 60000;

export const POLLING_INTERVAL_OPTIONS: PollingInterval[] = [
  "off",
  2000,
  5000,
  10000,
  30000,
  60000,
];

export const SERVER_ACTIVITY_OPTIONS: PollingInterval[] = [
  "off",
  5000,
  10000,
  30000,
  60000,
];

export const LIVE_QUERIES_OPTIONS: PollingInterval[] = [
  "off",
  2000,
  5000,
  10000,
];

export const DEFAULT_POLLING_INTERVAL: PollingInterval = 30000;
export const DEFAULT_LIVE_QUERIES_INTERVAL: PollingInterval = 5000;

export const MAX_RETRY_MS = 300_000;

const LASTING_CODES = new Set([
  36, // BAD_ARGUMENTS
  46, // UNKNOWN_FUNCTION
  47, // UNKNOWN_IDENTIFIER
  60, // UNKNOWN_TABLE
  62, // SYNTAX_ERROR
  81, // UNKNOWN_DATABASE
  164, // READONLY
  192, // UNKNOWN_USER
  497, // ACCESS_DENIED
  516, // AUTHENTICATION_FAILED
  701, // CLUSTER_DOESNT_EXIST
]);

export function isLastingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { kind?: unknown; code?: unknown };
  if (e.kind === "invalid" || e.kind === "keychain") return true;
  return typeof e.code === "number" && LASTING_CODES.has(e.code);
}

export interface PollState {
  error: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export interface PolledQuery {
  state: PollState;
}

/** TanStack resets its failure counter on every fetch, so streaks live here. */
const streaks = new WeakMap<
  PolledQuery,
  { failures: number; lastErrorAt: number; dataAt: number }
>();

function failureStreak(query: PolledQuery): number {
  const { dataUpdatedAt, errorUpdatedAt } = query.state;
  let s = streaks.get(query);
  if (!s || s.dataAt !== dataUpdatedAt) {
    s = { failures: 0, lastErrorAt: 0, dataAt: dataUpdatedAt };
    streaks.set(query, s);
  }
  if (errorUpdatedAt !== s.lastErrorAt) {
    s.failures += 1;
    s.lastErrorAt = errorUpdatedAt;
  }
  return s.failures;
}

function nextPoll(base: number, query: PolledQuery | false): number | false {
  if (!query || !query.state.error) return base;
  if (isLastingError(query.state.error)) return false;
  const failures = failureStreak(query);
  return Math.min(MAX_RETRY_MS, base * 2 ** Math.min(12, failures - 1));
}

export function resolveRefetchInterval(
  pref: PollingInterval,
  query: PolledQuery | false,
): number | false {
  if (pref === "off") return false;
  return nextPoll(pref, query);
}

export function resolvePulseInterval(
  pref: PollingInterval,
  query: PolledQuery | false,
): number | false {
  if (pref === "off") return false;
  return nextPoll(30_000, query);
}

export function pollingStatusText(
  pref: PollingInterval,
  error?: unknown,
): string {
  if (pref === "off") return "Polling off: turn it on in Settings";
  if (error) {
    return isLastingError(error)
      ? "Polling stopped: see the error below"
      : "Last poll failed: retrying";
  }
  return `Polling every ${pref / 1000}s`;
}

export function effectivePollingInterval(
  pref: PollingInterval,
  hidden: boolean,
): PollingInterval {
  return hidden ? "off" : pref;
}
