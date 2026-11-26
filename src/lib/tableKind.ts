/** A SELECT on these engines can consume messages or mark files processed. */
export const STREAMING_ENGINES = new Set([
  "Kafka",
  "RabbitMQ",
  "NATS",
  "FileLog",
  "RedisStreams",
  "S3Queue",
  "AzureQueue",
]);

const INNER_ID =
  /^\.inner_id\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** View storage is `.inner_id.<uuid>`, or `.inner.<view>` on old servers. */
export function innerTables(
  tables: { name: string; engine: string }[],
): Set<string> {
  const views = new Set(
    tables.filter((t) => t.engine === "MaterializedView").map((t) => t.name),
  );
  return new Set(
    tables
      .map((t) => t.name)
      .filter(
        (n) =>
          INNER_ID.test(n) ||
          (n.startsWith(".inner.") && views.has(n.slice(".inner.".length))),
      ),
  );
}

export function tableKind(engine: string): string {
  if (engine === "View") return "View";
  if (engine === "MaterializedView") return "Materialized view";
  if (engine === "LiveView") return "Live view";
  if (engine === "Dictionary") return "Dictionary";
  if (STREAMING_ENGINES.has(engine)) return `${engine} queue`;
  return "Table";
}
