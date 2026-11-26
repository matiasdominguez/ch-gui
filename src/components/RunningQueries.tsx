import {
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatBytes, formatCount } from "../lib/format";
import { notifyError } from "../lib/notify";
import {
  pollingStatusText,
  resolveRefetchInterval,
} from "../lib/pollingInterval";
import {
  canKillOthers,
  killRunningQuery,
  listRunningQueries,
} from "../lib/tauri";
import { useUserPrefs } from "../state/userPreferences";
import type { ConnectionConfigPayload, RunningQuery } from "../types";
import { ErrorBox } from "./Errors";
import { PanelStatus } from "./PanelStatus";
import { NoConnection, Tag } from "./ui";

interface Props {
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
  loadFailed?: boolean;
}

function formatElapsed(s: number): string {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function RunningQueries({ payload, connectionId, loadFailed }: Props) {
  const qc = useQueryClient();
  const [killing, setKilling] = useState<RunningQuery | null>(null);
  const [killInFlight, setKillInFlight] = useState(false);
  const pollingMs = useUserPrefs((s) => s.liveQueriesPollingMs);

  const q = useQuery({
    queryKey: ["running_queries", connectionId],
    queryFn: () => listRunningQueries(payload!),
    enabled: Boolean(payload && connectionId),
    refetchInterval: (query) => resolveRefetchInterval(pollingMs, query),
    // Stops a remount of the hidden panel from polling inside the interval.
    staleTime: resolveRefetchInterval(pollingMs, false) || 0,
    refetchIntervalInBackground: false,
  });

  // Stopping another user's query needs the KILL QUERY grant. While the check
  // is loading or after it fails, Stop still shows and the server decides.
  const killOthers = useQuery({
    queryKey: [
      "can_kill_others",
      connectionId,
      payload?.user,
      payload?.host,
      payload?.port,
    ],
    queryFn: () => canKillOthers(payload!),
    enabled: Boolean(payload && connectionId),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    setKillInFlight(false);
  }, [killing]);

  if (!payload || !connectionId) {
    return (
      <NoConnection failed={loadFailed}>
        Pick a connection to see its running queries.
      </NoConnection>
    );
  }

  const items = q.data ?? [];
  const canStop = (r: RunningQuery) =>
    r.user === payload.user || killOthers.data !== false;

  async function confirmKill() {
    if (!killing || !payload) return;
    setKillInFlight(true);
    try {
      const status = await killRunningQuery(payload, killing.query_id);
      qc.invalidateQueries({ queryKey: ["running_queries", connectionId] });
      setKilling(null);
      if (status === "cant_cancel") {
        notifyError(
          "Couldn't stop the query",
          "The server can't stop this query.",
        );
      } else {
        notifications.show(
          status === null
            ? {
                color: "gray",
                message: "No running query matched. It may have finished.",
              }
            : { color: "teal", message: "Query stopped" },
        );
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Couldn't stop the query", e.message ?? String(err));
      setKillInFlight(false);
    }
  }

  return (
    <Stack gap={4} h="100%">
      <Modal
        opened={killing !== null}
        onClose={() => (killInFlight ? undefined : setKilling(null))}
        title="Stop query?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Stop{" "}
            {killing?.user === payload.user ? (
              "your query"
            ) : (
              <>
                <b>{killing?.user}</b>'s query
              </>
            )}
            , running for{" "}
            <b>{killing ? formatElapsed(killing.elapsed_s) : ""}</b>?
          </Text>
          <Text
            size="xs"
            lineClamp={6}
            className="chg-code"
            style={{
              fontFamily: "var(--mantine-font-family-monospace)",
              whiteSpace: "pre-wrap",
            }}
          >
            {killing?.query}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => setKilling(null)}
              disabled={killInFlight}
            >
              Cancel
            </Button>
            <Button color="red" onClick={confirmKill} loading={killInFlight}>
              Stop query
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Box pt={4} px="xs">
        <PanelStatus
          testId="live-queries-status"
          status={pollingStatusText(pollingMs, q.error)}
          queryKeys={[["running_queries", connectionId]]}
        />
      </Box>
      <ScrollArea flex={1} px="xs">
        {q.isError ? (
          <ErrorBox
            message={String((q.error as Error).message ?? q.error)}
            onRetry={() =>
              qc.resetQueries({ queryKey: ["running_queries", connectionId] })
            }
          />
        ) : q.isLoading && !q.data ? (
          <Text size="xs" c="dimmed" px="xs" py="md">
            Loading…
          </Text>
        ) : items.length === 0 ? (
          <Text size="xs" c="dimmed" px="xs" py="md">
            No running queries.
          </Text>
        ) : (
          items.map((r) => (
            <Group
              key={r.query_id}
              gap={4}
              wrap="nowrap"
              align="flex-start"
              className="chg-list-row chg-row-with-more"
              style={{ paddingRight: 4 }}
            >
              <Stack gap={3} flex={1} style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" fw={600}>
                    {r.user || "—"}
                  </Text>
                  {r.user === payload.user && <Tag tone="accent">yours</Tag>}
                  <Text
                    size="xs"
                    className="chg-time"
                    style={{ marginLeft: "auto" }}
                  >
                    {formatElapsed(r.elapsed_s)}
                  </Text>
                </Group>
                <Text size="xs" lineClamp={2} className="chg-mono chg-sql">
                  {r.query}
                </Text>
                <div className="chg-meta">
                  <span>{formatCount(r.read_rows)} rows</span>
                  <span>{formatBytes(r.memory_usage)}</span>
                </div>
              </Stack>
              {canStop(r) && (
                <Button
                  variant="default"
                  size="compact-xs"
                  onClick={() => setKilling(r)}
                >
                  Stop
                </Button>
              )}
            </Group>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
}
