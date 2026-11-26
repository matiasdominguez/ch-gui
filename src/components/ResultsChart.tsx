import {
  Alert,
  Box,
  Group,
  NativeSelect,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { BarChart, LineChart } from "@mantine/charts";
import { useMemo } from "react";

import { AUTO_LIMIT_ROWS } from "../lib/autoLimit";
import {
  chartPoints,
  columnShape,
  defaultY,
  xIsUnique,
} from "../lib/chartData";
import { isNumericClickHouseType } from "../lib/chartTypes";
import type { ChartState } from "../state/tabs";
import type { ColumnMeta, QueryResult } from "../types";

import { Tag } from "./ui";

const MAX_POINTS = 10_000;
const READABLE_POINTS = 500;

function isNumericColumn(col: ColumnMeta): boolean {
  return isNumericClickHouseType(col.type);
}

interface Props {
  capped?: boolean;
  result: QueryResult;
  chart: ChartState;
  onChange: (patch: Partial<ChartState>) => void;
}

export function ResultsChart({ capped, result, chart, onChange }: Props) {
  const { columns } = result;

  const numericCols = useMemo(
    () => columns.filter(isNumericColumn).map((c) => c.name),
    [columns],
  );
  const allCols = columns.map((c) => c.name);

  const xCol =
    chart.xCol && allCols.includes(chart.xCol)
      ? chart.xCol
      : (columns.find((c) => !isNumericColumn(c))?.name ?? allCols[0] ?? null);
  const unique = useMemo(
    () => (xCol ? xIsUnique(result, xCol) : true),
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- the compiler cannot prove `result` is never mutated; it is not.
    [result, xCol],
  );
  const yOptions = numericCols.filter((c) => c !== xCol);
  const shape = columnShape(result);
  const yCol =
    chart.yCount === shape
      ? null
      : chart.yCol != null && yOptions.includes(chart.yCol)
        ? chart.yCol
        : xCol
          ? defaultY(xCol, numericCols, unique)
          : null;

  const points = useMemo(
    () => (xCol ? chartPoints(result, xCol, yCol) : []),
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- the compiler cannot prove `result` is never mutated; it is not.
    [result, xCol, yCol],
  );
  const data = useMemo(() => points.slice(0, MAX_POINTS), [points]);
  const yLabel = (c: string | null) =>
    c == null ? "count of rows" : unique ? c : `sum of ${c}`;

  const truncated = points.length > MAX_POINTS;

  if (columns.length === 0) {
    return (
      <Box p="md">
        <Text size="sm" c="dimmed">
          Run a query to chart its results.
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap="xs" h="100%" p="xs">
      <Group gap="xs" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={chart.type}
          onChange={(v) => onChange({ type: v as ChartState["type"] })}
          data={[
            { value: "bar", label: "Bar" },
            { value: "line", label: "Line" },
          ]}
        />
        <NativeSelect
          size="xs"
          value={xCol ?? ""}
          onChange={(e) => onChange({ xCol: e.currentTarget.value })}
          data={allCols.map((name) => ({ value: name, label: `x: ${name}` }))}
          aria-label="X axis column"
        />
        <NativeSelect
          size="xs"
          value={yCol == null ? "count" : `col:${yCol}`}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange(
              v === "count"
                ? { yCount: shape, yCol: null }
                : { yCount: null, yCol: v.slice("col:".length) },
            );
          }}
          data={[
            { value: "count", label: `y: ${yLabel(null)}` },
            ...yOptions.map((name) => ({
              value: `col:${name}`,
              label: `y: ${yLabel(name)}`,
            })),
          ]}
          aria-label="Y axis column"
        />
        {capped && (
          <Tag tone="yellow">
            {unique
              ? `First ${AUTO_LIMIT_ROWS.toLocaleString()} rows only`
              : `Totals from the first ${AUTO_LIMIT_ROWS.toLocaleString()} rows only`}
          </Tag>
        )}
      </Group>
      {data.length > READABLE_POINTS && (
        <Alert color="yellow" p="xs">
          <Text size="xs">
            {truncated
              ? `Showing the first ${MAX_POINTS.toLocaleString()} of ${points.length.toLocaleString()} points.`
              : `${points.length.toLocaleString()} points.`}{" "}
            For a readable chart, use GROUP BY to reduce the result to a few
            hundred points.
          </Text>
        </Alert>
      )}
      <Box flex={1} mih={0}>
        {xCol && data.length > 0 ? (
          chart.type === "bar" ? (
            <BarChart
              h="100%"
              data={data}
              dataKey="x"
              series={[{ name: "y", label: yLabel(yCol), color: "accent.6" }]}
              withLegend={false}
              barProps={{ radius: [3, 3, 0, 0] }}
              className="chg-chart"
            />
          ) : (
            <LineChart
              h="100%"
              data={data}
              dataKey="x"
              series={[{ name: "y", label: yLabel(yCol), color: "accent.6" }]}
              withLegend={false}
              className="chg-chart"
            />
          )
        ) : (
          <Text size="sm" c="dimmed" p="md">
            No points to plot.
          </Text>
        )}
      </Box>
    </Stack>
  );
}
