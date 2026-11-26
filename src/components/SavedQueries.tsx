import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { DotsThreeIcon } from "@phosphor-icons/react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  deleteSavedQuery,
  listSavedQueries,
  updateSavedQuery,
} from "../lib/db";
import { notifyError } from "../lib/notify";
import { SAMPLE_QUERIES } from "../lib/sampleQueries";
import { useTabs } from "../state/tabs";
import { ErrorBox } from "./Errors";
import { NameInputModal } from "./NameInputModal";
import { SectionLabel } from "./ui";

interface Props {
  connectionId: string | null;
}

export function SavedQueries({ connectionId }: Props) {
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["saved_queries", connectionId, search],
    queryFn: () => listSavedQueries(connectionId!, search, 200),
    enabled: Boolean(connectionId),
    placeholderData: keepPreviousData,
  });

  if (!connectionId) {
    return (
      <Text size="xs" c="dimmed" px="sm">
        Pick a connection to see its saved queries.
      </Text>
    );
  }

  const items = q.data ?? [];
  const renamingItem =
    renamingId != null
      ? (items.find((s) => s.id === renamingId) ?? null)
      : null;
  const deletingItem =
    deletingId != null
      ? (items.find((s) => s.id === deletingId) ?? null)
      : null;

  const needle = search.trim().toLowerCase();
  const samples = needle
    ? SAMPLE_QUERIES.filter(
        (s) =>
          s.title.toLowerCase().includes(needle) ||
          s.sql.toLowerCase().includes(needle),
      )
    : SAMPLE_QUERIES;

  async function onRenameSubmit(newName: string) {
    if (!renamingItem) return;
    if (newName === renamingItem.name) {
      setRenamingId(null);
      return;
    }
    try {
      await updateSavedQuery(renamingItem.id, {
        name: newName,
        sql: renamingItem.sql,
      });
      qc.invalidateQueries({ queryKey: ["saved_queries", connectionId] });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Rename failed", e.message ?? String(err));
    } finally {
      setRenamingId(null);
    }
  }

  async function onDeleteConfirm() {
    if (!deletingItem) return;
    try {
      await deleteSavedQuery(deletingItem.id);
      qc.invalidateQueries({ queryKey: ["saved_queries", connectionId] });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Delete failed", e.message ?? String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Stack gap={4} h="100%">
      <NameInputModal
        opened={renamingItem !== null}
        title="Rename saved query"
        label="Name"
        submitLabel="Rename"
        initialValue={renamingItem?.name ?? ""}
        onSubmit={onRenameSubmit}
        onCancel={() => setRenamingId(null)}
      />
      <Modal
        opened={deletingItem !== null}
        onClose={() => setDeletingId(null)}
        title="Delete saved query?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Delete <b>{deletingItem?.name}</b>? You can't undo this.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeletingId(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={onDeleteConfirm}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Box px="sm">
        <TextInput
          size="xs"
          placeholder="Search saved queries…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Box>
      <ScrollArea flex={1} px="xs">
        {q.isError ? (
          <ErrorBox
            message={String((q.error as Error).message ?? q.error)}
            onRetry={() => q.refetch()}
          />
        ) : items.length === 0 ? (
          <Text size="xs" c="dimmed" px="xs">
            No saved queries yet.
          </Text>
        ) : (
          items.map((s) => (
            <SavedRow
              key={s.id}
              s={s}
              onRename={setRenamingId}
              onDelete={setDeletingId}
            />
          ))
        )}
        {samples.length > 0 && (
          <>
            <Box pt="sm" pb={2}>
              <SectionLabel title="Samples" />
            </Box>
            {samples.map((s) => (
              <UnstyledButton
                key={s.title}
                className="chg-list-row"
                style={{ minWidth: 0 }}
                onClick={() => {
                  useTabs.getState().open({ title: s.title, sql: s.sql });
                }}
              >
                <Stack gap={2}>
                  <Text size="xs" fw={500} truncate>
                    {s.title}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    lineClamp={1}
                    className="chg-mono chg-excerpt"
                  >
                    {s.sql.replace(/\s+/g, " ")}
                  </Text>
                </Stack>
              </UnstyledButton>
            ))}
          </>
        )}
      </ScrollArea>
    </Stack>
  );
}

function SavedRow({
  s,
  onRename,
  onDelete,
}: {
  s: { id: number; name: string; sql: string };
  onRename: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Group
      gap={2}
      wrap="nowrap"
      align="flex-start"
      className="chg-row-with-more"
    >
      <UnstyledButton
        className="chg-list-row"
        style={{ flex: 1, minWidth: 0 }}
        onClick={() => {
          useTabs.getState().openSaved(s);
        }}
      >
        <Stack gap={2}>
          <Text size="xs" fw={500} truncate>
            {s.name}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            lineClamp={1}
            className="chg-mono chg-excerpt"
          >
            {s.sql}
          </Text>
        </Stack>
      </UnstyledButton>
      <Menu shadow="md" width={140} position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label="Saved query actions"
            className="chg-row-more"
          >
            <DotsThreeIcon weight="bold" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => onRename(s.id)}>Rename</Menu.Item>
          <Menu.Item color="red" onClick={() => onDelete(s.id)}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
