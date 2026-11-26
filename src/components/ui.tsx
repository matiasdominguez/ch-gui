import { Text } from "@mantine/core";
import type { ReactNode } from "react";

export type Tone = "red" | "yellow" | "green" | "gray" | "accent";

export function Count({
  tone = "gray",
  children,
  label,
}: {
  tone?: Tone;
  children: ReactNode;
  label?: string;
}) {
  return (
    <span className="chg-count" data-tone={tone} aria-label={label}>
      {children}
    </span>
  );
}

export function Tag({
  tone = "gray",
  mono,
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="chg-tag" data-tone={tone} data-mono={mono || undefined}>
      {children}
    </span>
  );
}

export function Dot({ tone = "gray" }: { tone?: Tone }) {
  return <span className="chg-dot" data-tone={tone} aria-hidden />;
}

export function Shortcut({ children }: { children: ReactNode }) {
  return <span className="chg-shortcut">{children}</span>;
}

export function SectionLabel({
  title,
  count,
  tone = "red",
  subtitle,
  action,
}: {
  title: ReactNode;
  count?: number | null;
  tone?: Tone;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="chg-section">
      <div className="chg-section-row">
        <span className="chg-section-title">{title}</span>
        {count != null && count > 0 && <Count tone={tone}>{count}</Count>}
        <span className="chg-section-rule" />
        {action}
      </div>
      {subtitle && <div className="chg-section-sub">{subtitle}</div>}
    </div>
  );
}

export function NoConnection({
  failed,
  size = "xs",
  children,
}: {
  failed?: boolean;
  size?: "xs" | "sm";
  children: ReactNode;
}) {
  return (
    <Text size={size} c="dimmed" px="sm">
      {failed
        ? "This connection isn't ready. The connection picker shows the error."
        : children}
    </Text>
  );
}
