import {
  Code,
  Collapse,
  Group,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatCount, truncate } from "../lib/format";
import {
  pollingStatusText,
  resolvePulseInterval,
  resolveRefetchInterval,
} from "../lib/pollingInterval";
import { kafkaPulse, listKafkaTables } from "../lib/tauri";
import { useUserPrefs } from "../state/userPreferences";
import type { ConnectionConfigPayload, KafkaTableSummary } from "../types";

import { ErrorBox } from "./Errors";
import { TableDetailsDrawer } from "./TableDetailsDrawer";
import { PanelStatus } from "./PanelStatus";
import { TimeAgo } from "./TimeAgo";
import { Count, Dot, NoConnection, SectionLabel, Tag } from "./ui";

interface Props {
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
  loadFailed?: boolean;
}

export function Kafka({ payload, connectionId, loadFailed }: Props) {
  const enabled = Boolean(payload && connectionId);
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const [inspecting, setInspecting] = useState<{
    database: string;
    table: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["kafka_tables", connectionId],
    queryFn: () => listKafkaTables(payload!),
    enabled,
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    // Stops a remount of the hidden panel from polling inside the interval.
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
    retry: false,
  });

  if (!enabled) {
    return (
      <NoConnection failed={loadFailed}>
        Pick a connection to see Kafka consumer health.
      </NoConnection>
    );
  }

  const result = q.data;
  const rows = result?.status === "enabled" ? result.rows : [];
  const stuckCount = rows.filter((r) => r.is_stuck).length;

  return (
    <>
      <ScrollArea h="100%" px="xs">
        <Stack gap="md" py={4}>
          <PanelStatus
            status={pollingStatusText(pollingMs, q.error)}
            queryKeys={[["kafka_tables", connectionId]]}
          />

          <SectionLabel
            title="Kafka tables"
            action={
              stuckCount > 0 ? (
                <Tag tone="red">{stuckCount} stuck</Tag>
              ) : undefined
            }
            subtitle={
              <>
                system.kafka_consumers · engine LIKE 'Kafka%'
                <br />
                <Tooltip
                  label="ClickHouse records only consumer state, not partition lag on the broker."
                  multiline
                  w={260}
                  withArrow
                >
                  <span style={{ cursor: "help" }}>
                    (no broker-side lag data)
                  </span>
                </Tooltip>
              </>
            }
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
              <code>system.kafka_consumers</code> isn't available here. It needs
              ClickHouse 23.5 or later, and a grant for this user.
            </Text>
          ) : rows.length === 0 ? (
            <Text size="xs" c="dimmed" px="xs">
              This cluster has no Kafka tables.
            </Text>
          ) : (
            <Stack gap={0}>
              {rows.map((r) => (
                <KafkaTableRow
                  key={`${r.database}.${r.table}`}
                  r={r}
                  onOpen={() =>
                    setInspecting({ database: r.database, table: r.table })
                  }
                />
              ))}
            </Stack>
          )}
        </Stack>
      </ScrollArea>
      <TableDetailsDrawer
        opened={inspecting !== null}
        onClose={() => setInspecting(null)}
        payload={payload}
        database={inspecting?.database ?? null}
        table={inspecting?.table ?? null}
      />
    </>
  );
}

function KafkaTableRow({
  r,
  onOpen,
}: {
  r: KafkaTableSummary;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pollLabel =
    r.last_poll_time !== null ? (
      <TimeAgo value={r.last_poll_time} />
    ) : (
      "never polled"
    );
  return (
    <Stack
      gap={4}
      className="chg-list-item chg-kafka-row"
      data-stuck={r.is_stuck || undefined}
    >
      <Group gap={6} wrap="nowrap">
        <Dot tone={r.is_stuck ? "red" : "green"} />
        <UnstyledButton
          onClick={onOpen}
          style={{ flex: 1, minWidth: 0, textAlign: "left" }}
        >
          <Text size="xs" fw={500} truncate className="chg-mono chg-link">
            {r.database}.{r.table}
          </Text>
        </UnstyledButton>
        {r.is_stuck && <Tag tone="red">stuck</Tag>}
        <Text
          size="xs"
          c="dimmed"
          className="chg-time"
          style={{ whiteSpace: "nowrap" }}
        >
          {pollLabel}
        </Text>
      </Group>
      <Group gap={6} wrap="wrap" className="chg-kafka-meta">
        <Text size="xs" c="dimmed">
          <Count>{r.num_consumers}</Count> consumer
          {r.num_consumers === 1 ? "" : "s"}
        </Text>
        <Text size="xs" c="dimmed">
          · <span className="chg-num">{formatCount(r.messages_read)}</span> msgs
        </Text>
        {r.num_rebalances > 0 && (
          <Text size="xs" c="dimmed">
            · {formatCount(r.num_rebalances)} rebalance
            {r.num_rebalances === 1 ? "" : "s"}
          </Text>
        )}
        <UnstyledButton
          onClick={() => setOpen((v) => !v)}
          style={{ marginLeft: "auto" }}
          aria-expanded={open}
        >
          <span className="chg-disclosure">
            {open ? "Hide engine" : "Show engine"}
            <CaretRightIcon
              className="chg-tree-caret"
              data-open={open || undefined}
              weight="bold"
            />
          </span>
        </UnstyledButton>
      </Group>
      {!open && r.last_exception && (
        <Text
          size="xs"
          lineClamp={2}
          className="chg-mono chg-excerpt"
          data-tone="red"
        >
          {truncate(r.last_exception, 180)}
        </Text>
      )}
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
            {r.engine_full || "(no engine text)"}
          </Code>
          {r.last_exception && (
            <Code
              block
              className="chg-code"
              data-tone="red"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {r.last_exception}
            </Code>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}

export function useKafkaPulse(
  payload: ConnectionConfigPayload | null,
  connectionId: string | null,
) {
  const pollingMs = useUserPrefs((s) => s.serverActivityPollingMs);
  return useQuery({
    queryKey: ["kafka_pulse", connectionId],
    queryFn: () => kafkaPulse(payload!),
    enabled: Boolean(payload && connectionId),
    refetchInterval: (q) => resolvePulseInterval(pollingMs, q),
    refetchIntervalInBackground: false,
    retry: false,
  });
}
