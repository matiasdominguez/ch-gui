import { useSyncExternalStore } from "react";

import { formatExactLocal, formatRelativeOrShort } from "../lib/errorsFormat";

const TICK_MS = 30_000;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function TimeAgo({ value }: { value: string }) {
  const at = useSyncExternalStore(subscribe, () => now);
  return (
    <span title={formatExactLocal(value)}>
      {formatRelativeOrShort(value, at)}
    </span>
  );
}
