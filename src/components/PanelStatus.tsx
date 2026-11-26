import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  useIsFetching,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function updatedAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const matches = (key: QueryKey, prefixes: QueryKey[]) =>
  prefixes.some((p) => p.every((part, i) => key[i] === part));

export function PanelStatus({
  queryKeys,
  status,
  testId,
}: {
  queryKeys: QueryKey[];
  status: string;
  testId?: string;
}) {
  const qc = useQueryClient();
  const fetching =
    useIsFetching({ predicate: (q) => matches(q.queryKey, queryKeys) }) > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const updatedAt = Math.max(
    0,
    ...qc
      .getQueryCache()
      .findAll({ predicate: (q) => matches(q.queryKey, queryKeys) })
      .map((q) => q.state.dataUpdatedAt),
  );

  return (
    <Group
      justify="space-between"
      px="xs"
      wrap="nowrap"
      gap="xs"
      className="chg-panel-status"
    >
      <Text size="xs" c="dimmed" data-testid={testId}>
        {status}
        {updatedAt > 0 && ` · Updated ${updatedAgo(updatedAt, now)}`}
      </Text>
      <Tooltip label="Refresh">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Refresh"
          loading={fetching}
          onClick={() => {
            for (const queryKey of queryKeys) {
              void qc.invalidateQueries({ queryKey });
            }
          }}
        >
          <ArrowClockwiseIcon />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
