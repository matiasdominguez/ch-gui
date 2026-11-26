import { describe, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { LogsPanel } from "./LogsPanel";

const BASE = {
  logs: [],
  level: "information" as const,
  unavailable: false,
  running: false,
  ran: false,
};

describe("LogsPanel", () => {
  it("says logs are unavailable when the server refused them", () => {
    const ui = renderWithProviders(<LogsPanel {...BASE} unavailable running />);
    ui.getByText("Server logs aren't available for this user.");
  });

  it("waits while a query runs", () => {
    const ui = renderWithProviders(<LogsPanel {...BASE} running />);
    ui.getByText("Waiting for information logs…");
  });

  it("says the query logged nothing once it finished", () => {
    const ui = renderWithProviders(<LogsPanel {...BASE} ran />);
    ui.getByText("No logs for this query.");
  });

  it("prompts for a run before the first one", () => {
    const ui = renderWithProviders(<LogsPanel {...BASE} />);
    ui.getByText("Run a query to see its information logs.");
  });
});
