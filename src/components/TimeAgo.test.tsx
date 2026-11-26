import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { TimeAgo } from "./TimeAgo";

describe("TimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("reads a UTC time as relative, with the local time on hover", () => {
    const ui = renderWithProviders(<TimeAgo value="2026-10-06 11:55:00" />);
    const el = ui.getByText("5m ago");
    expect(el).toHaveAttribute(
      "title",
      new Date("2026-10-06T11:55:00Z").toLocaleString(),
    );
  });

  it("keeps counting without new data", () => {
    const ui = renderWithProviders(<TimeAgo value="2026-10-06 11:59:30" />);
    ui.getByText("just now");
    act(() => vi.advanceTimersByTime(60_000));
    ui.getByText("1m ago");
  });
});
