import { mentionsInsert } from "./autoLimit";
import { detectLeadingKeyword } from "./sqlKind";
import { splitStatements } from "./sqlSplit";

const WRITE_KEYWORDS = new Set([
  "INSERT",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "DELETE",
  "UPDATE",
  "CREATE",
  "RENAME",
  "EXCHANGE",
  "ATTACH",
  "DETACH",
  "OPTIMIZE",
  "SYSTEM",
  "KILL",
  "GRANT",
  "REVOKE",
]);

export function hasWriteStatement(sql: string): boolean {
  return splitStatements(sql).some((st) => {
    const kw = detectLeadingKeyword(st);
    if (kw !== null && WRITE_KEYWORDS.has(kw)) return true;
    return kw === "WITH" && mentionsInsert(st);
  });
}
