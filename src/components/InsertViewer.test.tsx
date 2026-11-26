import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs } from "../state/tabs";
import { renderWithProviders } from "../test/render";
import { InsertViewer } from "./InsertViewer";

const SQL = "INSERT INTO analytics.events VALUES (1, 'click')";

describe("InsertViewer", () => {
  beforeEach(() => {
    act(() => useTabs.setState({ tabs: [], activeId: null, closedStack: [] }));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("shows the INSERT and copies it", async () => {
    renderWithProviders(
      <InsertViewer
        viewName="analytics.v"
        sql={SQL}
        opened
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(SQL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SQL),
    );
  });

  it("opens a guarded tab", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <InsertViewer
        viewName="analytics.v"
        sql={SQL}
        opened
        onClose={onClose}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in a new tab" }),
    );
    const [tab] = useTabs.getState().tabs;
    expect(tab).toMatchObject({
      sql: SQL,
      guardWrites: true,
      title: "INSERT → analytics.v",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the guard when the tab is closed and reopened", () => {
    act(() => {
      const id = useTabs
        .getState()
        .open({ title: "x", sql: SQL, guardWrites: true });
      useTabs.getState().close(id);
      useTabs.getState().reopenLast();
    });
    expect(useTabs.getState().tabs[0].guardWrites).toBe(true);
  });
});
