import {
  ActionIcon,
  AppShell,
  Box,
  Center,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  GearSixIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConnectionList } from "./components/ConnectionList";
import { useErrorPulse } from "./components/Errors";
import { useKafkaPulse } from "./components/Kafka";
import { useWriteGuard } from "./components/useWriteGuard";
import { useTabClose } from "./components/useTabClose";
import {
  MonitorDot,
  monitorDotStale,
  MonitorPane,
} from "./components/MonitorPane";
import { NameInputModal } from "./components/NameInputModal";
import type { QueryEditorHandle } from "./components/QueryEditor";
import { QueryHistory } from "./components/QueryHistory";
import { SavedQueries } from "./components/SavedQueries";
import { SchemaDiffModal } from "./components/SchemaDiffModal";
import { ServerSettingsModal } from "./components/ServerSettingsModal";
import { SchemaTree } from "./components/SchemaTree";
import { SettingsModal } from "./components/SettingsModal";
import { TabPane } from "./components/TabPane";
import { CheatSheet } from "./components/CheatSheet";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { UpdateChecker } from "./components/UpdateChecker";
import { check } from "@tauri-apps/plugin-updater";
import { WelcomeModal } from "./components/WelcomeModal";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { useChFunctions } from "./hooks/useChFunctions";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSidebarWidth } from "./hooks/useSidebarWidth";
import {
  monitorViews,
  nextActiveTab,
  nextMonitorView,
  type MonitorView,
} from "./lib/activeTab";
import {
  CHANGELOG,
  changelogFor,
  whatsNewOnLaunch,
  type ChangelogEntry,
} from "./lib/changelog";
import {
  downloadTextFile,
  rowsToCsv,
  rowsToJsonLines,
  rowsToTsv,
  type ExportFormat,
} from "./lib/csv";
import { saveQuery, updateSavedQuery } from "./lib/db";
import { notifyError } from "./lib/notify";
import {
  cancelTab as runCancelTab,
  cancelTabQuietly,
  executeTab as runExecuteTab,
} from "./lib/runQueryFlow";
import { NEXT_COLOR_SCHEME } from "./lib/theme";
import { prefetchSchema } from "./lib/schemaIndex";
import { setCompletionContext } from "./lib/sqlCompletion";
import { sqlName } from "./lib/sqlIdent";
import { useConnectionUI } from "./state/connectionUI";
import { useConnections } from "./state/connections";
import { useTabs, type QueryTab } from "./state/tabs";
import { useUserPrefs } from "./state/userPreferences";
import type {
  ConnectionConfigPayload,
  LogEventPayload,
  LogsUnavailablePayload,
  ProgressEventPayload,
} from "./types";

