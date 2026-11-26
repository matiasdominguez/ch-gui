import { Button, Group, List, Modal, Stack, Text } from "@mantine/core";

import type { ChangelogEntry } from "../lib/changelog";

interface Props {
  opened: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
}

export function WhatsNewModal({ opened, onClose, entries }: Props) {
  const single = entries.length === 1;
  const title = single ? `What's New in ${entries[0].version}` : "What's New";

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg" centered>
      <Stack gap="lg">
        {entries.length === 0 ? (
          <Text size="sm" c="dimmed">
            No release notes for this version.
          </Text>
        ) : (
          entries.map((e) => (
            <Stack key={e.version} gap="xs">
              {!single && (
                <Group gap="xs" align="baseline">
                  <Text fw={600}>{e.version}</Text>
                  <Text size="xs" c="dimmed">
                    {e.date}
                  </Text>
                </Group>
              )}
              <List size="sm" spacing={6}>
                {e.changes.map((change, i) => (
                  <List.Item key={i}>{change}</List.Item>
                ))}
              </List>
            </Stack>
          ))
        )}
        <Group justify="flex-end">
          <Button onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
