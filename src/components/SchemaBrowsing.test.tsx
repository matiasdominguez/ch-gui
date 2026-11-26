import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelScan,
  fetchColumnDistribution,
  fetchColumnStats,
  fetchTableDetails,
  introspectDatabases,
  introspectTables,
} from "../lib/tauri";
import { renderWithProviders } from "../test/render";
import type { ConnectionConfigPayload, TableDetails } from "../types";
import { ColumnStatsDrawer } from "./ColumnStatsDrawer";
import { SchemaTree } from "./SchemaTree";
import { TableDetailsDrawer } from "./TableDetailsDrawer";

vi.mock("../lib/tauri", () => ({
  introspectDatabases: vi.fn(),
  introspectTables: vi.fn(),
  introspectColumns: vi.fn().mockResolvedValue([]),
  cancelScan: vi.fn(),
  fetchColumnStats: vi.fn(),
  fetchColumnDistribution: vi.fn(),
  fetchTableDetails: vi.fn(),
  fetchPartsSummary: vi.fn().mockResolvedValue({ status: "disabled" }),
  fetchDependencyGraph: vi.fn(),
  listMvFailures: vi.fn(),
  listKafkaConsumers: vi.fn(),
}));

const PAYLOAD = { id: "c1", host: "h", port: 9000 } as ConnectionConfigPayload;

function withQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

describe("schema tree kinds", () => {
  beforeEach(() => {
    vi.mocked(introspectDatabases).mockResolvedValue([
      { name: "smoke" },
    ] as never);
    vi.mocked(introspectTables).mockResolvedValue([
      { name: "daily_mv", engine: "MaterializedView" },
      {
        name: ".inner_id.e216f127-5a2c-4fa8-b64f-d0c71db1ed3e",
        engine: "MergeTree",
      },
      { name: "orders", engine: "MergeTree" },
    ] as never);
  });

  it("hides a view's storage table and names each table's kind", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    fireEvent.click(await ui.findByText(/smoke/));
    const mv = await ui.findByText("daily_mv");
    expect(mv.closest("button")).toHaveAttribute(
      "title",
      "Materialized view · MaterializedView",
    );
    expect(ui.getByText("orders").closest("button")).toHaveAttribute(
      "title",
      "Table · MergeTree",
    );
    expect(ui.queryByText(/\.inner_id\./)).toBeNull();
  });

  it("shows the server's message when tables fail to load and retries", async () => {
    vi.mocked(introspectTables).mockReset();
    vi.mocked(introspectTables)
      .mockRejectedValueOnce({ message: "Code: 60. Unknown table" })
      .mockResolvedValue([{ name: "orders", engine: "MergeTree" }] as never);
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    fireEvent.click(await ui.findByText(/smoke/));
    expect(await ui.findByText("Code: 60. Unknown table")).toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: "Retry" }));
    expect(await ui.findByText("orders")).toBeInTheDocument();
  });
});

describe("schema filter", () => {
  beforeEach(() => {
    vi.mocked(introspectDatabases).mockResolvedValue([
      { name: "analytics" },
      { name: "smoke" },
    ] as never);
    vi.mocked(introspectTables).mockImplementation(
      async (_p, db) =>
        (db === "smoke"
          ? [{ name: "orders" }, { name: "events" }]
          : [{ name: "sessions" }]) as never,
    );
  });

  it("finds a table by name and opens its database", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/smoke/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "orde" },
    });
    await ui.findByText(/\borders\b/);
    expect(ui.queryByText(/\bevents\b/)).toBeNull();
    expect(ui.queryByText(/analytics/)).toBeNull();
  });

  it("collapses a matched database on click", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/smoke/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "orde" },
    });
    await ui.findByText(/\borders\b/);
    fireEvent.click(ui.getByText(/smoke/));
    await waitFor(() => expect(ui.queryByText(/\borders\b/)).toBeNull());
    fireEvent.click(ui.getByText(/smoke/));
    await ui.findByText(/\borders\b/);
  });

  it("names databases whose tables couldn't be searched", async () => {
    vi.mocked(introspectTables).mockImplementation(async (_p, db) => {
      if (db === "analytics") throw new Error("no access");
      return [{ name: "orders" }] as never;
    });
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/smoke/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "zzz" },
    });
    await ui.findByText(
      "Couldn't load the tables in analytics, so the filter skips them.",
    );
  });

  it("loads table lists at most four at a time while searching", async () => {
    const names = Array.from({ length: 12 }, (_, i) => ({ name: `db${i}` }));
    vi.mocked(introspectDatabases).mockResolvedValue(names as never);
    let inFlight = 0;
    let peak = 0;
    vi.mocked(introspectTables).mockClear();
    vi.mocked(introspectTables).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [{ name: "t" }] as never;
    });
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/db11/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "t" },
    });
    await waitFor(() => expect(introspectTables).toHaveBeenCalledTimes(12));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("Refresh schema reloads the tables the search found", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/smoke/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "orde" },
    });
    await ui.findByText(/\borders\b/);
    vi.mocked(introspectTables).mockImplementation(
      async (_p, db) =>
        (db === "smoke" ? [{ name: "orders_v2" }] : []) as never,
    );
    fireEvent.click(ui.getByRole("button", { name: "Refresh schema" }));
    await ui.findByText(/orders_v2/);
  });

  it("says so when nothing matches", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    await ui.findByText(/smoke/);
    fireEvent.change(ui.getByPlaceholderText("Filter databases and tables…"), {
      target: { value: "zzz" },
    });
    await ui.findByText("No databases or tables match “zzz”.");
  });
});

