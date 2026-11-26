import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { llmReport, type ErrorDetail } from "../lib/llmReport";
import { versionInfo } from "../lib/tauri";
import { renderWithProviders } from "../test/render";
import type { ConnectionConfigPayload } from "../types";
import { CopyForLlmButton } from "./CopyForLlmButton";

vi.mock("../lib/tauri", () => ({ versionInfo: vi.fn() }));

function QueryReportButton({ detail }: { detail: ErrorDetail }) {
  return (
    <CopyForLlmButton
      conn={detail.conn}
      report={(v) => llmReport(detail, v)}
      tooltip="copy"
    />
  );
}

const DETAIL: ErrorDetail = {
  sql: "SELECT foo",
  queryId: "q-1",
  message: "Unknown identifier foo",
  statement: null,
  conn: { id: "c1", host: "h", port: 9000 } as ConnectionConfigPayload,
};

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>
      <QueryReportButton detail={DETAIL} />
    </QueryClientProvider>,
  );
}

describe("CopyForLlmButton", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.mocked(versionInfo).mockReset();
  });

  it("copies the report with both versions", async () => {
    vi.mocked(versionInfo).mockResolvedValue({
      server: "26.3.1",
      app: "0.2.15",
    });
    const { getByText } = renderButton();
    await waitFor(() => expect(versionInfo).toHaveBeenCalledWith(DETAIL.conn));
    await waitFor(() => {
      fireEvent.click(getByText("Copy for LLM"));
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining(
          "ClickHouse server: 26.3.1\nClient: ch-gui 0.2.15",
        ),
      );
    });
    expect(
      vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0],
    ).toContain("```sql\nSELECT foo\n```");
  });

  it("refetches on every mount, so an edited connection reports its new server", async () => {
    vi.mocked(versionInfo)
      .mockResolvedValueOnce({ server: "25.8.1", app: "0.2.15" })
      .mockResolvedValueOnce({ server: "26.3.1", app: "0.2.15" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = (
      <QueryClientProvider client={qc}>
        <QueryReportButton detail={DETAIL} />
      </QueryClientProvider>
    );
    const first = renderWithProviders(ui);
    await waitFor(() => expect(versionInfo).toHaveBeenCalledTimes(1));
    first.unmount();

    const { getByText } = renderWithProviders(ui);
    await waitFor(() => expect(versionInfo).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      fireEvent.click(getByText("Copy for LLM"));
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining("ClickHouse server: 26.3.1"),
      );
    });
  });

  it("says unknown while a refetch is in flight, never the stale version", async () => {
    vi.mocked(versionInfo)
      .mockResolvedValueOnce({ server: "25.8.1", app: "0.2.15" })
      .mockReturnValueOnce(new Promise(() => {}));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = (
      <QueryClientProvider client={qc}>
        <QueryReportButton detail={DETAIL} />
      </QueryClientProvider>
    );
    const first = renderWithProviders(ui);
    await waitFor(() => expect(versionInfo).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        qc.getQueriesData({ queryKey: ["versionInfo", "c1"] })[0]?.[1],
      ).toBeTruthy(),
    );
    first.unmount();

    const { getByText } = renderWithProviders(ui);
    await waitFor(() => expect(versionInfo).toHaveBeenCalledTimes(2));
    fireEvent.click(getByText("Copy for LLM"));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("ClickHouse server: unknown"),
    );
  });

  it("never shares a request between an edited connection and its old server", async () => {
    let resolveOld: (v: { server: string; app: string }) => void = () => {};
    vi.mocked(versionInfo)
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ server: "26.3.1", app: "0.2.15" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrap = (detail: ErrorDetail) => (
      <QueryClientProvider client={qc}>
        <QueryReportButton detail={detail} />
      </QueryClientProvider>
    );
    const first = renderWithProviders(wrap(DETAIL));
    await waitFor(() => expect(versionInfo).toHaveBeenCalledTimes(1));
    first.unmount();

    const edited = { ...DETAIL, conn: { ...DETAIL.conn, host: "new-host" } };
    const { getByText } = renderWithProviders(wrap(edited));
    await waitFor(() =>
      expect(versionInfo).toHaveBeenLastCalledWith(edited.conn),
    );
    resolveOld({ server: "25.8.1", app: "0.2.15" });
    await waitFor(() => {
      fireEvent.click(getByText("Copy for LLM"));
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining("ClickHouse server: 26.3.1"),
      );
    });
  });

  it("still copies when the server can't be reached", async () => {
    vi.mocked(versionInfo).mockRejectedValue(new Error("offline"));
    const { getByText } = renderButton();
    fireEvent.click(getByText("Copy for LLM"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("ClickHouse server: unknown"),
    );
  });
});
