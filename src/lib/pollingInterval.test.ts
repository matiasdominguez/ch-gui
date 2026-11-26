import { describe, expect, it } from "vitest";

import {
  effectivePollingInterval,
  isLastingError,
  MAX_RETRY_MS,
  pollingStatusText,
  resolvePulseInterval,
  resolveRefetchInterval,
  type PollingInterval,
  type PolledQuery,
} from "./pollingInterval";

const NETWORK = { kind: "connect", message: "Connection refused" };
const DENIED = { kind: "clickhouse", message: "ACCESS_DENIED", code: 497 };

function failing(error: unknown): PolledQuery {
  return { state: { error, dataUpdatedAt: 1000, errorUpdatedAt: 2000 } };
}

function failAgain(q: PolledQuery, at: number) {
  q.state = { ...q.state, errorUpdatedAt: at };
}

describe("resolveRefetchInterval", () => {
  it("returns the interval when polling is on and there is no error", () => {
    expect(resolveRefetchInterval(2000, false)).toBe(2000);
    expect(resolveRefetchInterval(5000, false)).toBe(5000);
    expect(resolveRefetchInterval(10000, false)).toBe(10000);
    expect(resolveRefetchInterval(30000, false)).toBe(30000);
    expect(resolveRefetchInterval(60000, false)).toBe(60000);
  });

  it("returns false when polling is off", () => {
    expect(resolveRefetchInterval("off", false)).toBe(false);
  });

  it("doubles the wait with each failed poll since the last success", () => {
    const q = failing(NETWORK);
    expect(resolveRefetchInterval(5000, q)).toBe(5000);
    failAgain(q, 3000);
    expect(resolveRefetchInterval(5000, q)).toBe(10_000);
    failAgain(q, 4000);
    expect(resolveRefetchInterval(5000, q)).toBe(20_000);
    expect(resolveRefetchInterval(5000, q)).toBe(20_000);
  });

  it("retries at the interval after a long idle, not after the idle time", () => {
    const q: PolledQuery = {
      state: { error: NETWORK, dataUpdatedAt: 1000, errorUpdatedAt: 3_600_000 },
    };
    expect(resolveRefetchInterval(5000, q)).toBe(5000);
  });

  it("starts over after a success", () => {
    const q = failing(NETWORK);
    resolveRefetchInterval(5000, q);
    failAgain(q, 3000);
    expect(resolveRefetchInterval(5000, q)).toBe(10_000);
    q.state = { error: null, dataUpdatedAt: 4000, errorUpdatedAt: 3000 };
    expect(resolveRefetchInterval(5000, q)).toBe(5000);
    q.state = { error: NETWORK, dataUpdatedAt: 4000, errorUpdatedAt: 5000 };
    expect(resolveRefetchInterval(5000, q)).toBe(5000);
  });

  it("caps the wait", () => {
    const q = failing(NETWORK);
    for (let t = 3000; t < 30_000; t += 1000) {
      failAgain(q, t);
      resolveRefetchInterval(5000, q);
    }
    expect(resolveRefetchInterval(5000, q)).toBe(MAX_RETRY_MS);
  });

  it("stops on a lasting error", () => {
    expect(resolveRefetchInterval(5000, failing(DENIED))).toBe(false);
  });

  it("stays off when polling is off, error or not", () => {
    expect(resolveRefetchInterval("off", failing(NETWORK))).toBe(false);
  });
});

describe("isLastingError", () => {
  it("names errors a retry can't fix", () => {
    expect(isLastingError(DENIED)).toBe(true);
    expect(isLastingError({ kind: "connect", message: "x", code: 516 })).toBe(
      true,
    );
    expect(isLastingError({ kind: "invalid", message: "x" })).toBe(true);
  });

  it("retries network drops, timeouts, and unknown shapes", () => {
    expect(isLastingError(NETWORK)).toBe(false);
    expect(
      isLastingError({ kind: "clickhouse", message: "x", code: 159 }),
    ).toBe(false);
    expect(isLastingError({ kind: "clickhouse", message: "no code" })).toBe(
      false,
    );
    expect(isLastingError(new Error("boom"))).toBe(false);
    expect(isLastingError(null)).toBe(false);
  });
});

describe("resolvePulseInterval", () => {
  it("pins the pulse at 30s whenever polling is on", () => {
    expect(resolvePulseInterval(5000, false)).toBe(30_000);
    expect(resolvePulseInterval(10000, false)).toBe(30_000);
    expect(resolvePulseInterval(30000, false)).toBe(30_000);
    expect(resolvePulseInterval(60000, false)).toBe(30_000);
  });

  it("stops the pulse when polling is off", () => {
    expect(resolvePulseInterval("off", false)).toBe(false);
  });

  it("backs the pulse off from 30s on a passing failure", () => {
    const q = failing(NETWORK);
    expect(resolvePulseInterval(10000, q)).toBe(30_000);
    failAgain(q, 3000);
    expect(resolvePulseInterval(10000, q)).toBe(60_000);
  });

  it("stops the pulse on a lasting error or when polling is off", () => {
    expect(resolvePulseInterval(10000, failing(DENIED))).toBe(false);
    expect(resolvePulseInterval("off", failing(NETWORK))).toBe(false);
  });
});

describe("effectivePollingInterval", () => {
  it("passes the pref through when the tab is visible", () => {
    const all: PollingInterval[] = ["off", 2000, 5000, 10000, 30000, 60000];
    for (const p of all) {
      expect(effectivePollingInterval(p, false)).toBe(p);
    }
  });

  it("forces off when the tab is hidden, regardless of pref", () => {
    const all: PollingInterval[] = ["off", 2000, 5000, 10000, 30000, 60000];
    for (const p of all) {
      expect(effectivePollingInterval(p, true)).toBe("off");
    }
  });
});

describe("pollingStatusText", () => {
  it("says a passing failure is being retried and a lasting one stopped", () => {
    expect(pollingStatusText(5000, NETWORK)).toBe("Last poll failed: retrying");
    expect(pollingStatusText(5000, DENIED)).toBe(
      "Polling stopped: see the error below",
    );
  });

  it("says polling is off, not retrying, when the user turned it off", () => {
    expect(pollingStatusText("off", NETWORK)).toBe(
      "Polling off: turn it on in Settings",
    );
  });

  it("describes each interval in whole seconds", () => {
    expect(pollingStatusText(2000)).toBe("Polling every 2s");
    expect(pollingStatusText(5000)).toBe("Polling every 5s");
    expect(pollingStatusText(10000)).toBe("Polling every 10s");
    expect(pollingStatusText(30000)).toBe("Polling every 30s");
    expect(pollingStatusText(60000)).toBe("Polling every 60s");
  });

  it("points users at Settings when polling is off", () => {
    expect(pollingStatusText("off")).toBe(
      "Polling off: turn it on in Settings",
    );
  });
});
