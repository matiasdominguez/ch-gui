import Database from "@tauri-apps/plugin-sql";

import type { Connection, HistoryEntry, SavedQuery } from "../types";

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    // Clear the cache on failure, or one failed open breaks every later call.
    dbPromise = Database.load("sqlite:chgui.db").catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Pair with `ESCAPE '\'` in the LIKE clause. */
export function escapeLike(search: string): string {
  return search.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  secure: number;
  default_database: string | null;
  custom_ca_pem: string | null;
  cluster_name: string | null;
  cluster_fanout: number;
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    user: row.user,
    secure: row.secure === 1,
    defaultDatabase: row.default_database,
    customCaPem: row.custom_ca_pem,
    clusterName: row.cluster_name,
    clusterFanout: row.cluster_fanout !== 0,
  };
}

export async function listConnections(): Promise<Connection[]> {
  const db = await getDb();
  const rows = await db.select<ConnectionRow[]>(
    "SELECT id, name, host, port, user, secure, default_database, custom_ca_pem, cluster_name, cluster_fanout FROM connections ORDER BY name",
  );
  return rows.map(rowToConnection);
}

export async function upsertConnection(c: Connection): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO connections (id, name, host, port, user, secure, default_database, custom_ca_pem, cluster_name, cluster_fanout)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       host = excluded.host,
       port = excluded.port,
       user = excluded.user,
       secure = excluded.secure,
       default_database = excluded.default_database,
       custom_ca_pem = excluded.custom_ca_pem,
       cluster_name = excluded.cluster_name,
       cluster_fanout = excluded.cluster_fanout`,
    [
      c.id,
      c.name,
      c.host,
      c.port,
      c.user,
      c.secure ? 1 : 0,
      c.defaultDatabase,
      c.customCaPem,
      c.clusterName,
      c.clusterFanout ? 1 : 0,
    ],
  );
}

export async function countSavedQueries(connectionId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT count(*) AS n FROM saved_queries WHERE connection_id = $1",
    [connectionId],
  );
  return rows[0]?.n ?? 0;
}

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDb();
  // The SQL plugin pools connections, so BEGIN/COMMIT across execute() calls
  // is not a transaction. Deleting the connection last lets a failed delete
  // be retried.
  await db.execute("DELETE FROM query_history WHERE connection_id = $1", [id]);
  await db.execute("DELETE FROM saved_queries WHERE connection_id = $1", [id]);
  await db.execute("DELETE FROM connections WHERE id = $1", [id]);
}

const HISTORY_RETENTION_DAYS = 90;
let historyPrunedThisSession = false;

export async function recordHistory(entry: {
  connectionId: string;
  sql: string;
  durationMs: number | null;
  rowsReturned: number | null;
  error: string | null;
}): Promise<void> {
  const db = await getDb();

  // Never rewrite a pinned row. Only a success replaces a success, because a
  // failure must not overwrite good stats and a recovery must not erase one.
  const last = await db.select<
    { id: number; sql: string; error: string | null; pinned: number }[]
  >(
    `SELECT id, sql, error, pinned FROM query_history WHERE connection_id = $1
     ORDER BY id DESC LIMIT 1`,
    [entry.connectionId],
  );
  const dedupe =
    last[0] != null &&
    last[0].sql === entry.sql &&
    last[0].pinned === 0 &&
    last[0].error == null &&
    entry.error == null;
  if (dedupe) {
    await db.execute(
      `UPDATE query_history
       SET executed_at = datetime('now'), duration_ms = $1, rows_returned = $2, error = $3
       WHERE id = $4`,
      [entry.durationMs, entry.rowsReturned, entry.error, last[0].id],
    );
    return;
  }

  await db.execute(
    `INSERT INTO query_history (connection_id, sql, duration_ms, rows_returned, error)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.connectionId,
      entry.sql,
      entry.durationMs,
      entry.rowsReturned,
      entry.error,
    ],
  );

  if (!historyPrunedThisSession) {
    historyPrunedThisSession = true;
    await db
      .execute(
        `DELETE FROM query_history
         WHERE pinned = 0 AND executed_at < datetime('now', '-${HISTORY_RETENTION_DAYS} days')`,
      )
      .catch(() => {
        // A failed prune must not fail the insert.
      });
  }
}

export async function listHistory(
  connectionId: string,
  search: string,
  limit = 200,
): Promise<HistoryEntry[]> {
  const db = await getDb();
  if (search.trim().length === 0) {
    return await db.select<HistoryEntry[]>(
      `SELECT id, connection_id, sql, executed_at, duration_ms, rows_returned, error, pinned
       FROM query_history WHERE connection_id = $1
       ORDER BY pinned DESC, executed_at DESC LIMIT $2`,
      [connectionId, limit],
    );
  }
  return await db.select<HistoryEntry[]>(
    `SELECT id, connection_id, sql, executed_at, duration_ms, rows_returned, error, pinned
     FROM query_history WHERE connection_id = $1 AND sql LIKE $2 ESCAPE '\\'
     ORDER BY pinned DESC, executed_at DESC LIMIT $3`,
    [connectionId, `%${escapeLike(search)}%`, limit],
  );
}

export async function setHistoryPinned(
  id: number,
  pinned: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE query_history SET pinned = $1 WHERE id = $2`, [
    pinned ? 1 : 0,
    id,
  ]);
}

interface SavedQueryRow {
  id: number;
  connection_id: string | null;
  name: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export async function saveQuery(entry: {
  name: string;
  sql: string;
  connectionId: string | null;
}): Promise<number> {
  const db = await getDb();
  const res = await db.execute(
    `INSERT INTO saved_queries (connection_id, name, sql) VALUES ($1, $2, $3)`,
    [entry.connectionId, entry.name, entry.sql],
  );
  if (res.lastInsertId == null) {
    throw new Error("INSERT succeeded but driver returned no row id");
  }
  return res.lastInsertId;
}

export async function updateSavedQuery(
  id: number,
  patch: { name: string; sql: string },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE saved_queries
     SET name = $1, sql = $2, updated_at = datetime('now')
     WHERE id = $3`,
    [patch.name, patch.sql, id],
  );
}

export async function deleteSavedQuery(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM saved_queries WHERE id = $1`, [id]);
}

export async function listSavedQueries(
  connectionId: string,
  search: string,
  limit = 200,
): Promise<SavedQuery[]> {
  const db = await getDb();
  if (search.trim().length === 0) {
    return await db.select<SavedQueryRow[]>(
      `SELECT id, connection_id, name, sql, created_at, updated_at
       FROM saved_queries WHERE connection_id = $1 OR connection_id IS NULL
       ORDER BY updated_at DESC LIMIT $2`,
      [connectionId, limit],
    );
  }
  return await db.select<SavedQueryRow[]>(
    `SELECT id, connection_id, name, sql, created_at, updated_at
     FROM saved_queries
     WHERE (connection_id = $1 OR connection_id IS NULL)
       AND (name LIKE $2 ESCAPE '\\' OR sql LIKE $2 ESCAPE '\\')
     ORDER BY updated_at DESC LIMIT $3`,
    [connectionId, `%${escapeLike(search)}%`, limit],
  );
}
