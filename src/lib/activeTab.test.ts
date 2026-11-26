import { describe, expect, it } from "vitest";

import { monitorViews, nextActiveTab, nextMonitorView } from "./activeTab";

describe("monitorViews", () => {
  it("offers every panel that's on, in order", () => {
    expect(monitorViews(false, true, false)).toEqual([
      "activity",
      "kafka",
      "running",
    ]);
  });

  it("drops hidden panels and Kafka without Kafka tables", () => {
    expect(monitorViews(true, false, false)).toEqual(["running"]);
    expect(monitorViews(false, false, true)).toEqual(["activity"]);
    expect(monitorViews(true, false, true)).toEqual([]);
  });
});

describe("nextMonitorView", () => {
  it("keeps the chosen panel while it's offered", () => {
    expect(nextMonitorView("kafka", ["activity", "kafka"])).toBe("kafka");
  });

  it("falls back to the first panel offered", () => {
    expect(nextMonitorView("kafka", ["activity", "running"])).toBe("activity");
    expect(nextMonitorView(null, ["running"])).toBe("running");
  });

  it("returns null when nothing is offered", () => {
    expect(nextMonitorView("activity", [])).toBeNull();
  });
});

describe("nextActiveTab", () => {
  it("leaves the local tabs alone", () => {
    expect(nextActiveTab("schema", false)).toBe("schema");
    expect(nextActiveTab("saved", false)).toBe("saved");
    expect(nextActiveTab("history", true)).toBe("history");
  });

  it("keeps Monitor while it has a panel", () => {
    expect(nextActiveTab("monitor", true)).toBe("monitor");
  });

  it("falls back to Schema when Monitor empties", () => {
    expect(nextActiveTab("monitor", false)).toBe("schema");
  });
});
