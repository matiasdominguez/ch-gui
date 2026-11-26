import { Box, Center, Group, Loader, Stack, Text } from "@mantine/core";

import { formatBytes, formatCount } from "../lib/format";
import type { ProfileSnapshot } from "../types";

import { SectionLabel, Tag } from "./ui";

interface Props {
  snapshot: ProfileSnapshot | null;
  loading: boolean;
  error: string | null;
}

function formatMs(n: number | null): string {
  if (n == null) return "—";
  if (n >= 60_000) return `${(n / 60_000).toFixed(2)} min`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${n} ms`;
}

function formatMicros(n: number | null): string {
  if (n == null) return "—";
  return formatMs(Math.round(n / 1000));
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
}
function Stat({ label, value, hint }: StatProps) {
  return (
    <Stack gap={0} mr="lg" className="chg-stat-block">
      <Text className="chg-stat-label">{label}</Text>
      <Group gap={4} align="baseline">
        <Text className="chg-stat-value">{value}</Text>
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
function Section({ title, children }: SectionProps) {
  return (
    <Stack gap={6}>
      <SectionLabel title={title} />
      <Group gap="md" wrap="wrap">
        {children}
      </Group>
    </Stack>
  );
}

export function QueryProfile({ snapshot, loading, error }: Props) {
  if (!snapshot && loading) {
    return (
      <Center h="100%" p="md">
        <Stack gap="xs" align="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Waiting for <code>system.query_log</code> to flush…
          </Text>
        </Stack>
      </Center>
    );
  }
  if (!snapshot && error) {
    return (
      <Center h="100%" p="md">
        <Stack gap={4} align="center" maw={420}>
          <Text size="sm" c="dimmed">
            Couldn't read <code>system.query_log</code>. The Profile tab needs
            the current user to have read access to it.
          </Text>
          <Text
            size="xs"
            c="dimmed"
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          >
            {error}
          </Text>
        </Stack>
      </Center>
    );
  }
  if (!snapshot) {
    return (
      <Center h="100%" p="md">
        <Text size="sm" c="dimmed">
          No profile yet. Run a query. Its profile appears after{" "}
          <code>system.query_log</code> flushes.
        </Text>
      </Center>
    );
  }

  const compressionRatio =
    snapshot.compressed_read_bytes != null &&
    snapshot.compressed_read_bytes > 0 &&
    snapshot.read_bytes != null
      ? (snapshot.read_bytes / snapshot.compressed_read_bytes).toFixed(2) + "×"
      : null;

  return (
    <Box
      p="md"
      className="chg-profile"
      style={{ overflow: "auto", height: "100%" }}
    >
      <Stack gap="lg">
        <Section title="Overview">
          <Stat label="Duration" value={formatMs(snapshot.query_duration_ms)} />
          <Stat
            label="Peak memory"
            value={formatBytes(snapshot.memory_usage)}
          />
          <Stat label="Threads" value={formatCount(snapshot.thread_count)} />
          <Stat
            label="Rows read"
            value={formatCount(snapshot.read_rows)}
            hint={
              snapshot.read_bytes != null
                ? `· ${formatBytes(snapshot.read_bytes)}`
                : undefined
            }
          />
          <Stat
            label="Rows returned"
            value={formatCount(snapshot.result_rows)}
            hint={
              snapshot.result_bytes != null
                ? `· ${formatBytes(snapshot.result_bytes)}`
                : undefined
            }
          />
          {(snapshot.written_rows ?? 0) > 0 && (
            <Stat
              label="Rows written"
              value={formatCount(snapshot.written_rows)}
              hint={
                snapshot.written_bytes != null
                  ? `· ${formatBytes(snapshot.written_bytes)}`
                  : undefined
              }
            />
          )}
        </Section>

        <Section title="Data read">
          <Stat
            label="Selected parts"
            value={formatCount(snapshot.selected_parts)}
          />
          <Stat
            label="Selected ranges"
            value={formatCount(snapshot.selected_ranges)}
          />
          <Stat
            label="Selected marks"
            value={formatCount(snapshot.selected_marks)}
          />
          <Stat
            label="Selected rows"
            value={formatCount(snapshot.selected_rows)}
          />
          <Stat
            label="Compressed bytes"
            value={formatBytes(snapshot.compressed_read_bytes)}
            hint={
              compressionRatio
                ? `${compressionRatio} compression ratio`
                : undefined
            }
          />
          <Stat
            label="Mark cache hits"
            value={formatCount(snapshot.mark_cache_hits)}
          />
          <Stat
            label="Uncompressed cache hits"
            value={formatCount(snapshot.uncompressed_cache_hits)}
          />
          {snapshot.network_send_us != null && snapshot.network_send_us > 0 && (
            <Stat
              label="Network send"
              value={formatMicros(snapshot.network_send_us)}
            />
          )}
        </Section>

        {(snapshot.used_aggregate_functions.length > 0 ||
          snapshot.used_dictionaries.length > 0) && (
          <Section title="Functions">
            {snapshot.used_aggregate_functions.length > 0 && (
              <Stack gap={2}>
                <Text size="xs" c="dimmed" fw={500}>
                  Aggregate functions
                </Text>
                <Group gap={4} wrap="wrap">
                  {snapshot.used_aggregate_functions.map((f) => (
                    <Tag key={f} mono>
                      {f}
                    </Tag>
                  ))}
                </Group>
              </Stack>
            )}
            {snapshot.used_dictionaries.length > 0 && (
              <Stack gap={2}>
                <Text size="xs" c="dimmed" fw={500}>
                  Dictionaries
                </Text>
                <Group gap={4} wrap="wrap">
                  {snapshot.used_dictionaries.map((d) => (
                    <Tag key={d} mono>
                      {d}
                    </Tag>
                  ))}
                </Group>
              </Stack>
            )}
          </Section>
        )}
      </Stack>
    </Box>
  );
}
