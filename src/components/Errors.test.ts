import { describe, expect, it } from "vitest";

import { groupErrors } from "./Errors";
import type { ServerError } from "../types";

function err(overrides: Partial<ServerError>): ServerError {
  return {
    name: "SOCKET_TIMEOUT",
    code: 209,
    count: 1,
    last_error_time: "2026-04-21 10:00:00",
    last_error_message: "",
    remote: false,
    recent: false,
    ...overrides,
  };
}

describe("groupErrors", () => {
  it("dedupes rows with the same (name, code) from different replicas", () => {
    const out = groupErrors([
      err({ count: 2, last_error_time: "2026-04-21 10:00:00" }),
      err({ count: 5, last_error_time: "2026-04-21 10:05:00" }),
      err({ count: 3, last_error_time: "2026-04-21 09:55:00" }),
    ]);
    expect(out.length).toBe(1);
    expect(out[0]?.error.count).toBe(10);
  });

  it("keeps distinct (name, code) pairs separate", () => {
    const out = groupErrors([
      err({ name: "SOCKET_TIMEOUT", code: 209 }),
      err({ name: "ACCESS_DENIED", code: 497 }),
    ]);
    expect(out.length).toBe(2);
  });

  it("takes the most recent timestamp + message across replicas", () => {
    const out = groupErrors([
      err({
        count: 1,
        last_error_time: "2026-04-21 09:00:00",
        last_error_message: "old message",
      }),
      err({
        count: 1,
        last_error_time: "2026-04-21 10:00:00",
        last_error_message: "newest message",
      }),
      err({
        count: 1,
        last_error_time: "2026-04-21 09:30:00",
        last_error_message: "middle message",
      }),
    ]);
    expect(out[0]?.error.last_error_time).toBe("2026-04-21 10:00:00");
    expect(out[0]?.error.last_error_message).toBe("newest message");
  });

  it("ORs `remote` across replicas", () => {
    const out = groupErrors([
      err({ remote: false }),
      err({ remote: true }),
      err({ remote: false }),
    ]);
    expect(out[0]?.error.remote).toBe(true);
  });

  it("sorts distinct errors by last_error_time descending", () => {
    const out = groupErrors([
      err({
        name: "A",
        code: 1,
        last_error_time: "2026-04-21 09:00:00",
      }),
      err({
        name: "B",
        code: 2,
        last_error_time: "2026-04-21 11:00:00",
      }),
      err({
        name: "C",
        code: 3,
        last_error_time: "2026-04-21 10:00:00",
      }),
    ]);
    expect(out.map((g) => g.error.name)).toEqual(["B", "C", "A"]);
  });

  it("produces unique keys so React doesn't warn", () => {
    const out = groupErrors([
      err({ name: "SOCKET_TIMEOUT", code: 209 }),
      err({ name: "SOCKET_TIMEOUT", code: 209 }),
      err({ name: "SOCKET_TIMEOUT", code: 209 }),
    ]);
    const keys = out.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("groupErrors recent flag", () => {
  it("marks a group new when any replica's row is new", () => {
    const [g] = groupErrors([err({ recent: false }), err({ recent: true })]);
    expect(g.error.recent).toBe(true);
  });
});
