import { Box } from "@mantine/core";

import { cellToString } from "../lib/csv";
import type { CellValue } from "../types";

interface Props {
  rows: CellValue[][];
}

export function ExplainViewer({ rows }: Props) {
  const text = rows.map((r) => cellToString(r[0])).join("\n");
  return (
    <Box
      component="pre"
      h="100%"
      p="md"
      m={0}
      style={{
        overflow: "auto",
        whiteSpace: "pre",
        fontFamily: "var(--mantine-font-family-monospace)",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {text}
    </Box>
  );
}
