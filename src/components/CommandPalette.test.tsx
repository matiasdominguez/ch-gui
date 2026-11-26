import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";

vi.mock("../lib/db", () => ({
  listSavedQueries: vi.fn().mockResolvedValue([]),
  listHistory: vi.fn().mockResolvedValue([]),
}));

describe("CommandPalette", () => {
  it("says that picking a table inserts its name", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dbs", "c1"], [{ name: "sales" }]);
    qc.setQueryData(["tables", "c1", "sales"], [{ name: "orders" }]);
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <CommandPalette
            opened
            connectionId="c1"
            tabs={[]}
            activeTabId={null}
            connections={[]}
            onClose={() => {}}
            onPick={() => {}}
          />
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(screen.getByText("Insert table name")).toBeInTheDocument();
    expect(screen.getByText("Insert database name")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search tables, queries, tabs, actions…"),
    ).toBeInTheDocument();
  });
});
