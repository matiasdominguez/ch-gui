import type { MvFailure } from "../types";

export interface MvGroup {
  view_name: string;
  count: number;
  recent: boolean;
  latest: MvFailure;
  all: MvFailure[];
}

export function groupByView(rows: MvFailure[]): MvGroup[] {
  const map = new Map<string, MvGroup>();
  for (const r of rows) {
    const g = map.get(r.view_name);
    if (g) {
      g.count += 1;
      g.recent = g.recent || r.recent;
      g.all.push(r);
      if (r.event_time > g.latest.event_time) g.latest = r;
    } else {
      map.set(r.view_name, {
        view_name: r.view_name,
        count: 1,
        recent: r.recent,
        latest: r,
        all: [r],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    b.latest.event_time > a.latest.event_time ? 1 : -1,
  );
}

/** ClickHouse and SQLite give UTC times with no zone, so this adds one. */
export function parseUtcTime(raw: string): Date | null {
  if (!raw) return null;
  // WebKit's Date rejects more than three fractional digits, and server log
  // times have six.
  const normalized = (raw.includes("T") ? raw : raw.replace(" ", "T")).replace(
    /(\.\d{3})\d+/,
    "$1",
  );
  const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : normalized + "Z";
  const d = new Date(withTz);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRelativeOrShort(
  raw: string,
  now: number = Date.now(),
): string {
  const d = parseUtcTime(raw);
  if (!d) return raw;
  const diffSec = Math.max(0, (now - d.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86_400) return `${Math.floor(diffSec / 86_400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatLocalClock(raw: string): string {
  const d = parseUtcTime(raw);
  if (!d) return raw;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const clock = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const ms = d.getMilliseconds();
  return ms ? `${clock}.${p(ms, 3)}` : clock;
}

export function formatExactLocal(raw: string): string {
  const d = parseUtcTime(raw);
  return d ? d.toLocaleString() : raw;
}
