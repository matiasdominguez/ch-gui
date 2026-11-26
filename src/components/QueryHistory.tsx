import {
  ActionIcon,
  Collapse,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
  StarIcon,
} from "@phosphor-icons/react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { listHistory, setHistoryPinned } from "../lib/db";
import { formatBytes, formatCount } from "../lib/format";
import { notifyError } from "../lib/notify";
import {
  filterSummary,
  uiToBackendFilters,
  type ServerHistoryFilterUi,
} from "../lib/serverHistoryFilters";
import { listServerHistory, listServerHistoryGrouped } from "../lib/tauri";
import { useTabs } from "../state/tabs";
import type { ConnectionConfigPayload, ServerHistoryGroup } from "../types";

import { ErrorBox } from "./Errors";
import { TimeAgo } from "./TimeAgo";
import { NoConnection, Tag } from "./ui";

interface Props {
  connectionId: string | null;
  payload: ConnectionConfigPayload | null;
  loadFailed?: boolean;
}

type Source = "local" | "server";

export function QueryHistory({ connectionId, payload, loadFailed }: Props) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Source>("local");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [filterUi, setFilterUi] = useState<ServerHistoryFilterUi>({
    min_duration_s: "",
    min_memory_mb: "",
    exception_only: false,
  });
  const qc = useQueryClient();

  const backendFilters = useMemo(
    () => uiToBackendFilters(filterUi),
    [filterUi],
  );
  const filterKey = useMemo(
    () => JSON.stringify(backendFilters),
    [backendFilters],
  );
  const summary = filterSummary(filterUi, grouped);

  const local = useQuery({
    queryKey: ["history", connectionId, search],
    queryFn: () => listHistory(connectionId!, search, 200),
    enabled: Boolean(connectionId) && source === "local",
    placeholderData: keepPreviousData,
  });

  const server = useQuery({
    queryKey: ["server_history", connectionId, filterKey],
    queryFn: () => listServerHistory(payload!, 500, backendFilters),
    enabled:
      Boolean(payload && connectionId) && source === "server" && !grouped,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const serverGrouped = useQuery({
    queryKey: ["server_history_grouped", connectionId, filterKey],
    queryFn: () => listServerHistoryGrouped(payload!, 20, backendFilters),
    enabled: Boolean(payload && connectionId) && source === "server" && grouped,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  if (!connectionId) {
    return (
      <NoConnection failed={loadFailed}>
        Pick a connection to see its history.
      </NoConnection>
    );
  }

  async function togglePin(id: number, currentlyPinned: number) {
    try {
      await setHistoryPinned(id, !currentlyPinned);
      qc.invalidateQueries({ queryKey: ["history", connectionId] });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Pin failed", e.message ?? String(err));
    }
  }

  const serverItems = (() => {
    const list = server.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((h) => h.query.toLowerCase().includes(needle));
  })();

  const groupItems = (() => {
    const list = serverGrouped.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((g) => g.sample_query.toLowerCase().includes(needle));
  })();

  function refreshServer() {
    if (grouped) {
      qc.invalidateQueries({
        queryKey: ["server_history_grouped", connectionId],
      });
    } else {
      qc.invalidateQueries({ queryKey: ["server_history", connectionId] });
    }
  }

  return (
    <Stack gap={4} h="100%">
      <Stack gap={4} px="sm">
        <Group gap={6} wrap="nowrap" align="center">
          <SegmentedControl
            size="xs"
            value={source}
            onChange={(v) => setSource(v as Source)}
            data={[
              { value: "local", label: "Local" },
              { value: "server", label: "Server" },
            ]}
            style={{ flex: 1 }}
          />
          {source === "server" && (
            <Tooltip label="Refresh">
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label="Refresh server history"
                onClick={refreshServer}
                loading={server.isFetching || serverGrouped.isFetching}
              >
                <ArrowClockwiseIcon />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
        {source === "server" && (
          <>
            <UnstyledButton
              onClick={() => setFiltersOpen((v) => !v)}
              style={{ padding: "2px 4px" }}
              aria-expanded={filtersOpen}
              aria-label="Toggle filters"
            >
              <Group gap={4} wrap="nowrap">
                <span className="chg-disclosure">
                  <CaretRightIcon
                    className="chg-tree-caret"
                    data-open={filtersOpen || undefined}
                    weight="bold"
                  />
                  Filters
                </span>
                {summary && !filtersOpen && (
                  <Text size="xs" c="dimmed">
                    · {summary}
                  </Text>
                )}
              </Group>
            </UnstyledButton>
            <Collapse in={filtersOpen}>
              <Stack gap={4}>
                <Group gap={6} wrap="nowrap">
                  <NumberInput
                    size="xs"
                    placeholder="min duration"
                    suffix=" s"
                    min={0}
                    value={filterUi.min_duration_s}
                    onChange={(v) =>
                      setFilterUi((s) => ({
                        ...s,
                        min_duration_s: typeof v === "number" ? v : "",
                      }))
                    }
                    style={{ flex: 1 }}
                  />
                  <NumberInput
                    size="xs"
                    placeholder="min memory"
                    suffix=" MB"
                    min={0}
                    value={filterUi.min_memory_mb}
                    onChange={(v) =>
                      setFilterUi((s) => ({
                        ...s,
                        min_memory_mb: typeof v === "number" ? v : "",
                      }))
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group gap="md" wrap="wrap">
                  <Switch
                    size="xs"
                    label="Exceptions only"
                    checked={filterUi.exception_only}
                    onChange={(e) =>
                      setFilterUi((s) => ({
                        ...s,
                        exception_only: e.currentTarget.checked,
                      }))
                    }
                  />
                  <Switch
                    size="xs"
                    label="Group by normalized query"
                    checked={grouped}
                    onChange={(e) => setGrouped(e.currentTarget.checked)}
                  />
                </Group>
              </Stack>
            </Collapse>
          </>
        )}
        <TextInput
          size="xs"
          placeholder={
            source === "local" ? "Search history…" : "Search server history…"
          }
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Stack>

      <ScrollArea flex={1} px="xs">
        {source === "local" ? (
          local.isError ? (
            <ErrorBox
              message={String((local.error as Error).message ?? local.error)}
              onRetry={() => local.refetch()}
            />
          ) : (
            <LocalList
              items={local.data ?? []}
              search={search}
              onTogglePin={togglePin}
            />
          )
        ) : grouped ? (
          serverGrouped.isLoading ? (
            <Text size="xs" c="dimmed" px="xs" py="md">
              Loading grouped history…
            </Text>
          ) : serverGrouped.error ? (
            <ErrorBox
              message={String(
                (serverGrouped.error as Error).message ?? serverGrouped.error,
              )}
              onRetry={() => serverGrouped.refetch()}
            />
          ) : groupItems.length === 0 ? (
            <Text size="xs" c="dimmed" px="xs" py="md">
              {(serverGrouped.data ?? []).length === 0
                ? "No server queries match the filters."
                : "No groups match the search."}
            </Text>
          ) : (
            <ServerGroupList items={groupItems} />
          )
        ) : server.isLoading ? (
          <Text size="xs" c="dimmed" px="xs" py="md">
            Loading server history…
          </Text>
        ) : server.error ? (
          <ErrorBox
            message={String((server.error as Error).message ?? server.error)}
            onRetry={() => server.refetch()}
          />
        ) : serverItems.length === 0 ? (
          <Text size="xs" c="dimmed" px="xs" py="md">
            {(server.data ?? []).length === 0
              ? "No server queries in the last 7 days."
              : "No queries match the search."}
          </Text>
        ) : (
          <ServerList items={serverItems} />
        )}
      </ScrollArea>
    </Stack>
  );
}

function LocalList({
  items,
  search,
  onTogglePin,
}: {
  items: ReturnType<typeof listHistory> extends Promise<infer T> ? T : never;
  search: string;
  onTogglePin: (id: number, currentlyPinned: number) => void;
}) {
  if (items.length === 0) {
    return (
      <Text size="xs" c="dimmed" px="xs">
        {search ? `No queries match “${search}”.` : "No queries yet."}
      </Text>
    );
  }
  return (
    <>
      {items.map((h) => {
        const pinned = Boolean(h.pinned);
        return (
          <Group
            key={h.id}
            gap={2}
            wrap="nowrap"
            align="flex-start"
            className="chg-row-with-more"
            data-pinned={pinned || undefined}
          >
            <UnstyledButton
              className="chg-list-row"
              style={{ flex: 1, minWidth: 0 }}
              onClick={() => {
                useTabs.getState().openSql(h.sql);
              }}
            >
              <Stack gap={2}>
                <Text size="xs" lineClamp={2} className="chg-mono chg-sql">
                  {h.sql}
                </Text>
                <div className="chg-meta">
                  <TimeAgo value={h.executed_at} />
                  {h.error ? (
                    <Tag tone="red">error</Tag>
                  ) : (
                    <>
                      <span>{h.rows_returned ?? "?"} rows</span>
                      {h.duration_ms !== null && <span>{h.duration_ms}ms</span>}
                    </>
                  )}
                </div>
              </Stack>
            </UnstyledButton>
            <Tooltip label={pinned ? "Unpin" : "Pin"}>
              <ActionIcon
                variant="subtle"
                size="sm"
                color={pinned ? "yellow" : "gray"}
                aria-label={
                  pinned ? "Unpin history entry" : "Pin history entry"
                }
                onClick={() => onTogglePin(h.id, h.pinned)}
                className="chg-row-more chg-pin"
                data-pinned={pinned || undefined}
                style={{ marginTop: 4, marginRight: 2 }}
              >
                <StarIcon weight={pinned ? "fill" : "regular"} />
              </ActionIcon>
            </Tooltip>
          </Group>
        );
      })}
    </>
  );
}

function ServerGroupList({ items }: { items: ServerHistoryGroup[] }) {
  return (
    <Stack gap={0}>
      {items.map((g) => (
        <UnstyledButton
          key={g.normalized_query_hash}
          className="chg-list-row"
          onClick={() => {
            if (!g.sample_query) return;
            useTabs.getState().openSql(g.sample_query);
          }}
        >
          <Stack gap={2}>
            <Text size="xs" lineClamp={2} className="chg-mono chg-sql">
              {g.sample_query || "(empty)"}
            </Text>
            <div className="chg-meta">
              <span className="chg-meta-strong">{formatCount(g.count)}×</span>
              <span>avg {Math.round(g.avg_duration_ms)} ms</span>
              <span>max {g.max_duration_ms} ms</span>
              <span>read {formatBytes(g.sum_read_bytes)}</span>
              <span>mem {formatBytes(g.sum_memory)}</span>
              <span>
                <TimeAgo value={g.first_seen} /> →{" "}
                <TimeAgo value={g.last_seen} />
              </span>
            </div>
          </Stack>
        </UnstyledButton>
      ))}
    </Stack>
  );
}

function ServerList({
  items,
}: {
  items: ReturnType<typeof listServerHistory> extends Promise<infer T>
    ? T
    : never;
}) {
  return (
    <Stack gap={0}>
      {items.map((h) => (
        <UnstyledButton
          key={h.query_id || h.event_time}
          className="chg-list-row"
          onClick={() => {
            useTabs.getState().openSql(h.query);
          }}
        >
          <Stack gap={2}>
            <Text size="xs" lineClamp={2} className="chg-mono chg-sql">
              {h.query || "(empty)"}
            </Text>
            <div className="chg-meta">
              <TimeAgo value={h.event_time} />
              {h.user && <span>{h.user}</span>}
              {h.exception ? (
                <Tag tone="red">error</Tag>
              ) : (
                <>
                  <span>{formatCount(h.result_rows)} rows</span>
                  {h.query_duration_ms !== null && (
                    <span>{h.query_duration_ms} ms</span>
                  )}
                  {h.read_bytes !== null && (
                    <span>{formatBytes(h.read_bytes)}</span>
                  )}
                </>
              )}
            </div>
          </Stack>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