export default function App() {
  const {
    activeId,
    connections,
    loaded,
    load,
    buildPayload,
    setActive: setActiveConnection,
  } = useConnections();
  const {
    tabs,
    activeId: tabId,
    openNew,
    openSaved,
    openSql,
    setActive,
    patch,
    appendLogs,
    setProgress,
    markLogsUnavailable,
  } = useTabs();
  const [loadedPayload, setPayload] = useState<ConnectionConfigPayload | null>(
    null,
  );
  // Derive this during render. An effect would leave one render that pairs the
  // new `activeId` with the old server.
  const payload =
    loadedPayload && loadedPayload.id === activeId ? loadedPayload : null;
  // Stores the connection id, so a switch never shows the previous connection's
  // error for one render.
  const [payloadError, setPayloadError] = useState<{
    id: string;
    message: string;
    keychain: boolean;
  } | null>(null);
  const loadFailed = payloadError?.id === activeId;
  const [payloadAttempt, setPayloadAttempt] = useState(0);
  const connId = payload?.id ?? null;
  const { guardRun, guardModal } = useWriteGuard();
  const [saveAsTabId, setSaveAsTabId] = useState<string | null>(null);
  const { requestClose, confirmModal: closeTabModal } = useTabClose((t) =>
    cancelTabQuietly(t),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [updateCheckerOpen, setUpdateCheckerOpen] = useState(false);
  const openUpdateChecker = useCallback(() => setUpdateCheckerOpen(true), []);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewEntries, setWhatsNewEntries] = useState<ChangelogEntry[]>([]);
  const hasSeenWelcome = useUserPrefs((s) => s.hasSeenWelcome);
  const setHasSeenWelcome = useUserPrefs((s) => s.setHasSeenWelcome);
  const openNewConnection = useConnectionUI((s) => s.openNewConnection);
  const [schemaDiff, setSchemaDiff] = useState<{
    opened: boolean;
    prefill: { database: string; table: string } | null;
  }>({ opened: false, prefill: null });
  const [sidebarTab, setSidebarTab] = useState<string>("schema");
  const { navWidth, startNavResize } = useSidebarWidth();
  const hideServerActivityTab = useUserPrefs((s) => s.hideServerActivityTab);
  const hideLiveQueriesTab = useUserPrefs((s) => s.hideLiveQueriesTab);
  const pulse = useErrorPulse(payload, connId);
  // A hidden Server Activity panel stops polling but keeps its cached counts,
  // which must not show on the Monitor tab.
  const pulseData = hideServerActivityTab ? undefined : pulse.data;
  const pulseTotal =
    (pulseData?.errors_recent ?? 0) + (pulseData?.mv_failures_recent ?? 0);
  const healthAlert =
    (pulseData?.pending_mutations ?? 0) > 0 ||
    (pulseData?.max_replica_queue ?? 0) > 0;
  const kafkaPulse = useKafkaPulse(payload, connId);
  const showKafkaTab = (kafkaPulse.data?.kafka_tables ?? 0) > 0;
  const kafkaStuck = kafkaPulse.data?.kafka_stuck ?? 0;

  const views = monitorViews(
    hideServerActivityTab,
    showKafkaTab,
    hideLiveQueriesTab,
  );
  const [monitorView, setMonitorView] = useState<MonitorView | null>(null);
  const shownMonitorView = nextMonitorView(monitorView, views);

  const monitorVisible = views.length > 0;
  useEffect(() => {
    setSidebarTab((current) => nextActiveTab(current, monitorVisible));
  }, [monitorVisible]);
  useChFunctions(payload, connId);
  const queryClient = useQueryClient();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const editorRef = useRef<QueryEditorHandle | null>(null);

  useKeyboardShortcuts({
    onRun: (t) => executeTab(t),
    onRunAll: (t) => executeTabAll(t),
    onSave: (t) => saveTab(t),
    onCancel: (t) => cancelTab(t),
    onCloseTab: (t) => closeTab(t),
    onNewTab: () => openNew(),
    onFormat: () => editorRef.current?.formatAll(),
    onPaletteOpen: () => setPaletteOpen(true),
    onCheatOpen: () => setCheatOpen(true),
  });

  const saveAsTab = saveAsTabId
    ? (tabs.find((t) => t.id === saveAsTabId) ?? null)
    : null;

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlisten = listen<LogEventPayload>("query-log", (e) => {
      appendLogs(e.payload.queryId, e.payload.entries);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [appendLogs]);

  useEffect(() => {
    const unlisten = listen<LogsUnavailablePayload>(
      "query-logs-unavailable",
      (e) => markLogsUnavailable(e.payload.queryId),
    );
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [markLogsUnavailable]);

  useEffect(() => {
    const unlisten = listen<ProgressEventPayload>("query-progress", (e) => {
      const { queryId, ...snapshot } = e.payload;
      setProgress(queryId, snapshot);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setProgress]);

  // The backend stops using clusterAllReplicas after error 497 (no REMOTE
  // grant) and emits this event. `disableFanout` returns false when already
  // off, so a repeat event shows no notice.
  useEffect(() => {
    const unlisten = listen<string>("cluster-fanout-disabled", (e) => {
      useConnections
        .getState()
        .disableFanout(e.payload)
        .then((changed) => {
          if (changed) {
            notifications.show({
              color: "yellow",
              title: "Cluster fan-out disabled",
              message:
                "This user lacks the REMOTE grant, so monitoring reads only the local node.",
            });
          }
        })
        .catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Only the red close button emits this event. The custom menu has no Close
  // Window item, so Cmd+W goes to the keydown handler instead.
  useEffect(() => {
    const unlisten = listen("app-close-requested", () => {
      // window.confirm returns false in WKWebView without showing a dialog, so
      // a confirmation here would keep the window open. Tabs persist through
      // useTabs; results and logs are not kept.
      getCurrentWindow().destroy();
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const checkAndOpen = () => {
      if (!useUserPrefs.getState().hasSeenWelcome) setWelcomeOpen(true);
    };
    if (useUserPrefs.persist.hasHydrated()) {
      checkAndOpen();
      return;
    }
    return useUserPrefs.persist.onFinishHydration(checkAndOpen);
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const version = await getVersion();
        const prefs = useUserPrefs.getState();
        const { entries, nextSeen } = whatsNewOnLaunch(
          version,
          prefs.lastSeenChangelogVersion,
        );
        if (nextSeen !== prefs.lastSeenChangelogVersion) {
          prefs.setLastSeenChangelogVersion(nextSeen);
        }
        if (entries.length) {
          setWhatsNewEntries(entries);
          setWhatsNewOpen(true);
        }
      } catch {
        // getVersion rejects only outside Tauri, with nothing to show.
      }
    };
    const fire = () => void run();
    if (useUserPrefs.persist.hasHydrated()) {
      fire();
      return;
    }
    return useUserPrefs.persist.onFinishHydration(fire);
  }, []);

  useEffect(() => {
    const unlisten = listen("help:show-welcome", () => setWelcomeOpen(true));
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("help:keyboard-shortcuts", () =>
      setCheatOpen(true),
    );
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("app:settings", () => setSettingsOpen(true));
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("help:check-for-updates", () =>
      setUpdateCheckerOpen(true),
    );
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("help:whats-new", async () => {
      const version = await getVersion().catch(() => "");
      const forVersion = changelogFor(version);
      setWhatsNewEntries(
        forVersion.length ? forVersion : CHANGELOG.slice(0, 1),
      );
      setWhatsNewOpen(true);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!cancelled && update) setUpdateCheckerOpen(true);
      } catch {
        // Ignore offline and registry errors. The menu item can still check.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPayloadError(null);
    if (!activeId) return;
    let cancelled = false;
    buildPayload(activeId)
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPayload(null);
        const e = (err ?? {}) as { kind?: string; message?: string };
        setPayloadError({
          id: activeId,
          message: e.message ?? String(err),
          keychain: e.kind === "keychain",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, buildPayload, connections, payloadAttempt]);

  useEffect(() => {
    if (!payload) {
      setCompletionContext(null);
      return;
    }
    setCompletionContext({
      qc: queryClient,
      connectionId: payload.id,
      payload,
    });
    const ac = new AbortController();
    prefetchSchema(queryClient, payload.id, payload, ac.signal).catch(() => {});
    return () => {
      ac.abort();
    };
  }, [payload, queryClient]);

  useEffect(() => {
    if (loaded && activeId && tabs.length === 0) {
      openNew();
    }
  }, [loaded, activeId, tabs.length, openNew]);

  const activeTab = tabs.find((t) => t.id === tabId) ?? null;

  const runCtx = () => ({
    payload,
    patch,
    queryClient,
  });

  function executeTab(t: QueryTab) {
    const sql = editorRef.current?.getSqlToRun() ?? undefined;
    guardRun(t, sql ?? t.sql, () =>
      startRun(t, () => runExecuteTab(t, runCtx(), sql)),
    );
  }

  function executeTabAll(t: QueryTab) {
    guardRun(t, t.sql, () => startRun(t, () => runExecuteTab(t, runCtx())));
  }

  /** Returns whether a query starts. runExecuteTab returns early with no
   * connection or with a query already running. */
  function startRun(t: QueryTab, go: () => Promise<unknown>): boolean {
    const live = useTabs.getState().tabs.find((x) => x.id === t.id);
    const starts = payload !== null && !live?.runningQueryId;
    void go();
    return starts;
  }

  /** Runs `cappedSql` as sent, so earlier statements do not replay and edited
   * params do not change it. */
  function executeTabUncapped(t: QueryTab) {
    if (!t.cappedSql) return;
    return runExecuteTab(t, runCtx(), t.cappedSql, {
      noLimit: true,
      raw: true,
    });
  }

  function cancelTab(t: QueryTab) {
    return runCancelTab(t, { payload, patch });
  }

  function closeTab(t: QueryTab) {
    requestClose(t);
  }

  function exportTab(t: QueryTab, format: ExportFormat) {
    // During a run, `result` still holds the previous run's rows.
    if (!t.result || t.runningQueryId) return;
    const { columns, rows } = t.result;
    const base = t.title.replace(/[^A-Za-z0-9_-]/g, "_");
    switch (format) {
      case "csv":
        downloadTextFile(`${base}.csv`, rowsToCsv(columns, rows), "text/csv");
        break;
      case "tsv":
        downloadTextFile(
          `${base}.tsv`,
          rowsToTsv(columns, rows),
          "text/tab-separated-values",
        );
        break;
      case "jsonl":
        downloadTextFile(
          `${base}.jsonl`,
          rowsToJsonLines(columns, rows),
          "application/x-ndjson",
        );
        break;
    }
  }

  async function saveTab(t: QueryTab) {
    if (!t.sql.trim()) return;
    if (t.savedQueryId == null) {
      setSaveAsTabId(t.id);
      return;
    }
    try {
      await updateSavedQuery(t.savedQueryId, { name: t.title, sql: t.sql });
      notifications.show({ color: "teal", title: "Saved", message: t.title });
      queryClient.invalidateQueries({ queryKey: ["saved_queries"] });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Save failed", e.message ?? String(err));
    }
  }

  async function confirmSaveAs(name: string) {
    if (!saveAsTab) return;
    try {
      const id = await saveQuery({
        name,
        sql: saveAsTab.sql,
        connectionId: activeId,
      });
      patch(saveAsTab.id, { savedQueryId: id, title: name });
      notifications.show({ color: "teal", title: "Saved", message: name });
      queryClient.invalidateQueries({ queryKey: ["saved_queries"] });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Save failed", e.message ?? String(err));
    } finally {
      setSaveAsTabId(null);
    }
  }

  return (
    <AppShell navbar={{ width: navWidth, breakpoint: 0 }} padding={0}>
      <AppShell.Navbar p="xs" className="chg-sidebar">
        <Box
          onMouseDown={startNavResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          style={{
            position: "absolute",
            top: 0,
            right: -2,
            bottom: 0,
            width: 4,
            cursor: "col-resize",
            zIndex: 101,
          }}
        />
        <Stack gap="xs" h="100%">
          <ConnectionList
            payloadError={loadFailed ? payloadError : null}
            onRetryPayload={() => setPayloadAttempt((n) => n + 1)}
          />
          <Divider className="chg-sidebar-divider" />
          <Box flex={1} mih={0}>
            <Tabs
              className="chg-sidebar-tabs"
              value={sidebarTab}
              onChange={(v) => v && setSidebarTab(v)}
              variant="default"
              h="100%"
              display="flex"
              style={{ flexDirection: "column" }}
              styles={{
                list: {
                  flexWrap: "nowrap",
                  overflowX: "auto",
                  scrollbarWidth: "none",
                },
                tab: { flexShrink: 0 },
              }}
              // Unmount hidden panels so only the visible panel polls.
              keepMounted={false}
            >
              <Tabs.List>
                <Tabs.Tab value="schema">Schema</Tabs.Tab>
                <Tabs.Tab value="saved">Saved</Tabs.Tab>
                <Tabs.Tab value="history">History</Tabs.Tab>
                {monitorVisible && (
                  <Tabs.Tab
                    value="monitor"
                    rightSection={
                      <MonitorDot
                        newFailures={pulseTotal}
                        stuckKafka={kafkaStuck}
                        health={healthAlert}
                        stale={monitorDotStale({
                          activityShown: !hideServerActivityTab,
                          activityFailed: pulse.isError,
                          activityAlerting: pulseTotal > 0 || healthAlert,
                          kafkaFailed: kafkaPulse.isError,
                          kafkaStuck,
                        })}
                      />
                    }
                  >
                    Monitor
                  </Tabs.Tab>
                )}
              </Tabs.List>
              <Tabs.Panel value="schema" flex={1} mih={0} pt="xs" keepMounted>
                <SchemaTree
                  payload={payload}
                  loadFailed={loadFailed}
                  onCompareTable={(ref) =>
                    setSchemaDiff({ opened: true, prefill: ref })
                  }
                  onRunTab={(id) => {
                    const t = useTabs.getState().tabs.find((x) => x.id === id);
                    if (t) executeTabAll(t);
                  }}
                  onInsert={(text) => editorRef.current?.insertAtCursor(text)}
                />
              </Tabs.Panel>
              <Tabs.Panel value="saved" flex={1} mih={0} pt="xs" keepMounted>
                <SavedQueries connectionId={activeId} />
              </Tabs.Panel>
              <Tabs.Panel value="history" flex={1} mih={0} pt="xs" keepMounted>
                <QueryHistory
                  connectionId={connId}
                  payload={payload}
                  loadFailed={loadFailed}
                />
              </Tabs.Panel>
              {monitorVisible && (
                <Tabs.Panel value="monitor" flex={1} mih={0} pt="xs">
                  <MonitorPane
                    views={views}
                    view={shownMonitorView}
                    onViewChange={setMonitorView}
                    activityAlerts={pulseTotal}
                    healthAlert={healthAlert}
                    kafkaStuck={kafkaStuck}
                    payload={payload}
                    connectionId={connId}
                    loadFailed={loadFailed}
                  />
                </Tabs.Panel>
              )}
            </Tabs>
          </Box>
          <Group justify="flex-end" gap={2} className="chg-sidebar-footer">
            <Tooltip label="Server settings changed from defaults">
              <ActionIcon
                variant="subtle"
                size="md"
                aria-label="Server settings changed from defaults"
                onClick={() => setServerSettingsOpen(true)}
                disabled={!payload}
              >
                <SlidersHorizontalIcon />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Settings (⌘,)">
              <ActionIcon
                variant="subtle"
                size="md"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <GearSixIcon />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main h="100vh">
        <Stack gap={0} h="100%">
          <Group gap={4} wrap="nowrap" className="chg-tabstrip">
            <ScrollArea
              flex={1}
              type="auto"
              scrollbarSize={6}
              styles={{ viewport: { display: "flex" } }}
            >
              <Group gap={4} wrap="nowrap" role="tablist">
                {tabs.map((t, i) => (
                  <Group
                    key={t.id}
                    gap={2}
                    wrap="nowrap"
                    className="chg-doctab"
                    role="tab"
                    aria-selected={t.id === tabId}
                    tabIndex={t.id === tabId ? 0 : -1}
                    data-active={t.id === tabId || undefined}
                    onClick={() => setActive(t.id)}
                    onKeyDown={(e) => {
                      const moves: Record<string, number> = {
                        ArrowLeft: i - 1,
                        ArrowRight: i + 1,
                        Home: 0,
                        End: tabs.length - 1,
                      };
                      const next = moves[e.key];
                      const target = tabs[next];
                      if (!target) return;
                      e.preventDefault();
                      setActive(target.id);
                      const els =
                        e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                          '[role="tab"]',
                        );
                      els?.[next]?.focus();
                    }}
                  >
                    <Text
                      size="xs"
                      maw={160}
                      truncate
                      className="chg-doctab-title"
                    >
                      {t.title}
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="xs"
                      className="chg-doctab-close"
                      tabIndex={-1}
                      aria-label={`Close ${t.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t);
                      }}
                    >
                      <XIcon size={11} />
                    </ActionIcon>
                  </Group>
                ))}
                <Tooltip label="New tab">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="New tab"
                    onClick={() => openNew()}
                  >
                    <PlusIcon />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </ScrollArea>
          </Group>

          {activeTab ? (
            <TabPane
              tab={activeTab}
              payload={payload}
              editorRef={editorRef}
              onSqlChange={(v) => patch(activeTab.id, { sql: v })}
              onRun={() => executeTab(activeTab)}
              onRunAll={() => executeTabAll(activeTab)}
              onRunWithoutLimit={() => executeTabUncapped(activeTab)}
              onCancel={() => cancelTab(activeTab)}
              onExport={(format) => exportTab(activeTab, format)}
              onSave={() => saveTab(activeTab)}
              onLogLevelChange={(lvl) => patch(activeTab.id, { logLevel: lvl })}
              onAutoLimitChange={(on) => patch(activeTab.id, { autoLimit: on })}
              onParamChange={(name, value) =>
                patch(activeTab.id, {
                  paramValues: { ...activeTab.paramValues, [name]: value },
                })
              }
              onChartChange={(chartPatch) =>
                patch(activeTab.id, {
                  chart: { ...activeTab.chart, ...chartPatch },
                })
              }
            />
          ) : (
            <Center flex={1}>
              <Text c="dimmed">Open a tab to write a query.</Text>
            </Center>
          )}
        </Stack>
      </AppShell.Main>

      <NameInputModal
        opened={saveAsTab !== null}
        title="Save query as…"
        label="Name"
        submitLabel="Save"
        initialValue={saveAsTab?.title ?? ""}
        onSubmit={confirmSaveAs}
        onCancel={() => setSaveAsTabId(null)}
      />

      <CheatSheet opened={cheatOpen} onClose={() => setCheatOpen(false)} />

      <WelcomeModal
        opened={welcomeOpen}
        onClose={() => {
          setWelcomeOpen(false);
          if (!hasSeenWelcome) setHasSeenWelcome(true);
        }}
        onAddConnection={openNewConnection}
      />

      <UpdateChecker
        opened={updateCheckerOpen}
        onClose={() => setUpdateCheckerOpen(false)}
        onOpen={openUpdateChecker}
      />

      <WhatsNewModal
        opened={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        entries={whatsNewEntries}
      />

      {guardModal}
      {closeTabModal}
      <SettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <SchemaDiffModal
        opened={schemaDiff.opened}
        onClose={() => setSchemaDiff({ opened: false, prefill: null })}
        payload={payload}
        prefill={schemaDiff.prefill}
      />

      <ServerSettingsModal
        opened={serverSettingsOpen}
        onClose={() => setServerSettingsOpen(false)}
        payload={payload}
      />

      <CommandPalette
        opened={paletteOpen}
        connectionId={connId}
        tabs={tabs}
        activeTabId={tabId}
        connections={connections}
        onClose={() => setPaletteOpen(false)}
        onPick={(item: PaletteItem) => {
          switch (item.kind) {
            case "table": {
              editorRef.current?.insertAtCursor(
                `${sqlName(item.db)}.${sqlName(item.table)}`,
              );
              return;
            }
            case "database": {
              editorRef.current?.insertAtCursor(`${sqlName(item.name)}.`);
              return;
            }
            case "tab": {
              setActive(item.tab.id);
              return;
            }
            case "saved": {
              openSaved(item.saved);
              return;
            }
            case "history": {
              openSql(item.entry.sql);
              return;
            }
            case "connection": {
              setActiveConnection(item.connection.id);
              return;
            }
            case "action": {
              if (item.id === "format") {
                editorRef.current?.formatAll();
              } else if (item.id === "toggleTheme") {
                setColorScheme(NEXT_COLOR_SCHEME[colorScheme]);
              } else if (item.id === "exportCsv") {
                if (activeTab) exportTab(activeTab, "csv");
              } else if (item.id === "compareTables") {
                setSchemaDiff({ opened: true, prefill: null });
              } else if (item.id === "serverSettings") {
                setServerSettingsOpen(true);
              }
              return;
            }
          }
        }}
      />
    </AppShell>
  );
}
