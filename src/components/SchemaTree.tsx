import {
  ActionIcon,
  Box,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
  DatabaseIcon,
  DotsThreeIcon,
  EyeIcon,
  LightningIcon,
  TableIcon,
  TrayArrowDownIcon,
} from "@phosphor-icons/react";
import {
  useIsFetching,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  introspectColumns,
  introspectDatabases,
  introspectTables,
} from "../lib/tauri";
import { copyWithToast } from "../lib/clipboard";
import { prefetchSchema } from "../lib/schemaIndex";
import { quoteIdent, sqlName } from "../lib/sqlIdent";
import { innerTables, STREAMING_ENGINES, tableKind } from "../lib/tableKind";
import { useTabs } from "../state/tabs";
import type { ColumnInfo, ConnectionConfigPayload, TableInfo } from "../types";

import { ColumnStatsDrawer } from "./ColumnStatsDrawer";
import { ErrorBox } from "./Errors";
import { TableDetailsDrawer } from "./TableDetailsDrawer";
import { NoConnection } from "./ui";

function TableGlyph({ engine }: { engine: string }) {
  if (engine === "MaterializedView")
    return <LightningIcon className="chg-tree-icon" />;
  if (engine === "View" || engine === "LiveView")
    return <EyeIcon className="chg-tree-icon" />;
  if (STREAMING_ENGINES.has(engine))
    return <TrayArrowDownIcon className="chg-tree-icon" />;
  return <TableIcon className="chg-tree-icon" />;
}

function Caret({ open }: { open: boolean }) {
  return (
    <CaretRightIcon
      className="chg-tree-caret"
      data-open={open || undefined}
      weight="bold"
    />
  );
}

function parentRow(row: HTMLElement): HTMLElement | null {
  return (
    row
      .closest(".chg-tree-children")
      ?.parentElement?.querySelector<HTMLElement>(".chg-tree-row") ?? null
  );
}

function onRowKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const row = e.currentTarget;
  const rows = Array.from(
    row.closest(".chg-tree")?.querySelectorAll<HTMLElement>(".chg-tree-row") ??
      [],
  );
  const i = rows.indexOf(row);
  const expanded = row.getAttribute("aria-expanded");
  let target: HTMLElement | null | undefined;
  if (e.key === "ArrowDown") target = rows[i + 1];
  else if (e.key === "ArrowUp") target = rows[i - 1];
  else if (e.key === "ArrowRight" && expanded === "false") row.click();
  else if (e.key === "ArrowRight" && expanded === "true")
    target = rows[i + 1] && parentRow(rows[i + 1]) === row ? rows[i + 1] : null;
  else if (e.key === "ArrowLeft" && expanded === "true") row.click();
  else if (e.key === "ArrowLeft") target = parentRow(row);
  else return;
  e.preventDefault();
  target?.focus();
}

interface Props {
  payload: ConnectionConfigPayload | null;
  loadFailed?: boolean;
  onCompareTable?: (ref: { database: string; table: string }) => void;
  onRunTab?: (tabId: string) => void;
  onInsert?: (text: string) => void;
}

