/** splitStatements, applyAutoLimit, and params all use this, so they agree on
 * where a string or comment ends. */
export function skipLexicalAtom(sql: string, i: number): number {
  const c = sql[i];
  const n = sql.length;

  if ((c === "-" && sql[i + 1] === "-") || c === "#") {
    const nl = sql.indexOf("\n", i);
    return nl === -1 ? n : nl + 1;
  }

  if (c === "/" && sql[i + 1] === "*") {
    const close = sql.indexOf("*/", i + 2);
    return close === -1 ? n : close + 2;
  }

  if (c === "'") {
    i++;
    while (i < n) {
      if (sql[i] === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return n;
  }

  if (c === '"') {
    i++;
    while (i < n) {
      if (sql[i] === '"') {
        if (sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return n;
  }

  if (c === "`") {
    i++;
    while (i < n && sql[i] !== "`") i++;
    return i < n ? i + 1 : n;
  }

  return i;
}

export function isQuotedIdentStart(sql: string, i: number): boolean {
  return sql[i] === '"' || sql[i] === "`";
}
