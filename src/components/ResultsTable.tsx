import {
  ActionIcon,
  Box,
  Button,
  Center,
  Code,
  Group,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isNumericClickHouseType } from "../lib/chartTypes";
import { copyWithToast } from "../lib/clipboard";
import { cellToString, rowsToClipboardTsv, rowsToMarkdown } from "../lib/csv";
import { prettyJsonOrNull } from "../lib/prettyJson";
import type { CellValue, ColumnMeta } from "../types";
import { Shortcut } from "./ui";

interface Props {
  columns: ColumnMeta[];
  rows: CellValue[][];
  scrollKey?: string;
}

const scrollCache = new Map<string, { top: number; left: number }>();

const ROW_HEIGHT = 26;
const COL_WIDTH = 180;

export function gutterWidth(rowCount: number): number {
  return Math.max(36, String(Math.max(rowCount, 1)).length * 7 + 16);
}

/** Paints `color` over the grid's base color, so a translucent tint stays
 * opaque on sticky cells that scroll over other cells. */
const opaque = (color: string) =>
  `linear-gradient(${color}, ${color}), var(--chg-grid-bg)`;

const isNumericType = (type: string) =>
  isNumericClickHouseType(
    type.replace(/^(?:(?:LowCardinality|Nullable)\()+/, ""),
  );
const isNumericCell = (c: CellValue) =>
  c.t === "Int" || c.t === "Float" || c.t === "BigInt" || c.t === "Decimal";

type Selection =
  | null
  | { kind: "cell"; row: number; col: number }
  | { kind: "range"; anchor: GridCell; focus: GridCell }
  | { kind: "row"; row: number }
  | { kind: "column"; col: number }
  | { kind: "all" };

interface GridCell {
  row: number;
  col: number;
}

function rangeBounds(sel: { anchor: GridCell; focus: GridCell }) {
  return {
    r0: Math.min(sel.anchor.row, sel.focus.row),
    r1: Math.max(sel.anchor.row, sel.focus.row),
    c0: Math.min(sel.anchor.col, sel.focus.col),
    c1: Math.max(sel.anchor.col, sel.focus.col),
  };
}

type Sort = null | { col: number; dir: "asc" | "desc" };

function cellNumeric(c: CellValue): number | null {
  switch (c.t) {
    case "Int":
    case "Float":
      return c.v;
    case "BigInt":
    case "Decimal": {
      const n = Number(c.v);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return null;
  }
}

function compareCells(a: CellValue, b: CellValue, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  // Nulls sort last in both directions.
  if (a.t === "Null" && b.t === "Null") return 0;
  if (a.t === "Null") return 1;
  if (b.t === "Null") return -1;
  const aN = cellNumeric(a);
  const bN = cellNumeric(b);
  if (aN !== null && bN !== null) return mul * (aN - bN);
  return mul * cellToString(a).localeCompare(cellToString(b));
}

function CellDisplay({ cell }: { cell: CellValue }) {
  const [cutOff, setCutOff] = useState(false);
  if (cell.t === "Null") {
    return (
      <Text size="xs" className="chg-null">
        NULL
      </Text>
    );
  }
  const text = cellToString(cell);
  return (
    <Tooltip
      label={text}
      withinPortal
      openDelay={350}
      multiline
      maw={500}
      disabled={!cutOff}
    >
      <Text
        size="xs"
        truncate
        className="chg-cell-text"
        onPointerEnter={(e) =>
          setCutOff(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)
        }
        data-num={isNumericCell(cell) || undefined}
      >
        {text}
      </Text>
    </Tooltip>
  );
}

export function ResultsTable({ columns, rows, scrollKey }: Props) {
  const tableColumns = useMemo<ColumnDef<CellValue[]>[]>(
    () =>
      columns.map((c, i) => ({
        id: c.name + "_" + i,
        header: c.name,
        accessorFn: (row) => row[i],
        cell: (info) => <CellDisplay cell={info.getValue() as CellValue} />,
        size: COL_WIDTH,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
  });

  const parentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el || !scrollKey) return;
    const saved = scrollCache.get(scrollKey);
    if (saved) {
      el.scrollTop = saved.top;
      el.scrollLeft = saved.left;
    }
  }, [scrollKey]);

  // Each run produces new arrays, so resets key on column names and types: the
  // same columns keep their widths and sort across a re-run. TabPane renders
  // this component unkeyed, so `scrollKey` joins the deps. Without it, two tabs
  // with the same columns would share sort and widths.
  const columnsKey = useMemo(
    () => columns.map((c) => `${c.name}\u0000${c.type}`).join("\u0001"),
    [columns],
  );

  // The virtualizer reads sizes through a ref. `colVirt.measure()` must run
  // after each change to clear its cached offsets.
  const [columnSizes, setColumnSizes] = useState<number[]>(() =>
    columns.map(() => COL_WIDTH),
  );
  useEffect(() => {
    setColumnSizes(columns.map(() => COL_WIDTH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, scrollKey]);
  const columnSizesRef = useRef(columnSizes);
  columnSizesRef.current = columnSizes;

  const rowVirt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  // scrollPaddingStart stops keyboard navigation from scrolling a cell under
  // the sticky gutter.
  const gutter = gutterWidth(rows.length);
  const colVirt = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => columnSizesRef.current[i] ?? COL_WIDTH,
    overscan: 4,
    paddingStart: gutter,
    scrollPaddingStart: gutter,
  });
  useEffect(() => {
    colVirt.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSizes]);

  const [selection, setSelection] = useState<Selection>(null);
  const [sort, setSort] = useState<Sort>(null);
  useEffect(() => {
    setSelection(null);
  }, [rows]);
  const [inspected, setInspected] = useState<GridCell | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    cell: GridCell;
  } | null>(null);
  useEffect(() => {
    setInspected(null);
  }, [rows]);
  useEffect(() => {
    setSort(null);
  }, [columnsKey, scrollKey]);

  // Align a header by its first non-NULL cell, so types the regex cannot unwrap
  // (SimpleAggregateFunction, Variant) still line up. An all-NULL column uses
  // its type.
  const numericCols = useMemo(
    () =>
      columns.map((col, i) => {
        const cell = rows.find((r) => r[i]?.t !== "Null")?.[i];
        return cell ? isNumericCell(cell) : isNumericType(col.type);
      }),
    [columns, rows],
  );

  const sortedRows = useMemo(() => {
    // The sort reset runs in an effect, so for one render a narrower result can
    // arrive with the old sort column, which would read past each row.
    if (!sort || sort.col >= columns.length) return rows;
    const idx = rows.map((_, i) => i);
    idx.sort((a, b) =>
      compareCells(rows[a][sort.col], rows[b][sort.col], sort.dir),
    );
    return idx.map((i) => rows[i]);
  }, [rows, sort, columns.length]);

  // Detects a double-click from mousedown times, because startResize's document
  // listeners make `dblclick` and `e.detail` unreliable.
  const lastGripDownAt = useRef(0);
  const DBL_CLICK_MS = 400;

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnSizesRef.current[colIdx] ?? COL_WIDTH;
    const MIN = 60;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        MIN,
        Math.round(startWidth + (ev.clientX - startX)),
      );
      setColumnSizes((prev) => {
        if (prev[colIdx] === next) return prev;
        const copy = prev.slice();
        copy[colIdx] = next;
        return copy;
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function autoSizeColumn(colIdx: number) {
    // Estimates width from character counts, without measuring rendered text.
    const chars = Math.max(
      columns[colIdx]?.name.length ?? 0,
      ...sortedRows.map((r) => cellToString(r[colIdx]).length),
    );
    const guess = Math.min(600, Math.max(80, chars * 7 + 24));
    setColumnSizes((prev) => {
      const copy = prev.slice();
      copy[colIdx] = guess;
      return copy;
    });
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchIdx(0);
  }, [rows]);

  const searchMatches = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return [] as { row: number; col: number }[];
    const out: { row: number; col: number }[] = [];
    for (let r = 0; r < sortedRows.length; r++) {
      const row = sortedRows[r];
      for (let c = 0; c < row.length; c++) {
        if (cellToString(row[c]).toLowerCase().includes(needle)) {
          out.push({ row: r, col: c });
        }
      }
    }
    return out;
  }, [sortedRows, searchQuery]);

  const searchMatchSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of searchMatches) s.add(`${m.row}|${m.col}`);
    return s;
  }, [searchMatches]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      if (searchIdx !== 0) setSearchIdx(0);
    } else if (searchIdx >= searchMatches.length) {
      setSearchIdx(0);
    }
  }, [searchMatches, searchIdx]);

  function stepSearch(delta: 1 | -1) {
    if (searchMatches.length === 0) return;
    const next =
      (searchIdx + delta + searchMatches.length) % searchMatches.length;
    setSearchIdx(next);
    const m = searchMatches[next];
    rowVirt.scrollToIndex(m.row, { align: "auto" });
    colVirt.scrollToIndex(m.col, { align: "auto" });
  }

  function openSearch() {
    setSearchOpen(true);
    // The input does not exist until React commits `searchOpen`.
    queueMicrotask(() => searchInputRef.current?.focus());
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchIdx(0);
    parentRef.current?.focus();
  }

  function cycleSort(col: number) {
    // These selections hold row indexes, so after a sort they would point at
    // other rows and Cmd+C would copy the wrong ones.
    setSelection((prev) =>
      prev?.kind === "cell" || prev?.kind === "range" || prev?.kind === "row"
        ? null
        : prev,
    );
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  }

  const isCellSelected = (r: number, c: number): boolean => {
    if (!selection) return false;
    if (selection.kind === "all") return true;
    if (selection.kind === "column") return selection.col === c;
    if (selection.kind === "row") return selection.row === r;
    if (selection.kind === "range") {
      const b = rangeBounds(selection);
      return r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
    }
    return selection.row === r && selection.col === c;
  };
  const isRowNumberSelected = (r: number): boolean =>
    selection?.kind === "all" ||
    (selection?.kind === "row" && selection.row === r);
  const isColumnHeaderSelected = (c: number): boolean => {
    if (!selection) return false;
    if (selection.kind === "all") return true;
    if (selection.kind === "column") return selection.col === c;
    return false;
  };

  // Dragging does not auto-scroll at the edges. Shift+arrows reach past them.
  const dragAnchor = useRef<GridCell | null>(null);

  function beginCellDrag(row: number, col: number) {
    dragAnchor.current = { row, col };
    const onUp = () => {
      dragAnchor.current = null;
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mouseup", onUp);
  }

  function selectRange(anchor: GridCell, focus: GridCell) {
    setSelection(
      anchor.row === focus.row && anchor.col === focus.col
        ? { kind: "cell", row: focus.row, col: focus.col }
        : { kind: "range", anchor, focus },
    );
  }

  function selectionAnchor(): GridCell {
    return selection?.kind === "range"
      ? selection.anchor
      : selection?.kind === "cell"
        ? { row: selection.row, col: selection.col }
        : { row: 0, col: 0 };
  }

  function extendDragTo(row: number, col: number) {
    const a = dragAnchor.current;
    if (a) selectRange(a, { row, col });
  }

  function copyToClipboard(text: string) {
    copyWithToast(text, "grid-copy");
  }

  function copyCurrentSelection() {
    if (!selection) return;
    if (selection.kind === "cell") {
      copyToClipboard(cellToString(sortedRows[selection.row][selection.col]));
      return;
    }
    if (selection.kind === "row") {
      // Every branch below copies TSV because spreadsheets split pasted tabs
      // into cells but paste CSV into one column.
      copyToClipboard(rowsToClipboardTsv(columns, [sortedRows[selection.row]]));
      return;
    }
    if (selection.kind === "range") {
      const b = rangeBounds(selection);
      copyToClipboard(
        rowsToClipboardTsv(
          columns.slice(b.c0, b.c1 + 1),
          sortedRows.slice(b.r0, b.r1 + 1).map((r) => r.slice(b.c0, b.c1 + 1)),
        ),
      );
      return;
    }
    if (selection.kind === "column") {
      const c = selection.col;
      copyToClipboard(
        rowsToClipboardTsv(
          [columns[c]],
          sortedRows.map((r) => [r[c]]),
        ),
      );
      return;
    }
    copyToClipboard(rowsToClipboardTsv(columns, sortedRows));
  }

  function copyAsMarkdown() {
    if (!selection || selection.kind === "all") {
      copyToClipboard(rowsToMarkdown(columns, sortedRows));
      return;
    }
    if (selection.kind === "cell") {
      copyToClipboard(
        rowsToMarkdown(
          [columns[selection.col]],
          [[sortedRows[selection.row][selection.col]]],
        ),
      );
      return;
    }
    if (selection.kind === "row") {
      copyToClipboard(rowsToMarkdown(columns, [sortedRows[selection.row]]));
      return;
    }
    if (selection.kind === "range") {
      const b = rangeBounds(selection);
      copyToClipboard(
        rowsToMarkdown(
          columns.slice(b.c0, b.c1 + 1),
          sortedRows.slice(b.r0, b.r1 + 1).map((r) => r.slice(b.c0, b.c1 + 1)),
        ),
      );
      return;
    }
    const c = selection.col;
    copyToClipboard(
      rowsToMarkdown(
        [columns[c]],
        sortedRows.map((r) => [r[c]]),
      ),
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const rowCount = rows.length;
    const colCount = columns.length;
    if (rowCount === 0 || colCount === 0) return;

    if (
      (e.metaKey || e.ctrlKey) &&
      e.code === "KeyF" &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      if (searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      e.code === "KeyA" &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      setSelection({ kind: "all" });
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      e.code === "KeyC" &&
      !e.shiftKey &&
      !e.altKey
    ) {
      if (!selection) return; // Let the browser copy any text selection.
      e.preventDefault();
      copyCurrentSelection();
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      e.code === "KeyC" &&
      e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      copyAsMarkdown();
      return;
    }

    if (e.key === "Escape") {
      if (selection) {
        e.preventDefault();
        setSelection(null);
      }
      return;
    }

    // Cmd+Enter and Cmd+Shift+Enter also trigger the document-level run
    // shortcuts, so opening the inspector on them would cover a starting run.
    // A focused sort button handles its own Enter.
    if (
      e.key === "Enter" &&
      e.target === e.currentTarget &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      selection?.kind === "cell"
    ) {
      e.preventDefault();
      setInspected({ row: selection.row, col: selection.col });
      return;
    }

    const arrow = (() => {
      switch (e.key) {
        case "ArrowUp":
          return { dr: -1, dc: 0 };
        case "ArrowDown":
          return { dr: 1, dc: 0 };
        case "ArrowLeft":
          return { dr: 0, dc: -1 };
        case "ArrowRight":
          return { dr: 0, dc: 1 };
        default:
          return null;
      }
    })();
    if (!arrow) return;
    e.preventDefault();

    const base =
      selection?.kind === "cell"
        ? { row: selection.row, col: selection.col }
        : selection?.kind === "range"
          ? selection.focus
          : { row: 0, col: 0 };
    const next = {
      row: Math.min(rowCount - 1, Math.max(0, base.row + arrow.dr)),
      col: Math.min(colCount - 1, Math.max(0, base.col + arrow.dc)),
    };
    if (e.shiftKey) {
      selectRange(selectionAnchor(), next);
    } else {
      setSelection({ kind: "cell", row: next.row, col: next.col });
    }
    rowVirt.scrollToIndex(next.row, { align: "auto" });
    colVirt.scrollToIndex(next.col, { align: "auto" });
  }

  if (columns.length === 0) {
    return (
      <Center h="100%">
        <Text size="sm" c="dimmed">
          The statement returned no result.
        </Text>
      </Center>
    );
  }

  const totalWidth = colVirt.getTotalSize();
  const totalHeight = rowVirt.getTotalSize();
  const virtualRows = rowVirt.getVirtualItems();
  const virtualCols = colVirt.getVirtualItems();
  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <Box
      className="chg-grid-wrap"
      style={{ position: "relative", height: "100%" }}
    >
      <CellInspectorModal
        inspected={inspected}
        columns={columns}
        rows={sortedRows}
        onClose={() => setInspected(null)}
      />
      {searchOpen && (
        <Paper
          shadow="md"
          withBorder
          p={4}
          style={{
            position: "absolute",
            top: 6,
            right: 16,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <TextInput
            ref={searchInputRef}
            size="xs"
            placeholder="Find in results…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              setSearchIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                stepSearch(e.shiftKey ? -1 : 1);
              }
            }}
            styles={{ input: { minWidth: 180 } }}
          />
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {searchMatches.length === 0
              ? "0 / 0"
              : `${searchIdx + 1} / ${searchMatches.length}`}
          </Text>
          <Tooltip label="Previous (⇧↵)">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => stepSearch(-1)}
              disabled={searchMatches.length === 0}
              aria-label="Previous match"
            >
              <ArrowUpIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Next (↵)">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => stepSearch(1)}
              disabled={searchMatches.length === 0}
              aria-label="Next match"
            >
              <ArrowDownIcon />
            </ActionIcon>
          </Tooltip>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={closeSearch}
            aria-label="Close search"
          >
            <XIcon />
          </ActionIcon>
        </Paper>
      )}
      <Menu
        opened={menu !== null}
        onClose={() => {
          setMenu(null);
          parentRef.current?.focus();
        }}
        position="bottom-start"
        offset={0}
        withinPortal
      >
        <Menu.Target>
          <Box style={{ position: "fixed", left: menu?.x, top: menu?.y }} />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            rightSection={<Shortcut>⌘C</Shortcut>}
            onClick={copyCurrentSelection}
          >
            Copy
          </Menu.Item>
          <Menu.Item
            rightSection={<Shortcut>⌘⇧C</Shortcut>}
            onClick={copyAsMarkdown}
          >
            Copy as Markdown
          </Menu.Item>
          <Menu.Item
            rightSection={<Shortcut>↵</Shortcut>}
            onClick={() => setInspected(menu?.cell ?? null)}
          >
            Inspect cell
          </Menu.Item>
          <Menu.Item
            rightSection={<Shortcut>⌘F</Shortcut>}
            onClick={openSearch}
          >
            Find
          </Menu.Item>
          <Menu.Item
            rightSection={<Shortcut>⌘A</Shortcut>}
            onClick={() => setSelection({ kind: "all" })}
          >
            Select all
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Box
        ref={parentRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={(e) => {
          if (scrollKey)
            scrollCache.set(scrollKey, {
              top: e.currentTarget.scrollTop,
              left: e.currentTarget.scrollLeft,
            });
        }}
        className="chg-grid"
        style={{
          height: "100%",
          overflow: "auto",
          position: "relative",
          background: "var(--chg-grid-bg)",
          outline: "none",
          // Native text selection would highlight partial cells during a drag.
          userSelect: "none",
        }}
      >
        <Box style={{ width: totalWidth, position: "relative" }}>
          <Box
            className="chg-grid-head"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              height: ROW_HEIGHT,
              background: "var(--chg-grid-head-bg)",
              borderBottom: "1px solid var(--chg-grid-head-line)",
            }}
          >
            <Box
              aria-label="Select all rows"
              title="Select all (⌘A)"
              onMouseDown={() => setSelection({ kind: "all" })}
              style={{
                position: "sticky",
                left: 0,
                zIndex: 4,
                width: gutter,
                height: ROW_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: "0 6px",
                fontSize: 11,
                color: "var(--chg-grid-gutter-fg)",
                background: opaque(
                  selection?.kind === "all"
                    ? "var(--chg-grid-selection)"
                    : "var(--chg-grid-head-bg)",
                ),
                borderRight: "1px solid var(--chg-grid-gutter-line)",
                cursor: "pointer",
              }}
            >
              #
            </Box>
            {virtualCols.map((vc) => {
              const header = headerCells[vc.index];
              const headerSelected = isColumnHeaderSelected(vc.index);
              const sortedHere = sort?.col === vc.index ? sort.dir : null;
              const Chevron =
                sortedHere === "asc"
                  ? CaretUpIcon
                  : sortedHere === "desc"
                    ? CaretDownIcon
                    : CaretUpDownIcon;
              const numeric = numericCols[vc.index] ?? false;
              return (
                <Box
                  key={vc.key}
                  onMouseDown={() =>
                    setSelection({ kind: "column", col: vc.index })
                  }
                  className="chg-grid-th"
                  data-num={numeric || undefined}
                  data-sorted={sortedHere ?? undefined}
                  style={{
                    // `top` is explicit because the in-flow corner cell would
                    // otherwise push this cell's static position down a row.
                    position: "absolute",
                    top: 0,
                    left: vc.start,
                    width: vc.size,
                    height: ROW_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 4px 4px 8px",
                    borderRight: "1px solid var(--chg-grid-col-line)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    cursor: "pointer",
                    background: headerSelected
                      ? "var(--chg-grid-selection)"
                      : undefined,
                    userSelect: "none",
                  }}
                  title={columns[vc.index]?.type}
                >
                  <Box
                    className="chg-grid-th-label"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {header
                      ? flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      : null}
                  </Box>
                  <UnstyledButton
                    aria-label={
                      sortedHere
                        ? `Sort ${columns[vc.index]?.name} (${sortedHere})`
                        : `Sort ${columns[vc.index]?.name}`
                    }
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => cycleSort(vc.index)}
                    className="chg-grid-sort"
                    style={{
                      flex: "0 0 auto",
                      padding: "0 2px",
                      display: "flex",
                      cursor: "pointer",
                    }}
                  >
                    <Chevron size={12} weight="bold" />
                  </UnstyledButton>
                  <Box
                    role="separator"
                    aria-label={`Resize ${columns[vc.index]?.name}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const now = performance.now();
                      if (now - lastGripDownAt.current < DBL_CLICK_MS) {
                        e.preventDefault();
                        lastGripDownAt.current = 0;
                        autoSizeColumn(vc.index);
                        return;
                      }
                      lastGripDownAt.current = now;
                      startResize(e, vc.index);
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: -3,
                      width: 6,
                      height: "100%",
                      cursor: "col-resize",
                      zIndex: 3,
                    }}
                  />
                </Box>
              );
            })}
          </Box>

          {rows.length === 0 && (
            <Center py="xl">
              <Text size="sm" c="dimmed">
                No rows returned.
              </Text>
            </Center>
          )}

          <Box style={{ position: "relative", height: totalHeight }}>
            {virtualRows.map((vr) => {
              const row = sortedRows[vr.index];
              return (
                <Box
                  key={vr.key}
                  className="chg-grid-row"
                  data-odd={vr.index % 2 === 1 || undefined}
                  style={{
                    position: "absolute",
                    top: vr.start,
                    left: 0,
                    width: totalWidth,
                    height: ROW_HEIGHT,
                    borderBottom: "1px solid var(--chg-grid-row-line)",
                  }}
                >
                  <Box
                    data-row-number
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      setSelection({ kind: "row", row: vr.index });
                    }}
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      width: gutter,
                      height: ROW_HEIGHT - 1,
                      padding: "4px 6px",
                      textAlign: "right",
                      fontFamily: "var(--mantine-font-family-monospace)",
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--chg-grid-gutter-fg)",
                      background: opaque(
                        isRowNumberSelected(vr.index)
                          ? "var(--chg-grid-selection)"
                          : "var(--chg-grid-gutter-bg)",
                      ),
                      borderRight: "1px solid var(--chg-grid-gutter-line)",
                      cursor: "pointer",
                    }}
                  >
                    {vr.index + 1}
                  </Box>
                  {virtualCols.map((vc) => {
                    const selected = isCellSelected(vr.index, vc.index);
                    const showSelectionRing =
                      (selection?.kind === "cell" &&
                        selection.row === vr.index &&
                        selection.col === vc.index) ||
                      (selection?.kind === "range" &&
                        selection.anchor.row === vr.index &&
                        selection.anchor.col === vc.index);
                    const matchHit = searchMatchSet.has(
                      `${vr.index}|${vc.index}`,
                    );
                    const currentMatch =
                      matchHit &&
                      searchMatches.length > 0 &&
                      searchMatches[searchIdx]?.row === vr.index &&
                      searchMatches[searchIdx]?.col === vc.index;
                    const background = selected
                      ? "var(--chg-grid-selection)"
                      : matchHit
                        ? "var(--mantine-color-yellow-light)"
                        : undefined;
                    const boxShadow = showSelectionRing
                      ? "inset 0 0 0 var(--chg-grid-ring-width) var(--chg-grid-ring)"
                      : currentMatch
                        ? "inset 0 0 0 2px var(--mantine-color-yellow-filled)"
                        : undefined;
                    return (
                      <Box
                        key={vc.key}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || e.ctrlKey) return;
                          if (e.shiftKey) {
                            // WebKit extends the page's text selection on shift+click.
                            e.preventDefault();
                            parentRef.current?.focus();
                            const target = { row: vr.index, col: vc.index };
                            selectRange(
                              selection ? selectionAnchor() : target,
                              target,
                            );
                            return;
                          }
                          setSelection({
                            kind: "cell",
                            row: vr.index,
                            col: vc.index,
                          });
                          beginCellDrag(vr.index, vc.index);
                        }}
                        onMouseEnter={() => extendDragTo(vr.index, vc.index)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!isCellSelected(vr.index, vc.index))
                            setSelection({
                              kind: "cell",
                              row: vr.index,
                              col: vc.index,
                            });
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            cell: { row: vr.index, col: vc.index },
                          });
                        }}
                        onDoubleClick={() =>
                          setInspected({ row: vr.index, col: vc.index })
                        }
                        style={{
                          position: "absolute",
                          top: 0,
                          left: vc.start,
                          width: vc.size,
                          height: ROW_HEIGHT,
                          padding: "3px 8px",
                          borderRight: "1px solid var(--chg-grid-col-line)",
                          overflow: "hidden",
                          background,
                          boxShadow,
                          cursor: "cell",
                        }}
                      >
                        <CellDisplay cell={row[vc.index]} />
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function CellInspectorModal({
  inspected,
  columns,
  rows,
  onClose,
}: {
  inspected: GridCell | null;
  columns: ColumnMeta[];
  rows: CellValue[][];
  onClose: () => void;
}) {
  const cell = inspected ? rows[inspected.row]?.[inspected.col] : undefined;
  const isNull = !cell || cell.t === "Null";
  const raw = cell && !isNull ? cellToString(cell) : "";
  const pretty = useMemo(
    () => (isNull ? null : prettyJsonOrNull(raw)),
    [isNull, raw],
  );
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    setShowRaw(false);
  }, [inspected]);
  const shown = pretty && !showRaw ? pretty : raw;
  const colName = inspected ? (columns[inspected.col]?.name ?? "") : "";

  return (
    <Modal
      opened={inspected !== null}
      onClose={onClose}
      size="lg"
      title={
        <Text
          fw={600}
          size="sm"
          style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
        >
          {colName} · row {(inspected?.row ?? 0) + 1}
        </Text>
      }
    >
      <Stack gap="xs">
        {pretty && (
          <SegmentedControl
            size="xs"
            value={showRaw ? "raw" : "json"}
            onChange={(v) => setShowRaw(v === "raw")}
            data={[
              { label: "Pretty JSON", value: "json" },
              { label: "Raw", value: "raw" },
            ]}
            style={{ alignSelf: "flex-start" }}
          />
        )}
        {isNull ? (
          <Text size="sm" c="dimmed" style={{ fontStyle: "italic" }}>
            NULL
          </Text>
        ) : (
          <Code
            block
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
              maxHeight: "60vh",
              overflow: "auto",
            }}
          >
            {shown}
          </Code>
        )}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {isNull
              ? ""
              : `${raw.length.toLocaleString()} chars · ${columns[inspected?.col ?? 0]?.type ?? ""}`}
          </Text>
          <Button
            size="compact-sm"
            variant="default"
            disabled={isNull}
            onClick={() => copyWithToast(shown, "grid-copy")}
          >
            Copy
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