export function SchemaTree({
  payload,
  loadFailed,
  onCompareTable,
  onRunTab,
  onInsert,
}: Props) {
  const activeId = payload?.id ?? null;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Databases the user collapsed while a filter had opened them. This stays
  // separate from `expanded` so a filter never rewrites the unfiltered tree.
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(
    new Set(),
  );
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<{
    database: string;
    table: string;
  } | null>(null);
  const [statsFor, setStatsFor] = useState<{
    database: string;
    table: string;
    column: string;
  } | null>(null);

  const dbsQuery = useQuery({
    queryKey: ["dbs", activeId],
    queryFn: () => introspectDatabases(payload!),
    enabled: Boolean(payload && activeId),
    staleTime: 30_000,
  });

  const q = filter.trim().toLowerCase();
  const dbNames = useMemo(
    () => (dbsQuery.data ?? []).map((d) => d.name),
    [dbsQuery.data],
  );
  const expandedDbs = useMemo(
    () => Array.from(new Set([...expanded, ...(q ? dbNames : [])])),
    [expanded, q, dbNames],
  );

  // Only databases the user opened fetch here. The other databases a search
  // adds read the cache; the effect below fills it through the bounded
  // prefetcher, not with one request per database on the first keystroke.
  const tableResults = useQueries({
    queries: expandedDbs.map((db) => ({
      queryKey: ["tables", activeId, db],
      queryFn: () => introspectTables(payload!, db),
      enabled: Boolean(payload && activeId && expanded.has(db)),
      staleTime: 30_000,
    })),
  });
  const searchActive = q !== "";
  useEffect(() => {
    if (!searchActive || !payload) return;
    const ac = new AbortController();
    prefetchSchema(queryClient, payload.id, payload, ac.signal).catch(() => {});
    return () => ac.abort();
  }, [searchActive, payload, queryClient]);
  const fetchingTables = useIsFetching({ queryKey: ["tables", activeId] }) > 0;

  const expandedTablesArr = useMemo(
    () => Array.from(expandedTables),
    [expandedTables],
  );

  const columnResults = useQueries({
    queries: expandedTablesArr.map((key) => {
      const [database, table] = key.split("\u0000");
      return {
        queryKey: ["cols", activeId, database, table],
        queryFn: () => introspectColumns(payload!, database, table),
        enabled: Boolean(payload && activeId),
        staleTime: 60_000,
      };
    }),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["dbs", activeId] });
    queryClient.invalidateQueries({ queryKey: ["tables", activeId] });
    queryClient.invalidateQueries({ queryKey: ["cols", activeId] });
    // The search's table lists only read the cache, so invalidation alone does
    // not reload them.
    if (q && payload) {
      prefetchSchema(queryClient, payload.id, payload).catch(() => {});
    }
  }

  function toggleDb(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleFilterCollapsed(name: string) {
    setFilterCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleTable(database: string, table: string) {
    const key = `${database}\u0000${table}`;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function previewTable(database: string, table: string, engine: string) {
    const id = useTabs.getState().open({
      title: `${database}.${table}`,
      sql: `SELECT *\nFROM ${quoteIdent(database)}.${quoteIdent(table)}\nLIMIT 100`,
    });
    // Reading a streaming table can consume messages before the views that read
    // from it see them, so these previews open without running.
    if (!STREAMING_ENGINES.has(engine)) onRunTab?.(id);
  }

  if (!payload) {
    return (
      <NoConnection failed={loadFailed} size="sm">
        Pick or create a connection above to browse its schema.
      </NoConnection>
    );
  }

  if (dbsQuery.isLoading) {
    return (
      <Group gap={6} px="sm">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Loading databases…
        </Text>
      </Group>
    );
  }

  if (dbsQuery.isError) {
    return (
      <ErrorBox
        message={String((dbsQuery.error as Error).message ?? dbsQuery.error)}
        onRetry={() => dbsQuery.refetch()}
      />
    );
  }

  const dbs = dbsQuery.data ?? [];
  const tablesOf = (db: string) => {
    const i = expandedDbs.indexOf(db);
    return i >= 0 ? tableResults[i] : null;
  };
  type Row = {
    db: (typeof dbs)[number];
    auto: boolean;
    open: boolean;
    only: Set<string> | null;
  };
  const filtered = dbs.flatMap((d): Row[] => {
    if (!q)
      return [{ db: d, auto: false, open: expanded.has(d.name), only: null }];
    const dbHit = d.name.toLowerCase().includes(q);
    const tables = tablesOf(d.name)?.data ?? [];
    const inner = innerTables(tables);
    const hits = tables.filter(
      (t) => !inner.has(t.name) && t.name.toLowerCase().includes(q),
    );
    if (!dbHit && hits.length === 0) return [];
    const auto = hits.length > 0;
    return [
      {
        db: d,
        auto,
        open: auto ? !filterCollapsed.has(d.name) : expanded.has(d.name),
        only: dbHit ? null : new Set(hits.map((t) => t.name)),
      },
    ];
  });
  const searching = searchActive && fetchingTables;
  const unsearched = q ? expandedDbs.filter((db) => tablesOf(db)?.isError) : [];

  return (
    <Stack gap={4} h="100%">
      <Group gap={4} px="sm" wrap="nowrap" className="chg-tree-filter">
        <TextInput
          flex={1}
          size="xs"
          placeholder="Filter databases and tables…"
          value={filter}
          onChange={(e) => {
            setFilter(e.currentTarget.value);
            setFilterCollapsed(new Set());
          }}
        />
        <Tooltip label="Refresh schema">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={refresh}
            aria-label="Refresh schema"
          >
            <ArrowClockwiseIcon />
          </ActionIcon>
        </Tooltip>
      </Group>
      <ScrollArea flex={1} px="xs" className="chg-tree">
        {q && filtered.length === 0 && (
          <Text size="sm" c="dimmed" px={4} py="xs">
            {searching
              ? "Searching tables…"
              : `No databases or tables match “${filter.trim()}”.`}
          </Text>
        )}
        {unsearched.length > 0 && (
          <Text size="xs" c="red" px={4} py={4}>
            Couldn't load the tables in {unsearched.join(", ")}, so the filter
            skips them.
          </Text>
        )}
        {filtered.map(({ db, auto, open: isOpen, only }) => {
          const tablesQ = tablesOf(db.name);
          const inner = innerTables(tablesQ?.data ?? []);
          return (
            <Box key={db.name}>
              <UnstyledButton
                className="chg-tree-row"
                data-level="db"
                aria-expanded={isOpen}
                onClick={() =>
                  auto ? toggleFilterCollapsed(db.name) : toggleDb(db.name)
                }
                onKeyDown={onRowKeyDown}
              >
                <Caret open={isOpen} />
                <DatabaseIcon className="chg-tree-icon" />
                <span className="chg-tree-label">{db.name}</span>
              </UnstyledButton>
              {isOpen && (
                <Box className="chg-tree-children">
                  {!tablesQ || tablesQ.isLoading ? (
                    <Text size="xs" c="dimmed" className="chg-tree-note">
                      …
                    </Text>
                  ) : tablesQ.isError ? (
                    <ErrorBox
                      message={String(
                        (tablesQ.error as Error).message ?? tablesQ.error,
                      )}
                      onRetry={() => tablesQ.refetch()}
                    />
                  ) : (
                    (tablesQ.data ?? [])
                      .filter(
                        (t: TableInfo) =>
                          !inner.has(t.name) && (!only || only.has(t.name)),
                      )
                      .map((t: TableInfo) => {
                        const tkey = `${db.name}\u0000${t.name}`;
                        const tOpen = expandedTables.has(tkey);
                        const colsIdx = expandedTablesArr.indexOf(tkey);
                        const colsQ =
                          colsIdx >= 0 ? columnResults[colsIdx] : null;
                        return (
                          <Box key={t.name}>
                            <Group
                              gap={2}
                              wrap="nowrap"
                              className="chg-tree-table"
                              data-menu-open={menuFor === tkey || undefined}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setMenuFor(tkey);
                              }}
                            >
                              <UnstyledButton
                                className="chg-tree-row"
                                data-level="table"
                                title={`${tableKind(t.engine)} · ${t.engine}`}
                                aria-expanded={tOpen}
                                onClick={() => toggleTable(db.name, t.name)}
                                onDoubleClick={() =>
                                  previewTable(db.name, t.name, t.engine)
                                }
                                onKeyDown={onRowKeyDown}
                              >
                                <Caret open={tOpen} />
                                <TableGlyph engine={t.engine} />
                                <span className="chg-tree-label">{t.name}</span>
                              </UnstyledButton>
                              <Menu
                                position="right-start"
                                withinPortal
                                opened={menuFor === tkey}
                                onChange={(o) => setMenuFor(o ? tkey : null)}
                              >
                                <Menu.Target>
                                  <ActionIcon
                                    variant="subtle"
                                    size="xs"
                                    className="chg-tree-more"
                                    aria-label={`Actions for ${t.name}`}
                                  >
                                    <DotsThreeIcon weight="bold" />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    onClick={() =>
                                      previewTable(db.name, t.name, t.engine)
                                    }
                                  >
                                    {STREAMING_ENGINES.has(t.engine)
                                      ? "Open a preview query"
                                      : "Preview 100 rows"}
                                  </Menu.Item>
                                  {onInsert && (
                                    <Menu.Item
                                      onClick={() =>
                                        onInsert(
                                          `${sqlName(db.name)}.${sqlName(t.name)}`,
                                        )
                                      }
                                    >
                                      Insert name
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    onClick={() =>
                                      copyWithToast(
                                        `${sqlName(db.name)}.${sqlName(t.name)}`,
                                        "table-name",
                                      )
                                    }
                                  >
                                    Copy name
                                  </Menu.Item>
                                  <Menu.Item
                                    onClick={() =>
                                      setInspecting({
                                        database: db.name,
                                        table: t.name,
                                      })
                                    }
                                  >
                                    Inspect table…
                                  </Menu.Item>
                                  {onCompareTable && (
                                    <Menu.Item
                                      onClick={() =>
                                        onCompareTable({
                                          database: db.name,
                                          table: t.name,
                                        })
                                      }
                                    >
                                      Compare with another table…
                                    </Menu.Item>
                                  )}
                                </Menu.Dropdown>
                              </Menu>
                            </Group>
                            {tOpen && (
                              <Box className="chg-tree-children">
                                {!colsQ || colsQ.isLoading ? (
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    className="chg-tree-note"
                                  >
                                    …
                                  </Text>
                                ) : colsQ.isError ? (
                                  <ErrorBox
                                    message={String(
                                      (colsQ.error as Error).message ??
                                        colsQ.error,
                                    )}
                                    onRetry={() => colsQ.refetch()}
                                  />
                                ) : (
                                  (colsQ.data ?? []).map((c: ColumnInfo) => (
                                    <UnstyledButton
                                      key={c.name}
                                      className="chg-tree-row"
                                      data-level="column"
                                      onClick={() =>
                                        setStatsFor({
                                          database: db.name,
                                          table: t.name,
                                          column: c.name,
                                        })
                                      }
                                      onKeyDown={onRowKeyDown}
                                    >
                                      <span className="chg-tree-label">
                                        {c.name}
                                      </span>
                                      <span
                                        className="chg-tree-type"
                                        title={c.type}
                                      >
                                        {c.type}
                                      </span>
                                    </UnstyledButton>
                                  ))
                                )}
                              </Box>
                            )}
                          </Box>
                        );
                      })
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </ScrollArea>
      <TableDetailsDrawer
        opened={inspecting !== null}
        onClose={() => setInspecting(null)}
        payload={payload}
        database={inspecting?.database ?? null}
        table={inspecting?.table ?? null}
      />
      <ColumnStatsDrawer
        opened={statsFor !== null}
        onClose={() => setStatsFor(null)}
        payload={payload}
        database={statsFor?.database ?? null}
        table={statsFor?.table ?? null}
        column={statsFor?.column ?? null}
      />
    </Stack>
  );
}
