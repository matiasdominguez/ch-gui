import {
  ActionIcon,
  Box,
  Button,
  Center,
  Code,
  Divider,
  Drawer,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format as formatSql } from "sql-formatter";

import {
  fetchActiveMerges,
  fetchPartsSummary,
  fetchTableDetails,
  listKafkaConsumers,
  listMvFailures,
} from "../lib/tauri";
import { useDrawerEscape } from "../hooks/useDrawerEscape";
import { resolveRefetchInterval } from "../lib/pollingInterval";
import { useUserPrefs } from "../state/userPreferences";
import type {
  ActiveMerge,
  ConnectionConfigPayload,
  KafkaConsumer,
  MvFailure,
  PartsSummary,
  TableDetails,
} from "../types";

import { copyWithToast } from "../lib/clipboard";
import { quoteIdent } from "../lib/sqlIdent";
import { formatBytes, formatCount } from "../lib/format";
import { DependencyGraphView } from "./DependencyGraphView";
import { ErrorBox } from "./Errors";
import { openInsertTab } from "./InsertViewer";
import { TimeAgo } from "./TimeAgo";
import { Dot, SectionLabel, Tag } from "./ui";

function tryFormatSql(raw: string): string {
  if (!raw) return "";
  try {
    return formatSql(raw, {
      language: "clickhouse",
      keywordCase: "upper",
      tabWidth: 2,
    });
  } catch {
    return raw;
  }
}

interface Props {
  opened: boolean;
  onClose: () => void;
  payload: ConnectionConfigPayload | null;
  database: string | null;
  table: string | null;
}

type Crumb = { database: string; table: string };

function isMergeTreeEngine(engine: string): boolean {
  return engine.includes("MergeTree");
}

