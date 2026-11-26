import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countSavedQueries } from "../lib/db";
import { useConnectionUI } from "../state/connectionUI";
import { useConnections } from "../state/connections";
import { renderWithProviders } from "../test/render";
import type { Connection } from "../types";
import { ConnectionList } from "./ConnectionList";

vi.mock("../lib/db", () => ({
  countSavedQueries: vi.fn(),
  listConnections: vi.fn().mockResolvedValue([]),
  upsertConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

const A: Connection = {
  id: "a",
  name: "Prod",
  host: "prod",
  port: 9440,
  user: "u",
  secure: true,
  defaultDatabase: null,
  customCaPem: null,
  clusterName: null,
  clusterFanout: false,
};
const B: Connection = { ...A, id: "b", name: "Staging", host: "staging" };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function openDelete(ui: ReturnType<typeof renderWithProviders>) {
  fireEvent.click(ui.getByRole("button", { name: "Connection actions" }));
  fireEvent.click(await ui.findByRole("menuitem", { name: "Delete" }));
}

describe("ConnectionList delete dialog", () => {
  beforeEach(() => {
    vi.mocked(countSavedQueries).mockReset();
    useConnections.setState({
      connections: [A, B],
      activeId: "a",
      loaded: true,
      loadError: null,
    });
  });

  it("names the saved queries and waits for the count before Delete", async () => {
    const count = deferred<number>();
    vi.mocked(countSavedQueries).mockReturnValue(count.promise);
    const ui = renderWithProviders(<ConnectionList />);
    await openDelete(ui);

    await ui.findByRole("button", { name: /^Delete$/ });
    const del = () => ui.getByRole("button", { name: /^Delete$/ });
    expect(del()).toBeDisabled();
    await act(async () => count.resolve(12));
    await waitFor(() => expect(del()).toBeEnabled());
    expect(ui.getByText("12 saved queries")).toBeTruthy();
  });

  it("warns about all saved queries when the count fails", async () => {
    vi.mocked(countSavedQueries).mockRejectedValue(new Error("sqlite busy"));
    const ui = renderWithProviders(<ConnectionList />);
    await openDelete(ui);
    await waitFor(() =>
      expect(ui.getByRole("button", { name: /^Delete$/ })).toBeEnabled(),
    );
    expect(ui.getByText("all its saved queries")).toBeTruthy();
  });

  it("ignores a late count from an earlier opening for the same connection", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    vi.mocked(countSavedQueries)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const ui = renderWithProviders(<ConnectionList />);
    await openDelete(ui);
    fireEvent.click(await ui.findByRole("button", { name: "Cancel" }));
    await openDelete(ui);

    await act(async () => first.resolve(5));
    const del = await ui.findByRole("button", { name: /^Delete$/ });
    expect(del).toBeDisabled();
    expect(ui.queryByText("5 saved queries")).toBeNull();

    await act(async () => second.resolve(7));
    await waitFor(() => expect(ui.getByText("7 saved queries")).toBeTruthy());
  });

  it("ignores a late count from a dialog that was cancelled", async () => {
    const countA = deferred<number>();
    vi.mocked(countSavedQueries)
      .mockReturnValueOnce(countA.promise)
      .mockResolvedValueOnce(3);
    const ui = renderWithProviders(<ConnectionList />);
    await openDelete(ui);
    fireEvent.click(await ui.findByRole("button", { name: "Cancel" }));

    act(() => useConnections.getState().setActive("b"));
    await openDelete(ui);
    await waitFor(() => expect(ui.getByText("3 saved queries")).toBeTruthy());

    await act(async () => countA.resolve(99));
    expect(ui.queryByText("99 saved queries")).toBeNull();
    expect(ui.getByText("3 saved queries")).toBeTruthy();
  });
});

describe("ConnectionList Keychain error", () => {
  beforeEach(() => {
    useConnections.setState({
      connections: [A, B],
      activeId: "a",
      loaded: true,
      loadError: null,
    });
  });

  it("shows the error with Retry and Edit", async () => {
    const retry = vi.fn();
    const ui = renderWithProviders(
      <ConnectionList
        payloadError={{ message: "User canceled", keychain: true }}
        onRetryPayload={retry}
      />,
    );
    expect(ui.getByText(/Keychain: User canceled/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(ui.getByRole("button", { name: "Edit" }));
    expect(await ui.findByText("Edit connection")).toBeTruthy();
  });

  it("hides the error when nothing is picked", () => {
    useConnections.setState({ activeId: null });
    const ui = renderWithProviders(
      <ConnectionList payloadError={{ message: "boom", keychain: true }} />,
    );
    expect(ui.queryByText(/Keychain/)).toBeNull();
  });

  it("does not blame the Keychain for other failures", () => {
    const ui = renderWithProviders(
      <ConnectionList
        payloadError={{ message: "unknown connection a", keychain: false }}
      />,
    );
    expect(
      ui.getByText(/Couldn't load this connection: unknown connection a/),
    ).toBeTruthy();
  });
});

describe("ConnectionList form modal", () => {
  afterEach(() => useConnectionUI.getState().closeNewConnection());

  it("stays open on Esc", async () => {
    useConnections.setState({
      connections: [A],
      activeId: "a",
      loaded: true,
      loadError: null,
    });
    const ui = renderWithProviders(<ConnectionList />);
    fireEvent.click(ui.getByRole("button", { name: "New" }));
    const dialog = await ui.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    // Assert on the flag because the dialog title stays in the DOM during the
    // close transition.
    expect(useConnectionUI.getState().newConnectionOpen).toBe(true);
  });
});
