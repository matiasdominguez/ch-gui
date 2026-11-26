import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { introspectDatabases, introspectTables } from "../lib/tauri";
import { useTabs } from "../state/tabs";
import { renderWithProviders } from "../test/render";
import type { ConnectionConfigPayload } from "../types";
import { SchemaTree } from "./SchemaTree";

vi.mock("../lib/tauri", () => ({
  introspectDatabases: vi.fn(),
  introspectTables: vi.fn(),
  introspectColumns: vi.fn().mockResolvedValue([]),
}));

const PAYLOAD = { id: "c1", host: "h", port: 9000 } as ConnectionConfigPayload;

function withQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

async function openMenu(
  onRunTab = vi.fn(),
  onInsert = vi.fn(),
  table = "orders",
) {
  const ui = withQuery(
    <SchemaTree payload={PAYLOAD} onRunTab={onRunTab} onInsert={onInsert} />,
  );
  fireEvent.click(await ui.findByText(/smoke/));
  fireEvent.click(await ui.findByLabelText(`Actions for ${table}`));
  return { ui, onRunTab, onInsert };
}

describe("table actions", () => {
  beforeEach(() => {
    vi.mocked(introspectDatabases).mockResolvedValue([
      { name: "smoke" },
    ] as never);
    vi.mocked(introspectTables).mockResolvedValue([
      { name: "orders", engine: "MergeTree" },
      { name: "clicks_queue", engine: "Kafka" },
      { name: "daily revenue", engine: "SummingMergeTree" },
      { name: "landing", engine: "S3Queue" },
    ] as never);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("Preview opens the query and runs it", async () => {
    const { ui, onRunTab } = await openMenu();
    fireEvent.click(await ui.findByText("Preview 100 rows"));
    const { tabs, activeId } = useTabs.getState();
    const tab = tabs.find((t) => t.id === activeId);
    expect(tab?.sql).toBe("SELECT *\nFROM `smoke`.`orders`\nLIMIT 100");
    expect(onRunTab).toHaveBeenCalledWith(activeId);
  });

  it("Preview of a Kafka table opens the query without running it", async () => {
    const { ui, onRunTab } = await openMenu(vi.fn(), vi.fn(), "clicks_queue");
    fireEvent.click(await ui.findByText("Open a preview query"));
    const { tabs, activeId } = useTabs.getState();
    expect(tabs.find((t) => t.id === activeId)?.title).toBe(
      "smoke.clicks_queue",
    );
    expect(onRunTab).not.toHaveBeenCalled();
  });

  it("Preview of an S3Queue table doesn't run either", async () => {
    const { ui, onRunTab } = await openMenu(vi.fn(), vi.fn(), "landing");
    fireEvent.click(await ui.findByText("Open a preview query"));
    expect(onRunTab).not.toHaveBeenCalled();
  });

  it("Insert name puts the bare name at the cursor", async () => {
    const { ui, onInsert } = await openMenu();
    fireEvent.click(await ui.findByText("Insert name"));
    expect(onInsert).toHaveBeenCalledWith("smoke.orders");
  });

  it("quotes a name that needs it", async () => {
    const { ui, onInsert } = await openMenu(vi.fn(), vi.fn(), "daily revenue");
    fireEvent.click(await ui.findByText("Insert name"));
    expect(onInsert).toHaveBeenCalledWith("smoke.`daily revenue`");
  });

  it("Copy name puts the name on the clipboard", async () => {
    const { ui } = await openMenu();
    fireEvent.click(await ui.findByText("Copy name"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "smoke.orders",
      ),
    );
  });

  it("double-click on a table previews it and leaves it collapsed", async () => {
    const onRunTab = vi.fn();
    const ui = withQuery(<SchemaTree payload={PAYLOAD} onRunTab={onRunTab} />);
    fireEvent.click(await ui.findByText(/smoke/));
    const row = (await ui.findByText("orders")).closest("button")!;
    expect(row).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.doubleClick(row);

    const { tabs, activeId } = useTabs.getState();
    expect(tabs.find((t) => t.id === activeId)?.sql).toBe(
      "SELECT *\nFROM `smoke`.`orders`\nLIMIT 100",
    );
    expect(onRunTab).toHaveBeenCalledWith(activeId);
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("right-click on a table opens its actions", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    fireEvent.click(await ui.findByText(/smoke/));
    fireEvent.contextMenu(await ui.findByText(/\borders\b/));
    expect(await ui.findByText("Preview 100 rows")).toBeInTheDocument();
  });
});

describe("schema tree keys", () => {
  beforeEach(() => {
    vi.mocked(introspectDatabases).mockResolvedValue([
      { name: "analytics" },
      { name: "smoke" },
    ] as never);
    vi.mocked(introspectTables).mockResolvedValue([
      { name: "orders", engine: "MergeTree" },
    ] as never);
  });

  it("Down moves to the next row; Right opens a row, then enters it", async () => {
    const ui = withQuery(<SchemaTree payload={PAYLOAD} />);
    const analytics = (await ui.findByText("analytics")).closest("button")!;
    const smoke = ui.getByText("smoke").closest("button")!;
    analytics.focus();

    fireEvent.keyDown(analytics, { key: "ArrowDown" });
    expect(smoke).toHaveFocus();

    fireEvent.keyDown(smoke, { key: "ArrowRight" });
    expect(smoke).toHaveAttribute("aria-expanded", "true");
    const orders = (await ui.findByText("orders")).closest("button")!;

    fireEvent.keyDown(smoke, { key: "ArrowRight" });
    expect(orders).toHaveFocus();

    fireEvent.keyDown(orders, { key: "ArrowLeft" });
    expect(smoke).toHaveFocus();
  });
});
