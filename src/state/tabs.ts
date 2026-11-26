import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";

import type {
  AppError,
  ConnectionConfigPayload,
  LogEntry,
  LogLevel,
  ProfileSnapshot,
  ProgressSnapshot,
  QueryResult,
} from "../types";
import type { ErrorDetail } from "../lib/llmReport";

export interface TabError extends AppError {
  detail?: ErrorDetail;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  savedQueryId: number | null;
  result: QueryResult | null;
  error: TabError | null;
  runningQueryId: string | null;
  /** Cancel must KILL on this server, even if the active connection changed. */
  runConn: ConnectionConfigPayload | null;
  /** A slow profile fetch checks this, so it cannot overwrite a newer profile. */
  profileQueryId: string | null;
  cancelRequested: boolean;
  batch: { idx: number; total: number } | null;
  logLevel: LogLevel;
  logs: LogEntry[];
  logsUnavailable: boolean;
  progress: ProgressSnapshot | null;
  /** `system.query_log` flushes late, so this stays null until the row appears. */
  profile: ProfileSnapshot | null;
  profileLoading: boolean;
  profileError: string | null;
  autoLimit: boolean;
  guardWrites: boolean;
  autoLimitHit: boolean;
  /** Holds only the capped statement, so "Run without limit" skips earlier writes. */
  cappedSql?: string;
  runStartedAt?: number;
  resultOf?: { idx: number; total: number };
  paramValues: Record<string, string>;
  chart: ChartState;
}

export interface ChartState {
  type: "bar" | "line";
  xCol: string | null;
  yCol: string | null;
  /** `columnShape` of the result where the user picked "count of rows" for y. */
  yCount?: string | null;
}

const reopened = new WeakSet<object>();

export interface ClosedTab {
  title: string;
  sql: string;
  savedQueryId: number | null;
  logLevel: LogLevel;
  paramValues: Record<string, string>;
  chart: ChartState;
  guardWrites?: boolean;
}

const CLOSED_STACK_LIMIT = 10;

const MAX_LOG_ENTRIES = 5000;

interface TabsState {
  tabs: QueryTab[];
  activeId: string | null;
  closedStack: ClosedTab[];
  open: (init?: Partial<QueryTab>) => string;
  openNew: () => string;
  openSaved: (saved: { id: number; name: string; sql: string }) => string;
  /** Reuses only a never-run tab; a run tab may show another connection's result. */
  openSql: (sql: string) => string;
  close: (id: string) => void;
  reopenLast: () => string | null;
  reopenClosed: (entry: ClosedTab) => string | null;
  setActive: (id: string) => void;
  patch: (id: string, patch: Partial<QueryTab>) => void;
  appendLogs: (queryId: string, entries: LogEntry[]) => void;
  setProgress: (queryId: string, snapshot: ProgressSnapshot) => void;
  markLogsUnavailable: (queryId: string) => void;
}

/** Omits runtime state, because results can be huge and go stale on relaunch. */
interface PersistedTab {
  id: string;
  title: string;
  sql: string;
  savedQueryId: number | null;
  logLevel: LogLevel;
  autoLimit?: boolean;
  guardWrites?: boolean;
  paramValues: Record<string, string>;
  chart: ChartState;
}

const TITLE_MAX = 32;

const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

