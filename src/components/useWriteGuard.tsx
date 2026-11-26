import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useState, type ReactNode } from "react";

import { substituteParams } from "../lib/params";
import { hasWriteStatement } from "../lib/writeStatement";
import { useTabs, type QueryTab } from "../state/tabs";

export function useWriteGuard(): {
  guardRun: (t: QueryTab, sql: string, run: () => boolean) => void;
  guardModal: ReactNode;
} {
  const [pending, setPending] = useState<{
    tabId: string;
    run: () => boolean;
  } | null>(null);

  function guardRun(t: QueryTab, sql: string, run: () => boolean) {
    // Check the SQL as it will run, since a {!raw} value can hold the write.
    const willRun = substituteParams(sql, t.paramValues);
    if (t.guardWrites && hasWriteStatement(willRun)) {
      setPending({ tabId: t.id, run });
    } else {
      run();
    }
  }

  const guardModal = (
    <Modal
      opened={pending !== null}
      onClose={() => setPending(null)}
      title="Run this INSERT again?"
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          This tab holds the INSERT from a failed materialized view. Running it
          writes the same rows a second time.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              if (!pending) return;
              const { tabId, run } = pending;
              setPending(null);
              // Clear `guardWrites` only if the confirmed query started.
              if (run()) {
                useTabs.getState().patch(tabId, { guardWrites: false });
              }
            }}
          >
            Run it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { guardRun, guardModal };
}
