import {
  Button,
  Code,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import { copyWithToast } from "../lib/clipboard";
import { useTabs } from "../state/tabs";

export function openInsertTab(viewName: string, sql: string) {
  useTabs.getState().open({
    title: `INSERT → ${viewName}`,
    sql,
    guardWrites: true,
  });
}

export function InsertViewer({
  viewName,
  sql,
  opened,
  onClose,
}: {
  viewName: string;
  sql: string;
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`INSERT that triggered ${viewName}`}
      size="xl"
      centered
    >
      <Stack gap="md">
        <ScrollArea.Autosize mah="55vh">
          <Code
            block
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {sql}
          </Code>
        </ScrollArea.Autosize>
        <Text size="xs" c="dimmed">
          Running it again writes the same rows a second time.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button
            variant="default"
            onClick={() => copyWithToast(sql, "insert-copy")}
          >
            Copy
          </Button>
          <Button
            variant="default"
            onClick={() => {
              openInsertTab(viewName, sql);
              onClose();
            }}
          >
            Open in a new tab
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
