import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import type { CellValue, ColumnMeta } from "../types";
import { gutterWidth, ResultsTable } from "./ResultsTable";

const COL: ColumnMeta = { name: "id", type: "UInt32" };
const intCell = (v: number): CellValue => ({ t: "Int", v });

describe("ResultsTable empty states", () => {
  it("reports no rows for a statement with no result set (0 columns)", () => {
    const { getByText } = renderWithProviders(
      <ResultsTable columns={[]} rows={[]} />,
    );
    expect(getByText("The statement returned no result.")).toBeTruthy();
  });

  it("reports no rows for an empty SELECT (columns present, 0 rows)", () => {
    const { getByText } = renderWithProviders(
      <ResultsTable columns={[COL]} rows={[]} />,
    );
    expect(getByText("No rows returned.")).toBeTruthy();
  });

  it("does not show the empty message when there are rows", () => {
    const { queryByText } = renderWithProviders(
      <ResultsTable columns={[COL]} rows={[[intCell(1)]]} />,
    );
    expect(queryByText("No rows returned.")).toBeNull();
  });
});

describe("gutterWidth", () => {
  it("fits the widest row number, never narrower than the corner", () => {
    expect(gutterWidth(0)).toBe(36);
    expect(gutterWidth(99)).toBe(36);
    expect(gutterWidth(99_999)).toBe(51);
    expect(gutterWidth(1_000_000)).toBe(65);
  });
});

