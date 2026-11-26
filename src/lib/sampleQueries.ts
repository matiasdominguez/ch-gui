export interface SampleQuery {
  title: string;
  sql: string;
}

export const SAMPLE_QUERIES: SampleQuery[] = [
  {
    title: "Top tables by disk",
    sql: `SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk)) AS on_disk,
    sum(rows) AS rows,
    count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 20`,
  },
  {
    title: "Storage by database",
    sql: `SELECT
    database,
    formatReadableSize(sum(bytes_on_disk)) AS on_disk,
    sum(rows) AS rows,
    count(DISTINCT table) AS tables
FROM system.parts
WHERE active
GROUP BY database
ORDER BY sum(bytes_on_disk) DESC`,
  },
  {
    title: "Slowest queries (24h)",
    sql: `SELECT
    event_time,
    query_duration_ms,
    formatReadableSize(memory_usage) AS memory,
    read_rows,
    user,
    substring(query, 1, 120) AS query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 24 HOUR
ORDER BY query_duration_ms DESC
LIMIT 20`,
  },
  {
    title: "Highest-memory queries (24h)",
    sql: `SELECT
    event_time,
    formatReadableSize(memory_usage) AS memory,
    query_duration_ms,
    user,
    substring(query, 1, 120) AS query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 24 HOUR
ORDER BY memory_usage DESC
LIMIT 20`,
  },
  {
    title: "Compression by table",
    sql: `SELECT
    database,
    table,
    formatReadableSize(sum(data_compressed_bytes)) AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed,
    round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 1) AS ratio
FROM system.parts
WHERE active
GROUP BY database, table
HAVING sum(data_compressed_bytes) > 0
ORDER BY sum(data_compressed_bytes) DESC
LIMIT 20`,
  },
  {
    title: "Replica status and lag",
    sql: `SELECT
    database,
    table,
    is_readonly,
    absolute_delay,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    last_queue_update
FROM system.replicas
ORDER BY absolute_delay DESC`,
  },
  {
    title: "Pending mutations",
    sql: `SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    parts_to_do,
    latest_fail_reason
FROM system.mutations
WHERE NOT is_done
ORDER BY create_time`,
  },
  {
    title: "Recent server errors",
    sql: `SELECT
    name,
    code,
    value AS times,
    last_error_time,
    substring(last_error_message, 1, 200) AS last_message
FROM system.errors
WHERE last_error_time > now() - INTERVAL 24 HOUR
ORDER BY last_error_time DESC
LIMIT 20`,
  },
  {
    title: "Running queries",
    sql: `SELECT
    query_id,
    user,
    round(elapsed, 1) AS elapsed_s,
    formatReadableSize(memory_usage) AS memory,
    read_rows,
    substring(query, 1, 120) AS query
FROM system.processes
ORDER BY elapsed DESC`,
  },
  {
    title: "Tables with the most parts",
    sql: `SELECT
    database,
    table,
    count() AS active_parts,
    formatReadableSize(sum(bytes_on_disk)) AS on_disk
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY active_parts DESC
LIMIT 20`,
  },
];
