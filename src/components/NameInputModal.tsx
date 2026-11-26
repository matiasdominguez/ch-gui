import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";

interface Props {
  opened: boolean;
  title: string;
  label?: string;
  submitLabel?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Replaces window.prompt, which returns null in WKWebView without showing a
 * dialog. */
export function NameInputModal({
  opened,
  title,
  label,
  submitLabel = "Save",
  initialValue = "",
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (opened) setValue(initialValue);
  }, [opened, initialValue]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered>
      <Stack gap="md">
        <TextInput
          label={label}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          data-autofocus
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
