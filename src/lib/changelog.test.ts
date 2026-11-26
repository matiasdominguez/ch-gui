import { describe, expect, it } from "vitest";

import {
  changelogFor,
  changelogSince,
  compareVersions,
  whatsNewOnLaunch,
  type ChangelogEntry,
} from "./changelog";

const FIX: ChangelogEntry[] = [
  { version: "0.2.4", date: "2026-06-01", changes: ["a"] },
  { version: "0.2.5", date: "2026-06-10", changes: ["b"] },
  { version: "0.2.10", date: "2026-06-20", changes: ["c"] },
];

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.5", "0.2.5")).toBe(0);
    expect(compareVersions("0.2.4", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });
});

describe("changelogSince", () => {
  it("returns entries newer than lastSeen up to current, newest first", () => {
    expect(
      changelogSince("0.2.10", "0.2.4", FIX).map((e) => e.version),
    ).toEqual(["0.2.10", "0.2.5"]);
  });

  it("excludes versions newer than the current build", () => {
    expect(changelogSince("0.2.5", "0.2.4", FIX).map((e) => e.version)).toEqual(
      ["0.2.5"],
    );
  });

  it("returns empty when already up to date", () => {
    expect(changelogSince("0.2.10", "0.2.10", FIX)).toEqual([]);
  });

  it("returns empty for an unknown (empty) lastSeen — the caller seeds instead", () => {
    expect(changelogSince("0.2.10", "", FIX)).toEqual([]);
  });
});

describe("changelogFor", () => {
  it("returns the single matching entry", () => {
    expect(changelogFor("0.2.5", FIX).map((e) => e.version)).toEqual(["0.2.5"]);
  });

  it("returns empty when no entry exists for the version", () => {
    expect(changelogFor("9.9.9", FIX)).toEqual([]);
  });
});

describe("whatsNewOnLaunch", () => {
  it("seeds silently on a fresh/unknown install (empty lastSeen)", () => {
    expect(whatsNewOnLaunch("0.2.5", "", FIX)).toEqual({
      entries: [],
      nextSeen: "0.2.5",
    });
  });

  it("shows nothing and keeps lastSeen when the version is unchanged", () => {
    expect(whatsNewOnLaunch("0.2.5", "0.2.5", FIX)).toEqual({
      entries: [],
      nextSeen: "0.2.5",
    });
  });

  it("shows everything since lastSeen and advances on a version bump", () => {
    const d = whatsNewOnLaunch("0.2.10", "0.2.4", FIX);
    expect(d.nextSeen).toBe("0.2.10");
    expect(d.entries.map((e) => e.version)).toEqual(["0.2.10", "0.2.5"]);
  });
});
