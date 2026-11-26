import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = process.env.CH_TEST_HOST ?? "127.0.0.1";
const PORT = process.env.CH_TEST_HTTP_PORT ?? "8123";
const OUT = resolve(import.meta.dirname, "../src/assets/ch-functions.json");

const sql = `
SELECT
  name,
  coalesce(description, '') AS description,
  is_aggregate,
  case_insensitive,
  coalesce(syntax, '') AS syntax,
  coalesce(arguments, '') AS arguments,
  coalesce(returned_value, '') AS returned_value,
  coalesce(categories, '') AS categories
FROM system.functions
ORDER BY name
FORMAT JSONEachRow
`;

type RawRow = {
  name: string;
  description: string;
  is_aggregate: number | boolean;
  case_insensitive: number | boolean;
  syntax: string;
  arguments: string;
  returned_value: string;
  categories: string;
};

async function main() {
  const res = await fetch(`http://${HOST}:${PORT}/`, {
    method: "POST",
    body: sql,
  });
  if (!res.ok) {
    throw new Error(`CH HTTP ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  const rows = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawRow);

  // ClickHouse serializes UInt8 booleans as 0 or 1 in JSON.
  const normalized = rows.map((r) => ({
    name: r.name,
    description: r.description,
    is_aggregate: !!r.is_aggregate,
    case_insensitive: !!r.case_insensitive,
    syntax: r.syntax,
    arguments: r.arguments,
    returned_value: r.returned_value,
    categories: r.categories,
  }));

  writeFileSync(OUT, JSON.stringify(normalized, null, 2) + "\n");
  console.log(
    `wrote ${normalized.length} functions to ${OUT} (${(JSON.stringify(normalized).length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
