import {
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { groupByView, type MvGroup } from "../lib/errorsFormat";
import { truncate } from "../lib/format";
import { mvFailureReport, serverErrorReport } from "../lib/llmReport";
import {
  effectivePollingInterval,
  isLastingError,
  pollingStatusText,
  resolvePulseInterval,
  resolveRefetchInterval,
} from "../lib/pollingInterval";
import {
  errorPulse,
  listMvFailures,
  listPendingMutations,
  listReplicaQueue,
  listServerErrors,
} from "../lib/tauri";
import { useUserPrefs } from "../state/userPreferences";
import type {
  ConnectionConfigPayload,
  MvFailure,
  PendingMutation,
  ReplicaQueueEntry,
  ServerError,
} from "../types";
import { CopyForLlmButton } from "./CopyForLlmButton";
import { InsertViewer } from "./InsertViewer";
import { PanelStatus } from "./PanelStatus";
import { TimeAgo } from "./TimeAgo";
import { Count, NoConnection, SectionLabel, Tag } from "./ui";

interface Props {
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
  loadFailed?: boolean;
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Stack gap={4} px="xs">
      <Group gap="xs" justify="space-between">
        <Text size="xs" c="red" fw={500}>
          Failed to load
        </Text>
        {onRetry && (
          <Button size="compact-xs" variant="subtle" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Group>
      <Code
        block
        className="chg-code"
        style={{
          maxHeight: 120,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message || "(no error message)"}
      </Code>
    </Stack>
  );
}

interface ServerErrorGroup {
  key: string;
  error: ServerError;
}

export function groupErrors(rows: ServerError[]): ServerErrorGroup[] {
  // clusterAllReplicas(system.errors) returns one row per replica for each
  // (name, code). Merge them so each error gets one row and React keys stay
  // unique.
  const byKey = new Map<string, ServerError>();
  for (const r of rows) {
    const key = `${r.name}:${r.code}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r });
      continue;
    }
    existing.count += r.count;
    existing.remote = existing.remote || r.remote;
    existing.recent = existing.recent || r.recent;
    if (r.last_error_time > existing.last_error_time) {
      existing.last_error_time = r.last_error_time;
      existing.last_error_message = r.last_error_message;
    }
  }
  return Array.from(byKey.entries())
    .sort((a, b) => b[1].last_error_time.localeCompare(a[1].last_error_time))
    .map(([key, error]) => ({ key, error }));
}

export function Errors({ payload, connectionId, loadFailed }: Props) {
  const enabled = Boolean(payload && connectionId);
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const qc = useQueryClient();

  const errors = useQuery({
    queryKey: ["server_errors", connectionId],
    queryFn: () => listServerErrors(payload!),
    enabled,
    refetchInterval: (q) => resolveRefetchInterval(pollingMs, q),
    // Stops a remount of the hidden panel from polling inside the interval.
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const mv = useQuery({
    queryKey: ["mv_failures", connectionId, null],
    queryFn: () => listMvFailures(payload!),
    enabled,
    refetchInterval: (q) => resolveRefetchInterval(pollingMs, q),
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
    retry: false,
  });

  if (!enabled) {
    return (
      <NoConnection failed={loadFailed}>
        Pick a connection to see cluster errors.
      </NoConnection>
    );
  }

  const errorItems = groupErrors(errors.data ?? []);
  const mvResult = mv.data;
  const mvGroups =
    mvResult?.status === "enabled" ? groupByView(mvResult.rows) : [];

  // Prefer a stopped poll's error, so the header does not announce a retry that
  // one of the queries will not make.
  const headerError = isLastingError(mv.error)
    ? mv.error
    : (errors.error ?? mv.error);
  return (
    <ScrollArea h="100%" px="xs">
      <Stack gap="md" py={4}>
        <PanelStatus
          testId="server-activity-status"
          status={pollingStatusText(pollingMs, headerError)}
          queryKeys={[
            ["server_errors", connectionId],
            ["mv_failures", connectionId],
            ["pending_mutations", connectionId],
            ["replica_queue", connectionId],
          ]}
        />

        <SectionHeader
          title="Materialized view failures"
          subtitle="system.query_views_log · last 7 days"
          count={mvResult?.status === "enabled" ? mvGroups.length : null}
        />
        {mv.isLoading && !mv.data ? (
          <Text size="xs" c="dimmed" px="xs">
            Loading…
          </Text>
        ) : mv.isError ? (
          <ErrorBox
            message={String((mv.error as Error).message ?? mv.error)}
            onRetry={() =>
              qc.resetQueries({ queryKey: ["mv_failures", connectionId] })
            }
          />
        ) : mvResult?.status === "disabled" ? (
          <Text size="xs" c="dimmed" px="xs">
            <code>query_views_log</code> is off on this cluster. Ask an admin to
            turn it on to see materialized view failures here.
          </Text>
        ) : mvGroups.length === 0 ? (
          <Text size="xs" c="dimmed" px="xs">
            No MV failures in the last 7 days.
          </Text>
        ) : (
          <Stack gap={0}>
            {mvGroups.map((g) => (
              <MvGroupRow key={g.view_name} g={g} conn={payload} />
            ))}
          </Stack>
        )}

        <Divider className="chg-divider" />

        <ServerErrorsSection
          conn={payload}
          isLoading={errors.isLoading && !errors.data}
          isError={errors.isError}
          errorMessage={String(
            (errors.error as Error)?.message ?? errors.error ?? "",
          )}
          onRetry={() =>
            qc.resetQueries({ queryKey: ["server_errors", connectionId] })
          }
          items={errorItems}
        />

        <Divider className="chg-divider" />

        <PendingMutationsSection
          payload={payload}
          connectionId={connectionId}
        />

        <Divider className="chg-divider" />

        <ReplicaQueueSection payload={payload} connectionId={connectionId} />
      </Stack>
    </ScrollArea>
  );
}

function ServerErrorsSection({
  conn,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  items,
}: {
  conn: ConnectionConfigPayload | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  items: ServerErrorGroup[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="xs">
      <UnstyledButton
        onClick={() => setOpen((v) => !v)}
        className="chg-section-toggle"
        aria-expanded={open}
      >
        <SectionLabel
          title="Server errors"
          count={items.length}
          subtitle="system.errors · last 7 days"
          action={
            <span className="chg-disclosure">
              {open ? "Hide" : "Show"}
              <CaretRightIcon
                className="chg-tree-caret"
                data-open={open || undefined}
                weight="bold"
              />
            </span>
          }
        />
      </UnstyledButton>
      <Collapse in={open}>
        {isLoading ? (
          <Text size="xs" c="dimmed" px="xs">
            Loading…
          </Text>
        ) : isError ? (
          <ErrorBox message={errorMessage} onRetry={onRetry} />
        ) : items.length === 0 ? (
          <Text size="xs" c="dimmed" px="xs">
            No errors recorded.
          </Text>
        ) : (
          <Stack gap={0}>
            {items.map((g) => (
              <ServerErrorRow key={g.key} e={g.error} conn={conn} />
            ))}
          </Stack>
        )}
      </Collapse>
    </Stack>
  );
}

function SectionHeader({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle: string;
  count: number | null;
}) {
  return <SectionLabel title={title} count={count} subtitle={subtitle} />;
}

function NewBadge() {
  return (
    <Tooltip label="In the Activity count: new in the last 5 minutes">
      <span>
        <Tag tone="red">new</Tag>
      </span>
    </Tooltip>
  );
}

function ServerErrorRow({
  e,
  conn,
}: {
  e: ServerError;
  conn: ConnectionConfigPayload | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={4} className="chg-list-item" data-open={open || undefined}>
      <UnstyledButton
        onClick={() => setOpen((v) => !v)}
        className="chg-list-row"
        aria-expanded={open}
      >
        <Stack gap={2}>
          <Group gap={6} wrap="nowrap">
            <Count tone="red">{e.count}</Count>
            <Text size="xs" fw={500} className="chg-mono" truncate>
              {e.name}
            </Text>
            <Text size="xs" c="dimmed">
              #{e.code}
            </Text>
            {e.remote && <Tag>remote</Tag>}
            {e.recent && <NewBadge />}
            <Text
              size="xs"
              c="dimmed"
              className="chg-time"
              style={{ marginLeft: "auto" }}
            >
              <TimeAgo value={e.last_error_time} />
            </Text>
          </Group>
          {!open && e.last_error_message && (
            <Text
              size="xs"
              c="dimmed"
              lineClamp={1}
              className="chg-mono chg-excerpt"
            >
              {truncate(e.last_error_message, 180)}
            </Text>
          )}
        </Stack>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap={6} className="chg-list-detail">
          <Code
            block
            className="chg-code"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {e.last_error_message || "(no message)"}
          </Code>
          {conn && (
            <Group justify="flex-end" className="chg-copy-row">
              <CopyForLlmButton
                conn={conn}
                report={(v) => serverErrorReport(e, v, conn)}
                tooltip="Copies the error, the server version, and a query_log lookup"
                size="compact-xs"
              />
            </Group>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}

function MvGroupRow({
  g,
  conn,
}: {
  g: MvGroup;
  conn: ConnectionConfigPayload | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={0} className="chg-list-item" data-open={open || undefined}>
      <UnstyledButton
        onClick={() => setOpen((v) => !v)}
        className="chg-list-row"
        aria-expanded={open}
      >
        <Stack gap={2}>
          <Group gap={6} wrap="nowrap">
            <Count tone="red">{g.count}</Count>
            <Text
              size="xs"
              fw={500}
              truncate
              className="chg-mono"
              style={{ flex: 1, minWidth: 0 }}
            >
              {g.view_name}
            </Text>
            {g.recent && <NewBadge />}
            <Text
              size="xs"
              c="dimmed"
              className="chg-time"
              style={{ whiteSpace: "nowrap" }}
            >
              <TimeAgo value={g.latest.event_time} />
            </Text>
          </Group>
          <Text
            size="xs"
            c="dimmed"
            lineClamp={1}
            className="chg-mono chg-excerpt"
          >
            {truncate(g.latest.exception, 180)}
          </Text>
        </Stack>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap={10} className="chg-list-detail">
          {g.all.map((f, i) => (
            <MvFailureDetail
              key={`${f.event_time}:${f.initial_query_id}:${i}`}
              f={f}
              conn={conn}
            />
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}

function MvFailureDetail({
  f,
  conn,
}: {
  f: MvFailure;
  conn: ConnectionConfigPayload | null;
}) {
  const hasInsert = f.initial_query.trim().length > 0;
  const [viewing, setViewing] = useState(false);
  return (
    <Stack gap={6} className="chg-failure">
      <Group gap={6} wrap="wrap">
        <Text size="xs" c="dimmed" className="chg-time">
          <TimeAgo value={f.event_time} />
        </Text>
        <Tag mono>{f.status}</Tag>
        {hasInsert ? (
          <Button
            size="compact-xs"
            variant="subtle"
            className="chg-inline-action"
            onClick={() => setViewing(true)}
          >
            View INSERT
          </Button>
        ) : (
          <Tag>no query_log row</Tag>
        )}
        <Text
          size="xs"
          c="dimmed"
          className="chg-mono"
          style={{ marginLeft: "auto" }}
        >
          {truncate(f.initial_query_id, 18)}
        </Text>
      </Group>
      <Code
        block
        className="chg-code"
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {f.exception || "(no exception text)"}
      </Code>
      {conn && (
        <Group justify="flex-end" className="chg-copy-row">
          <CopyForLlmButton
            conn={conn}
            report={(v) => mvFailureReport(f, v, conn)}
            tooltip="Copies the exception, the INSERT, the server version, and lookups for the view"
            size="compact-xs"
          />
        </Group>
      )}
      {hasInsert && (
        <InsertViewer
          viewName={f.view_name}
          sql={f.initial_query}
          opened={viewing}
          onClose={() => setViewing(false)}
        />
      )}
    </Stack>
  );
}

function PendingMutationsSection({
  payload,
  connectionId,
}: {
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
}) {
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const q = useQuery({
    queryKey: ["pending_mutations", connectionId],
    queryFn: () => listPendingMutations(payload!),
    enabled: Boolean(payload && connectionId),
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const result = q.data;
  const rows = result?.status === "enabled" ? result.rows : [];

  return (
    <>
      <SectionHeader
        title="Pending mutations"
        subtitle="system.mutations · is_done = 0"
        count={result?.status === "enabled" ? rows.length : null}
      />
      {q.isLoading && !q.data ? (
        <Text size="xs" c="dimmed" px="xs">
          Loading…
        </Text>
      ) : q.isError ? (
        <ErrorBox
          message={String((q.error as Error).message ?? q.error)}
          onRetry={() => q.refetch()}
        />
      ) : result?.status === "disabled" ? (
        <Text size="xs" c="dimmed" px="xs">
          This connection can't read <code>system.mutations</code>. Ask an admin
          for the grant to see pending mutations here.
        </Text>
      ) : rows.length === 0 ? (
        <Text size="xs" c="dimmed" px="xs">
          No pending mutations.
        </Text>
      ) : (
        <Stack gap={0}>
          {rows.map((m) => (
            <PendingMutationRow
              key={`${m.database}.${m.table}:${m.mutation_id}`}
              m={m}
            />
          ))}
        </Stack>
      )}
    </>
  );
}

function PendingMutationRow({ m }: { m: PendingMutation }) {
  const [open, setOpen] = useState(false);
  const failing = m.latest_fail_reason.trim().length > 0;
  return (
    <UnstyledButton
      onClick={() => setOpen((v) => !v)}
      className="chg-list-row"
      aria-expanded={open}
    >
      <Stack gap={2}>
        <Group gap={6} wrap="wrap">
          {failing ? (
            <Tag tone="red">failing</Tag>
          ) : (
            <Tag tone="yellow">{m.parts_to_do} parts</Tag>
          )}
          <Text
            size="xs"
            fw={500}
            className="chg-mono"
            style={{ flex: 1, minWidth: 0 }}
            truncate
          >
            {m.database}.{m.table}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            className="chg-time"
            style={{ whiteSpace: "nowrap" }}
          >
            <TimeAgo value={m.create_time} />
          </Text>
        </Group>
        <Text
          size="xs"
          c="dimmed"
          lineClamp={1}
          className="chg-mono chg-excerpt"
        >
          {truncate(m.command, 180)}
        </Text>
        <Collapse in={open}>
          <Stack gap={4}>
            <Code
              block
              className="chg-code"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.command || "(no command)"}
            </Code>
            {failing && (
              <Code
                block
                className="chg-code"
                data-tone="red"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.latest_fail_reason}
              </Code>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </UnstyledButton>
  );
}

function ReplicaQueueSection({
  payload,
  connectionId,
}: {
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
}) {
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const q = useQuery({
    queryKey: ["replica_queue", connectionId],
    queryFn: () => listReplicaQueue(payload!),
    enabled: Boolean(payload && connectionId),
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const result = q.data;
  const rows = result?.status === "enabled" ? result.rows : [];

  return (
    <>
      <SectionHeader
        title="Replica queue"
        subtitle="system.replicas · queue_size > 0 or session expired"
        count={result?.status === "enabled" ? rows.length : null}
      />
      {q.isLoading && !q.data ? (
        <Text size="xs" c="dimmed" px="xs">
          Loading…
        </Text>
      ) : q.isError ? (
        <ErrorBox
          message={String((q.error as Error).message ?? q.error)}
          onRetry={() => q.refetch()}
        />
      ) : result?.status === "disabled" ? (
        <Text size="xs" c="dimmed" px="xs">
          This connection can't read <code>system.replicas</code>.
        </Text>
      ) : rows.length === 0 ? (
        <Text size="xs" c="dimmed" px="xs">
          Replica queues are empty.
        </Text>
      ) : (
        <Stack gap={0}>
          {rows.map((r) => (
            <ReplicaQueueRow key={`${r.database}.${r.table}`} r={r} />
          ))}
        </Stack>
      )}
    </>
  );
}

function ReplicaQueueRow({ r }: { r: ReplicaQueueEntry }) {
  return (
    <Group gap={6} wrap="wrap" className="chg-list-row">
      <Count tone="yellow">{r.queue_size}</Count>
      <Text
        size="xs"
        fw={500}
        className="chg-mono"
        style={{ flex: 1, minWidth: 0 }}
        truncate
      >
        {r.database}.{r.table}
      </Text>
      {r.absolute_delay > 0 && <Tag>delay {r.absolute_delay}s</Tag>}
      {r.is_session_expired && <Tag tone="red">session expired</Tag>}
    </Group>
  );
}

export function useErrorPulse(
  payload: ConnectionConfigPayload | null,
  connectionId: string | null,
) {
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const hidden = useUserPrefs((s) => s.hideServerActivityTab);
  const effective = effectivePollingInterval(pollingMs, hidden);
  return useQuery({
    queryKey: ["error_pulse", connectionId],
    queryFn: () => errorPulse(payload!),
    enabled: Boolean(payload && connectionId) && effective !== "off",
    refetchInterval: (q) => resolvePulseInterval(effective, q),
    refetchIntervalInBackground: false,
    retry: false,
  });
}
