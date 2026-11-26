import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { useTabs, type QueryTab } from "../state/tabs";

export interface KeyboardShortcutOptions {
  onRun: (tab: QueryTab) => void;
  onRunAll: (tab: QueryTab) => void;
  onSave: (tab: QueryTab) => void;
  onCancel: (tab: QueryTab) => void;
  onCloseTab: (tab: QueryTab) => void;
  onNewTab: () => void;
  onFormat: () => void;
  onPaletteOpen: () => void;
  onCheatOpen: () => void;
}

export type ShortcutAction =
  | "new-tab"
  | "reopen-tab"
  | "close-tab"
  | "save"
  | "run"
  | "run-all"
  | "cancel"
  | "format"
  | "palette"
  | "cheat-sheet"
  | "select-none"
  | `tab-${number}`;

// ⌘, is the native Settings… menu accelerator; binding it here too adds a second path.
const KEYS: Record<string, ShortcutAction> = {
  Enter: "run",
  KeyN: "new-tab",
  KeyT: "new-tab",
  KeyW: "close-tab",
  KeyS: "save",
  KeyP: "palette",
  Period: "cancel",
  KeyA: "select-none",
};

const SHIFT_KEYS: Record<string, ShortcutAction> = {
  Enter: "run-all",
  KeyT: "reopen-tab",
  KeyL: "format",
  // Monaco consumes Cmd+/ to toggle a line comment, so this needs Shift.
  Slash: "cheat-sheet",
};

// Monaco binds these keys while focused; firing here would run them twice.
const MONACO_ACTIONS = new Set<ShortcutAction>(["run", "run-all", "format"]);

function keyAction(e: KeyboardEvent): ShortcutAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.shiftKey) return `tab-${Number(digit[1])}`;
  return (e.shiftKey ? SHIFT_KEYS : KEYS)[e.code] ?? null;
}

function runAction(id: string, o: KeyboardShortcutOptions): boolean {
  const focus = document.activeElement;
  // A closed Mantine Modal keeps its root in the DOM, so test its content.
  if (
    id !== "cancel" &&
    (document.querySelector(".mantine-Modal-content") ||
      (focus instanceof Element && focus.closest(".mantine-Drawer-content")))
  ) {
    return false;
  }
  const { tabs, activeId, setActive, reopenLast } = useTabs.getState();
  const t = tabs.find((x) => x.id === activeId);
  const digit = /^tab-([1-9])$/.exec(id);
  if (digit) {
    const target = tabs[Number(digit[1]) - 1];
    if (target) setActive(target.id);
    return true;
  }
  switch (id) {
    case "new-tab":
      o.onNewTab();
      break;
    case "reopen-tab":
      reopenLast();
      break;
    case "close-tab":
      if (t) o.onCloseTab(t);
      break;
    case "save":
      if (t) o.onSave(t);
      break;
    case "run":
      if (t) o.onRun(t);
      break;
    case "run-all":
      if (t) o.onRunAll(t);
      break;
    case "cancel":
      if (t && t.runningQueryId) o.onCancel(t);
      break;
    case "format":
      o.onFormat();
      break;
    case "palette":
      o.onPaletteOpen();
      break;
    case "cheat-sheet":
      o.onCheatOpen();
      break;
    case "select-none":
      break;
    default:
      return false;
  }
  return true;
}

export function useKeyboardShortcuts(opts: KeyboardShortcutOptions): void {
  const ref = useRef(opts);
  // eslint-disable-next-line react-hooks/refs -- the listener reads the latest options from this write.
  ref.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const id = keyAction(e);
      if (!id) return;
      const focus = document.activeElement;
      const within = (selector: string) =>
        focus instanceof Element && focus.closest(selector) !== null;
      if (MONACO_ACTIONS.has(id) && within(".monaco-editor")) return;
      if (
        id === "select-none" &&
        within(
          "input, textarea, [contenteditable]:not([contenteditable=false]), .monaco-editor, .chg-grid",
        )
      )
        return;
      if (runAction(id, ref.current)) e.preventDefault();
    };
    document.addEventListener("keydown", handler);
    const unlisten = listen<string>("app:menu-action", (e) => {
      runAction(e.payload, ref.current);
    });
    return () => {
      document.removeEventListener("keydown", handler);
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
