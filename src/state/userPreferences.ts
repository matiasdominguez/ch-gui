import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_LIVE_QUERIES_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
  type PollingInterval,
} from "../lib/pollingInterval";

interface UserPrefsState {
  serverActivityPollingMs: PollingInterval;
  hideServerActivityTab: boolean;
  liveQueriesPollingMs: PollingInterval;
  hideLiveQueriesTab: boolean;
  hasSeenWelcome: boolean;
  lastSeenChangelogVersion: string;
  setServerActivityPollingInterval: (pref: PollingInterval) => void;
  setHideServerActivityTab: (hide: boolean) => void;
  setLiveQueriesPollingInterval: (pref: PollingInterval) => void;
  setHideLiveQueriesTab: (hide: boolean) => void;
  setHasSeenWelcome: (seen: boolean) => void;
  setLastSeenChangelogVersion: (version: string) => void;
}

const USER_PREFS_VERSION = 1;

export const useUserPrefs = create<UserPrefsState>()(
  persist(
    (set) => ({
      serverActivityPollingMs: DEFAULT_POLLING_INTERVAL,
      hideServerActivityTab: false,
      liveQueriesPollingMs: DEFAULT_LIVE_QUERIES_INTERVAL,
      hideLiveQueriesTab: false,
      hasSeenWelcome: false,
      lastSeenChangelogVersion: "",
      setServerActivityPollingInterval: (pref) =>
        set({ serverActivityPollingMs: pref }),
      setHideServerActivityTab: (hide) => set({ hideServerActivityTab: hide }),
      setLiveQueriesPollingInterval: (pref) =>
        set({ liveQueriesPollingMs: pref }),
      setHideLiveQueriesTab: (hide) => set({ hideLiveQueriesTab: hide }),
      setHasSeenWelcome: (seen) => set({ hasSeenWelcome: seen }),
      setLastSeenChangelogVersion: (version) =>
        set({ lastSeenChangelogVersion: version }),
    }),
    {
      name: "ch-gui.user-prefs",
      version: USER_PREFS_VERSION,
      // Installs at version 0 predate the welcome tour, so mark it seen. Otherwise
      // it would open on the first launch after an upgrade.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<UserPrefsState>;
        if (version < 1) {
          return { ...state, hasSeenWelcome: true } as UserPrefsState;
        }
        return state as UserPrefsState;
      },
    },
  ),
);
