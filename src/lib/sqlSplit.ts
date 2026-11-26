/** The native protocol takes one statement per query, so scripts split here. */
import { skipLexicalAtom } from "./sqlLex";

export function splitStatements(sql: string): string[] {
  return splitStatementsWithRanges(sql).map((s) => s.text);
}

export interface StatementRange {
  text: string;
  start: number;
  end: number;
}

export function splitStatementsWithRanges(sql: string): StatementRange[] {
  const out: StatementRange[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const text = raw.trim();
    if (!text) return;
    const trimStart = start + (raw.length - raw.trimStart().length);
    out.push({ text, start: trimStart, end: trimStart + text.length });
  };

  while (i < n) {
    const skipped = skipLexicalAtom(sql, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (sql[i] === ";") {
      push(i);
      i++;
      start = i;
      continue;
    }

    i++;
  }

  push(n);
  return out;
}

export function statementAtOffset(
  sql: string,
  offset: number,
): StatementRange | null {
  const stmts = splitStatementsWithRanges(sql);
  if (stmts.length === 0) return null;
  for (const s of stmts) {
    if (offset <= s.end) return s;
  }
  return stmts[stmts.length - 1];
}
