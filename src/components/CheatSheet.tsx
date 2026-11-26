import { Box, Modal, ScrollArea, Stack, Text } from "@mantine/core";

interface Shortcut {
  keys: string;
  description: string;
}
interface Section {
  title: string;
  shortcuts: Shortcut[];
}

const SECTIONS: Section[] = [
  {
    title: "App-wide",
    shortcuts: [
      {
        keys: "⌘↵",
        description: "Run the selection, or the statement under the cursor",
      },
      { keys: "⌘⇧↵", description: "Run every statement in the editor" },
      {
        keys: "⌘S",
        description: "Save the active tab's query, or update its saved copy",
      },
      { keys: "⌘.", description: "Cancel the active tab's running query" },
      { keys: "⌘N / ⌘T", description: "New tab" },
      { keys: "⌘⇧T", description: "Reopen last closed tab" },
      { keys: "⌘W", description: "Close the active tab, not the window" },
      { keys: "⌘1…9", description: "Go to tab N" },
      { keys: "⌘P", description: "Open the command palette" },
      { keys: "⌘,", description: "Open Settings" },
      { keys: "⌘?", description: "Open this cheat sheet" },
    ],
  },
  {
    title: "Query editor (Monaco)",
    shortcuts: [
      {
        keys: "⌘↵",
        description: "Run the selection, or the statement under the cursor",
      },
      { keys: "⌘⇧↵", description: "Run every statement in the editor" },
      {
        keys: "⌘⇧L",
        description:
          "Format SQL with the server's formatQuery, or locally if that fails",
      },
      { keys: "esc", description: "Move focus to the params bar" },
    ],
  },
  {
    title: "Params bar",
    shortcuts: [
      { keys: "↵", description: "Run the query" },
      { keys: "esc", description: "Move focus to the editor" },
    ],
  },
  {
    title: "Results grid (when focused)",
    shortcuts: [
      { keys: "click", description: "Select a cell" },
      { keys: "drag", description: "Select a rectangular range of cells" },
      {
        keys: "⇧click",
        description: "Extend the selection to the clicked cell",
      },
      { keys: "click header", description: "Select the whole column" },
      {
        keys: "click ⇅",
        description: "Toggle sort on that column (none → asc → desc)",
      },
      {
        keys: "drag edge",
        description: "Resize the column by dragging its right edge",
      },
      {
        keys: "dblclick grip",
        description: "Fit the column to its widest visible value",
      },
      { keys: "arrows", description: "Move the cell selection" },
      { keys: "⇧arrows", description: "Extend or shrink the selected range" },
      {
        keys: "⌘A",
        description: "Select every cell in the grid",
      },
      {
        keys: "⌘C",
        description:
          "Copy the selection. One cell copies as plain text. A larger range copies as tab-separated text with headers, which pastes into spreadsheet cells.",
      },
      {
        keys: "⌘⇧C",
        description:
          "Copy the selection, or the whole grid, as a Markdown table",
      },
      { keys: "⌘F", description: "Search the grid" },
      {
        keys: "↵ / ⇧↵",
        description: "Go to the next or previous search match",
      },
      {
        keys: "esc",
        description: "Clear the selection or close the search",
      },
    ],
  },
];

interface Props {
  opened: boolean;
  onClose: () => void;
}

export function CheatSheet({ opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="lg"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        {SECTIONS.map((s) => (
          <Box key={s.title}>
            <Text className="chg-sheet-section" mb={6}>
              {s.title}
            </Text>
            <Stack gap={4}>
              {s.shortcuts.map((sc, i) => (
                <Box
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr",
                    columnGap: 16,
                    alignItems: "baseline",
                  }}
                >
                  <Text size="xs" className="chg-keys">
                    {sc.keys}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {sc.description}
                  </Text>
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Modal>
  );
}
