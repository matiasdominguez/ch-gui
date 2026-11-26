import type { ServerHistoryFilters } from "../types";

export interface ServerHistoryFilterUi {
  min_duration_s: number | "";
  min_memory_mb: number | "";
  exception_only: boolean;
}

export function uiToBackendFilters(
  ui: ServerHistoryFilterUi,
): ServerHistoryFilters {
  const f: ServerHistoryFilters = {};
  if (typeof ui.min_duration_s === "number" && ui.min_duration_s > 0) {
    f.min_duration_ms = Math.round(ui.min_duration_s * 1000);
  }
  if (typeof ui.min_memory_mb === "number" && ui.min_memory_mb > 0) {
    f.min_memory_bytes = Math.round(ui.min_memory_mb * 1024 * 1024);
  }
  if (ui.exception_only) f.exception_only = true;
  return f;
}

export function filterSummary(
  ui: ServerHistoryFilterUi,
  grouped: boolean,
): string | null {
  const bits: string[] = [];
  if (typeof ui.min_duration_s === "number" && ui.min_duration_s > 0) {
    bits.push(`≥${ui.min_duration_s}s`);
  }
  if (typeof ui.min_memory_mb === "number" && ui.min_memory_mb > 0) {
    bits.push(`≥${ui.min_memory_mb}MB`);
  }
  if (ui.exception_only) bits.push("errors");
  if (grouped) bits.push("grouped");
  return bits.length ? bits.join(" · ") : null;
}
