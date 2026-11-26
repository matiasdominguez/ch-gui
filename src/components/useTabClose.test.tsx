import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs, type QueryTab } from "../state/tabs";
import { useTabClose } from "./useTabClose";

function Harness({ cancel }: { cancel: (t: QueryTab) => void }) {
  const { requestClose, confirmModal } = useTabClose(cancel);
  const tabs = useTabs((s) => s.tabs);
  return (
    <>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => requestClose(t)}>
          close {t.title}
        </button>
      ))}
      {confirmModal}
    </>
  );
}

function renderHarness(cancel = vi.fn()) {
  render(
    <MantineProvider>
      <Notifications />
      <Harness cancel={cancel} />
    </MantineProvider>,
  );
  return cancel;
}

function openTab(title: string, sql: string, running = false): string {
  let id = "";
  act(() => {
    id = useTabs.getState().open({ title, sql });
    if (running) useTabs.getState().patch(id, { runningQueryId: "q1" });
  });
  return id;
}

const has = (id: string) => useTabs.getState().tabs.some((t) => t.id === id);

describe("useTabClose", () => {
  beforeEach(() => {
    act(() => useTabs.setState({ tabs: [], activeId: null, closedStack: [] }));
    act(() => notifications.clean());
  });

  it("closes an idle tab at once and offers Undo", async () => {
    const id = openTab("Revenue", "SELECT 1");
    const cancel = renderHarness();
    fireEvent.click(screen.getByText("close Revenue"));
    expect(has(id)).toBe(false);
    expect(cancel).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Revenue"]);
  });

  it("offers no Undo for an empty tab", () => {
    openTab("Scratch", "  ");
    renderHarness();
    fireEvent.click(screen.getByText("close Scratch"));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("asks before closing a tab whose query is running", async () => {
    const id = openTab("Slow", "SELECT sleep(3)", true);
    const cancel = renderHarness();
    fireEvent.click(screen.getByText("close Slow"));
    expect(await screen.findByText(/is still running/)).toBeInTheDocument();
    expect(has(id)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    await waitFor(() =>
      expect(screen.queryByText(/is still running/)).toBeNull(),
    );
    expect(has(id)).toBe(true);
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("close Slow"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop and close" }),
    );
    expect(has(id)).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("Undo reopens the tab its toast names, after later closes", async () => {
    openTab("First", "SELECT 1");
    openTab("Second", "SELECT 2");
    openTab("Blank", "");
    renderHarness();
    fireEvent.click(screen.getByText("close First"));
    fireEvent.click(screen.getByText("close Second"));
    fireEvent.click(screen.getByText("close Blank"));
    const toast = (await screen.findByText("Closed “First”")).closest(
      ".mantine-Notification-root",
    ) as HTMLElement;
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["First"]);
  });

  it("Undo still works after later closes push its tab off the stack", async () => {
    openTab("Keep me", "SELECT 42");
    for (let i = 0; i < 12; i++) openTab(`Other ${i}`, `SELECT ${i}`);
    renderHarness();
    fireEvent.click(screen.getByText("close Keep me"));
    for (let i = 0; i < 12; i++)
      fireEvent.click(screen.getByText(`close Other ${i}`));
    expect(
      useTabs.getState().closedStack.some((e) => e.title === "Keep me"),
    ).toBe(false);
    const toast = (await screen.findByText("Closed “Keep me”")).closest(
      ".mantine-Notification-root",
    ) as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Keep me"]);
  });

  it("Undo does nothing once ⌘⇧T already reopened the tab", async () => {
    openTab("Once", "SELECT 1");
    renderHarness();
    fireEvent.click(screen.getByText("close Once"));
    act(() => {
      useTabs.getState().reopenLast();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Once"]);
  });
});
