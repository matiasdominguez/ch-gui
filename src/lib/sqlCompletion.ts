import type { QueryClient } from "@tanstack/react-query";
import * as monaco from "monaco-editor";

import {
  formatDocMarkdown,
  listFunctionDocs,
  lookupFunction,
} from "./chFunctions";
import {
  getAllCachedColumns,
  getCachedColumns,
  getCachedTables,
  loadColumns,
  loadDatabases,
  loadTables,
} from "./schemaIndex";
import { extractAliases, type AliasScope } from "./sqlAlias";
import { sqlNameAfter } from "./sqlIdent";
import type { ColumnInfo, ConnectionConfigPayload } from "../types";

interface Ctx {
  qc: QueryClient;
  connectionId: string;
  payload: ConnectionConfigPayload;
}

let activeCtx: Ctx | null = null;
let registered = false;

const MAX_SUGGESTIONS = 1000;

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "DISTINCT",
  "WITH",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ARRAY",
  "TUPLE",
  "ASOF",
  "PREWHERE",
  "FORMAT",
  "SETTINGS",
  "SAMPLE",
  "FINAL",
  "UNION",
  "ALL",
];

function findCachedColumnsAcrossDbs(
  qc: QueryClient,
  connectionId: string,
  dbs: { name: string }[],
  table: string,
): { db: string; table: string; columns: ColumnInfo[] } | null {
  for (const d of dbs) {
    const tables = getCachedTables(qc, connectionId, d.name);
    if (!tables.some((t) => t.name === table)) continue;
    const columns = getCachedColumns(qc, connectionId, d.name, table);
    if (columns.length === 0) continue;
    return { db: d.name, table, columns };
  }
  return null;
}

export function setCompletionContext(next: Ctx | null) {
  activeCtx = next;
  if (next && !registered) {
    register();
  }
}

function register() {
  registered = true;
  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: ["."],
    provideCompletionItems: provide,
  });
  monaco.languages.registerHoverProvider("sql", {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const doc = lookupFunction(word.word);
      if (!doc) return null;
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: [{ value: formatDocMarkdown(doc) }],
      };
    },
  });
}

