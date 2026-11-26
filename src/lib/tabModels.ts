export const TAB_MODEL_SCHEME = "query-tab";

export function closedTabModels<
  T extends { uri: { scheme: string; path: string } },
>(models: T[], openTabIds: string[]): T[] {
  return models.filter(
    (m) =>
      m.uri.scheme === TAB_MODEL_SCHEME && !openTabIds.includes(m.uri.path),
  );
}
