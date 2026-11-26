import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  listServerErrors: vi.fn(() => new Promise(() => {})),
  listMvFailures: vi.fn(() => new Promise(() => {})),
  listPendingMutations: vi.fn(() => new Promise(() => {})),
  listReplicaQueue: vi.fn(() => new Promise(() => {})),
  errorPulse: vi.fn(() => new Promise(() => {})),
  versionInfo: vi.fn(() =>
    Promise.resolve({ server: "26.3.1", app: "0.2.16" }),
  ),
}));

import { DEFAULT_POLLING_INTERVAL } from "../lib/pollingInterval";
import { listMvFailures, listServerErrors } from "../lib/tauri";
import { useUserPrefs } from "../state/userPreferences";
import { Errors } from "./Errors";
import type { ConnectionConfigPayload } from "../types";

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
    serverActivityPollingMs: DEFAULT_POLLING_INTERVAL,
    hideServerActivityTab: false,
  });
}

describe("Errors status line", () => {
  beforeEach(resetPrefs);

  it("shows the default 30s text at the default polling interval", () => {
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("server-activity-status")).toHaveTextContent(
      "Polling every 30s",
    );
  });

  it("reflects a 5s polling choice", () => {
    useUserPrefs.setState({ serverActivityPollingMs: 5000 });
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("server-activity-status")).toHaveTextContent(
      "Polling every 5s",
    );
  });

  it("shows the off text and points at Settings when polling is off", () => {
    useUserPrefs.setState({ serverActivityPollingMs: "off" });
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.getByTestId("server-activity-status")).toHaveTextContent(
      "Polling off: turn it on in Settings",
    );
  });

  it("does not render a Pause/Resume button anymore", () => {
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });

  it("shows the connection-required message when no payload is provided", () => {
    render(
      <Providers>
        <Errors payload={null} connectionId={null} />
      </Providers>,
    );
    expect(
      screen.getByText(/pick a connection to see cluster errors/i),
    ).toBeInTheDocument();
  });
});

describe("Server error rows", () => {
  beforeEach(() => {
    resetPrefs();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("copies an expanded error as a report for an LLM", async () => {
    vi.mocked(listServerErrors).mockResolvedValueOnce([
      {
        name: "NO_REPLICA_HAS_PART",
        code: 234,
        count: 2770,
        last_error_time: "2026-09-27 19:40:12",
        last_error_message: "No active replica has part 202609_1_1_0",
        remote: false,
        recent: true,
      },
    ]);
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    fireEvent.click(await screen.findByText("Server errors"));
    expect(await screen.findByText("new")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("NO_REPLICA_HAS_PART"));

    const button = screen.getByRole("button", { name: "Copy for LLM" });
    expect(button.parentElement?.closest("button")).toBeNull();

    await waitFor(() => {
      fireEvent.click(button);
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining("ClickHouse server: 26.3.1"),
      );
    });
    const text = vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0];
    expect(text).toContain("Error: NO_REPLICA_HAS_PART (code 234)");
    expect(text).toContain("No active replica has part 202609_1_1_0");
  });
});

describe("Activity header with mixed failures", () => {
  beforeEach(resetPrefs);

  it("says stopped when one query stopped, though another retries", async () => {
    vi.mocked(listServerErrors).mockRejectedValueOnce({
      kind: "connect",
      message: "Connection refused",
    });
    vi.mocked(listMvFailures).mockRejectedValueOnce({
      kind: "clickhouse",
      message: "server exception: 497 ACCESS_DENIED",
      code: 497,
    });
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("server-activity-status")).toHaveTextContent(
        "Polling stopped: see the error below",
      ),
    );
  });
});

describe("MV failure rows", () => {
  beforeEach(() => {
    resetPrefs();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("copies a failure as a report for an LLM", async () => {
    vi.mocked(listMvFailures).mockResolvedValueOnce({
      status: "enabled",
      rows: [
        {
          event_time: "2026-09-27 18:00:01",
          view_name: "smoke.audit_mv",
          view_type: "Materialized",
          status: "ExceptionWhileProcessing",
          exception: "audit rule failed",
          initial_query_id: "q-42",
          initial_query: "INSERT INTO smoke.orders VALUES (1)",
          recent: false,
        },
      ],
    });
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    fireEvent.click(await screen.findByText("smoke.audit_mv"));
    const button = await screen.findByRole("button", { name: "Copy for LLM" });
    await waitFor(() => {
      fireEvent.click(button);
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining("View: smoke.audit_mv (Materialized)"),
      );
    });
  });
});

describe("rows outside the Activity count", () => {
  beforeEach(resetPrefs);

  it("carry no new marker", async () => {
    vi.mocked(listServerErrors).mockResolvedValueOnce([
      {
        name: "SYNTAX_ERROR",
        code: 62,
        count: 4,
        last_error_time: "2026-09-27 19:40:12",
        last_error_message: "Syntax error",
        remote: false,
        recent: false,
      },
    ]);
    render(
      <Providers>
        <Errors payload={fakePayload()} connectionId="conn-1" />
      </Providers>,
    );
    fireEvent.click(await screen.findByText("Server errors"));
    await screen.findByText("SYNTAX_ERROR");
    expect(screen.queryByText("new")).toBeNull();
  });
});
