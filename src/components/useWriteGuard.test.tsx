import { MantineProvider } from "@mantine/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs, type QueryTab } from "../state/tabs";
import { useWriteGuard } from "./useWriteGuard";

function Harness({ sql, run }: { sql: string; run: () => boolean }) {
  const { guardRun, guardModal } = useWriteGuard();
  const tab = useTabs((s) => s.tabs[0]) as QueryTab;
  return (
    <>
      <button onClick={() => guardRun(tab, sql, run)}>run</button>
      {guardModal}
    </>
  );
}

function setup(
  guardWrites: boolean,
  sql = "INSERT INTO t VALUES (1)",
  paramValues: Record<string, string> = {},
  starts = true,
) {
  act(() => {
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
    useTabs
      .getState()
      .open({ title: "INSERT → db.v", sql, guardWrites, paramValues });
  });
  const run = vi.fn(() => starts);
  render(
    <MantineProvider>
      <Harness sql={sql} run={run} />
    </MantineProvider>,
  );
  return run;
}

describe("useWriteGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks before running a write from a guarded tab", async () => {
    const run = setup(true);
    fireEvent.click(screen.getByText("run"));
    expect(
      await screen.findByText("Run this INSERT again?"),
    ).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Run this INSERT again?")).toBeNull(),
    );
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("run"));
    fireEvent.click(await screen.findByRole("button", { name: "Run it" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("asks only once per tab", async () => {
    const run = setup(true);
    fireEvent.click(screen.getByText("run"));
    fireEvent.click(await screen.findByRole("button", { name: "Run it" }));
    expect(useTabs.getState().tabs[0].guardWrites).toBe(false);
    fireEvent.click(screen.getByText("run"));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs reads from a guarded tab, and anything from other tabs, at once", () => {
    const readRun = setup(true, "SELECT count() FROM t");
    fireEvent.click(screen.getByText("run"));
    expect(readRun).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary tabs alone", () => {
    const run = setup(false);
    fireEvent.click(screen.getByText("run"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Run this INSERT again?")).toBeNull();
  });

  it("judges the SQL after parameters are filled in", async () => {
    const run = setup(true, "{!stmt}", { stmt: "INSERT INTO t VALUES (2)" });
    fireEvent.click(screen.getByText("run"));
    expect(
      await screen.findByText("Run this INSERT again?"),
    ).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("stays guarded when the confirmed run doesn't start", async () => {
    setup(true, "INSERT INTO t VALUES (1)", {}, false);
    fireEvent.click(screen.getByText("run"));
    fireEvent.click(await screen.findByRole("button", { name: "Run it" }));
    expect(useTabs.getState().tabs[0].guardWrites).toBe(true);
  });
});
