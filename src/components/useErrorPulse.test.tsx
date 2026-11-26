import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { errorPulseMock } = vi.hoisted(() => ({
  errorPulseMock: vi.fn(() =>
    Promise.resolve({
      errors_recent: 0,
      mv_failures_recent: 0,
      pending_mutations: 0,
      max_replica_queue: 0,
    }),
  ),
}));

vi.mock("../lib/tauri", () => ({
  errorPulse: errorPulseMock,
  listServerErrors: vi.fn(() => new Promise(() => {})),
  listMvFailures: vi.fn(() => new Promise(() => {})),
  listPendingMutations: vi.fn(() => new Promise(() => {})),
  listReplicaQueue: vi.fn(() => new Promise(() => {})),
}));

import { useErrorPulse } from "./Errors";
import { DEFAULT_POLLING_INTERVAL } from "../lib/pollingInterval";
import { useUserPrefs } from "../state/userPreferences";
import type { ConnectionConfigPayload } from "../types";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
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

function Probe() {
  useErrorPulse(fakePayload(), "conn-1");
  return null;
}

describe("useErrorPulse hide gating", () => {
  beforeEach(() => {
    errorPulseMock.mockClear();
    window.localStorage.clear();
    useUserPrefs.setState({
      serverActivityPollingMs: DEFAULT_POLLING_INTERVAL,
      hideServerActivityTab: false,
    });
  });

  it("fires when the Server Activity tab is visible", async () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    await waitFor(() => {
      expect(errorPulseMock).toHaveBeenCalled();
    });
  });

  it("does not fire when the Server Activity tab is hidden, even with polling set", () => {
    useUserPrefs.setState({
      serverActivityPollingMs: 10000,
      hideServerActivityTab: true,
    });
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(errorPulseMock).not.toHaveBeenCalled();
  });

  it("does not fire at all when polling is Off, even with the tab visible", () => {
    useUserPrefs.setState({
      serverActivityPollingMs: "off",
      hideServerActivityTab: false,
    });
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(errorPulseMock).not.toHaveBeenCalled();
  });
});