interface StatProps {
  label: string;
  value: React.ReactNode;
}
function Stat({ label, value }: StatProps) {
  return (
    <div className="chg-stat-block">
      <div className="chg-stat-label">{label}</div>
      <div className="chg-stat-value">{value}</div>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  dim?: boolean;
  action?: React.ReactNode;
}
function Section({ title, children, dim, action }: SectionProps) {
  return (
    <Stack gap={8} data-dim={dim || undefined}>
      <SectionLabel title={title} action={action} />
      {children}
    </Stack>
  );
}

export function TableDetailsDrawer({
  opened,
  onClose,
  payload,
  database,
  table,
}: Props) {
  const [stack, setStack] = useState<Crumb[]>(() =>
    database && table ? [{ database, table }] : [],
  );

  useEffect(() => {
    if (database && table) {
      setStack([{ database, table }]);
    } else {
      setStack([]);
    }
  }, [database, table]);

  const current = stack[stack.length - 1];

  const query = useQuery({
    queryKey: ["table_details", payload?.id, current?.database, current?.table],
    queryFn: () =>
      fetchTableDetails(payload!, current!.database, current!.table),
    enabled: Boolean(opened && payload && current),
    staleTime: 30_000,
  });

  const title = current ? `${current.database}.${current.table}` : "Table";
  const canGoBack = stack.length > 1;
  const escapeClass = useDrawerEscape(opened, onClose);

  function handlePick(database: string, t: string) {
    setStack((s) => [...s, { database, table: t }]);
  }

  function handleBack() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      className={`chg-drawer ${escapeClass}`}
      // Keep the editor usable beside the drawer.
      withOverlay={false}
      trapFocus={false}
      lockScroll={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={
        <Group gap="xs" wrap="nowrap">
          {canGoBack && (
            <Tooltip
              label={`Back to ${stack[stack.length - 2]!.database}.${stack[stack.length - 2]!.table}`}
            >
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={handleBack}
                aria-label="Back"
              >
                <ArrowLeftIcon />
              </ActionIcon>
            </Tooltip>
          )}
          <Text className="chg-drawer-title" fw={600}>
            {title}
          </Text>
        </Group>
      }
    >
      {query.isLoading ? (
        <Center h={240}>
          <Stack gap="xs" align="center">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading table details…
            </Text>
          </Stack>
        </Center>
      ) : query.isError ? (
        <ErrorBox
          message={String((query.error as Error).message ?? query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data ? (
        <TableDetailsBody
          details={query.data}
          payload={payload}
          onPick={handlePick}
        />
      ) : null}
    </Drawer>
  );
}

const PARTITIONS_SHOWN = 10;

function TableDetailsBody({
  details,
  payload,
  onPick,
}: {
  details: TableDetails;
  payload: ConnectionConfigPayload | null;
  onPick?: (database: string, table: string) => void;
}) {
  const prettyCreate = useMemo(
    () => tryFormatSql(details.create_table_query),
    [details.create_table_query],
  );
  const [showStorage, setShowStorage] = useState(false);
  const [allPartitions, setAllPartitions] = useState(false);
  const hasComments = details.columns.some((c) => c.comment);
  const hasCodecs = details.columns.some((c) => c.compression_codec);
  return (
    <ScrollArea h="calc(100vh - 100px)" type="auto" pr="md">
      <Stack gap="lg">
        {details.comment && (
          <Text size="sm" className="chg-drawer-comment">
            {details.comment}
          </Text>
        )}

        <Section title="Overview">
          <Group gap="xl" wrap="wrap" className="chg-stats">
            <Stat label="Engine" value={details.engine || "—"} />
            <Stat label="Total rows" value={formatCount(details.total_rows)} />
            <Stat label="On disk" value={formatBytes(details.total_bytes)} />
            <Stat label="Partitions" value={details.partitions.length} />
            <Stat label="Columns" value={details.columns.length} />
          </Group>
        </Section>

        {details.columns.length > 0 && (
          <>
            <Divider />
            <Section
              title={`Columns (${details.columns.length})`}
              action={
                <Tooltip label="Copy the column names as a comma-separated list for a SELECT">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    className="chg-inline-action"
                    onClick={() =>
                      copyWithToast(
                        details.columns
                          .map((c) => quoteIdent(c.name))
                          .join(", "),
                        "drawer-copy",
                      )
                    }
                  >
                    Copy names
                  </Button>
                </Tooltip>
              }
            >
              <Table
                withTableBorder
                horizontalSpacing="xs"
                verticalSpacing={4}
                fz="xs"
                className="chg-table"
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Type</Table.Th>
                    {hasComments && <Table.Th>Comment</Table.Th>}
                    <Table.Th>Default</Table.Th>
                    {hasCodecs && <Table.Th>Codec</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {details.columns.map((c) => (
                    <Table.Tr key={c.name}>
                      <Table.Td>{c.name}</Table.Td>
                      <Table.Td>{c.type_str}</Table.Td>
                      {hasComments && (
                        <Table.Td
                          style={{
                            fontFamily: "var(--mantine-font-family)",
                            whiteSpace: "normal",
                          }}
                        >
                          {c.comment || "—"}
                        </Table.Td>
                      )}
                      <Table.Td>
                        {c.default_kind ? (
                          <Box>
                            <Tag>{c.default_kind.toLowerCase()}</Tag>
                            <Text size="xs" c="dimmed" truncate>
                              {c.default_expression}
                            </Text>
                          </Box>
                        ) : (
                          "—"
                        )}
                      </Table.Td>
                      {hasCodecs && (
                        <Table.Td>{c.compression_codec || "—"}</Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Section>
          </>
        )}

        {details.engine.includes("MaterializedView") && (
          <>
            <Divider />
            <MvHealthSection
              payload={payload}
              database={details.database}
              table={details.table}
            />
          </>
        )}

        {details.engine.startsWith("Kafka") && (
          <>
            <Divider />
            <KafkaConsumerSection
              payload={payload}
              database={details.database}
              table={details.table}
            />
          </>
        )}

        {details.dependencies.length > 0 && (
          <>
            <Divider />
            <Section title={`Used by (${details.dependencies.length} direct)`}>
              <DependencyGraphView
                payload={payload}
                database={details.database}
                table={details.table}
                onPick={onPick}
              />
              <Text size="xs" c="dimmed">
                Materialized views and aliases that read from this table, plus
                the join tables and dictionaries of those views. Click a node to
                highlight it. Double-click a node to open its details.
              </Text>
            </Section>
          </>
        )}

        <Divider />
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          className="chg-disclosure-button"
          onClick={() => setShowStorage((v) => !v)}
          aria-expanded={showStorage}
          leftSection={
            <CaretRightIcon
              className="chg-tree-caret"
              data-open={showStorage || undefined}
              weight="bold"
            />
          }
          style={{ alignSelf: "flex-start" }}
        >
          Storage details
        </Button>
        {showStorage && (
          <>
            {details.engine_full && (
              <Code block style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                {details.engine_full}
              </Code>
            )}
            {isMergeTreeEngine(details.engine) && (
              <>
                <Divider />

                <Section title="MergeTree keys">
                  <Stack gap={6}>
                    <KeyRow label="ORDER BY" value={details.sorting_key} />
                    <KeyRow label="PRIMARY KEY" value={details.primary_key} />
                    <KeyRow
                      label="PARTITION BY"
                      value={details.partition_key}
                    />
                    <KeyRow label="SAMPLE BY" value={details.sampling_key} />
                  </Stack>
                </Section>
              </>
            )}

            {details.partitions.length > 0 && (
              <>
                <Divider />
                <Section title={`Partitions (${details.partitions.length})`}>
                  <Table
                    withTableBorder
                    withColumnBorders
                    horizontalSpacing="xs"
                    verticalSpacing={4}
                    fz="xs"
                    style={{
                      fontFamily: "var(--mantine-font-family-monospace)",
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Partition</Table.Th>
                        <Table.Th ta="right">Rows</Table.Th>
                        <Table.Th ta="right">Bytes</Table.Th>
                        <Table.Th ta="right">Parts</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(allPartitions
                        ? details.partitions
                        : details.partitions.slice(0, PARTITIONS_SHOWN)
                      ).map((p) => (
                        <Table.Tr key={p.partition}>
                          <Table.Td>{p.partition}</Table.Td>
                          <Table.Td ta="right">{formatCount(p.rows)}</Table.Td>
                          <Table.Td ta="right">{formatBytes(p.bytes)}</Table.Td>
                          <Table.Td ta="right">{p.parts}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {details.partitions.length > PARTITIONS_SHOWN && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => setAllPartitions((v) => !v)}
                      style={{ alignSelf: "flex-start" }}
                    >
                      {allPartitions
                        ? "Show fewer"
                        : `Show all ${details.partitions.length}`}
                    </Button>
                  )}
                </Section>
              </>
            )}

            {isMergeTreeEngine(details.engine) && (
              <>
                <Divider />
                <PartsAndMergesSection
                  payload={payload}
                  database={details.database}
                  table={details.table}
                />
              </>
            )}

            {details.skip_indexes.length > 0 && (
              <>
                <Divider />
                <Section
                  title={`Skip indexes (${details.skip_indexes.length})`}
                >
                  <Table
                    withTableBorder
                    horizontalSpacing="xs"
                    verticalSpacing={4}
                    fz="xs"
                    style={{
                      fontFamily: "var(--mantine-font-family-monospace)",
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Expression</Table.Th>
                        <Table.Th ta="right">Granularity</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {details.skip_indexes.map((idx) => (
                        <Table.Tr key={idx.name}>
                          <Table.Td>{idx.name}</Table.Td>
                          <Table.Td>{idx.type_str}</Table.Td>
                          <Table.Td>{idx.expr}</Table.Td>
                          <Table.Td ta="right">{idx.granularity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Section>
              </>
            )}

            {details.projections.length > 0 && (
              <>
                <Divider />
                <Section title={`Projections (${details.projections.length})`}>
                  <Table
                    withTableBorder
                    horizontalSpacing="xs"
                    verticalSpacing={4}
                    fz="xs"
                    style={{
                      fontFamily: "var(--mantine-font-family-monospace)",
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Expression</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {details.projections.map((p) => (
                        <Table.Tr key={p.name}>
                          <Table.Td>{p.name}</Table.Td>
                          <Table.Td>{p.proj_type}</Table.Td>
                          <Table.Td>
                            <Code
                              style={{ whiteSpace: "pre-wrap", fontSize: 11 }}
                            >
                              {p.expression}
                            </Code>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Section>
              </>
            )}

            {details.create_table_query && (
              <>
                <Divider />
                <Section
                  title="CREATE TABLE"
                  action={
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => copyWithToast(prettyCreate, "drawer-copy")}
                    >
                      Copy DDL
                    </Button>
                  }
                >
                  <Code
                    block
                    style={{
                      whiteSpace: "pre",
                      fontSize: 11,
                      overflow: "auto",
                    }}
                  >
                    {prettyCreate}
                  </Code>
                </Section>
              </>
            )}
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}

function formatProgress(p: number): string {
  const pct = Math.max(0, Math.min(1, p)) * 100;
  return `${pct.toFixed(1)}%`;
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  if (m < 60) return `${m}m${rem > 0 ? ` ${rem}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function PartsAndMergesSection({
  payload,
  database,
  table,
}: {
  payload: ConnectionConfigPayload | null;
  database: string;
  table: string;
}) {
  const partsQ = useQuery({
    queryKey: ["parts_summary", payload?.id, database, table],
    queryFn: () => fetchPartsSummary(payload!, database, table),
    enabled: Boolean(payload),
    staleTime: 30_000,
    retry: false,
  });
  const mergesQ = useQuery({
    queryKey: ["active_merges", payload?.id, database, table],
    queryFn: () => fetchActiveMerges(payload!, database, table),
    enabled: Boolean(payload),
    staleTime: 30_000,
    retry: false,
  });

  const partsResult = partsQ.data;
  const parts: PartsSummary | undefined =
    partsResult?.status === "enabled" ? partsResult.summary : undefined;
  const partsDisabled = partsResult?.status === "disabled";
  const merges: ActiveMerge[] | undefined = mergesQ.data;
  const loading = partsQ.isLoading || mergesQ.isLoading;

  return (
    <Section title="Parts & merges">
      <Group justify="space-between" align="flex-start">
        {partsDisabled ? (
          <Text size="xs" c="dimmed">
            Can't read <code>system.parts</code> on this connection. To see
            parts here, ask an admin for read access to it.
          </Text>
        ) : (
          <Group gap="md" wrap="wrap">
            <Stat
              label="Active parts"
              value={parts ? formatCount(parts.active_count) : "—"}
            />
            <Stat
              label="Inactive"
              value={parts ? formatCount(parts.inactive_count) : "—"}
            />
            <Stat
              label="Active on disk"
              value={parts ? formatBytes(parts.total_active_bytes) : "—"}
            />
            <Stat
              label="Biggest active"
              value={parts ? formatBytes(parts.biggest_active_bytes) : "—"}
            />
            <Stat
              label="Oldest active"
              value={
                parts?.oldest_active_modified_at ? (
                  <TimeAgo value={parts.oldest_active_modified_at} />
                ) : (
                  "—"
                )
              }
            />
          </Group>
        )}
        <Tooltip label="Refresh parts and merges">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => {
              partsQ.refetch();
              mergesQ.refetch();
            }}
            loading={loading}
            aria-label="Refresh parts and merges"
          >
            <ArrowClockwiseIcon />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box>
        <Text size="xs" c="dimmed" fw={600} mb={4}>
          Active merges
        </Text>
        {mergesQ.isLoading && !merges ? (
          <Text size="xs" c="dimmed">
            Loading…
          </Text>
        ) : mergesQ.isError ? (
          <ErrorBox
            message={String((mergesQ.error as Error).message ?? mergesQ.error)}
            onRetry={() => mergesQ.refetch()}
          />
        ) : !merges || merges.length === 0 ? (
          <Text size="xs" c="dimmed">
            No active merges.
          </Text>
        ) : (
          <Table
            withTableBorder
            horizontalSpacing="xs"
            verticalSpacing={4}
            fz="xs"
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Result part</Table.Th>
                <Table.Th ta="right">Progress</Table.Th>
                <Table.Th ta="right">Elapsed</Table.Th>
                <Table.Th ta="right">Parts</Table.Th>
                <Table.Th ta="right">Rows read</Table.Th>
                <Table.Th ta="right">Bytes read</Table.Th>
                <Table.Th>Kind</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {merges.map((m, i) => (
                <Table.Tr key={`${m.result_part_name}:${i}`}>
                  <Table.Td>{m.result_part_name}</Table.Td>
                  <Table.Td ta="right">{formatProgress(m.progress)}</Table.Td>
                  <Table.Td ta="right">{formatElapsed(m.elapsed_s)}</Table.Td>
                  <Table.Td ta="right">{m.num_parts}</Table.Td>
                  <Table.Td ta="right">{formatCount(m.rows_read)}</Table.Td>
                  <Table.Td ta="right">
                    {formatBytes(m.bytes_read_uncompressed)}
                  </Table.Td>
                  <Table.Td>
                    <Tag tone={m.is_mutation ? "yellow" : "accent"}>
                      {m.is_mutation ? "mutation" : "merge"}
                    </Tag>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Box>
    </Section>
  );
}

function MvHealthSection({
  payload,
  database,
  table,
}: {
  payload: ConnectionConfigPayload | null;
  database: string;
  table: string;
}) {
  const viewName = `${database}.${table}`;
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const q = useQuery({
    queryKey: ["mv_health", payload?.id, viewName],
    queryFn: () => listMvFailures(payload!, viewName),
    enabled: Boolean(payload),
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    refetchIntervalInBackground: false,
    retry: false,
  });

  return (
    <Section title="Health">
      {q.isLoading && !q.data ? (
        <Text size="xs" c="dimmed">
          Loading…
        </Text>
      ) : q.isError ? (
        <ErrorBox
          message={
            (q.error as { message?: string })?.message ?? String(q.error)
          }
          onRetry={() => q.refetch()}
        />
      ) : q.data?.status === "disabled" ? (
        <Text size="xs" c="dimmed">
          <code>query_views_log</code> is not enabled on this cluster. Without
          it, ch-gui can't check this view for failures.
        </Text>
      ) : q.data?.rows.length === 0 ? (
        <Group gap={6}>
          <Dot tone="green" />
          <Text size="xs">No failures in the last 7 days</Text>
        </Group>
      ) : (
        <Stack gap={4}>
          <Group gap={6}>
            <Dot tone="red" />
            <Text size="xs">
              {q.data!.rows.length} failure(s) in the last 7 days
            </Text>
          </Group>
          <Stack gap={2}>
            {q.data!.rows.slice(0, 10).map((f, i) => (
              <MvHealthRow
                key={`${f.event_time}:${f.initial_query_id}:${i}`}
                f={f}
                connectionId={payload?.id ?? ""}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Section>
  );
}

function MvHealthRow({
  f,
  connectionId,
}: {
  f: MvFailure;
  connectionId: string;
}) {
  const hasInsert = f.initial_query.trim().length > 0;
  return (
    <Stack gap={2} className="chg-failure">
      <Group gap={6} wrap="wrap">
        <Text size="xs" c="dimmed" className="chg-time">
          <TimeAgo value={f.event_time} />
        </Text>
        <Tag mono>{f.status}</Tag>
        {hasInsert && connectionId && (
          <Button
            size="compact-xs"
            variant="subtle"
            className="chg-inline-action"
            onClick={() => openInsertTab(f.view_name, f.initial_query)}
          >
            Open INSERT
          </Button>
        )}
      </Group>
      <Text
        size="xs"
        c="dimmed"
        lineClamp={2}
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        {f.exception || "(no exception text)"}
      </Text>
    </Stack>
  );
}

function KafkaConsumerSection({
  payload,
  database,
  table,
}: {
  payload: ConnectionConfigPayload | null;
  database: string;
  table: string;
}) {
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const q = useQuery({
    queryKey: ["kafka_consumers", payload?.id, database, table],
    queryFn: () => listKafkaConsumers(payload!, database, table),
    enabled: Boolean(payload),
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    refetchIntervalInBackground: false,
    retry: false,
  });

  return (
    <Section title="Kafka consumers">
      <Tooltip
        label="ClickHouse records only consumer state, not partition lag on the broker."
        multiline
        w={280}
        withArrow
      >
        <Text size="xs" c="dimmed" style={{ cursor: "help" }}>
          system.kafka_consumers · cluster-wide
        </Text>
      </Tooltip>
      {q.isLoading && !q.data ? (
        <Text size="xs" c="dimmed">
          Loading…
        </Text>
      ) : q.isError ? (
        <ErrorBox
          message={
            (q.error as { message?: string })?.message ?? String(q.error)
          }
          onRetry={() => q.refetch()}
        />
      ) : q.data?.status === "disabled" ? (
        <Text size="xs" c="dimmed">
          <code>system.kafka_consumers</code> is not available. It requires
          ClickHouse 23.5 or later.
        </Text>
      ) : q.data!.rows.length === 0 ? (
        <Text size="xs" c="dimmed">
          No consumer rows yet
        </Text>
      ) : (
        <Stack gap={6}>
          {q.data!.rows.map((c, i) => (
            <KafkaConsumerRow key={`${c.consumer_id}:${i}`} c={c} />
          ))}
        </Stack>
      )}
    </Section>
  );
}

function KafkaConsumerRow({ c }: { c: KafkaConsumer }) {
  const failing = c.last_exception.trim().length > 0;
  return (
    <Stack gap={2} className="chg-failure" data-tone={failing ? "red" : "gray"}>
      <Group gap={6} wrap="wrap">
        <Text
          size="xs"
          fw={500}
          style={{
            fontFamily: "var(--mantine-font-family-monospace)",
            flex: 1,
            minWidth: 0,
          }}
          truncate
        >
          {c.consumer_id || "(unnamed consumer)"}
        </Text>
        <Text size="xs" c="dimmed">
          <TimeAgo value={c.last_poll_time} />
        </Text>
      </Group>
      {c.assignments && (
        <Text
          size="xs"
          c="dimmed"
          style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          lineClamp={2}
        >
          {c.assignments}
        </Text>
      )}
      <Group gap={10} wrap="wrap">
        <Text size="xs" c="dimmed">
          {formatCount(c.num_messages_read)} msgs
        </Text>
        <Text size="xs" c="dimmed">
          {formatCount(c.num_commits)} commits
        </Text>
        {c.num_rebalance_revocations > 0 && (
          <Text size="xs" c="dimmed">
            {formatCount(c.num_rebalance_revocations)} rebalances
          </Text>
        )}
      </Group>
      {failing && (
        <Code
          block
          className="chg-code"
          data-tone="red"
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {c.last_exception}
        </Code>
      )}
    </Stack>
  );
}

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="md" align="baseline">
      <Text
        size="xs"
        c="dimmed"
        fw={600}
        style={{
          minWidth: 110,
          fontFamily: "var(--mantine-font-family-monospace)",
        }}
      >
        {label}
      </Text>
      <Text
        size="sm"
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        {value || "—"}
      </Text>
    </Group>
  );
}
