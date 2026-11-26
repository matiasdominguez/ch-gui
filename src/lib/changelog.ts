import data from "./changelog.json";

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = data as ChangelogEntry[];

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function changelogSince(
  currentVersion: string,
  lastSeen: string,
  entries: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  if (!lastSeen) return [];
  return entries
    .filter(
      (e) =>
        compareVersions(e.version, lastSeen) > 0 &&
        compareVersions(e.version, currentVersion) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function changelogFor(
  version: string,
  entries: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  return entries.filter((e) => e.version === version);
}

export interface WhatsNewDecision {
  entries: ChangelogEntry[];
  nextSeen: string;
}

export function whatsNewOnLaunch(
  currentVersion: string,
  lastSeen: string,
  entries: ChangelogEntry[] = CHANGELOG,
): WhatsNewDecision {
  if (!lastSeen) return { entries: [], nextSeen: currentVersion };
  if (lastSeen === currentVersion) return { entries: [], nextSeen: lastSeen };
  return {
    entries: changelogSince(currentVersion, lastSeen, entries),
    nextSeen: currentVersion,
  };
}