export function titleFromSql(sql: string): string {
  const line = sql.replace(LEADING_COMMENTS, "").split("\n")[0];
  const flat = line.replace(/\s+/g, " ").trim();
  if (!flat) return "Untitled";
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

export function nextQueryTitle(titles: string[]): string {
  const taken = titles.map((t) => /^Query (\d+)$/.exec(t)?.[1]).map(Number);
  return `Query ${Math.max(0, ...taken.filter(Number.isFinite)) + 1}`;
}

const TABS_VERSION = 0;

function inflateTab(p: PersistedTab): QueryTab {
  return {
    ...p,
    autoLimit: p.autoLimit ?? true,
    guardWrites: p.guardWrites ?? false,
    autoLimitHit: false,
    result: null,
    error: null,
    runningQueryId: null,
    runConn: null,
    profileQueryId: null,
    cancelRequested: false,
    batch: null,
    logs: [],
    logsUnavailable: false,
    progress: null,
    profile: null,
    profileLoading: false,
    profileError: null,
  };
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      closedStack: [],
      open(init) {
        const id = uuid();
        const tab: QueryTab = {
          id,
          title: init?.title ?? "Untitled",
          sql: init?.sql ?? "",
          savedQueryId: init?.savedQueryId ?? null,
          result: null,
          error: null,
          runningQueryId: null,
          runConn: null,
          profileQueryId: null,
          cancelRequested: false,
          batch: null,
          logLevel: "none",
          autoLimit: true,
          guardWrites: false,
          autoLimitHit: false,
          logs: [],
          logsUnavailable: false,
          progress: null,
          profile: null,
          profileLoading: false,
          profileError: null,
          paramValues: {},
          chart: { type: "bar", xCol: null, yCol: null },
          ...init,
        };
        set({ tabs: [...get().tabs, tab], activeId: id });
        return id;
      },
      openNew() {
        const { tabs, closedStack } = get();
        return get().open({
          title: nextQueryTitle([
            ...tabs.map((t) => t.title),
            ...closedStack.map((t) => t.title),
          ]),
          sql: "",
        });
      },
      openSaved(saved) {
        const hit = get().tabs.find((t) => t.savedQueryId === saved.id);
        if (hit) {
          set({
            tabs: get().tabs.map((t) =>
              t.id === hit.id ? { ...t, title: saved.name } : t,
            ),
            activeId: hit.id,
          });
          return hit.id;
        }
        return get().open({
          title: saved.name,
          sql: saved.sql,
          savedQueryId: saved.id,
        });
      },
      openSql(sql) {
        const hit = get().tabs.find(
          (t) =>
            t.savedQueryId === null &&
            t.sql === sql &&
            !t.result &&
            !t.error &&
            !t.runningQueryId,
        );
        if (hit) {
          set({ activeId: hit.id });
          return hit.id;
        }
        return get().open({ title: titleFromSql(sql), sql });
      },
      close(id) {
        const closing = get().tabs.find((t) => t.id === id);
        const tabs = get().tabs.filter((t) => t.id !== id);
        const activeId =
          get().activeId === id
            ? (tabs[tabs.length - 1]?.id ?? null)
            : get().activeId;
        const closedStack = closing
          ? [
              {
                title: closing.title,
                sql: closing.sql,
                savedQueryId: closing.savedQueryId,
                logLevel: closing.logLevel,
                paramValues: closing.paramValues,
                chart: closing.chart,
                guardWrites: closing.guardWrites,
              },
              ...get().closedStack,
            ].slice(0, CLOSED_STACK_LIMIT)
          : get().closedStack;
        set({ tabs, activeId, closedStack });
      },
      reopenLast() {
        const [last, ...rest] = get().closedStack;
        if (!last) return null;
        set({ closedStack: rest });
        reopened.add(last);
        return get().open(last);
      },
      reopenClosed(entry) {
        // An evicted entry can still reopen, so stack membership cannot decide this.
        if (reopened.has(entry)) return null;
        reopened.add(entry);
        set({ closedStack: get().closedStack.filter((e) => e !== entry) });
        return get().open(entry);
      },
      setActive(id) {
        set({ activeId: id });
      },
      patch(id, patch) {
        set({
          tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        });
      },
      appendLogs(queryId, entries) {
        if (!entries.length) return;
        set({
          tabs: get().tabs.map((t) => {
            if (t.runningQueryId !== queryId) return t;
            const logs = [...t.logs, ...entries];
            return {
              ...t,
              logs:
                logs.length > MAX_LOG_ENTRIES
                  ? logs.slice(-MAX_LOG_ENTRIES)
                  : logs,
            };
          }),
        });
      },
      setProgress(queryId, snapshot) {
        set({
          tabs: get().tabs.map((t) =>
            t.runningQueryId === queryId ? { ...t, progress: snapshot } : t,
          ),
        });
      },
      markLogsUnavailable(queryId) {
        set({
          tabs: get().tabs.map((t) =>
            t.runningQueryId === queryId ? { ...t, logsUnavailable: true } : t,
          ),
        });
      },
    }),
    {
      name: "ch-gui.tabs",
      version: TABS_VERSION,
      partialize: (state) => ({
        tabs: state.tabs.map((t): PersistedTab => ({
          id: t.id,
          title: t.title,
          sql: t.sql,
          savedQueryId: t.savedQueryId,
          logLevel: t.logLevel,
          autoLimit: t.autoLimit,
          guardWrites: t.guardWrites,
          paramValues: t.paramValues,
          chart: t.chart,
        })),
        activeId: state.activeId,
        closedStack: state.closedStack,
      }),
      // A shallow merge would leave the fields stripped from PersistedTab undefined,
      // and the grid would crash.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as {
          tabs?: PersistedTab[];
          activeId?: string | null;
          closedStack?: ClosedTab[];
        };
        const tabs = (p.tabs ?? []).map(inflateTab);
        return {
          ...current,
          tabs,
          activeId:
            p.activeId && tabs.some((t) => t.id === p.activeId)
              ? p.activeId
              : (tabs[tabs.length - 1]?.id ?? null),
          closedStack: p.closedStack ?? [],
        };
      },
    },
  ),
);