describe("column stats drawer", () => {
  beforeEach(() => {
    vi.mocked(fetchColumnStats)
      .mockReset()
      .mockResolvedValue({
        database: "smoke",
        table: "orders",
        column: "total",
        type_str: "Decimal(18, 2)",
        total: 200,
        nulls: 0,
        uniq_approx: 37,
        min: "0",
        max: "36",
      } as never);
    vi.mocked(fetchColumnDistribution)
      .mockReset()
      .mockResolvedValue({ kind: "none", reason: "" } as never);
  });

  it("scans nothing until Compute stats is clicked", async () => {
    const ui = withQuery(
      <ColumnStatsDrawer
        opened
        onClose={() => {}}
        payload={PAYLOAD}
        database="smoke"
        table="orders"
        column="total"
      />,
    );
    const button = await ui.findByRole("button", { name: "Compute stats" });
    expect(fetchColumnStats).not.toHaveBeenCalled();
    expect(fetchColumnDistribution).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(fetchColumnStats).toHaveBeenCalledTimes(1));
    expect(fetchColumnDistribution).toHaveBeenCalledTimes(1);
  });
});

describe("column stats drawer, scanning", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rejects: Array<(e: unknown) => void> = [];
    const hang = () => new Promise<never>((_, reject) => rejects.push(reject));
    vi.mocked(fetchColumnStats).mockReset().mockImplementation(hang);
    vi.mocked(fetchColumnDistribution).mockReset().mockImplementation(hang);
    vi.mocked(cancelScan)
      .mockReset()
      .mockImplementation(async () => {
        rejects.forEach((r) => r({ message: "Query was cancelled" }));
      });
  });

  const drawer = (column: string) => (
    <QueryClientProvider client={qc}>
      <ColumnStatsDrawer
        opened
        onClose={() => {}}
        payload={PAYLOAD}
        database="smoke"
        table="orders"
        column={column}
      />
    </QueryClientProvider>
  );

  async function startScan() {
    const ui = renderWithProviders(drawer("total"));
    fireEvent.click(await ui.findByRole("button", { name: "Compute stats" }));
    await waitFor(() => expect(fetchColumnDistribution).toHaveBeenCalled());
    const ids = [
      vi.mocked(fetchColumnStats).mock.calls[0]![4],
      vi.mocked(fetchColumnDistribution).mock.calls[0]![4],
    ];
    return { ui, ids };
  }

  const cancelledIds = () =>
    vi.mocked(cancelScan).mock.calls.map(([cfg, id]) => [cfg.id, id]);

  it("Cancel kills both scans and asks again without an error", async () => {
    const { ui, ids } = await startScan();
    ui.getByLabelText("Elapsed time");
    fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
    await ui.findByRole("button", { name: "Compute stats" });
    expect(cancelledIds()).toEqual(ids.map((id) => ["c1", id]));
    await new Promise((r) => setTimeout(r, 20));
    expect(ui.queryByText("Query was cancelled")).toBeNull();
  });

  it("closing the drawer kills both scans", async () => {
    const { ids } = await startScan();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".mantine-Drawer-close")!,
    );
    await waitFor(() =>
      expect(cancelledIds()).toEqual(ids.map((id) => ["c1", id])),
    );
  });

  it("switching columns kills both scans and does not restart them", async () => {
    const { ui, ids } = await startScan();
    ui.rerender(drawer("id"));
    await waitFor(() =>
      expect(cancelledIds()).toEqual(ids.map((id) => ["c1", id])),
    );
    ui.rerender(drawer("total"));
    await ui.findByRole("button", { name: "Compute stats" });
    expect(fetchColumnStats).toHaveBeenCalledTimes(1);
  });

  it("Cancel during Recompute kills both scans and keeps the cached stats", async () => {
    qc.setQueryData(["column_stats", "c1", "smoke", "orders", "total"], {
      total: 4321,
      nulls: 0,
      uniq_approx: 1,
      min: "0",
      max: "0",
      type_str: "UInt8",
    });
    const ui = renderWithProviders(drawer("total"));
    fireEvent.click(await ui.findByRole("button", { name: "Recompute" }));
    fireEvent.click(await ui.findByRole("button", { name: "Cancel" }));
    await ui.findByRole("button", { name: "Recompute" });
    const ids = [
      vi.mocked(fetchColumnStats).mock.calls[0]![4],
      vi.mocked(fetchColumnDistribution).mock.calls[0]![4],
    ];
    expect(cancelledIds()).toEqual(ids.map((id) => ["c1", id]));
    await new Promise((r) => setTimeout(r, 20));
    ui.getByText("4.3k");
    expect(ui.queryByText("Query was cancelled")).toBeNull();
  });
});

