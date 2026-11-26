import {
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { listChangedSettings } from "../lib/tauri";
import type { ConnectionConfigPayload } from "../types";

import { ErrorBox } from "./Errors";

interface Props {
  opened: boolean;
  onClose: () => void;
  payload: ConnectionConfigPayload | null;
}

export function ServerSettingsModal({ opened, onClose, payload }: Props) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!opened) setSearch("");
  }, [opened]);

  const q = useQuery({
    queryKey: ["changed_settings", payload?.id],
    queryFn: () => listChangedSettings(payload!),
    enabled: Boolean(opened && payload),
    staleTime: 30_000,
  });

  const needle = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      s.description.toLowerCase().includes(needle),
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      title={
        <Text fw={600} size="sm">
          Server settings changed from defaults
          {payload ? ` on ${payload.host}` : ""}
        </Text>
      }
    >
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Session settings that differ from ClickHouse's compiled defaults. They
          come from your user profile and from server-level overrides. Check
          this list first when a query behaves differently here than in another
          client.
        </Text>
        <TextInput
          size="xs"
          placeholder="Filter by name or description…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        {!payload ? (
          <Text size="xs" c="dimmed">
            No active connection. Pick a connection to see its session settings.
          </Text>
        ) : q.isLoading ? (
          <Text size="xs" c="dimmed">
            Loading…
          </Text>
        ) : q.isError ? (
          <ErrorBox
            message={
              (q.error as { message?: string })?.message ?? String(q.error)
            }
            onRetry={() => q.refetch()}
          />
        ) : rows.length === 0 ? (
          <Text size="xs" c="dimmed">
            {needle
              ? "No changed settings match the filter."
              : "No settings differ from the defaults. This session uses only ClickHouse's default settings."}
          </Text>
        ) : (
          <ScrollArea.Autosize mah="60vh" type="auto">
            <Table
              withTableBorder
              horizontalSpacing="xs"
              verticalSpacing={6}
              fz="xs"
              className="chg-table chg-table-prose"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Setting</Table.Th>
                  <Table.Th>Value</Table.Th>
                  <Table.Th>Default</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((s) => (
                  <Table.Tr key={s.name}>
                    <Table.Td style={{ maxWidth: 340 }}>
                      <Text
                        size="xs"
                        fw={500}
                        style={{
                          fontFamily: "var(--mantine-font-family-monospace)",
                          wordBreak: "break-all",
                        }}
                      >
                        {s.name}
                      </Text>
                      {s.description && (
                        <Tooltip
                          label={s.description}
                          multiline
                          w={420}
                          openDelay={300}
                        >
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {s.description}
                          </Text>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        fw={600}
                        className="chg-setting-value"
                        style={{ maxWidth: 180, wordBreak: "break-all" }}
                      >
                        {s.value}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{
                          fontFamily: "var(--mantine-font-family-monospace)",
                          wordBreak: "break-all",
                        }}
                      >
                        {s.default_value || "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Modal>
  );
}
