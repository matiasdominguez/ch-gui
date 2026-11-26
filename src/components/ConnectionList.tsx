import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { DotsThreeIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { countSavedQueries } from "../lib/db";
import { notifyError } from "../lib/notify";
import { useConnectionUI } from "../state/connectionUI";
import { useConnections } from "../state/connections";
import type { Connection } from "../types";

import { ConnectionForm } from "./ConnectionForm";
import { SectionLabel } from "./ui";

let deleteDialogToken = 0;

interface Props {
  payloadError?: { message: string; keychain: boolean } | null;
  onRetryPayload?: () => void;
}

export function ConnectionList({ payloadError, onRetryPayload }: Props = {}) {
  const { connections, activeId, setActive, remove, loadError, load } =
    useConnections();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  // The token identifies one dialog opening, so a slow count from an earlier
  // opening cannot replace this one. `n` is null while loading.
  const [savedCount, setSavedCount] = useState<{
    token: number;
    n: number | null;
    failed?: boolean;
  } | null>(null);
  function askDelete(c: Connection) {
    const token = ++deleteDialogToken;
    setSavedCount({ token, n: null });
    setDeleting(c);
    const settle = (next: { n: number | null; failed?: boolean }) =>
      setSavedCount((prev) =>
        prev?.token === token ? { token, ...next } : prev,
      );
    countSavedQueries(c.id)
      .then((n) => settle({ n }))
      .catch(() => settle({ n: null, failed: true }));
  }
  const count = deleting ? savedCount : null;
  const countKnown = count != null && (count.n != null || count.failed);
  const newConnectionOpen = useConnectionUI((s) => s.newConnectionOpen);
  const openNewConnection = useConnectionUI((s) => s.openNewConnection);
  const closeNewConnection = useConnectionUI((s) => s.closeNewConnection);
  const opened = newConnectionOpen || editOpen;

  function openNew() {
    setEditing(null);
    setEditOpen(false);
    openNewConnection();
  }

  function openEdit(c: Connection) {
    setEditing(c);
    setEditOpen(true);
  }

  function close() {
    closeNewConnection();
    setEditOpen(false);
    setEditing(null);
  }

  // window.confirm does nothing in the Tauri webview, so deletion confirms
  // through a Mantine Modal.
  async function onDeleteConfirm() {
    if (!deleting) return;
    try {
      await remove(deleting.id);
    } catch (err) {
      const e = err as { message?: string };
      notifyError("Delete failed", e.message ?? String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Box>
      <SectionLabel
        title="Connection"
        action={
          <Button
            variant="subtle"
            size="compact-xs"
            className="chg-new-connection"
            leftSection={<PlusIcon size={12} />}
            onClick={openNew}
          >
            New
          </Button>
        }
      />

      <Group
        gap={4}
        align="center"
        wrap="nowrap"
        className="chg-connection-row"
      >
        <Select
          className="chg-connection-select"
          flex={1}
          placeholder={
            connections.length ? "Pick a connection" : "No connections yet"
          }
          data={connections.map((c) => ({ value: c.id, label: c.name }))}
          value={activeId}
          onChange={setActive}
          searchable
          nothingFoundMessage="No matches"
          disabled={connections.length === 0}
        />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              disabled={!activeId}
              aria-label="Connection actions"
            >
              <DotsThreeIcon weight="bold" />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => {
                const c = connections.find((c) => c.id === activeId);
                if (c) openEdit(c);
              }}
            >
              Edit…
            </Menu.Item>
            <Menu.Item
              color="red"
              onClick={() => {
                const c = connections.find((c) => c.id === activeId);
                if (c) askDelete(c);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {payloadError && activeId && (
        <Group gap={6} mt={4} wrap="nowrap" align="baseline">
          <Text size="xs" c="red" style={{ wordBreak: "break-word" }} flex={1}>
            {payloadError.keychain
              ? "Couldn't read this connection's password from the Keychain"
              : "Couldn't load this connection"}
            : {payloadError.message}
          </Text>
          <Button variant="subtle" size="compact-xs" onClick={onRetryPayload}>
            Retry
          </Button>
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              const c = connections.find((c) => c.id === activeId);
              if (c) openEdit(c);
            }}
          >
            Edit
          </Button>
        </Group>
      )}

      {loadError && (
        <Group gap={6} mt={4} wrap="nowrap" align="baseline">
          <Text size="xs" c="red" style={{ wordBreak: "break-word" }} flex={1}>
            Couldn't load connections: {loadError}
          </Text>
          <Button variant="subtle" size="compact-xs" onClick={() => load()}>
            Retry
          </Button>
        </Group>
      )}

      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete connection?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Delete <b>{deleting?.name}</b>? This also removes its query history
            and stored password
            {count?.failed ? (
              <>
                , and <b>all its saved queries</b>
              </>
            ) : count?.n ? (
              <>
                , and{" "}
                <b>
                  {count.n} saved {count.n === 1 ? "query" : "queries"}
                </b>
              </>
            ) : null}
            .
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={onDeleteConfirm}
              disabled={!countKnown}
              loading={!countKnown}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={opened}
        onClose={close}
        title={editing ? "Edit connection" : "New connection"}
        size="lg"
        centered
        // Esc or an outside click would discard a half-typed connection.
        closeOnEscape={false}
        closeOnClickOutside={false}
      >
        <Stack>
          <ConnectionForm initial={editing} onClose={close} />
        </Stack>
      </Modal>
    </Box>
  );
}
