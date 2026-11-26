export interface AliasScope {
  db?: string;
  table: string;
}

const CLAUSE_KEYWORDS_PATTERN =
  "FROM|JOIN|WHERE|ON|AND|OR|NOT|GROUP|BY|ORDER|LIMIT|OFFSET|UNION|" +
  "SETTINGS|FORMAT|PREWHERE|SAMPLE|FINAL|LEFT|RIGHT|INNER|OUTER|ASOF|" +
  "ANY|ALL|SEMI|INTO|USING|HAVING|WITH|AS|SELECT|INSERT|UPDATE|DELETE|" +
  "DISTINCT|CROSS|FULL";
const CLAUSE_KEYWORDS_UPPER = new Set(CLAUSE_KEYWORDS_PATTERN.split("|"));

export function extractAliases(sql: string): Map<string, AliasScope> {
  const out = new Map<string, AliasScope>();
  // This lookahead stops the alias group from consuming the next JOIN keyword.
  const re = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(?:(\\w+)\\.)?(\\w+)` +
      `(?:\\s+(?:AS\\s+)?(?!(?:${CLAUSE_KEYWORDS_PATTERN})\\b)(\\w+))?`,
    "gi",
  );
  for (const m of sql.matchAll(re)) {
    const db = m[1] || undefined;
    const table = m[2];
    const aliasCandidate = m[3];
    const alias =
      aliasCandidate && !CLAUSE_KEYWORDS_UPPER.has(aliasCandidate.toUpperCase())
        ? aliasCandidate
        : undefined;
    const scope: AliasScope = db ? { db, table } : { table };
    if (alias) out.set(alias, scope);
    out.set(table, scope);
  }
  return out;
}
