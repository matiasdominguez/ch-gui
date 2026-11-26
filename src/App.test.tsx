import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { useTabs } from "./state/tabs";
import { renderWithProviders } from "./test/render";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no backend")),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: vi.fn() }),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockRejectedValue(new Error("no backend")),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn().mockRejectedValue(new Error("no backend")) },
}));
vi.mock("./components/TabPane", () => ({ TabPane: () => null }));
vi.mock("./lib/sqlCompletion", () => ({ setCompletionContext: vi.fn() }));

describe("editor tab strip", () => {
  it("moves to and activates the neighbouring tab with the arrow keys", () => {
    act(() => {
      useTabs.getState().open({ title: "first", sql: "" });
      useTabs.getState().open({ title: "second", sql: "" });
    });
    const qc = new QueryClient();
    const ui = renderWithProviders(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );
    const second = ui.getByRole("tab", { name: /second/ });
    expect(second).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(second, { key: "ArrowLeft" });

    const first = ui.getByRole("tab", { name: /first/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });
});