async function provide(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.CompletionList> {
  // A connection switch can clear `activeCtx` during the awaits below.
  const ctx = activeCtx;
  if (!ctx) return { suggestions: [] };

  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  const charBefore = model.getValueInRange({
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: Math.max(1, word.startColumn - 1),
    endColumn: word.startColumn,
  });
  const nameText = (name: string) => sqlNameAfter(charBefore, name);

  const linePrefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - 1000),
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const lookback = model.getValueInRange({
    startLineNumber: Math.max(1, position.lineNumber - 30),
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const m3 = linePrefix.match(/(\w+)\.(\w+)\.(\w*)$/);
  if (m3) {
    const [, db, table] = m3;
    let cols;
    try {
      cols = await loadColumns(
        ctx.qc,
        ctx.connectionId,
        ctx.payload,
        db,
        table,
      );
    } catch {
      return { suggestions: [] };
    }
    return {
      suggestions: cols.map((c) => ({
        label: c.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: nameText(c.name),
        detail: c.type,
        range,
      })),
    };
  }

  const aliasMap = extractAliases(model.getValue());

  // Use the async loaders, not getCached*, because prefetchSchema may still be
  // running. fetchQuery shares its pending request.
  const m2 = linePrefix.match(/(\w+)\.(\w*)$/);
  if (m2) {
    const [, x] = m2;

    // An alias takes precedence over a database of the same name.
    const aliased = aliasMap.get(x);
    if (aliased) {
      const { db, table } = aliased;
      try {
        if (db) {
          const cols = await loadColumns(
            ctx.qc,
            ctx.connectionId,
            ctx.payload,
            db,
            table,
          );
          return {
            suggestions: cols.map((c) => ({
              label: c.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: nameText(c.name),
              detail: `${db}.${table} : ${c.type}`,
              range,
            })),
          };
        }
        // With no database named, the cached-table search below handles this.
      } catch {
        return { suggestions: [] };
      }
    }
    const resolvedTable = aliased?.table ?? x;

    let dbs;
    try {
      dbs = await loadDatabases(ctx.qc, ctx.connectionId, ctx.payload);
    } catch {
      return { suggestions: [] };
    }
    if (!aliased && dbs.some((d) => d.name === x)) {
      let tables;
      try {
        tables = await loadTables(ctx.qc, ctx.connectionId, ctx.payload, x);
      } catch {
        return { suggestions: [] };
      }
      return {
        suggestions: tables.map((t) => ({
          label: t.name,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: nameText(t.name),
          detail: t.engine,
          range,
        })),
      };
    }
    // Search only cached tables. A server can have hundreds of databases, so
    // prefetchSchema loads them in the background instead.
    for (const d of dbs) {
      const tables = getCachedTables(ctx.qc, ctx.connectionId, d.name);
      if (tables.some((t) => t.name === resolvedTable)) {
        let cols;
        try {
          cols = await loadColumns(
            ctx.qc,
            ctx.connectionId,
            ctx.payload,
            d.name,
            resolvedTable,
          );
        } catch {
          return { suggestions: [] };
        }
        return {
          suggestions: cols.map((c) => ({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: nameText(c.name),
            detail: `${d.name}.${resolvedTable} : ${c.type}`,
            range,
          })),
        };
      }
    }
    return { suggestions: [] };
  }

  const suggestions: monaco.languages.CompletionItem[] = [];
  let dbs: Awaited<ReturnType<typeof loadDatabases>> = [];
  try {
    dbs = await loadDatabases(ctx.qc, ctx.connectionId, ctx.payload);
  } catch {
    // Keywords can still be suggested without the database list.
  }

  if (/\b(FROM|JOIN|UPDATE|INTO)\s+\w*$/i.test(lookback)) {
    for (const d of dbs) {
      const tables = getCachedTables(ctx.qc, ctx.connectionId, d.name);
      for (const t of tables) {
        suggestions.push({
          label: `${d.name}.${t.name}`,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: `${nameText(d.name)}.${nameText(t.name)}`,
          detail: t.engine,
          range,
        });
        if (suggestions.length >= MAX_SUGGESTIONS) break;
      }
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return { suggestions };
  }

  // Monaco sorts items with equal fuzzy scores by sortText, so the "0_" prefix
  // ranks FROM-scope columns first.
  const scopeColumnsSeen = new Set<string>();
  const aliasScopes = Array.from(aliasMap.values());
  // The alias map stores each scope under both the alias and the table name.
  const uniqueScopes: AliasScope[] = [];
  const scopeSeen = new Set<string>();
  for (const s of aliasScopes) {
    const key = `${s.db ?? ""}.${s.table}`;
    if (scopeSeen.has(key)) continue;
    scopeSeen.add(key);
    uniqueScopes.push(s);
  }
  for (const scope of uniqueScopes) {
    let resolved: { db: string; table: string; columns: ColumnInfo[] } | null;
    if (scope.db) {
      const columns = getCachedColumns(
        ctx.qc,
        ctx.connectionId,
        scope.db,
        scope.table,
      );
      resolved = columns.length
        ? { db: scope.db, table: scope.table, columns }
        : null;
    } else {
      resolved = findCachedColumnsAcrossDbs(
        ctx.qc,
        ctx.connectionId,
        dbs,
        scope.table,
      );
    }
    if (!resolved) continue;
    for (const c of resolved.columns) {
      if (scopeColumnsSeen.has(c.name)) continue;
      scopeColumnsSeen.add(c.name);
      suggestions.push({
        label: c.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: nameText(c.name),
        detail: `${resolved.db}.${resolved.table} : ${c.type}`,
        sortText: `0_${c.name}`,
        range,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  for (const d of dbs) {
    suggestions.push({
      label: d.name,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: nameText(d.name),
      range,
    });
  }
  for (const d of dbs) {
    const tables = getCachedTables(ctx.qc, ctx.connectionId, d.name);
    for (const t of tables) {
      suggestions.push({
        label: t.name,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: nameText(t.name),
        detail: `${d.name}.${t.name}`,
        range,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  for (const { db, table, columns } of getAllCachedColumns(
    ctx.qc,
    ctx.connectionId,
  )) {
    for (const c of columns) {
      if (scopeColumnsSeen.has(c.name)) continue;
      scopeColumnsSeen.add(c.name);
      suggestions.push({
        label: c.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: nameText(c.name),
        detail: `${db}.${table} : ${c.type}`,
        range,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  for (const kw of SQL_KEYWORDS) {
    suggestions.push({
      label: kw,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: kw,
      range,
    });
  }

  // Filter functions by prefix. Monaco's fuzzy matcher would otherwise rank
  // `sleepEachRow` above the keyword `SELECT` when the user types `sele`. An
  // empty word offers no functions.
  const fnPrefix = word.word.toLowerCase();
  if (fnPrefix.length > 0) {
    for (const d of listFunctionDocs()) {
      if (!d.name.toLowerCase().startsWith(fnPrefix)) continue;
      suggestions.push({
        label: d.name,
        kind: d.is_aggregate
          ? monaco.languages.CompletionItemKind.Method
          : monaco.languages.CompletionItemKind.Function,
        insertText: `${d.name.replace(/[\\$}]/g, "\\$&")}($0)`,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: d.is_aggregate ? "aggregate" : "function",
        documentation: { value: formatDocMarkdown(d) },
        range,
      });
    }
  }

  return { suggestions };
}
