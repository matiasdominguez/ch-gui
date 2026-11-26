import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { RunClock } from "./RunClock";

describe("RunClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts up as m:ss from the run's start", () => {
    const start = Date.now() - 65_000;
    const ui = renderWithProviders(<RunClock since={start} />);
    expect(ui.getByLabelText("Elapsed time").textContent).toBe("1:05");
    act(() => vi.advanceTimersByTime(1000));
    expect(ui.getByLabelText("Elapsed time").textContent).toBe("1:06");
  });
});
