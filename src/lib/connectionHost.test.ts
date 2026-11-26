import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  normalizeHost,
  portAfterTlsToggle,
} from "./connectionHost";

describe("normalizeHost", () => {
  it.each([
    ["my-cluster.example.com", "my-cluster.example.com"],
    ["  my-cluster.example.com  ", "my-cluster.example.com"],
    ["https://my-cluster.example.com:8443/play", "my-cluster.example.com"],
    ["clickhouse://user@ch.example.com:9440", "ch.example.com"],
    ["ch.example.com:9000", "ch.example.com"],
    ["ch.example.com/?query=1", "ch.example.com"],
    ["[::1]:9440", "[::1]"],
    ["::1", "::1"],
    ["", ""],
  ])("%j → %j", (raw, want) => {
    expect(normalizeHost(raw)).toBe(want);
  });
});

describe("portAfterTlsToggle", () => {
  it("swaps the default ports", () => {
    expect(portAfterTlsToggle(9440, false)).toBe(9000);
    expect(portAfterTlsToggle(9000, true)).toBe(9440);
  });

  it("keeps a custom port", () => {
    expect(portAfterTlsToggle(19440, false)).toBe(19440);
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "127.0.0.2:9000",
    "::1",
    "[::1]",
    "localhost:9000",
  ])("treats %s as loopback", (host) =>
    expect(isLoopbackHost(host)).toBe(true),
  );
  it.each(["clickhouse.example.com", "10.0.0.5", "127.0.0.1.example.com", ""])(
    "treats '%s' as remote",
    (host) => expect(isLoopbackHost(host)).toBe(false),
  );
});
