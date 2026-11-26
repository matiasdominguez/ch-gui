import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  listRunningQueries: vi.fn(() => new Promise(() => {})),
  canKillOthers: vi.fn(() => Promise.resolve(false)),
  killRunningQuery: vi.fn(() => Promise.resolve("finished")),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn(), hide: vi.fn() },
}));

import { DEFAULT_LIVE_QUERIES_INTERVAL } from "../lib/pollingInterval";
import { useUserPrefs } from "../state/userPreferences";
import { RunningQueries } from "./RunningQueries";
import type { ConnectionConfigPayload, RunningQuery } from "../types";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MantineProvider defaultColorScheme="light">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function fakePayload(): ConnectionConfigPayload {
  return {
    id: "conn-1",
    host: "localhost",
    port: 9440,
    user: "default",
    password: "",
    secure: true,
    default_database: null,
    custom_ca_pem: null,
    cluster_name: null,
    cluster_fanout: false,
  };
}

function resetPrefs() {
  window.localStorage.clear();
  useUserPrefs.setState({
    liveQueriesPollingMs: DEFAULT_LIVE_QUERIES_INTERVAL,
    hideLiveQueriesTab: false,
  });
}

describe("RunningQueries status line", () => {
  beforeEach(resetPrefs);

  it("shows the default 5s text when polling is at the default", () => {
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("live-queries-status")).toHaveTextContent(
      "Polling every 5s",
    );
  });

  it("reflects a 2s polling choice", () => {
    useUserPrefs.setState({ liveQueriesPollingMs: 2000 });
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("live-queries-status")).toHaveTextContent(
      "Polling every 2s",
    );
  });

  it("shows the off text and points at Settings when polling is off", () => {
    useUserPrefs.setState({ liveQueriesPollingMs: "off" });
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("live-queries-status")).toHaveTextContent(
      "Polling off: turn it on in Settings",
    );
  });

  it("says Loading while the first poll is in flight", () => {
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/no running queries/i)).toBeNull();
  });

  it("shows the error and a retrying status when a poll fails", async () => {
    const { listRunningQueries } = await import("../lib/tauri");
    vi.mocked(listRunningQueries).mockRejectedValueOnce({
      kind: "connect",
      message: "Connection refused",
    });
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(await screen.findByText(/connection refused/i)).toBeInTheDocument();
    expect(screen.getByTestId("live-queries-status")).toHaveTextContent(
      "Last poll failed: retrying",
    );
    expect(screen.queryByText(/no running queries/i)).toBeNull();
  });

  it("says polling stopped when the server denies access", async () => {
    const { listRunningQueries } = await import("../lib/tauri");
    vi.mocked(listRunningQueries).mockRejectedValueOnce({
      kind: "clickhouse",
      message: "server exception: 497 ACCESS_DENIED: not enough privileges",
      code: 497,
    });
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(
      await screen.findByText(/not enough privileges/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("live-queries-status")).toHaveTextContent(
      "Polling stopped: see the error below",
    );
  });

  it("shows the connection-required message when no payload is provided", () => {
    render(
      <Providers>
        <RunningQueries payload={null} connectionId={null} />
      </Providers>,
    );
    expect(
      screen.getByText(/pick a connection to see its running queries/i),
    ).toBeInTheDocument();
  });
});

function row(user: string, query_id: string): RunningQuery {
  return {
    query_id,
    user,
    elapsed_s: 12,
    read_rows: 1,
    read_bytes: 1,
    memory_usage: 1,
    query: `SELECT '${query_id}'`,
  };
}

describe("RunningQueries Stop", () => {
  beforeEach(resetPrefs);

  async function renderRows(killOthers: boolean) {
    const tauri = await import("../lib/tauri");
    vi.mocked(tauri.listRunningQueries).mockResolvedValueOnce([
      row("default", "mine"),
      row("someone", "theirs"),
    ]);
    vi.mocked(tauri.canKillOthers).mockResolvedValueOnce(killOthers);
    render(
      <Providers>
        <RunningQueries payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    await screen.findByText("SELECT 'theirs'");
    await waitFor(() => expect(tauri.canKillOthers).toHaveBeenCalled());
    return tauri;
  }

  it("offers Stop only on your own queries without KILL QUERY", async () => {
    await renderRows(false);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1),
    );
  });

  it("tags only the connected user's queries as yours", async () => {
    await renderRows(false);
    expect(screen.getAllByText("yours")).toHaveLength(1);
  });

  it("offers Stop on every query with KILL QUERY", async () => {
    await renderRows(true);
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(2);
  });

  it("confirms, stops, and says so", async () => {
    const tauri = await renderRows(false);
    const { notifications } = await import("@mantine/notifications");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText(/your query/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop query" }));
    await waitFor(() =>
      expect(tauri.killRunningQuery).toHaveBeenCalledWith(
        expect.anything(),
        "mine",
      ),
    );
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Query stopped" }),
      ),
    );
  });

  it("says when no running query matched", async () => {
    const tauri = await renderRows(false);
    vi.mocked(tauri.killRunningQuery).mockResolvedValueOnce(null);
    const { notifications } = await import("@mantine/notifications");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop query" }));
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "No running query matched. It may have finished.",
        }),
      ),
    );
  });
});
