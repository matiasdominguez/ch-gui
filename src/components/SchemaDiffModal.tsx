import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  NativeSelect,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { computeSchemaDiff } from "../lib/schemaDiff";
import {
  fetchTableDetails,
  introspectDatabases,
  introspectTables,
} from "../lib/tauri";
import type { ColumnDetail, ConnectionConfigPayload } from "../types";

interface TableRef {
  database: string;
  table: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  payload: ConnectionConfigPayload | null;
  prefill: TableRef | null;
}

export function SchemaDiffModal({ opened, onClose, payload, prefill }: Props) {
  const [sideA, setSideA] = useState<Partial<TableRef>>({});
  const [sideB, setSideB] = useState<Partial<TableRef>>({});
  const [hasCompared, setHasCompared] = useState(false);

  useEffect(() => {
    if (opened) {
      setSideA(prefill ? { ...prefill } : {});
      setSideB({});
      setHasCompared(false);
    }
  }, [opened, prefill]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Compare two tables"
      size="xl"
      centered
    >
      <Stack gap="md">
        <Group align="flex-end" gap="md" grow>
          <SidePicker
            label="Side A"
            payload={payload}
            value={sideA}
            onChange={setSideA}
          />
          <SidePicker
            label="Side B"
            payload={payload}
            value={sideB}
            onChange={setSideB}
          />
        </Group>

        <Group justify="flex-end">
          <Button
            onClick={() => setHasCompared(true)}
            disabled={
              !payload ||
              !sideA.database ||
              !sideA.table ||
              !sideB.database ||
              !sideB.table
            }
          >
            Compare
          </Button>
        </Group>

        {hasCompared &&
          payload &&
          sideA.database &&
          sideA.table &&
          sideB.database &&
          sideB.table && (
            <DiffView
              payload={payload}
              a={{ database: sideA.database, table: sideA.table }}
              b={{ database: sideB.database, table: sideB.table }}
            />
          )}
      </Stack>
    </Modal>
  );
}

function SidePicker({
  label,
  payload,
  value,
  onChange,
}: {
  label: string;
  payload: ConnectionConfigPayload | null;
  value: Partial<TableRef>;
  onChange: (next: Partial<TableRef>) => void;
}) {
  const dbs = useQuery({
    queryKey: ["dbs", payload?.id],
    queryFn: () => introspectDatabases(payload!),
    enabled: Boolean(payload),
    staleTime: 60_000,
  });
  const tables = useQuery({
    queryKey: ["tables", payload?.id, value.database],
    queryFn: () => introspectTables(payload!, value.database!),
    enabled: Boolean(payload && value.database),
    staleTime: 60_000,
  });

  const dbOptions = useMemo(
    () => [
      { value: "", label: "Select a database" },
      ...(dbs.data ?? []).map((d) => ({ value: d.name, label: d.name })),
    ],
    [dbs.data],
  );
  const tableOptions = useMemo(
    () => [
      { value: "", label: "Select a table" },
      ...(tables.data ?? []).map((t) => ({ value: t.name, label: t.name })),
    ],
    [tables.data],
  );

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed">
        {label}
      </Text>
      <NativeSelect
        size="sm"
        data={dbOptions}
        value={value.database ?? ""}
        onChange={(e) =>
          onChange({
            database: e.currentTarget.value || undefined,
            table: undefined,
          })
        }
        disabled={!payload || dbs.isLoading}
      />
      <NativeSelect
        size="sm"
        data={tableOptions}
        value={value.table ?? ""}
        onChange={(e) =>
          onChange({ ...value, table: e.currentTarget.value || undefined })
        }
        disabled={!value.database || tables.isLoading}
      />
    </Stack>
  );
}

