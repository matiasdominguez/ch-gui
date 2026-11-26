import {
  Box,
  Button,
  Center,
  Code,
  Group,
  Menu,
  NativeSelect,
  Progress,
  Stack,
  Switch,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  CaretDownIcon,
  DatabaseIcon,
  PlayIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { useRef, useState, type RefObject } from "react";

import { useEditorHeight } from "../hooks/useEditorHeight";
import { AUTO_LIMIT_ROWS } from "../lib/autoLimit";
import { copyWithToast } from "../lib/clipboard";
import {
  rowsToCsv,
  rowsToJson,
  rowsToMarkdown,
  rowsToPythonList,
  rowsToSqlValues,
  rowsToClipboardTsv,
  type ExportFormat,
} from "../lib/csv";
import { formatBytes, formatCount } from "../lib/format";
import { llmReport } from "../lib/llmReport";
import { extractParams } from "../lib/params";
import { formatSqlServer } from "../lib/tauri";
import { useConnections } from "../state/connections";
import type { ChartState, QueryTab } from "../state/tabs";
import type {
  ConnectionConfigPayload,
  LogLevel,
  ProgressSnapshot,
} from "../types";

import { isExplain } from "../lib/sqlKind";

import { CopyForLlmButton } from "./CopyForLlmButton";
import { ExplainViewer } from "./ExplainViewer";
import { LogsPanel } from "./LogsPanel";
import { ParamsBar } from "./ParamsBar";
import { QueryEditor, type QueryEditorHandle } from "./QueryEditor";
import { QueryProfile } from "./QueryProfile";
import { ResultsChart } from "./ResultsChart";
import { ResultsTable } from "./ResultsTable";
import { RunClock } from "./RunClock";
import { Shortcut } from "./ui";

const LOG_LEVELS: { value: LogLevel; label: string }[] = [
  { value: "none", label: "Logs: off" },
  { value: "error", label: "Logs: error" },
  { value: "warning", label: "Logs: warning" },
  { value: "information", label: "Logs: info" },
  { value: "debug", label: "Logs: debug" },
  { value: "trace", label: "Logs: trace" },
];

export interface TabPaneProps {
  tab: QueryTab;
  payload: ConnectionConfigPayload | null;
  editorRef?: RefObject<QueryEditorHandle | null>;
  onSqlChange: (v: string) => void;
  onRun: () => void;
  onRunAll: () => void;
  onRunWithoutLimit: () => void;
  onCancel: () => void;
  onExport: (format: ExportFormat) => void;
  onSave: () => void;
  onLogLevelChange: (level: LogLevel) => void;
  onAutoLimitChange: (on: boolean) => void;
  onParamChange: (name: string, value: string) => void;
  onChartChange: (patch: Partial<ChartState>) => void;
}

export function TabPane({
  tab,
  payload,
  editorRef: externalEditorRef,
  onSqlChange,
  onRun,
  onRunAll,
  onRunWithoutLimit,
  onCancel,
  onExport,
  onSave,
  onLogLevelChange,
  onAutoLimitChange,
  onParamChange,
  onChartChange,
}: TabPaneProps) {
  const internalEditorRef = useRef<QueryEditorHandle>(null);
  const cappedNote = `First ${AUTO_LIMIT_ROWS.toLocaleString()} rows only`;
  const editorRef = externalEditorRef ?? internalEditorRef;
  const errorDetail = tab.error?.detail ?? null;
  const firstParamRef = useRef<HTMLInputElement>(null);
  const { editorHeight, startEditorResize } = useEditorHeight();
  const isRunning = Boolean(tab.runningQueryId);
  const connections = useConnections((s) => s.connections);
  const runConnName = tab.runConn
    ? (connections.find((c) => c.id === tab.runConn?.id)?.name ??
      tab.runConn.host)
    : null;
  const activeConnName = payload
    ? (connections.find((c) => c.id === payload.id)?.name ?? payload.host)
    : null;
  const isCancelled = tab.error?.kind === "cancelled";
  const onServerFormat = payload
    ? (sql: string) => formatSqlServer(payload, sql)
    : undefined;
  const showLogs = tab.logLevel !== "none" || tab.logs.length > 0;

  const [runTargetSql, setRunTargetSql] = useState(tab.sql);

  const isMissing = (p: { name: string }) =>
    !(tab.paramValues[p.name] ?? "").trim();
  const tooltipFor = (missing: { name: string }[]) =>
    missing.length > 0
      ? `Missing value for ${missing.map((p) => `{${p.name}}`).join(", ")}`
      : null;

  const params = extractParams(tab.sql);
  const allMissing = params.filter(isMissing);
  const allDisabled = !tab.sql.trim() || allMissing.length > 0;
  const allTooltip = tooltipFor(allMissing);

  const targetMissing = extractParams(runTargetSql).filter(isMissing);
  const targetDisabled = !runTargetSql.trim() || targetMissing.length > 0;
  const targetTooltip = tooltipFor(targetMissing);

  type CopyFormat = "csv" | "tsv" | "markdown" | "json" | "sql" | "python";
  function copyResultAs(format: CopyFormat) {
    if (!tab.result) return;
    const { columns, rows } = tab.result;
    const text =
      format === "csv"
        ? rowsToCsv(columns, rows)
        : format === "tsv"
          ? rowsToClipboardTsv(columns, rows)
          : format === "markdown"
            ? rowsToMarkdown(columns, rows)
            : format === "json"
              ? rowsToJson(columns, rows)
              : format === "sql"
                ? rowsToSqlValues(rows)
                : rowsToPythonList(columns, rows);
    copyWithToast(text, "toolbar-copy");
  }

  return (
    <Stack gap={0} flex={1} mih={0}>
      <Box style={{ height: editorHeight, minHeight: 90, flexShrink: 0 }}>
        <QueryEditor
          ref={editorRef}
          tabId={tab.id}
          value={tab.sql}
          onChange={onSqlChange}
          onRun={() => {
            if (!targetDisabled) onRun();
          }}
          onRunAll={() => {
            if (!allDisabled) onRunAll();
          }}
          onRunTargetChange={setRunTargetSql}
          onServerFormat={onServerFormat}
          onEscape={() => firstParamRef.current?.focus()}
        />
      </Box>
      <Box
        role="separator"
        aria-label="Resize editor"
        onMouseDown={startEditorResize}
        className="chg-split"
        style={{ height: 5, flexShrink: 0, cursor: "row-resize" }}
      />
      {params.length > 0 && (
        <ParamsBar
          params={params}
          values={tab.paramValues}
          onChange={onParamChange}
          onRun={() => {
            if (!targetDisabled) onRun();
          }}
          onEscape={() => editorRef.current?.focus()}
          firstInputRef={firstParamRef}
        />
      )}
      <Group gap={6} className="chg-toolbar">
        {isRunning ? (
          <>
            {/* Run and Run all stay in place, so a double-click on either hits
                a disabled button, not Cancel. */}
            <RunButton
              label="Run"
              shortcut="⌘↵"
              primary
              onClick={onRun}
              disabled
              tooltip={null}
            />
            <RunButton
              label="Run all"
              shortcut="⌘⇧↵"
              variant="default"
              onClick={onRunAll}
              disabled
              tooltip={null}
            />
            {/* Stays clickable while cancelling. A KILL can reach a replica
                that is not running the query, so a second click retries it. */}
            <Button
              color="red"
              size="compact-sm"
              onClick={onCancel}
              leftSection={<StopIcon weight="fill" size={12} />}
            >
              {tab.cancelRequested ? "Cancelling…" : "Cancel"}
            </Button>
            {runConnName && (
              <Tooltip label="The connection this query runs on">
                <span className="chg-run-target" data-running>
                  <DatabaseIcon size={13} />
                  {runConnName}
                </span>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            <RunButton
              label="Run"
              shortcut="⌘↵"
              primary
              onClick={onRun}
              disabled={targetDisabled}
              tooltip={targetTooltip}
            />
            <RunButton
              label="Run all"
              shortcut="⌘⇧↵"
              variant="default"
              onClick={onRunAll}
              disabled={allDisabled}
              tooltip={allTooltip}
            />
            {activeConnName && (
              <Tooltip label="Run and Run all use this connection. Switch it in the sidebar.">
                <span data-run-target className="chg-run-target">
                  <DatabaseIcon size={13} />
                  <span className="chg-run-target-on">on</span>
                  <span className="chg-run-target-name">{activeConnName}</span>
                </span>
              </Tooltip>
            )}
          </>
        )}
        <span className="chg-toolbar-sep" />
        <Tooltip label="⌘S">
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            onClick={onSave}
            disabled={!tab.sql.trim()}
          >
            {tab.savedQueryId != null ? "Save" : "Save as…"}
          </Button>
        </Tooltip>
        <Tooltip label="⌘⇧L">
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            onClick={() => editorRef.current?.formatAll()}
            disabled={!tab.sql.trim()}
          >
            Format
          </Button>
        </Tooltip>
        <NativeSelect
          size="xs"
          className="chg-log-select"
          value={tab.logLevel}
          onChange={(e) => onLogLevelChange(e.currentTarget.value as LogLevel)}
          data={LOG_LEVELS}
          aria-label="Server log level"
        />
        <Tooltip
          label={`Adds LIMIT ${AUTO_LIMIT_ROWS.toLocaleString()} to each SELECT that has no LIMIT, so a large result can't slow the app or the server. Turn off to run this tab without a limit.`}
          multiline
          w={280}
        >
          <Switch
            size="xs"
            className="chg-autolimit"
            checked={tab.autoLimit}
            onChange={(e) => onAutoLimitChange(e.currentTarget.checked)}
            label="Auto-LIMIT"
          />
        </Tooltip>
      </Group>
      {isRunning && (
        <Group
          data-run-strip
          gap="sm"
          wrap="nowrap"
          className="chg-run-strip"
          style={{ flex: "none" }}
        >
          {tab.runStartedAt != null && (
            <RunClock key={tab.runStartedAt} since={tab.runStartedAt} />
          )}
          {tab.batch && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              Statement {tab.batch.idx} of {tab.batch.total}
            </Text>
          )}
          <QueryProgressBar progress={tab.progress} />
        </Group>
      )}
      {showLogs && (
        <Box
          style={{
            height: 160,
            minHeight: 80,
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <LogsPanel
            logs={tab.logs}
            level={tab.logLevel}
            unavailable={tab.logsUnavailable}
            running={isRunning}
            ran={Boolean(tab.result || tab.error)}
          />
        </Box>
      )}
      {tab.result && tab.autoLimitHit && !tab.error && !isRunning && (
        <Group
          data-capped-strip
          gap="sm"
          wrap="nowrap"
          className="chg-capped"
          style={{ flex: "none" }}
        >
          <Text size="sm" style={{ flex: 1 }}>
            Showing the first {AUTO_LIMIT_ROWS.toLocaleString()} rows. The query
            may return more. Sorting, charts, copies, and exports use only these
            rows.
          </Text>
          <Button
            size="compact-sm"
            variant="default"
            onClick={onRunWithoutLimit}
          >
            Run without limit
          </Button>
        </Group>
      )}
      <Box
        flex={1}
        mih={0}
        inert={isRunning && tab.result != null}
        data-stale={(isRunning && tab.result != null) || undefined}
        className="chg-result-area"
      >
        {tab.error ? (
          <Box
            h="100%"
            className="chg-error-pane"
            data-cancelled={isCancelled || undefined}
            style={{ display: "flex", flexDirection: "column" }}
          >
            {errorDetail && (
              <Box className="chg-error-actions" style={{ flex: "none" }}>
                <CopyForLlmButton
                  conn={errorDetail.conn}
                  report={(v) => llmReport(errorDetail, v)}
                  tooltip="Copies the SQL, the error, the server version, and the query id"
                />
              </Box>
            )}
            {/Timeout exceeded: elapsed/.test(tab.error.message) && (
              <Text size="sm" style={{ flex: "none" }}>
                The query ran past the server's time limit. To allow more time,
                end the query with{" "}
                <Code>{"SETTINGS max_execution_time = <seconds>"}</Code>. A
                value of 0 removes the limit. The server may refuse this setting
                for a read-only user.
              </Text>
            )}
            <Box
              data-error-scroll
              className="chg-error-scroll"
              style={{ flex: 1, minHeight: 0, overflow: "auto" }}
            >
              <ErrorText message={tab.error.message} />
            </Box>
          </Box>
        ) : tab.result ? (
          // Only the chart unmounts when hidden, because its grouping scans
          // every row and would rerun unseen on each result. The grid and
          // profile stay mounted to keep scroll and selection.
          <Tabs
            defaultValue="results"
            keepMounted={false}
            variant="default"
            h="100%"
            className="chg-result-tabs"
          >
            <Group gap={6} className="chg-result-bar">
              <Tabs.List>
                <Tabs.Tab value="results">Results</Tabs.Tab>
                <Tabs.Tab value="chart">Chart</Tabs.Tab>
                <Tabs.Tab value="profile">Profile</Tabs.Tab>
              </Tabs.List>
              {tab.resultOf && (
                <Text size="xs" c="dimmed">
                  Result of statement {tab.resultOf.idx} of {tab.resultOf.total}
                </Text>
              )}
              <Group gap={6} wrap="nowrap" className="chg-result-meta">
                <span
                  className="chg-stat"
                  data-tone={tab.autoLimitHit ? "yellow" : undefined}
                >
                  {tab.autoLimitHit
                    ? `${AUTO_LIMIT_ROWS.toLocaleString()} rows (limit reached)`
                    : `${tab.result.stats.rows.toLocaleString()} ${tab.result.stats.rows === 1 ? "row" : "rows"}`}
                </span>
                <span className="chg-stat-sep" aria-hidden>
                  ·
                </span>
                <span className="chg-stat">
                  {tab.result.stats.elapsed_ms} ms
                </span>
                <Menu shadow="md" position="bottom-end">
                  <Menu.Target>
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      disabled={!tab.result.rows.length}
                      rightSection={<CaretDownIcon size={11} weight="bold" />}
                    >
                      Copy
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {tab.autoLimitHit && <Menu.Label>{cappedNote}</Menu.Label>}
                    <Menu.Item onClick={() => copyResultAs("csv")}>
                      CSV
                    </Menu.Item>
                    <Menu.Item onClick={() => copyResultAs("tsv")}>
                      TSV
                    </Menu.Item>
                    <Menu.Item onClick={() => copyResultAs("markdown")}>
                      Markdown table
                    </Menu.Item>
                    <Menu.Item onClick={() => copyResultAs("json")}>
                      JSON rows
                    </Menu.Item>
                    <Menu.Item onClick={() => copyResultAs("sql")}>
                      SQL VALUES
                    </Menu.Item>
                    <Menu.Item onClick={() => copyResultAs("python")}>
                      Python list
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                <Menu shadow="md" position="bottom-end">
                  <Menu.Target>
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      disabled={!tab.result.rows.length}
                      rightSection={<CaretDownIcon size={11} weight="bold" />}
                    >
                      Export
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {tab.autoLimitHit && <Menu.Label>{cappedNote}</Menu.Label>}
                    <Menu.Item onClick={() => onExport("csv")}>CSV</Menu.Item>
                    <Menu.Item onClick={() => onExport("tsv")}>TSV</Menu.Item>
                    <Menu.Item onClick={() => onExport("jsonl")}>
                      JSON Lines
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
            <Tabs.Panel value="results" keepMounted>
              {isExplain(tab.sql) && tab.result.columns.length === 1 ? (
                <ExplainViewer rows={tab.result.rows} />
              ) : (
                <ResultsTable
                  columns={tab.result.columns}
                  rows={tab.result.rows}
                  scrollKey={tab.id}
                />
              )}
            </Tabs.Panel>
            <Tabs.Panel value="chart">
              <ResultsChart
                capped={tab.autoLimitHit}
                result={tab.result}
                chart={tab.chart}
                onChange={onChartChange}
              />
            </Tabs.Panel>
            <Tabs.Panel value="profile" keepMounted>
              <QueryProfile
                snapshot={tab.profile}
                loading={tab.profileLoading}
                error={tab.profileError}
              />
            </Tabs.Panel>
          </Tabs>
        ) : (
          <Center h="100%">
            <Text c="dimmed" size="sm">
              {isRunning ? "Running…" : "No results yet."}
            </Text>
          </Center>
        )}
      </Box>
    </Stack>
  );
}

function ErrorText({ message }: { message: string }) {
  const at = message.search(/\n\s*\nStack trace/);
  const head = at >= 0 ? message.slice(0, at) : message;
  const trace = at >= 0 ? message.slice(at).replace(/^\s+/, "") : "";
  return (
    <div className="chg-error-text">
      <div className="chg-error-message">{head}</div>
      {trace && <div className="chg-error-trace">{trace}</div>}
    </div>
  );
}

/** The span lets Mantine's Tooltip fire over a disabled button, which gets no
 * pointer events. */
function RunButton({
  label,
  shortcut,
  primary,
  onClick,
  disabled,
  tooltip,
  variant,
}: {
  label: string;
  shortcut: string;
  primary?: boolean;
  onClick: () => void;
  disabled: boolean;
  tooltip: string | null;
  variant?: string;
}) {
  const btn = (
    <Button
      size="compact-sm"
      variant={variant}
      className={primary ? "chg-run" : undefined}
      onClick={onClick}
      disabled={disabled}
      leftSection={primary ? <PlayIcon weight="fill" size={11} /> : undefined}
      rightSection={<Shortcut>{shortcut}</Shortcut>}
    >
      {label}
    </Button>
  );
  return tooltip ? (
    <Tooltip label={tooltip}>
      <span>{btn}</span>
    </Tooltip>
  ) : (
    btn
  );
}

function QueryProgressBar({ progress }: { progress: ProgressSnapshot | null }) {
  if (!progress) {
    return (
      <Text size="xs" c="dimmed">
        Running…
      </Text>
    );
  }
  const { read_rows, read_bytes, total_rows_to_read } = progress;
  const hasTotal = total_rows_to_read > 0 && total_rows_to_read >= read_rows;
  const pct = hasTotal ? (read_rows / total_rows_to_read) * 100 : 0;
  return (
    <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
      <Progress
        value={hasTotal ? pct : 100}
        animated={!hasTotal}
        striped={!hasTotal}
        size="sm"
        w={140}
      />
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {formatCount(read_rows)}
        {hasTotal
          ? ` / ${formatCount(total_rows_to_read)} (${pct.toFixed(0)}%)`
          : ""}
        {" · "}
        {formatBytes(read_bytes)}
      </Text>
    </Group>
  );
}