describe("column stats drawer, reopened", () => {
  it("asks again instead of rescanning on its own", async () => {
    vi.mocked(fetchColumnStats)
      .mockReset()
      .mockResolvedValue({
        total: 1,
        nulls: 0,
        uniq_approx: 1,
        min: "0",
        max: "0",
        type_str: "UInt8",
      } as never);
    vi.mocked(fetchColumnDistribution)
      .mockReset()
      .mockResolvedValue({ kind: "none", reason: "" } as never);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
    const drawer = (opened: boolean, onClose: () => void) => (
      <QueryClientProvider client={qc}>
        <ColumnStatsDrawer
          opened={opened}
          onClose={onClose}
          payload={PAYLOAD}
          database="smoke"
          table="orders"
          column="id"
        />
      </QueryClientProvider>
    );
    let open = true;
    const ui = renderWithProviders(drawer(open, () => (open = false)));
    fireEvent.click(await ui.findByRole("button", { name: "Compute stats" }));
    await waitFor(() => expect(fetchColumnStats).toHaveBeenCalledTimes(1));
    const close = document.querySelector<HTMLButtonElement>(
      ".mantine-Drawer-close",
    )!;
    fireEvent.click(close);
    ui.rerender(drawer(false, () => {}));
    qc.invalidateQueries({ refetchType: "none" });
    ui.rerender(drawer(true, () => {}));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchColumnStats).toHaveBeenCalledTimes(1);

    fireEvent.click(await ui.findByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(fetchColumnStats).toHaveBeenCalledTimes(2));
  });
});

describe("table drawer", () => {
  const details: TableDetails = {
    database: "smoke",
    table: "orders",
    engine: "MergeTree",
    engine_full: "MergeTree ORDER BY id",
    partition_key: "toYYYYMM(created)",
    sorting_key: "id",
    primary_key: "id",
    sampling_key: "",
    total_rows: 50000,
    total_bytes: 1000,
    comment: "One row per order.",
    create_table_query:
      "CREATE TABLE smoke.orders (id UInt64) ENGINE = MergeTree ORDER BY id",
    partitions: Array.from({ length: 12 }, (_, i) => ({
      partition: `2026${String(i + 1).padStart(2, "0")}`,
      rows: 1,
      bytes: 1,
      parts: 1,
    })),
    columns: [
      {
        name: "total",
        type_str: "Decimal(18, 2)",
        default_kind: "",
        default_expression: "",
        compression_codec: "",
        comment: "Order total in USD",
      },
    ],
    skip_indexes: [],
    dependencies: [],
    projections: [],
  } as TableDetails;

  it("leads with the comment and columns and folds the internals", async () => {
    vi.mocked(fetchTableDetails).mockResolvedValue(details);
    const ui = withQuery(
      <TableDetailsDrawer
        opened
        onClose={() => {}}
        payload={PAYLOAD}
        database="smoke"
        table="orders"
      />,
    );
    await ui.findByText("One row per order.");
    expect(ui.getByText("Order total in USD")).toBeTruthy();
    expect(ui.queryByText(/MergeTree keys/i)).toBeNull();
    expect(ui.queryByText("202601")).toBeNull();

    fireEvent.click(ui.getByRole("button", { name: /Storage details/ }));
    await ui.findByText(/MergeTree keys/i);
    expect(ui.getByText("202610")).toBeTruthy();
    expect(ui.queryByText("202611")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Show all 12" }));
    expect(ui.getByText("202612")).toBeTruthy();
  });
});
