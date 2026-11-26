import { BarChart } from "@mantine/charts";
import {
  Box,
  Button,
  Center,
  Code,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { v4 as uuid } from "uuid";

import { useDrawerEscape } from "../hooks/useDrawerEscape";
import { formatCount } from "../lib/format";
import { notifyError } from "../lib/notify";
import {
  cancelScan,
  fetchColumnDistribution,
  fetchColumnStats,
} from "../lib/tauri";
import { ErrorBox } from "./Errors";
import { RunClock } from "./RunClock";
import { SectionLabel, Tag } from "./ui";
import type {
  ColumnDistribution,
  ColumnStats,
  ConnectionConfigPayload,
} from "../types";

interface Props {
  opened: boolean;
  onClose: () => void;
  payload: ConnectionConfigPayload | null;
  database: string | null;
  table: string | null;
  column: string | null;
}

const NUMERIC_EDGE_FMT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatPct(n: number, total: number): string {
  if (total === 0) return "0%";
  const pct = (n / total) * 100;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct > 0) return `${pct.toFixed(2)}%`;
  return "0%";
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}
function Stat({ label, value, hint }: StatProps) {
  return (
    <Stack gap={0} className="chg-stat-block">
      <Text className="chg-stat-label">{label}</Text>
      <Group gap={4} align="baseline">
        <Text className="chg-stat-value" data-size="lg">
          {value}
        </Text>
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

export function ColumnStatsDrawer({
  opened,
  onClose,
  payload,
  database,
  table,
  column,
}: Props) {
  // Stats read the whole column twice, so they wait for "Compute stats" instead
  // of starting on click. A cached result for this column still shows at once.
  const target = `${payload?.id}\u0000${database}\u0000${table}\u0000${column}`;
  const [requested, setRequested] = useState<string | null>(null);
  // A column switch cancelled the old scans, so switching back waits for a click.
  if (requested !== null && requested !== target) setRequested(null);
  const [startedAt, setStartedAt] = useState(0);
  const ready = Boolean(opened && payload && database && table && column);
  const go = ready && requested === target;
  const queryClient = useQueryClient();
  const statsKey = ["column_stats", payload?.id, database, table, column];
  const distributionKey = [
    "column_distribution",
    payload?.id,
    database,
    table,
    column,
  ];

  // React Query also aborts the signal when a column switch drops the observer.
  function killOnAbort(signal: AbortSignal): string {
    const cfg = payload!;
    const queryId = uuid();
    signal.addEventListener("abort", () => {
      cancelScan(cfg, queryId).catch((err: { message?: string }) =>
        notifyError("Cancel failed", err.message ?? String(err)),
      );
    });
    return queryId;
  }

  const query = useQuery({
    queryKey: statsKey,
    queryFn: ({ signal }) =>
      fetchColumnStats(
        payload!,
        database!,
        table!,
        column!,
        killOnAbort(signal),
      ),
    enabled: go,
    staleTime: 30_000,
  });

  const distribution = useQuery({
    queryKey: distributionKey,
    queryFn: ({ signal }) =>
      fetchColumnDistribution(
        payload!,
        database!,
        table!,
        column!,
        killOnAbort(signal),
      ),
    enabled: go,
    staleTime: 30_000,
  });

  function start() {
    setRequested(target);
    setStartedAt(Date.now());
  }

  function stop() {
    // Without this reset, a reopened drawer rescans on its own once the cached
    // result goes stale.
    setRequested(null);
    void queryClient.cancelQueries({ queryKey: statsKey });
    void queryClient.cancelQueries({ queryKey: distributionKey });
  }

  const title =
    database && table && column ? (
      <Stack gap={0}>
        <Text fw={600} className="chg-drawer-title">
          {column}
        </Text>
        <Text size="xs" c="dimmed" className="chg-mono">
          {database}.{table}
        </Text>
      </Stack>
    ) : (
      "Column stats"
    );

  function close() {
    stop();
    onClose();
  }
  const escapeClass = useDrawerEscape(opened, close);

  return (
    <Drawer
      opened={opened}
      onClose={close}
      position="right"
      size="md"
      title={title}
      className={`chg-drawer ${escapeClass}`}
      // Keep the editor usable beside the drawer.
      withOverlay={false}
      trapFocus={false}
      lockScroll={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      {!go && !query.data ? (
        <Stack gap="sm">
          <Text size="sm">
            Stats count the rows, nulls, and distinct values, and chart the
            value distribution. They read the whole column, so on a large table
            they can take up to a minute and add load to the server.
          </Text>
          <Button onClick={start} style={{ alignSelf: "flex-start" }}>
            Compute stats
          </Button>
        </Stack>
      ) : query.isLoading ? (
        <Center h={240}>
          <Stack gap="xs" align="center">
            <Loader size="sm" />
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Scanning column…
              </Text>
              <RunClock since={startedAt} />
            </Group>
            <Button variant="default" size="compact-sm" onClick={stop}>
              Cancel
            </Button>
          </Stack>
        </Center>
      ) : query.isError ? (
        <ErrorBox
          message={
            (query.error as { message?: string })?.message ??
            String(query.error)
          }
          onRetry={() => {
            setStartedAt(Date.now());
            void query.refetch();
            void distribution.refetch();
          }}
        />
      ) : query.data ? (
        <Stack gap="sm">
          <ColumnStatsBody
            stats={query.data}
            distribution={distribution.data ?? null}
            distributionLoading={distribution.isLoading}
            distributionError={distribution.isError}
          />
          {query.isFetching || distribution.isFetching ? (
            <Button
              variant="default"
              size="compact-sm"
              onClick={stop}
              style={{ alignSelf: "flex-start" }}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="default"
              size="compact-sm"
              onClick={() => {
                setRequested(target);
                void query.refetch();
                void distribution.refetch();
              }}
              style={{ alignSelf: "flex-start" }}
            >
              Recompute
            </Button>
          )}
        </Stack>
      ) : null}
    </Drawer>
  );
}

function ColumnStatsBody({
  stats,
  distribution,
  distributionLoading,
  distributionError,
}: {
  stats: ColumnStats;
  distribution: ColumnDistribution | null;
  distributionLoading: boolean;
  distributionError: boolean;
}) {
  const nullPct =
    stats.nulls != null && stats.total != null && stats.total > 0
      ? formatPct(stats.nulls, stats.total)
      : null;
  const uniqPct =
    stats.uniq_approx != null && stats.total != null && stats.total > 0
      ? formatPct(stats.uniq_approx, stats.total)
      : null;

  return (
    <Stack gap="lg">
      <Box>
        <Tag mono>{stats.type_str || "unknown type"}</Tag>
      </Box>

      <Group gap="xl" wrap="wrap">
        <Stat label="Total rows" value={formatCount(stats.total)} />
        <Stat
          label="Nulls"
          value={formatCount(stats.nulls)}
          hint={nullPct ? `(${nullPct})` : undefined}
        />
        <Stat
          label="Distinct (approx)"
          value={formatCount(stats.uniq_approx)}
          hint={uniqPct ? `(${uniqPct})` : undefined}
        />
      </Group>

      <Stack gap={4}>
        <Text className="chg-stat-label">Min</Text>
        <Code block className="chg-code" style={{ whiteSpace: "pre-wrap" }}>
          {stats.min || "—"}
        </Code>
      </Stack>

      <Stack gap={4}>
        <Text className="chg-stat-label">Max</Text>
        <Code block className="chg-code" style={{ whiteSpace: "pre-wrap" }}>
          {stats.max || "—"}
        </Code>
      </Stack>

      <DistributionSection
        stats={stats}
        distribution={distribution}
        loading={distributionLoading}
        errored={distributionError}
      />

      <Text size="xs" c="dimmed">
        <code>uniq()</code> estimates the distinct count with HyperLogLog. For
        an exact count, run <code>uniqExact()</code>, which is slower on large
        tables.
      </Text>
    </Stack>
  );
}

function DistributionSection({
  stats,
  distribution,
  loading,
  errored,
}: {
  stats: ColumnStats;
  distribution: ColumnDistribution | null;
  loading: boolean;
  errored: boolean;
}) {
  return (
    <Stack gap={6}>
      <SectionLabel title="Distribution" />
      {loading ? (
        <Center h={100}>
          <Loader size="xs" />
        </Center>
      ) : errored ? (
        <Text size="xs" c="dimmed">
          Could not compute the distribution.
        </Text>
      ) : distribution ? (
        <DistributionContent stats={stats} distribution={distribution} />
      ) : null}
    </Stack>
  );
}

function DistributionContent({
  stats,
  distribution,
}: {
  stats: ColumnStats;
  distribution: ColumnDistribution;
}) {
  if (distribution.kind === "none") {
    return (
      <Text size="xs" c="dimmed">
        {distribution.reason}
      </Text>
    );
  }
  if (distribution.kind === "top_k") {
    if (distribution.values.length === 0) {
      return (
        <Text size="xs" c="dimmed">
          No data to plot.
        </Text>
      );
    }
    const data = distribution.values.map((v) => ({
      label: v.is_null ? "(null)" : v.label === "" ? "(empty)" : v.label,
      count: v.count,
    }));
    const subtitle =
      distribution.more && stats.uniq_approx != null
        ? `Top 10 of about ${formatCount(stats.uniq_approx)} distinct values`
        : distribution.values.length < (stats.uniq_approx ?? 0)
          ? `Top ${distribution.values.length} values`
          : null;
    return (
      <Stack gap={4}>
        <Box h={Math.max(140, Math.min(240, 18 * data.length + 40))}>
          <BarChart
            h="100%"
            data={data}
            dataKey="label"
            orientation="vertical"
            yAxisProps={{ width: 120, interval: 0 }}
            series={[{ name: "count", color: "accent.6" }]}
            withLegend={false}
            gridAxis="none"
            barProps={{ radius: [0, 3, 3, 0] }}
            className="chg-chart"
          />
        </Box>
        {subtitle && (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        )}
        {distribution.notes.map((n) => (
          <Text key={n} size="xs" c="dimmed">
            {n}
          </Text>
        ))}
      </Stack>
    );
  }
  if (distribution.buckets.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No data to plot.
      </Text>
    );
  }
  if (
    distribution.buckets.length === 1 &&
    distribution.buckets[0]!.lower === distribution.buckets[0]!.upper
  ) {
    return (
      <Text size="xs" c="dimmed">
        This column has one distinct value.
      </Text>
    );
  }
  const isTime = distribution.kind === "histogram_time";
  const formatEdge = (n: number) => {
    if (isTime) {
      const ms = n * 1000;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return String(n);
      return d.toISOString().slice(0, 10);
    }
    return NUMERIC_EDGE_FMT.format(n);
  };
  const data = distribution.buckets.map((b) => ({
    label: formatEdge(b.upper),
    count: b.count,
  }));
  return (
    <Stack gap={4}>
      <Box h={180}>
        <BarChart
          h="100%"
          data={data}
          dataKey="label"
          series={[{ name: "count", color: "accent.6" }]}
          withLegend={false}
          barProps={{ radius: [3, 3, 0, 0] }}
          className="chg-chart"
          xAxisProps={{
            tickMargin: 6,
            interval: 0,
            angle: -30,
            textAnchor: "end",
            height: 48,
          }}
        />
      </Box>
      {distribution.notes.map((n) => (
        <Text key={n} size="xs" c="dimmed">
          {n}
        </Text>
      ))}
    </Stack>
  );
}
