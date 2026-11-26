import { skipLexicalAtom } from "./sqlLex";

// A name can't start with a digit, so `\d{3}` in a regex isn't a placeholder.
const PLACEHOLDER = /\{([@#!]?)([A-Za-z_]\w*)\}/y;
const PLACEHOLDER_G = /\{([@#!]?)([A-Za-z_]\w*)\}/g;

export type ParamKind = "text" | "number" | "date" | "raw";

export interface ParamSpec {
  name: string;
  kind: ParamKind;
}

type Context = "code" | "string" | "ident";

interface Occurrence {
  start: number;
  end: number;
  sigil: string;
  name: string;
  context: Context;
}

function scanPlaceholders(sql: string): Occurrence[] {
  const out: Occurrence[] = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "{") {
      PLACEHOLDER.lastIndex = i;
      const m = PLACEHOLDER.exec(sql);
      if (m) {
        out.push({
          start: i,
          end: i + m[0].length,
          sigil: m[1],
          name: m[2],
          context: "code",
        });
        i += m[0].length;
        continue;
      }
    }
    const next = skipLexicalAtom(sql, i);
    if (next === i) {
      i++;
      continue;
    }
    const c = sql[i];
    const context: Context | null =
      c === "'" ? "string" : c === '"' || c === "`" ? "ident" : null;
    if (context) {
      for (const m of sql.slice(i, next).matchAll(PLACEHOLDER_G)) {
        const at = i + (m.index ?? 0);
        out.push({
          start: at,
          end: at + m[0].length,
          sigil: m[1],
          name: m[2],
          context,
        });
      }
    }
    i = next;
  }
  return out;
}

const DATE_WORDS = /(?:^|_)(?:date|at|from|to)$|^(?:date|from|to)$/i;
const NUMBER_WORDS =
  /(?:^|_)(?:id|count|n|num|limit|offset)$|^(?:n|num|id|count|limit|offset)$/i;

export function inferKind(sigil: string, name: string): ParamKind {
  if (sigil === "!") return "raw";
  if (sigil === "@") return "date";
  if (sigil === "#") return "number";
  if (DATE_WORDS.test(name)) return "date";
  if (NUMBER_WORDS.test(name)) return "number";
  return "text";
}

export function extractParams(sql: string): ParamSpec[] {
  const seen = new Set<string>();
  const out: ParamSpec[] = [];
  for (const { sigil, name } of scanPlaceholders(sql)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, kind: inferKind(sigil, name) });
  }
  return out;
}

function escapeString(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Missing keys keep their placeholder, so the server reports the error. */
export function substituteParams(
  sql: string,
  values: Record<string, string>,
  specs?: ParamSpec[],
): string {
  const kindByName = new Map<string, ParamKind>();
  for (const s of specs ?? extractParams(sql)) {
    kindByName.set(s.name, s.kind);
  }
  let out = "";
  let last = 0;
  for (const o of scanPlaceholders(sql)) {
    if (!Object.prototype.hasOwnProperty.call(values, o.name)) continue;
    out += sql.slice(last, o.start) + format(values[o.name], o, kindByName);
    last = o.end;
  }
  return out + sql.slice(last);
}

function format(
  raw: string,
  o: Occurrence,
  kindByName: Map<string, ParamKind>,
): string {
  if (o.context === "string") return escapeString(raw);
  if (o.context === "ident") return raw;
  const kind = kindByName.get(o.name) ?? "text";
  const trimmed = raw.trim();
  if (kind === "text") {
    return trimmed.startsWith("'") ? raw : `'${escapeString(raw)}'`;
  }
  if (kind === "date") {
    // A quote, letter, or paren starts a SQL expression, which passes through.
    // An ISO date starts with a digit and gets quoted.
    if (/^['A-Za-z(]/.test(trimmed)) return raw;
    return `'${raw}'`;
  }
  return raw;
}
