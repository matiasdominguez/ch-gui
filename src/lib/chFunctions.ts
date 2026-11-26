import type { FunctionDoc } from "../types";

/** Monaco providers register once, so per-connection docs live here. */
let byName: Map<string, FunctionDoc> = new Map();
let sorted: FunctionDoc[] = [];

export function setFunctionDocs(next: FunctionDoc[]): void {
  byName = new Map(next.map((d) => [d.name.toLowerCase(), d]));
  sorted = [...next].sort((a, b) => a.name.localeCompare(b.name));
}

export function lookupFunction(word: string): FunctionDoc | undefined {
  return byName.get(word.toLowerCase());
}

export function listFunctionDocs(): FunctionDoc[] {
  return sorted;
}

export function formatDocMarkdown(d: FunctionDoc): string {
  const parts: string[] = [];
  const kind = d.is_aggregate ? "aggregate" : "function";
  parts.push(`**${d.name}** · _${kind}_`);

  const signature = d.syntax
    ? d.syntax
    : d.arguments
      ? `${d.name}(${d.arguments})`
      : "";
  if (signature) {
    const arrow = d.returned_value ? ` → ${d.returned_value}` : "";
    parts.push(`\`${signature}\`${arrow}`);
  } else if (d.returned_value) {
    parts.push(`→ \`${d.returned_value}\``);
  }

  if (d.description) {
    parts.push(d.description);
  }

  if (d.categories) {
    parts.push(`_categories: ${d.categories}_`);
  }

  return parts.join("\n\n");
}

export function mergeFunctionDocs(
  server: { status: "disabled" } | { status: "enabled"; rows: FunctionDoc[] },
  bundle: FunctionDoc[],
): FunctionDoc[] {
  if (server.status === "disabled") return bundle;
  const out = new Map<string, FunctionDoc>(
    bundle.map((d) => [d.name.toLowerCase(), d]),
  );
  for (const s of server.rows) {
    const key = s.name.toLowerCase();
    const b = out.get(key);
    out.set(key, {
      name: s.name || b?.name || "",
      description: s.description || b?.description || "",
      // `||` would replace a server `false` with the bundle's `true`.
      is_aggregate: s.is_aggregate,
      case_insensitive: s.case_insensitive,
      syntax: s.syntax || b?.syntax || "",
      arguments: s.arguments || b?.arguments || "",
      returned_value: s.returned_value || b?.returned_value || "",
      categories: s.categories || b?.categories || "",
    });
  }
  return Array.from(out.values());
}
