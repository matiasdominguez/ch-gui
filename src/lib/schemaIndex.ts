import type { QueryClient } from "@tanstack/react-query";

import {
  introspectColumns,
  introspectDatabases,
  introspectTables,
} from "./tauri";
import type {
  ColumnInfo,
  ConnectionConfigPayload,
  DbInfo,
  TableInfo,
} from "../types";

const STALE_TIME_MS = 60_000;
const PARALLEL_DB_LOADS = 4;

const dbsKey = (cid: string) => ["dbs", cid] as const;
const tablesKey = (cid: string, db: string) => ["tables", cid, db] as const;
const columnsKey = (cid: string, db: string, table: string) =>
  ["cols", cid, db, table] as const;

export function loadDatabases(
  qc: QueryClient,
  connectionId: string,
  payload: ConnectionConfigPayload,
): Promise<DbInfo[]> {
  return qc.fetchQuery({
    queryKey: dbsKey(connectionId),
    queryFn: () => introspectDatabases(payload),
    staleTime: STALE_TIME_MS,
  });
}

export function loadTables(
  qc: QueryClient,
  connectionId: string,
  payload: ConnectionConfigPayload,
  db: string,
): Promise<TableInfo[]> {
  return qc.fetchQuery({
    queryKey: tablesKey(connectionId, db),
    queryFn: () => introspectTables(payload, db),
    staleTime: STALE_TIME_MS,
  });
}

export function loadColumns(
  qc: QueryClient,
  connectionId: string,
  payload: ConnectionConfigPayload,
  db: string,
  table: string,
): Promise<ColumnInfo[]> {
  return qc.fetchQuery({
    queryKey: columnsKey(connectionId, db, table),
    queryFn: () => introspectColumns(payload, db, table),
    staleTime: STALE_TIME_MS,
  });
}

export function getCachedDatabases(
  qc: QueryClient,
  connectionId: string,
): DbInfo[] {
  return qc.getQueryData<DbInfo[]>(dbsKey(connectionId)) ?? [];
}

export function getCachedTables(
  qc: QueryClient,
  connectionId: string,
  db: string,
): TableInfo[] {
  return qc.getQueryData<TableInfo[]>(tablesKey(connectionId, db)) ?? [];
}

export function getCachedColumns(
  qc: QueryClient,
  connectionId: string,
  db: string,
  table: string,
): ColumnInfo[] {
  return (
    qc.getQueryData<ColumnInfo[]>(columnsKey(connectionId, db, table)) ?? []
  );
}

export function getAllCachedColumns(
  qc: QueryClient,
  connectionId: string,
): { db: string; table: string; columns: ColumnInfo[] }[] {
  const entries = qc
    .getQueryCache()
    .findAll({ queryKey: ["cols", connectionId] });
  const out: { db: string; table: string; columns: ColumnInfo[] }[] = [];
  for (const e of entries) {
    const key = e.queryKey as readonly unknown[];
    if (key.length !== 4) continue;
    const data = e.state.data as ColumnInfo[] | undefined;
    if (!data) continue;
    out.push({ db: String(key[2]), table: String(key[3]), columns: data });
  }
  return out;
}

export async function prefetchSchema(
  qc: QueryClient,
  connectionId: string,
  payload: ConnectionConfigPayload,
  signal?: AbortSignal,
): Promise<void> {
  const dbs = await loadDatabases(qc, connectionId, payload);
  if (signal?.aborted) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < dbs.length) {
      if (signal?.aborted) return;
      const db = dbs[cursor++];
      try {
        await loadTables(qc, connectionId, payload, db.name);
      } catch {
        // Completion skips this database's tables.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_DB_LOADS, dbs.length) }, worker),
  );
}
