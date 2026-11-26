/** Re-indents the original text because a JSON.parse round trip rounds integers
 * above 2^53, and the inspector's Copy button copies this view. ClickHouse
 * Map, Array, and Tuple cells use single quotes, so they stay raw. */
export function prettyJsonOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    JSON.parse(t);
  } catch {
    return null;
  }
  return reindent(t);
}

function reindent(json: string): string {
  let out = "";
  let indent = 0;
  const pad = () => "  ".repeat(indent);
  let i = 0;
  const n = json.length;
  while (i < n) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (json[j] === "\\") {
          j += 2;
          continue;
        }
        if (json[j] === '"') break;
        j++;
      }
      out += json.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      let j = i + 1;
      while (j < n && /\s/.test(json[j])) j++;
      const close = c === "{" ? "}" : "]";
      if (json[j] === close) {
        out += c + close;
        i = j + 1;
        continue;
      }
      indent++;
      out += `${c}\n${pad()}`;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      indent = Math.max(0, indent - 1);
      out += `\n${pad()}${c}`;
      i++;
      continue;
    }
    if (c === ",") {
      out += `,\n${pad()}`;
      i++;
      continue;
    }
    if (c === ":") {
      out += ": ";
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
