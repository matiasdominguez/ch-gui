import { beforeEach, describe, expect, it } from "vitest";

import { nextQueryTitle, titleFromSql, useTabs } from "./tabs";
import type { LogEntry } from "../types";

const STORAGE_KEY = "ch-gui.tabs";

function resetStore() {
  window.localStorage.clear();
  useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
}

describe("useTabs persistence", () => {
  beforeEach(resetStore);

  it("persists SQL/title/params but strips runtime state from localStorage", () => {
    const id = useTabs.getState().open({ title: "Report", sql: "SELECT 1" });
    useTabs.getState().patch(id, {
      result: { columns: [], rows: [], stats: {} } as never,
      logs: [{ level: "trace" } as never],
      runningQueryId: "some-uuid",
      paramValues: { day: "2026-07-18" },
    });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!).state;
    expect(stored.tabs).toHaveLength(1);
    expect(stored.tabs[0].sql).toBe("SELECT 1");
    expect(stored.tabs[0].title).toBe("Report");
    expect(stored.tabs[0].paramValues).toEqual({ day: "2026-07-18" });
    expect(stored.tabs[0].result).toBeUndefined();
    expect(stored.tabs[0].logs).toBeUndefined();
    expect(stored.tabs[0].runningQueryId).toBeUndefined();
    expect(stored.activeId).toBe(id);
  });

  it("re-inflates persisted tabs with fresh runtime defaults on rehydrate", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          tabs: [
            {
              id: "t1",
              title: "Restored",
              sql: "SELECT 2",
              savedQueryId: 7,
              logLevel: "debug",
              paramValues: { x: "1" },
              chart: { type: "line", xCol: "a", yCol: "b" },
            },
          ],
          activeId: "t1",
          closedStack: [],
        },
        version: 0,
      }),
    );
    await useTabs.persist.rehydrate();

    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(1);
    const t = s.tabs[0];
    expect(t.sql).toBe("SELECT 2");
    expect(t.savedQueryId).toBe(7);
    expect(t.logLevel).toBe("debug");
    expect(t.chart).toEqual({ type: "line", xCol: "a", yCol: "b" });
    expect(t.result).toBeNull();
    expect(t.error).toBeNull();
    expect(t.runningQueryId).toBeNull();
    expect(t.logs).toEqual([]);
    expect(t.progress).toBeNull();
    expect(t.profile).toBeNull();
    expect(t.profileLoading).toBe(false);
    expect(t.profileError).toBeNull();
    expect(s.activeId).toBe("t1");
  });

  it("falls back to the last tab when the persisted activeId is unknown", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          tabs: [
            {
              id: "t1",
              title: "A",
              sql: "",
              savedQueryId: null,
              logLevel: "none",
              paramValues: {},
              chart: { type: "bar", xCol: null, yCol: null },
            },
            {
              id: "t2",
              title: "B",
              sql: "",
              savedQueryId: null,
              logLevel: "none",
              paramValues: {},
              chart: { type: "bar", xCol: null, yCol: null },
            },
          ],
          activeId: "gone",
          closedStack: [],
        },
        version: 0,
      }),
    );
    await useTabs.persist.rehydrate();
    expect(useTabs.getState().activeId).toBe("t2");
  });

  it("hydrates an empty/corrupt payload to a clean state", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: {}, version: 0 }),
    );
    await useTabs.persist.rehydrate();
    const s = useTabs.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.closedStack).toEqual([]);
  });
});

function logEntry(i: number): LogEntry {
  return {
    event_time: null,
    host_name: "host",
    query_id: "q1",
    thread_id: 1,
    priority: 6,
    source: "executeQuery",
    text: `line ${i}`,
  };
}

describe("useTabs.appendLogs", () => {
  beforeEach(resetStore);

  it("caps per-tab logs at 5000, dropping the oldest", () => {
    const id = useTabs.getState().open({ title: "t", sql: "" });
    useTabs.getState().patch(id, { runningQueryId: "q1" });

    useTabs.getState().appendLogs(
      "q1",
      Array.from({ length: 4998 }, (_, i) => logEntry(i)),
    );
    useTabs.getState().appendLogs(
      "q1",
      Array.from({ length: 10 }, (_, i) => logEntry(4998 + i)),
    );

    const tab = useTabs.getState().tabs.find((t) => t.id === id)!;
    expect(tab.logs).toHaveLength(5000);
    expect(tab.logs[0].text).toBe("line 8");
    expect(tab.logs[4999].text).toBe("line 5007");
  });

  it("does not touch tabs running a different query", () => {
    const id = useTabs.getState().open({ title: "t", sql: "" });
    useTabs.getState().patch(id, { runningQueryId: "q1" });

    useTabs.getState().appendLogs("other-query", [logEntry(0)]);

    const tab = useTabs.getState().tabs.find((t) => t.id === id)!;
    expect(tab.logs).toHaveLength(0);
  });
});

