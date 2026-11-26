import { Box, Group, SegmentedControl, Tooltip } from "@mantine/core";

import type { MonitorView } from "../lib/activeTab";
import type { ConnectionConfigPayload } from "../types";

import { Errors } from "./Errors";
import { Kafka } from "./Kafka";
import { RunningQueries } from "./RunningQueries";
import { Count } from "./ui";

const LABELS: Record<MonitorView, string> = {
  activity: "Activity",
  kafka: "Kafka",
  running: "Live",
};

export function AlertBadges({
  count,
  countLabel,
  health,
}: {
  count: number;
  countLabel: string;
  health?: boolean;
}) {
  if (count === 0 && !health) return null;
  return (
    <Group gap={4} wrap="nowrap">
      {count > 0 && (
        <Tooltip label={countLabel}>
          <span>
            <Count tone="red">{count}</Count>
          </span>
        </Tooltip>
      )}
      {health && (
        <Tooltip label="Pending mutations or replica queue entries">
          <span
            role="img"
            aria-label="Cluster health alert"
            className="chg-dot"
            data-tone="yellow"
          />
        </Tooltip>
      )}
    </Group>
  );
}

export function monitorDotStale(a: {
  activityShown: boolean;
  activityFailed: boolean;
  activityAlerting: boolean;
  kafkaFailed: boolean;
  kafkaStuck: number;
}): boolean {
  const activity = a.activityShown && a.activityFailed && a.activityAlerting;
  const kafka = a.kafkaFailed && a.kafkaStuck > 0;
  return activity || kafka;
}

export function MonitorDot({
  newFailures,
  stuckKafka,
  health,
  stale = false,
}: {
  newFailures: number;
  stuckKafka: number;
  health: boolean;
  stale?: boolean;
}) {
  const failures = newFailures + stuckKafka;
  if (failures === 0 && !health) return null;
  const parts = [
    newFailures > 0 && `${newFailures} new in the last 5 minutes`,
    stuckKafka > 0 &&
      `${stuckKafka} stuck Kafka ${stuckKafka === 1 ? "table" : "tables"}`,
  ].filter(Boolean);
  const counts =
    parts.length > 0
      ? parts.join("; ")
      : "Pending mutations or replica queue entries";
  const label = stale ? `${counts} (as of the last successful check)` : counts;
  return (
    <Tooltip label={label}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        className="chg-dot"
        data-tone={failures > 0 ? "red" : "yellow"}
        style={{ opacity: stale ? 0.4 : 1 }}
      />
    </Tooltip>
  );
}

export function MonitorPane({
  views,
  view,
  onViewChange,
  activityAlerts,
  healthAlert,
  kafkaStuck,
  payload,
  connectionId,
  loadFailed,
}: {
  views: MonitorView[];
  view: MonitorView | null;
  onViewChange: (v: MonitorView) => void;
  activityAlerts: number;
  healthAlert: boolean;
  kafkaStuck: number;
  payload: ConnectionConfigPayload | null;
  connectionId: string | null;
  loadFailed?: boolean;
}) {
  return (
    <Box display="flex" h="100%" style={{ flexDirection: "column", gap: 8 }}>
      {views.length > 1 && (
        <Box px="xs">
          <SegmentedControl
            className="chg-monitor-switch"
            size="xs"
            fullWidth
            value={view ?? undefined}
            onChange={(v) => onViewChange(v as MonitorView)}
            aria-label="Monitor panel"
            data={views.map((v) => ({
              value: v,
              label: (
                <Group gap={4} wrap="nowrap" justify="center">
                  {LABELS[v]}
                  {v === "activity" && (
                    <AlertBadges
                      count={activityAlerts}
                      countLabel={`${activityAlerts} new in the last 5 minutes`}
                      health={healthAlert}
                    />
                  )}
                  {v === "kafka" && (
                    <AlertBadges
                      count={kafkaStuck}
                      countLabel={`${kafkaStuck} stuck`}
                    />
                  )}
                </Group>
              ),
            }))}
          />
        </Box>
      )}
      <Box flex={1} mih={0}>
        {view === "activity" && (
          <Errors
            payload={payload}
            connectionId={connectionId}
            loadFailed={loadFailed}
          />
        )}
        {view === "kafka" && (
          <Kafka
            payload={payload}
            connectionId={connectionId}
            loadFailed={loadFailed}
          />
        )}
        {view === "running" && (
          <RunningQueries
            payload={payload}
            connectionId={connectionId}
            loadFailed={loadFailed}
          />
        )}
      </Box>
    </Box>
  );
}
