import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, type ReactNode } from "react";

import { useTabs, type QueryTab } from "../state/tabs";

const UNDO_TOAST = "tab-closed";

export function useTabClose(cancelQuery: (t: QueryTab) => void): {
  requestClose: (t: QueryTab) => void;
  confirmModal: ReactNode;
} {
  const [pending, setPending] = useState<QueryTab | null>(null);

  function closeNow(t: QueryTab) {
    cancelQuery(t);
    useTabs.getState().close(t.id);
    if (!t.sql.trim()) return;
    // Undo restores this tab, not whichever tab closed last.
    const entry = useTabs.getState().closedStack[0];
    const toastId = `${UNDO_TOAST}-${t.id}`;
    notifications.show({
      id: toastId,
      autoClose: 6000,
      message: (
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm" truncate>
            Closed “{t.title}”
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => {
              if (entry) useTabs.getState().reopenClosed(entry);
              notifications.hide(toastId);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
    });
  }

  function requestClose(t: QueryTab) {
    if (t.runningQueryId) setPending(t);
    else closeNow(t);
  }

  const confirmModal = (
    <Modal
      opened={pending !== null}
      onClose={() => setPending(null)}
      title="Stop the query and close the tab?"
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          “{pending?.title}” is still running. Closing the tab cancels its
          query.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => setPending(null)}>
            Keep running
          </Button>
          <Button
            color="red"
            onClick={() => {
              // The tab may have finished, so close its current state.
              const current = useTabs
                .getState()
                .tabs.find((x) => x.id === pending?.id);
              setPending(null);
              if (current) closeNow(current);
            }}
          >
            Stop and close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { requestClose, confirmModal };
}
