export type MonitorView = "activity" | "kafka" | "running";

export function monitorViews(
  hideActivity: boolean,
  kafkaVisible: boolean,
  hideLiveQueries: boolean,
): MonitorView[] {
  const views: MonitorView[] = [];
  if (!hideActivity) views.push("activity");
  if (kafkaVisible) views.push("kafka");
  if (!hideLiveQueries) views.push("running");
  return views;
}

export function nextMonitorView(
  current: MonitorView | null,
  views: MonitorView[],
): MonitorView | null {
  if (current && views.includes(current)) return current;
  return views[0] ?? null;
}

export function nextActiveTab(
  current: string,
  monitorVisible: boolean,
): string {
  if (current === "monitor" && !monitorVisible) return "schema";
  return current;
}
