import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { ErrorBoundary } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  it("replaces a crashed tree with the error and a reload button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("render failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    vi.restoreAllMocks();
  });
});
