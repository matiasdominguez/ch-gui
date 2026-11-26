import { describe, expect, it } from "vitest";

import type { ChangelogEntry } from "../lib/changelog";
import { renderWithProviders } from "../test/render";
import { WhatsNewModal } from "./WhatsNewModal";

const ENTRIES: ChangelogEntry[] = [
  {
    version: "0.2.5",
    date: "2026-06-26",
    changes: ["Cumulative top change", "Second change"],
  },
  { version: "0.2.4", date: "2026-06-26", changes: ["Older change"] },
];

describe("WhatsNewModal", () => {
  it("lists changes from every entry, with version headers, when cumulative", () => {
    const { getByText } = renderWithProviders(
      <WhatsNewModal opened entries={ENTRIES} onClose={() => {}} />,
    );
    expect(getByText("Cumulative top change")).toBeTruthy();
    expect(getByText("Older change")).toBeTruthy();
    expect(getByText("0.2.5")).toBeTruthy();
    expect(getByText("0.2.4")).toBeTruthy();
  });

  it("puts the version in the title for a single entry", () => {
    const { getByText } = renderWithProviders(
      <WhatsNewModal opened entries={[ENTRIES[0]]} onClose={() => {}} />,
    );
    expect(getByText("What's New in 0.2.5")).toBeTruthy();
  });

  it("renders nothing visible when closed", () => {
    const { queryByText } = renderWithProviders(
      <WhatsNewModal opened={false} entries={ENTRIES} onClose={() => {}} />,
    );
    expect(queryByText("Cumulative top change")).toBeNull();
  });
});
