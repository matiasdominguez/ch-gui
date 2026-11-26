export function quoteIdent(name: string): string {
  return "`" + name.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

export function sqlName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : quoteIdent(name);
}

export function sqlNameAfter(charBefore: string, name: string): string {
  if (!["`", '"', "'"].includes(charBefore)) return sqlName(name);
  return name
    .replace(/\\/g, "\\\\")
    .split(charBefore)
    .join("\\" + charBefore);
}
