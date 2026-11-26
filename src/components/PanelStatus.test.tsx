import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PanelStatus, updatedAgo } from "./PanelStatus";

describe("updatedAgo", () => {
  const t = 1_000_000;
  it.each([
    [0, "just now"],
    [4_000, "just now"],
    [12_000, "12s ago"],
    [59_000, "59s ago"],
    [60_000, "1m ago"],
    [59 * 60_000, "59m ago"],
    [2 * 3_600_000, "2h ago"],
  ])("%i ms later reads %s", (dt, want) => {
    expect(updatedAgo(t, t + dt)).toBe(want);
  });

  it("clamps a clock that runs behind to just now", () => {
    expect(updatedAgo(t, t - 30_000)).toBe("just now");
  });
});

function renderStatus(qc: QueryClient) {
  return render(
    <MantineProvider defaultColorScheme="light">
      <QueryClientProvider client={qc}>
        <PanelStatus
          testId="status"
          status="Polling every 5s"
          queryKeys={[
            ["a", "conn-1"],
            ["b", "conn-1"],
          ]}
        />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("PanelStatus", () => {
  it("shows when the panel's data last arrived", () => {
    const qc = new QueryClient();
    qc.setQueryData(["a", "conn-1"], []);
    renderStatus(qc);
    expect(screen.getByTestId("status")).toHaveTextContent(
      "Polling every 5s · Updated just now",
    );
  });

  it("ignores other panels and other connections", () => {
    const qc = new QueryClient();
    qc.setQueryData(["a", "conn-2"], []);
    qc.setQueryData(["c", "conn-1"], []);
    renderStatus(qc);
    expect(screen.getByTestId("status")).toHaveTextContent(
      /^Polling every 5s$/,
    );
  });

  it("refetches every panel query on Refresh", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderStatus(qc);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["a", "conn-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["b", "conn-1"] });
  });
});
