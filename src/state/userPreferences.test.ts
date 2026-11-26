import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_QUERIES_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
} from "../lib/pollingInterval";
import { useUserPrefs } from "./userPreferences";

const STORAGE_KEY = "ch-gui.user-prefs";

function resetStore() {
  window.localStorage.clear();
  useUserPrefs.setState({
    serverActivityPollingMs: DEFAULT_POLLING_INTERVAL,
    hideServerActivityTab: false,
    liveQueriesPollingMs: DEFAULT_LIVE_QUERIES_INTERVAL,
    hideLiveQueriesTab: false,
    hasSeenWelcome: false,
    lastSeenChangelogVersion: "",
  });
}

describe("useUserPrefs", () => {
  beforeEach(resetStore);

  it("defaults Server Activity polling to 30s and Live Queries polling to 5s", () => {
    const s = useUserPrefs.getState();
    expect(s.serverActivityPollingMs).toBe(30000);
    expect(s.hideServerActivityTab).toBe(false);
    expect(s.liveQueriesPollingMs).toBe(5000);
    expect(s.hideLiveQueriesTab).toBe(false);
  });

  it("defaults hasSeenWelcome to false for a clean install", () => {
    expect(useUserPrefs.getState().hasSeenWelcome).toBe(false);
  });

  it("setHasSeenWelcome writes the chosen value", () => {
    useUserPrefs.getState().setHasSeenWelcome(true);
    expect(useUserPrefs.getState().hasSeenWelcome).toBe(true);
    useUserPrefs.getState().setHasSeenWelcome(false);
    expect(useUserPrefs.getState().hasSeenWelcome).toBe(false);
  });

  it("defaults lastSeenChangelogVersion to empty for a clean install", () => {
    expect(useUserPrefs.getState().lastSeenChangelogVersion).toBe("");
  });

  it("setLastSeenChangelogVersion writes the chosen value", () => {
    useUserPrefs.getState().setLastSeenChangelogVersion("0.2.5");
    expect(useUserPrefs.getState().lastSeenChangelogVersion).toBe("0.2.5");
  });

  it("setServerActivityPollingInterval writes the chosen value", () => {
    useUserPrefs.getState().setServerActivityPollingInterval("off");
    expect(useUserPrefs.getState().serverActivityPollingMs).toBe("off");
    useUserPrefs.getState().setServerActivityPollingInterval(30000);
    expect(useUserPrefs.getState().serverActivityPollingMs).toBe(30000);
  });

  it("setHideServerActivityTab toggles the flag", () => {
    useUserPrefs.getState().setHideServerActivityTab(true);
    expect(useUserPrefs.getState().hideServerActivityTab).toBe(true);
    useUserPrefs.getState().setHideServerActivityTab(false);
    expect(useUserPrefs.getState().hideServerActivityTab).toBe(false);
  });

  it("setLiveQueriesPollingInterval writes the chosen value", () => {
    useUserPrefs.getState().setLiveQueriesPollingInterval("off");
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe("off");
    useUserPrefs.getState().setLiveQueriesPollingInterval(5000);
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe(5000);
  });

  it("setHideLiveQueriesTab toggles the flag", () => {
    useUserPrefs.getState().setHideLiveQueriesTab(true);
    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(true);
    useUserPrefs.getState().setHideLiveQueriesTab(false);
    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(false);
  });

  it("persists both sections to localStorage under ch-gui.user-prefs", () => {
    useUserPrefs.getState().setServerActivityPollingInterval(60000);
    useUserPrefs.getState().setHideServerActivityTab(true);
    useUserPrefs.getState().setLiveQueriesPollingInterval("off");
    useUserPrefs.getState().setHideLiveQueriesTab(true);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.serverActivityPollingMs).toBe(60000);
    expect(parsed.state.hideServerActivityTab).toBe(true);
    expect(parsed.state.liveQueriesPollingMs).toBe("off");
    expect(parsed.state.hideLiveQueriesTab).toBe(true);
  });

  it("hydrates from localStorage on rehydrate", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          serverActivityPollingMs: 5000,
          hideServerActivityTab: true,
          liveQueriesPollingMs: 10000,
          hideLiveQueriesTab: true,
          hasSeenWelcome: true,
        },
        version: 1,
      }),
    );
    await useUserPrefs.persist.rehydrate();
    const s = useUserPrefs.getState();
    expect(s.serverActivityPollingMs).toBe(5000);
    expect(s.hideServerActivityTab).toBe(true);
    expect(s.liveQueriesPollingMs).toBe(10000);
    expect(s.hideLiveQueriesTab).toBe(true);
    expect(s.hasSeenWelcome).toBe(true);
  });

  it("migrates v0 payloads by setting hasSeenWelcome=true", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          serverActivityPollingMs: 30000,
          hideServerActivityTab: false,
          liveQueriesPollingMs: 2000,
          hideLiveQueriesTab: false,
        },
        version: 0,
      }),
    );
    await useUserPrefs.persist.rehydrate();
    const s = useUserPrefs.getState();
    expect(s.hasSeenWelcome).toBe(true);
    expect(s.serverActivityPollingMs).toBe(30000);
  });

  it("hydrates a v1 payload without lastSeenChangelogVersion to empty", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          serverActivityPollingMs: 2000,
          hideServerActivityTab: false,
          liveQueriesPollingMs: 2000,
          hideLiveQueriesTab: false,
          hasSeenWelcome: true,
        },
        version: 1,
      }),
    );
    await useUserPrefs.persist.rehydrate();
    expect(useUserPrefs.getState().lastSeenChangelogVersion).toBe("");
  });
});
