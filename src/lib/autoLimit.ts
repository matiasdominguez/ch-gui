import { detectLeadingKeyword } from "./sqlKind";
import { isQuotedIdentStart, skipLexicalAtom } from "./sqlLex";

/** `max_result_rows` can't replace this LIMIT. Readonly profiles reject the
 * SET, and its default overflow mode fails the query after the work is done. */
export const AUTO_LIMIT_ROWS = 10_000;

interface Tok {
  kind: "word" | "num" | "str" | "ident" | "punct";
  up: string;
  pos: number;
}

function tokenize(sql: string): Tok[] {
  const toks: Tok[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const skipped = skipLexicalAtom(sql, i);
    if (skipped !== i) {
      if (depth === 0 && c !== "-" && c !== "#" && c !== "/") {
        toks.push({
          kind: isQuotedIdentStart(sql, i) ? "ident" : "str",
          up: "",
          pos: i,
        });
      }
      i = skipped;
      continue;
    }
    if (c === "(") {
      if (depth === 0) toks.push({ kind: "punct", up: "(", pos: i });
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) toks.push({ kind: "punct", up: ")", pos: i });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      if (depth === 0) {
        toks.push({ kind: "word", up: sql.slice(i, j).toUpperCase(), pos: i });
      }
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(sql[j])) j++;
      if (depth === 0) toks.push({ kind: "num", up: sql.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (depth === 0 && !/\s/.test(c)) {
      toks.push({ kind: "punct", up: c, pos: i });
    }
    i++;
  }
  return toks;
}

function isSettingsClause(toks: Tok[], k: number): boolean {
  return toks[k + 1]?.kind === "word" && toks[k + 2]?.up === "=";
}

function isFormatClause(toks: Tok[], k: number): boolean {
  const name = toks[k + 1];
  if (!name || name.kind !== "word") return false;
  const prev = toks[k - 1];
  if (!prev) return false;
  if (prev.kind === "punct" && prev.up !== ")") return false;
  if (
    prev.kind === "word" &&
    ["SELECT", "DISTINCT", "BY", "AS", "ALL", "ANY"].includes(prev.up)
  ) {
    return false;
  }
  const after = toks[k + 2];
  if (!after) return true;
  return after.up === "SETTINGS" && isSettingsClause(toks, k + 2);
}

interface ScanResult {
  hasSelect: boolean;
  hasInsert: boolean;
  bounded: boolean;
  /** ClickHouse binds a trailing LIMIT to the last branch only. */
  setOp: boolean;
  /** ClickHouse requires LIMIT before SETTINGS, FORMAT, and INTO OUTFILE. */
  insertPos: number;
}

export function mentionsInsert(sql: string): boolean {
  return scan(sql).hasInsert;
}

function scan(sql: string): ScanResult {
  const toks = tokenize(sql);
  const out: ScanResult = {
    hasSelect: false,
    hasInsert: false,
    bounded: false,
    setOp: false,
    insertPos: sql.length,
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "word") continue;
    switch (t.up) {
      case "SELECT":
        out.hasSelect = true;
        break;
      case "INSERT":
        out.hasInsert = true;
        break;
      case "UNION":
      case "INTERSECT":
        out.setOp = true;
        break;
      case "EXCEPT":
        // `* EXCEPT (col)` excludes a column and is not a set operation.
        if (["SELECT", "ALL", "DISTINCT"].includes(toks[k + 1]?.up ?? "")) {
          out.setOp = true;
        }
        break;
      case "LIMIT": {
        let m = k + 1;
        if (toks[m]?.kind !== "num") break;
        if (toks[m + 1]?.up === "," && toks[m + 2]?.kind === "num") m += 2;
        if (toks[m + 1]?.up === "BY") break; // LIMIT n BY caps each group.
        out.bounded = true;
        break;
      }
      case "OFFSET":
        if (toks[k + 1]?.kind === "num") out.bounded = true;
        break;
      case "FETCH":
        if (["FIRST", "NEXT"].includes(toks[k + 1]?.up ?? ""))
          out.bounded = true;
        break;
      case "INTO":
        if (toks[k + 1]?.up === "OUTFILE" && t.pos < out.insertPos) {
          out.insertPos = t.pos;
        }
        break;
      case "SETTINGS":
        if (isSettingsClause(toks, k) && t.pos < out.insertPos) {
          out.insertPos = t.pos;
        }
        break;
      case "FORMAT":
        if (isFormatClause(toks, k) && t.pos < out.insertPos) {
          out.insertPos = t.pos;
        }
        break;
    }
  }
  return out;
}

export function applyAutoLimit(
  sql: string,
  limit: number = AUTO_LIMIT_ROWS,
): { sql: string; applied: boolean } {
  const kind = detectLeadingKeyword(sql);
  if (kind !== "SELECT" && kind !== "WITH") return { sql, applied: false };
  const s = scan(sql);
  if (!s.hasSelect || s.hasInsert || s.bounded || s.setOp) {
    return { sql, applied: false };
  }
  if (s.insertPos >= sql.length) {
    return { sql: `${sql.trimEnd()}\nLIMIT ${limit}`, applied: true };
  }
  const head = sql.slice(0, s.insertPos).trimEnd();
  const tail = sql.slice(s.insertPos);
  return { sql: `${head}\nLIMIT ${limit}\n${tail}`, applied: true };
}