function DiffView({
  payload,
  a,
  b,
}: {
  payload: ConnectionConfigPayload;
  a: TableRef;
  b: TableRef;
}) {
  const sameTable = a.database === b.database && a.table === b.table;

  const aq = useQuery({
    queryKey: ["table_details", payload.id, a.database, a.table],
    queryFn: () => fetchTableDetails(payload, a.database, a.table),
    enabled: !sameTable,
    staleTime: 30_000,
  });
  const bq = useQuery({
    queryKey: ["table_details", payload.id, b.database, b.table],
    queryFn: () => fetchTableDetails(payload, b.database, b.table),
    enabled: !sameTable,
    staleTime: 30_000,
  });

  if (sameTable) {
    return (
      <Alert color="blue" variant="light">
        Side A and Side B are the same table.
      </Alert>
    );
  }

  if (aq.isLoading || bq.isLoading) {
    return (
      <Center h={200}>
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading schemas…
          </Text>
        </Stack>
      </Center>
    );
  }

  const aError = aq.isError ? errorMessage(aq.error) : null;
  const bError = bq.isError ? errorMessage(bq.error) : null;
  if (aError || bError) {
    return (
      <Stack gap="xs">
        {aError && (
          <Alert
            color="red"
            variant="light"
            title={`Side A: ${a.database}.${a.table}`}
          >
            {aError}
          </Alert>
        )}
        {bError && (
          <Alert
            color="red"
            variant="light"
            title={`Side B: ${b.database}.${b.table}`}
          >
            {bError}
          </Alert>
        )}
      </Stack>
    );
  }

  if (!aq.data || !bq.data) return null;

  const diff = computeSchemaDiff(aq.data, bq.data);
  const unchangedCount =
    aq.data.columns.length - diff.only_in_a.length - diff.changed.length;
  const nothingDifferent =
    diff.only_in_a.length === 0 &&
    diff.only_in_b.length === 0 &&
    diff.changed.length === 0;

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Badge color="gray" variant="light">
          {unchangedCount} unchanged
        </Badge>
        <Badge color="red" variant="light">
          {diff.only_in_a.length} only in A
        </Badge>
        <Badge color="teal" variant="light">
          {diff.only_in_b.length} only in B
        </Badge>
        <Badge color="yellow" variant="light">
          {diff.changed.length} changed
        </Badge>
      </Group>

      {nothingDifferent && (
        <Alert color="green" variant="light">
          No column differences between{" "}
          <code>
            {a.database}.{a.table}
          </code>{" "}
          and{" "}
          <code>
            {b.database}.{b.table}
          </code>
          .
        </Alert>
      )}

      <ScrollArea.Autosize mah={440}>
        <Stack gap="md">
          <DiffSection
            title={`Only in A: ${a.database}.${a.table}`}
            color="red"
            columns={diff.only_in_a}
          />
          <DiffSection
            title={`Only in B: ${b.database}.${b.table}`}
            color="teal"
            columns={diff.only_in_b}
          />
          <ChangedSection
            aLabel={`${a.database}.${a.table}`}
            bLabel={`${b.database}.${b.table}`}
            changed={diff.changed}
          />
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function DiffSection({
  title,
  color,
  columns,
}: {
  title: string;
  color: string;
  columns: ColumnDetail[];
}) {
  if (columns.length === 0) return null;
  return (
    <Box>
      <Group gap={6} mb={6}>
        <Badge color={color} variant="light" size="sm">
          {columns.length}
        </Badge>
        <Text size="sm" fw={600}>
          {title}
        </Text>
      </Group>
      <Table
        withTableBorder
        withColumnBorders
        striped
        styles={{
          table: {
            fontFamily: "var(--mantine-font-family-monospace)",
            fontSize: 12,
          },
        }}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Default</Table.Th>
            <Table.Th>Codec</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {columns.map((c) => (
            <Table.Tr key={c.name}>
              <Table.Td>{c.name}</Table.Td>
              <Table.Td>{c.type_str}</Table.Td>
              <Table.Td>{formatDefault(c)}</Table.Td>
              <Table.Td>{c.compression_codec || "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

function ChangedSection({
  aLabel,
  bLabel,
  changed,
}: {
  aLabel: string;
  bLabel: string;
  changed: { a: ColumnDetail; b: ColumnDetail }[];
}) {
  if (changed.length === 0) return null;
  return (
    <Box>
      <Group gap={6} mb={6}>
        <Badge color="yellow" variant="light" size="sm">
          {changed.length}
        </Badge>
        <Text size="sm" fw={600}>
          Changed
        </Text>
      </Group>
      <Stack gap="sm">
        {changed.map(({ a, b }) => (
          <Box
            key={a.name}
            p="xs"
            style={{
              border: "1px solid var(--mantine-color-yellow-3)",
              borderRadius: 4,
            }}
          >
            <Text
              fw={600}
              size="sm"
              mb={4}
              style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
            >
              {a.name}
            </Text>
            <Divider my={4} />
            <Group align="flex-start" gap="md" grow>
              <ChangeSide label={aLabel} col={a} />
              <ChangeSide label={bLabel} col={b} />
            </Group>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function ChangeSide({ label, col }: { label: string; col: ColumnDetail }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text
        size="xs"
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        type: {col.type_str}
      </Text>
      <Text
        size="xs"
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        default: {formatDefault(col)}
      </Text>
      <Text
        size="xs"
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        codec: {col.compression_codec || "—"}
      </Text>
    </Stack>
  );
}

function formatDefault(c: ColumnDetail): string {
  if (!c.default_kind && !c.default_expression) return "—";
  if (c.default_kind && c.default_expression) {
    return `${c.default_kind} ${c.default_expression}`;
  }
  return c.default_kind || c.default_expression;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