describe("ResultsTable row-number gutter", () => {
  // jsdom has no layout, and the virtualizer sizes its viewport from
  // offsetWidth and offsetHeight. Every element gets a size so rows and columns
  // render.
  const sizes = { offsetWidth: 800, offsetHeight: 400 };
  const saved = Object.fromEntries(
    Object.keys(sizes).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, k),
    ]),
  );
  beforeEach(() => {
    for (const [k, v] of Object.entries(sizes)) {
      Object.defineProperty(HTMLElement.prototype, k, {
        configurable: true,
        get: () => v,
      });
    }
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });
  afterEach(() => {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    }
  });

  const COLS: ColumnMeta[] = [
    { name: "id", type: "UInt32" },
    { name: "name", type: "String" },
  ];
  const ROWS: CellValue[][] = [
    [intCell(30), { t: "Str", v: "c" }],
    [intCell(10), { t: "Str", v: "a" }],
    [intCell(20), { t: "Str", v: "b" }],
  ];
  const numbers = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-row-number]")].map((el) => el.textContent);
  const rowText = (c: HTMLElement, n: string) => {
    const gutter = [...c.querySelectorAll("[data-row-number]")].find(
      (el) => el.textContent === n,
    )!;
    return [...gutter.parentElement!.children]
      .filter((el) => el !== gutter)
      .map((el) => el.textContent)
      .join(",");
  };

  it("numbers rows from 1", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toEqual(["1", "2", "3"]));
    expect(rowText(container, "1")).toBe("30,c");
  });

  it("numbers follow the sort order, like the cell inspector", async () => {
    const { container, getByLabelText } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.click(getByLabelText("Sort id"));
    await waitFor(() => expect(rowText(container, "1")).toBe("10,a"));
    expect(numbers(container)).toEqual(["1", "2", "3"]);
    expect(rowText(container, "3")).toBe("30,c");
  });

  it("aligns headers like their cells, falling back to the type", async () => {
    const columns: ColumnMeta[] = [
      { name: "lcn", type: "LowCardinality(Nullable(Float64))" },
      { name: "nlc", type: "Nullable(UInt8)" },
      { name: "iv", type: "IntervalDay" },
      { name: "saf", type: "SimpleAggregateFunction(sum, UInt64)" },
      { name: "empty", type: "Nullable(Float64)" },
    ];
    const { container } = renderWithProviders(
      <ResultsTable
        columns={columns}
        rows={[
          [
            intCell(1),
            intCell(2),
            { t: "Other", v: "1" },
            intCell(3),
            { t: "Null" },
          ],
        ]}
      />,
    );
    const numericHeads = () =>
      [...container.querySelectorAll(".chg-grid-th")].map((th) =>
        th.hasAttribute("data-num"),
      );
    await waitFor(() => expect(numericHeads()).toHaveLength(5));
    expect(numericHeads()).toEqual([true, true, false, true, true]);
  });

  it("survives a narrower result arriving while sorted by a later column", async () => {
    const ui = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} scrollKey="t" />,
    );
    await waitFor(() => expect(numbers(ui.container)).toHaveLength(3));
    fireEvent.click(ui.getByLabelText("Sort name"));
    ui.rerender(
      <ResultsTable
        columns={[COL]}
        rows={[[intCell(2)], [intCell(1)]]}
        scrollKey="t"
      />,
    );
    await waitFor(() => expect(rowText(ui.container, "1")).toBe("2"));
  });

  it("clicking a number selects the row, and copy leaves the number out", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    const gutter = [...container.querySelectorAll("[data-row-number]")][1];
    fireEvent.mouseDown(gutter, { button: 0 });
    const grid = container.querySelector('[tabindex="0"]')!;
    fireEvent.keyDown(grid, { code: "KeyC", metaKey: true });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "id\tname\n10\ta",
    );
  });

  it("the corner selects every row", async () => {
    const { container, getByLabelText } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(getByLabelText("Select all rows"));
    const grid = container.querySelector('[tabindex="0"]')!;
    fireEvent.keyDown(grid, { code: "KeyC", metaKey: true });
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied.split("\n")).toHaveLength(4);
    expect(copied).not.toMatch(/^1\t/m);
  });

  it("select all and a whole column copy as tab-separated text", async () => {
    const { container, getByLabelText, getByText } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    const grid = container.querySelector('[tabindex="0"]')!;
    fireEvent.mouseDown(getByLabelText("Select all rows"));
    fireEvent.keyDown(grid, { code: "KeyC", metaKey: true });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      "id\tname\n30\tc\n10\ta\n20\tb",
    );
    fireEvent.mouseDown(getByText("name"));
    fireEvent.keyDown(grid, { code: "KeyC", metaKey: true });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      "name\nc\na\nb",
    );
  });

  it("right-click outside the selection selects that cell for Copy", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(container.querySelector("[data-row-number]")!, {
      button: 0,
    });
    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(await screen.findByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("a");
  });

  it("right-click inside the selection keeps it", async () => {
    const { container, getByLabelText } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(getByLabelText("Select all rows"));
    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(await screen.findByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      "id\tname\n30\tc\n10\ta\n20\tb",
    );
  });

  it("shift+click after a click selects the rectangle between the two cells", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(screen.getByText("30"), { button: 0 });
    const allowed = fireEvent.mouseDown(screen.getByText("a"), {
      button: 0,
      shiftKey: true,
    });
    expect(allowed).toBe(false);
    fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, {
      code: "KeyC",
      metaKey: true,
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      "id\tname\n30\tc\n10\ta",
    );
  });

  it("shift+click with no selection selects that one cell", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(screen.getByText("a"), { button: 0, shiftKey: true });
    fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, {
      code: "KeyC",
      metaKey: true,
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("a");
  });

  it("the sort control sorts on Enter while a cell is selected", async () => {
    const { container, getByLabelText } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    fireEvent.mouseDown(screen.getByText("c"), { button: 0 });
    getByLabelText("Sort id").focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(rowText(container, "1")).toBe("10,a"));
  });

  it("offsets every cell by the gutter", async () => {
    const { container } = renderWithProviders(
      <ResultsTable columns={COLS} rows={ROWS} />,
    );
    await waitFor(() => expect(numbers(container)).toHaveLength(3));
    const gutter = container.querySelector<HTMLElement>("[data-row-number]")!;
    const firstCell = gutter.nextElementSibling as HTMLElement;
    expect(gutter.style.width).toBe(`${gutterWidth(3)}px`);
    expect(firstCell.style.left).toBe(`${gutterWidth(3)}px`);
    expect(firstCell.style.top).toBe("0px");
    const header = container.querySelector<HTMLElement>('[title="UInt32"]')!;
    expect(header.style.top).toBe("0px");
  });

  const LONG = "x".repeat(40);
  const hoverCell = (
    c: HTMLElement,
    scrollWidth: number,
    clientWidth: number,
  ) => {
    const el = c.querySelector<HTMLElement>(".chg-cell-text")!;
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { value: clientWidth });
    fireEvent.pointerEnter(el);
    fireEvent.mouseEnter(el);
  };
  const renderLong = () =>
    renderWithProviders(
      <ResultsTable
        columns={[{ name: "s", type: "String" }]}
        rows={[[{ t: "Str", v: LONG }]]}
      />,
    );

  it("shows the tooltip when the text is cut off", async () => {
    const { container } = renderLong();
    await waitFor(() =>
      expect(container.querySelector(".chg-cell-text")).toBeTruthy(),
    );
    hoverCell(container, 300, 100);
    expect(await screen.findByRole("tooltip")).toBeTruthy();
  });

  it("shows no tooltip when the text fits, even over 30 characters", async () => {
    const { container } = renderLong();
    await waitFor(() =>
      expect(container.querySelector(".chg-cell-text")).toBeTruthy(),
    );
    hoverCell(container, 100, 100);
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
