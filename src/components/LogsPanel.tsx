import { Box, Center, ScrollArea, Text } from "@mantine/core";
import { useEffect, useRef } from "react";

import { formatLocalClock } from "../lib/errorsFormat";
import type { LogEntry, LogLevel } from "../types";

interface Props {
  logs: LogEntry[];
  level: LogLevel;
  unavailable: boolean;
  running: boolean;
  ran: boolean;
}

const PRIORITY_LABELS: Record<number, { name: string; color: string }> = {
  1: { name: "FATAL", color: "var(--mantine-color-red-7)" },
  2: { name: "CRIT", color: "var(--mantine-color-red-6)" },
  3: { name: "ERROR", color: "var(--mantine-color-red-5)" },
  4: { name: "WARN", color: "var(--mantine-color-yellow-6)" },
  5: { name: "NOTICE", color: "var(--mantine-color-blue-5)" },
  6: { name: "INFO", color: "var(--mantine-color-gray-6)" },
  7: { name: "DEBUG", color: "var(--mantine-color-gray-5)" },
  8: { name: "TRACE", color: "var(--mantine-color-gray-5)" },
};

function emptyMessage({ level, unavailable, running, ran }: Props): string {
  if (level === "none") return "Server logs are off.";
  if (unavailable) return "Server logs aren't available for this user.";
  if (running) return `Waiting for ${level} logs…`;
  if (ran) return "No logs for this query.";
  return `Run a query to see its ${level} logs.`;
}

export function LogsPanel(props: Props) {
  const { logs } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  // Always scrolls to the newest line, even if the user scrolled up.
  useEffect(() => {
    const v = viewportRef.current;
    if (v) v.scrollTop = v.scrollHeight;
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <Center h="100%">
        <Text c="dimmed" size="xs">
          {emptyMessage(props)}
        </Text>
      </Center>
    );
  }

  return (
    <ScrollArea
      h="100%"
      viewportRef={viewportRef}
      type="auto"
      scrollbarSize={8}
    >
      <Box
        p={6}
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        {logs.map((entry, i) => {
          const meta = PRIORITY_LABELS[entry.priority] ?? {
            name: `P${entry.priority}`,
            color: "var(--mantine-color-gray-5)",
          };
          const ts = entry.event_time ? formatLocalClock(entry.event_time) : "";
          return (
            <div
              key={i}
              style={{ display: "flex", gap: 8, whiteSpace: "pre-wrap" }}
            >
              <span style={{ color: "var(--mantine-color-dimmed)" }}>{ts}</span>
              <span style={{ color: meta.color, minWidth: 48 }}>
                {meta.name}
              </span>
              <span
                style={{ color: "var(--mantine-color-dimmed)", minWidth: 80 }}
              >
                {entry.source}
              </span>
              <span style={{ flex: 1 }}>{entry.text}</span>
            </div>
          );
        })}
      </Box>
    </ScrollArea>
  );
}
