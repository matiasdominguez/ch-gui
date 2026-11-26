import {
  Button,
  Group,
  Kbd,
  List,
  Modal,
  Stack,
  Stepper,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

interface Props {
  opened: boolean;
  onClose: () => void;
  onAddConnection: () => void;
}

export function WelcomeModal({ opened, onClose, onAddConnection }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (opened) setStep(0);
  }, [opened]);

  const next = () => setStep((s) => Math.min(2, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function handleAddConnection() {
    onClose();
    onAddConnection();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Welcome to ch-gui"
      size="lg"
      centered
    >
      <Stack gap="lg">
        <Stepper active={step} onStepClick={setStep} size="sm">
          <Stepper.Step label="What's here">
            <Stack gap="sm" pt="md">
              <Text size="sm">
                ch-gui is a native ClickHouse client for macOS. It includes:
              </Text>
              <List size="sm" spacing={4}>
                <List.Item>
                  Connections to multiple clusters, with passwords in the macOS
                  Keychain
                </List.Item>
                <List.Item>
                  Monaco SQL editor with schema-aware autocomplete and inline
                  ClickHouse function docs
                </List.Item>
                <List.Item>
                  Schema sidebar with row preview and column distribution
                  (nulls, cardinality, top-k)
                </List.Item>
                <List.Item>
                  Virtualized results grid with sort, resize, CSV export, and
                  bar/line charts
                </List.Item>
                <List.Item>
                  Saved queries, per-connection history, and{" "}
                  <Text component="span" ff="monospace">
                    {"{param}"}
                  </Text>{" "}
                  substitution
                </List.Item>
                <List.Item>
                  Monitor tab with Server Activity, Live Queries, and (when the
                  server has Kafka tables) Kafka consumer status
                </List.Item>
              </List>
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Connect">
            <Stack gap="sm" pt="md">
              <Text size="sm">Add your first ClickHouse connection.</Text>
              <Text size="sm" c="dimmed">
                ch-gui stores passwords in the macOS Keychain, never in plain
                text.
              </Text>
              <Group>
                <Button onClick={handleAddConnection}>Add connection</Button>
              </Group>
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Tips">
            <Stack gap="sm" pt="md">
              <Text size="sm">Useful shortcuts:</Text>
              <List size="sm" spacing={4}>
                <List.Item>
                  <Kbd>⌘</Kbd> <Kbd>?</Kbd> — all keyboard shortcuts
                </List.Item>
                <List.Item>
                  <Kbd>⌘</Kbd> <Kbd>P</Kbd> — command palette (open saved
                  queries and tabs, insert table names)
                </List.Item>
                <List.Item>
                  <Kbd>⌘</Kbd> <Kbd>N</Kbd> — new query tab
                </List.Item>
                <List.Item>
                  <Kbd>⌘</Kbd> <Kbd>↵</Kbd> — run the active tab's query
                </List.Item>
                <List.Item>
                  <Kbd>⌘</Kbd> <Kbd>S</Kbd> — save the current tab's query
                </List.Item>
              </List>
              <Text size="xs" c="dimmed">
                Reopen this tour from Help → Welcome….
              </Text>
            </Stack>
          </Stepper.Step>
        </Stepper>

        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {step === 2 ? "Close" : "Skip"}
          </Button>
          <Group gap="xs">
            {step > 0 && (
              <Button variant="default" onClick={back}>
                Back
              </Button>
            )}
            {step < 2 ? (
              <Button onClick={next}>Next</Button>
            ) : (
              <Button onClick={onClose}>Done</Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
