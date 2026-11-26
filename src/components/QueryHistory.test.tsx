import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  listHistory: vi.fn(() => Promise.reject(new Error("database is locked"))),
  setHistoryPinned: vi.fn(),
}));

import { listHistory } from "../lib/db";
import { QueryHistory } from "./QueryHistory";

describe("QueryHistory", () => {
  it("shows a local history failure instead of an empty list", async () => {
    render(
      <MantineProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <QueryHistory connectionId="conn-1" payload={null} />
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText("database is locked")).toBeTruthy();
    expect(screen.queryByText("No queries yet.")).toBeNull();
  });

  it("says no queries match when a search filters out every row", async () => {
    vi.mocked(listHistory).mockResolvedValue([]);
    render(
      <MantineProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <QueryHistory connectionId="conn-1" payload={null} />
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText("No queries yet.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzz" } });
    expect(await screen.findByText("No queries match “zzz”.")).toBeTruthy();
  });

  it("says the connection is not ready when the active connection failed to load", () => {
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <QueryHistory connectionId={null} payload={null} loadFailed />
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(
      screen.getByText(
        "This connection isn't ready. The connection picker shows the error.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Pick a connection/)).toBeNull();
  });
});