describe("tab titles", () => {
  beforeEach(resetStore);

  it("never repeats a Query N title after a close", () => {
    const s = useTabs.getState();
    s.openNew();
    const second = s.openNew();
    s.openNew();
    useTabs.getState().close(second);
    useTabs.getState().openNew();
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual([
      "Query 1",
      "Query 3",
      "Query 4",
    ]);
  });

  it("counts closed tabs, so Undo can't bring back a twin", () => {
    const s = useTabs.getState();
    s.openNew();
    useTabs.getState().close(useTabs.getState().openNew());
    useTabs.getState().openNew();
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual([
      "Query 1",
      "Query 3",
    ]);
  });

  it("titles SQL tabs from the first line that isn't a comment", () => {
    expect(titleFromSql("-- chgui:abc\nSELECT  count()\n  FROM t")).toBe(
      "SELECT count()",
    );
    expect(
      titleFromSql("SELECT a, b, c FROM some_database.some_long_table"),
    ).toBe("SELECT a, b, c FROM some_databa…");
    expect(titleFromSql("  \n-- only a comment")).toBe("Untitled");
    expect(
      titleFromSql("/* report v2\n   owner: data */\n-- daily\nSELECT 1"),
    ).toBe("SELECT 1");
    expect(titleFromSql("/* note */ SELECT 2")).toBe("SELECT 2");
  });

  it("reads Query N titles only", () => {
    expect(nextQueryTitle(["Query 2", "orders", "Query 10x"])).toBe("Query 3");
    expect(nextQueryTitle([])).toBe("Query 1");
  });
});

describe("useTabs.openSaved / openSql", () => {
  beforeEach(resetStore);

  it("focuses the tab already holding a saved query", () => {
    const s = useTabs.getState();
    const first = s.openSaved({ id: 7, name: "Daily", sql: "SELECT 1" });
    s.openNew();
    const again = useTabs.getState().openSaved({
      id: 7,
      name: "Daily",
      sql: "SELECT 1",
    });
    expect(again).toBe(first);
    expect(useTabs.getState().activeId).toBe(first);
    expect(useTabs.getState().tabs).toHaveLength(2);
  });

  it("focuses an unsaved tab with the same SQL, and opens one otherwise", () => {
    const s = useTabs.getState();
    const first = s.openSql("SELECT 1");
    s.openNew();
    expect(useTabs.getState().openSql("SELECT 1")).toBe(first);
    useTabs.getState().patch(first, { sql: "SELECT 1 + 1" });
    const fresh = useTabs.getState().openSql("SELECT 1");
    expect(fresh).not.toBe(first);
    expect(useTabs.getState().tabs.find((t) => t.id === fresh)!.title).toBe(
      "SELECT 1",
    );
  });

  it("gives a focused saved-query tab the current name", () => {
    const s = useTabs.getState();
    const id = s.openSaved({ id: 7, name: "Daily", sql: "SELECT 1" });
    useTabs.getState().openSaved({ id: 7, name: "Daily v2", sql: "SELECT 1" });
    expect(useTabs.getState().tabs.find((t) => t.id === id)!.title).toBe(
      "Daily v2",
    );
  });

  it("doesn't reuse a tab that has already run", () => {
    const s = useTabs.getState();
    const ran = s.openSql("SELECT 1");
    useTabs.getState().patch(ran, {
      result: { columns: [], rows: [], stats: { rows: 0, elapsed_ms: 1 } },
    });
    expect(useTabs.getState().openSql("SELECT 1")).not.toBe(ran);
  });

  it("doesn't reuse a saved query's tab for history SQL", () => {
    const s = useTabs.getState();
    const saved = s.openSaved({ id: 3, name: "Q", sql: "SELECT 1" });
    expect(useTabs.getState().openSql("SELECT 1")).not.toBe(saved);
  });
});

describe("useTabs.markLogsUnavailable", () => {
  beforeEach(resetStore);

  it("marks only the tab running that query", () => {
    const a = useTabs.getState().open({ title: "a", sql: "" });
    const b = useTabs.getState().open({ title: "b", sql: "" });
    useTabs.getState().patch(a, { runningQueryId: "q1" });
    useTabs.getState().patch(b, { runningQueryId: "q2" });

    useTabs.getState().markLogsUnavailable("q1");

    const tabs = useTabs.getState().tabs;
    expect(tabs.find((t) => t.id === a)!.logsUnavailable).toBe(true);
    expect(tabs.find((t) => t.id === b)!.logsUnavailable).toBe(false);
  });
});
