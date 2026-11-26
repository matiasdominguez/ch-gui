import { Group, Text, TextInput } from "@mantine/core";
import type { RefObject } from "react";

import type { ParamKind, ParamSpec } from "../lib/params";

interface Props {
  params: ParamSpec[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onRun: () => void;
  onEscape: () => void;
  firstInputRef?: RefObject<HTMLInputElement | null>;
}

const PLACEHOLDERS: Record<ParamKind, string> = {
  text: "text",
  number: "number",
  date: "date",
  raw: "raw SQL",
};

export function ParamsBar({
  params,
  values,
  onChange,
  onRun,
  onEscape,
  firstInputRef,
}: Props) {
  return (
    <Group gap={6} wrap="wrap" className="chg-params">
      <Text size="xs" className="chg-params-title">
        Params
      </Text>
      {params.map((spec, idx) => {
        const { name, kind } = spec;
        const inputType =
          kind === "date" ? "date" : kind === "number" ? "number" : undefined;
        return (
          <TextInput
            key={name}
            ref={idx === 0 ? firstInputRef : undefined}
            size="xs"
            type={inputType}
            inputMode={kind === "number" ? "decimal" : undefined}
            placeholder={PLACEHOLDERS[kind]}
            label={name}
            value={values[name] ?? ""}
            onChange={(e) => onChange(name, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRun();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onEscape();
              }
            }}
            className="chg-param"
          />
        );
      })}
    </Group>
  );
}
