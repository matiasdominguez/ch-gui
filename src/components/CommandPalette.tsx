import {
  Box,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { listHistory, listSavedQueries } from "../lib/db";
import { getCachedDatabases, getCachedTables } from "../lib/schemaIndex";
import { innerTables } from "../lib/tableKind";
import type { Connection, HistoryEntry, SavedQuery } from "../types";
import type { QueryTab } from "../state/tabs";

import { TimeAgo } from "./TimeAgo";

export type PaletteItem =
  | ({ kind: "action" } & ActionItem)
  | { kind: "tab"; tab: QueryTab; searchable: string }
  | { kind: "saved"; saved: SavedQuery; searchable: string }
  | { kind: "history"; entry: HistoryEntry; searchable: string }
  | { kind: "connection"; connection: Connection; searchable: string }
  | { kind: "database"; name: string; searchable: string }
  | { kind: "table"; db: string; table: string; searchable: string };

export type ActionId =
  "format" | "toggleTheme" | "exportCsv" | "compareTables" | "serverSettings";

interface ActionItem {
  id: ActionId;
  label: string;
  hint?: string;
  searchable: string;
}

interface Props {
  opened: boolean;
  connectionId: string | null;
  tabs: QueryTab[];
  activeTabId: string | null;
  connections: Connection[];
  onClose: () => void;
  onPick: (item: PaletteItem) => void;
}

const SECTION_LABEL: Record<PaletteItem["kind"], string> = {
  action: "Actions",
  tab: "Tabs",
  saved: "Saved queries",
  history: "Recent history",
  connection: "Connections",
  database: "Insert database name",
  table: "Insert table name",
};

const ACTIONS: ActionItem[] = [
  {
    id: "format",
    label: "Format SQL",
    hint: "⌘⇧L",
    searchable: "format sql",
  },
  {
    id: "toggleTheme",
    label: "Toggle color scheme",
    searchable: "toggle theme color scheme dark light auto",
  },
  {
    id: "exportCsv",
    label: "Export results as CSV",
    searchable: "export csv results download",
  },
  {
    id: "compareTables",
    label: "Compare two tables…",
    searchable: "compare diff schema tables columns",
  },
  {
    id: "serverSettings",
    label: "Server settings changed from defaults",
    searchable:
      "server settings changed defaults profile system.settings inspector",
  },
];

export function CommandPalette({
  opened,
  connectionId,
  tabs,
  activeTabId,
  connections,
  onClose,
  onPick,
}: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!opened || !connectionId) {
      setSavedQueries([]);
      setHistory([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      listSavedQueries(connectionId, "", 200),
      listHistory(connectionId, "", 50),
    ])
      .then(([sv, hs]) => {
        if (!cancelled) {
          setSavedQueries(sv);
          setHistory(hs);
        }
      })
      .catch(() => {
        /* Leave the sections empty on failure. */
      });
    return () => {
      cancelled = true;
    };
  }, [opened, connectionId]);

  // Read the query cache once per open, so a background prefetch cannot reorder
  // the sections during a search.
  const cachedItems = useMemo(() => {
    if (!opened) return [] as PaletteItem[];
    const items: PaletteItem[] = [];

    for (const a of ACTIONS) items.push({ kind: "action", ...a });

    if (tabs.length > 1) {
      for (const t of tabs) {
        if (t.id === activeTabId) continue;
        items.push({ kind: "tab", tab: t, searchable: t.title.toLowerCase() });
      }
    }

    if (connections.length > 1) {
      for (const c of connections) {
        items.push({
          kind: "connection",
          connection: c,
          searchable: c.name.toLowerCase(),
        });
      }
    }

    if (connectionId) {
      const dbs = getCachedDatabases(qc, connectionId);
      for (const d of dbs) {
        items.push({
          kind: "database",
          name: d.name,
          searchable: d.name.toLowerCase(),
        });
      }
      for (const d of dbs) {
        const tbls = getCachedTables(qc, connectionId, d.name);
        const inner = innerTables(tbls);
        for (const t of tbls) {
          if (inner.has(t.name)) continue;
          const qn = `${d.name}.${t.name}`;
          items.push({
            kind: "table",
            db: d.name,
            table: t.name,
            searchable: qn.toLowerCase(),
          });
        }
      }
    }

    return items;
  }, [opened, activeTabId, tabs, connections, connectionId, qc]);

  const allItems = useMemo(() => {
    const items: PaletteItem[] = [];
    for (const it of cachedItems) {
      if (it.kind === "action" || it.kind === "tab") items.push(it);
    }
    for (const s of savedQueries) {
      items.push({
        kind: "saved",
        saved: s,
        searchable: `${s.name} ${s.sql}`.toLowerCase(),
      });
    }
    for (const h of history) {
      items.push({
        kind: "history",
        entry: h,
        searchable: h.sql.toLowerCase(),
      });
    }
    for (const it of cachedItems) {
      if (it.kind !== "action" && it.kind !== "tab") items.push(it);
    }
    return items;
  }, [cachedItems, savedQueries, history]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((it) => it.searchable.includes(q));
  }, [allItems, query]);

  useEffect(() => {
    if (opened) {
      setQuery("");
      setHighlighted(0);
    }
  }, [opened]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  useEffect(() => {
    itemRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function pickAt(idx: number) {
    const pick = filtered[idx];
    if (!pick) return;
    onPick(pick);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickAt(highlighted);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding={0}
      size="lg"
      centered
      className="chg-palette"
    >
      <Stack gap={0}>
        <Box className="chg-palette-search">
          <TextInput
            autoFocus
            size="sm"
            variant="unstyled"
            placeholder="Search tables, queries, tabs, actions…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </Box>
        <ScrollArea h={380} type="auto">
          {filtered.length === 0 ? (
            <Text size="xs" c="dimmed" p="md">
              {allItems.length === 0
                ? "Nothing to search yet. Expand a database in the sidebar or run a query."
                : "No matches."}
            </Text>
          ) : (
            filtered.map((item, idx) => {
              const prev = filtered[idx - 1];
              const showHeader = !prev || prev.kind !== item.kind;
              return (
                <Box key={`${item.kind}-${idx}`}>
                  {showHeader && (
                    <Text
                      className="chg-palette-section"
                      pt={idx === 0 ? 6 : 10}
                    >
                      {SECTION_LABEL[item.kind]}
                    </Text>
                  )}
                  <UnstyledButton
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onClick={() => pickAt(idx)}
                    className="chg-palette-row"
                    data-active={idx === highlighted || undefined}
                  >
                    <PaletteRow item={item} />
                  </UnstyledButton>
                </Box>
              );
            })
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}

function PaletteRow({ item }: { item: PaletteItem }) {
  switch (item.kind) {
    case "action":
      return (
        <Box
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <Text size="xs">{item.label}</Text>
          {item.hint && (
            <Text size="xs" c="dimmed">
              {item.hint}
            </Text>
          )}
        </Box>
      );
    case "tab":
      return <Text size="xs">{item.tab.title}</Text>;
    case "saved":
      return (
        <Stack gap={0}>
          <Text size="xs" fw={500}>
            {item.saved.name}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1} className="chg-mono">
            {item.saved.sql}
          </Text>
        </Stack>
      );
    case "history":
      return (
        <Stack gap={0}>
          <Text size="xs" lineClamp={1} className="chg-mono">
            {item.entry.sql}
          </Text>
          <Text size="xs" c="dimmed">
            <TimeAgo value={item.entry.executed_at} />
          </Text>
        </Stack>
      );
    case "connection":
      return <Text size="xs">{item.connection.name}</Text>;
    case "database":
      return (
        <Text size="xs" className="chg-mono">
          {item.name}
        </Text>
      );
    case "table":
      return (
        <Text size="xs" className="chg-mono">
          {item.db}.{item.table}
        </Text>
      );
  }
}
