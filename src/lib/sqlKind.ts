const LEADING_COMMENT_OR_WS =
  /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

export function stripLeadingComments(sql: string): string {
  return sql.replace(LEADING_COMMENT_OR_WS, "");
}

export function detectLeadingKeyword(sql: string): string | null {
  const trimmed = stripLeadingComments(sql);
  const m = trimmed.match(/^([A-Za-z]+)\b/);
  return m ? m[1].toUpperCase() : null;
}

export function isExplain(sql: string): boolean {
  return detectLeadingKeyword(sql) === "EXPLAIN";
}
